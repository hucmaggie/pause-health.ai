"""Wire-level contract tests run against a **real** JupyterHealth Exchange.

These tests mirror ``test_exchange_integration.py`` but the fixture is
``IngestConfig.from_env()`` instead of the in-process ``JheMockServer``.
They are opt-in: every test carries ``@pytest.mark.real_jhe`` and the
collection hook in ``conftest.py`` skips them unless
``PAUSE_USE_REAL_JHE=1`` is set in the environment.

When to run:

    cd pause_ingest
    PAUSE_USE_REAL_JHE=1 pytest -v tests/test_exchange_real_jhe.py

Prerequisites (see docs/JHE_SETUP_RUNBOOK.md):

  * The JHE Docker stack is up (``jhe-local && ./bootstrap.sh``).
  * ``pause_ingest/.env`` is populated with ``JHE_BASE_URL``,
    ``JHE_CLIENT_ID``, ``JHE_CLIENT_SECRET``, ``JHE_PATIENT_FHIR_ID``,
    ``JHE_DATA_SOURCE_ID``, and ``JHE_FHIR_SOURCE_ID``. The bootstrap
    script prints these on a successful seed.

Differences from the mock contract test:

  * No call-count assertions (``token_calls`` / ``upload_calls`` /
    ``list_calls``). The real JHE doesn't expose those, and they're
    properties of our client, not the server.
  * No raw-bundle-size assertions. Real JHE accumulates observations
    across runs, so a freshly uploaded observation must be located by
    its server-assigned id, not by ``len(fetched) == N``.
  * No symmetric "mapped handler must not require the FHIR-Source-ID
    header" assertion — that's an implementation detail of the mock.
    Real JHE just accepts the mapped write regardless of whether the
    header is sent.
"""

from __future__ import annotations

import base64
import dataclasses
import json
import uuid

import httpx
import pytest

from pause_ingest import (
    IngestConfig,
    convert_sample,
    hrv_features_to_fhir_observation,
    hrv_time_domain_fallback,
    omh_to_fhir_observation,
    read_recent_observations,
    upload_observation,
)


pytestmark = pytest.mark.real_jhe


@pytest.fixture(scope="module")
def config() -> IngestConfig:
    """Load IngestConfig from the developer's .env.

    A clear error here means the .env isn't populated — the runbook
    has the exact value list. We intentionally let ``from_env`` raise
    rather than skip silently, so a misconfigured real-JHE run is loud.
    """
    return IngestConfig.from_env()


def _unique_oura_observation(
    config: IngestConfig, *, bpm: int = 72
) -> tuple[dict[str, object], str]:
    """Build a fresh OMH heart-rate Observation tagged with a unique marker.

    Returns ``(observation, marker)``. Real JHE accumulates state across
    test runs, so we tag each observation with a per-test UUID inside
    the OMH payload. The tag is visible after base64-decoding
    ``valueAttachment.data`` and gives us a deterministic way to find
    *this run's* observation in a bundle that may contain thousands.
    """
    marker = f"pause-real-jhe-{uuid.uuid4()}"
    omh = convert_sample(
        source="oura_raw",
        data_type="heart_rate",
        sample={"bpm": bpm, "timestamp": "2026-04-09T08:00:00Z"},
        default_tz=config.default_tz,
    )
    # Stuff the marker into the OMH header so it round-trips through
    # the valueAttachment without disturbing the FHIR shape.
    omh.setdefault("header", {})["acquisition_provenance"] = {
        "source_name": marker,
    }
    observation = omh_to_fhir_observation(
        omh_record=omh,
        patient_fhir_id=config.patient_fhir_id,
        data_source_id=config.data_source_id,
    )
    return observation, marker


def _find_by_marker(
    observations: list[dict[str, object]], marker: str
) -> dict[str, object] | None:
    """Locate the observation whose base64 payload carries the marker."""
    for obs in observations:
        attachment = obs.get("valueAttachment") or {}
        encoded = attachment.get("data")
        if not isinstance(encoded, str):
            continue
        try:
            decoded = json.loads(base64.b64decode(encoded).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            continue
        provenance = (
            decoded.get("header", {})
            .get("acquisition_provenance", {})
            .get("source_name")
        )
        if provenance == marker:
            return obs
    return None


def test_upload_observation_round_trips_against_real_jhe(config: IngestConfig):
    """A raw OMH observation POSTs successfully and JHE assigns it an id.

    Mirrors ``test_upload_observation_round_trips_against_wire_mock``
    but drops two mock-only assertions:

      * Call-count and header-not-present checks (properties of the
        in-process mock, not the real JHE).
      * Decoding ``stored["valueAttachment"]`` on the POST response.
        Real JHE returns the persisted Observation envelope WITHOUT
        ``valueAttachment`` in the POST response body — the mock
        echoes the full posted resource. The OMH payload round-trip
        is validated on read-back by ``test_upload_then_list_...``
        instead.
    """
    observation, _marker = _unique_oura_observation(config)
    client_side_id = observation["id"]

    stored = upload_observation(observation, config=config)

    assert stored["resourceType"] == "Observation"
    assert "id" in stored and stored["id"], "JHE must echo back an assigned id"
    assert stored["id"] != client_side_id, (
        "real JHE assigns its own id; the client-side UUID must not survive"
    )


def test_upload_aux_routed_observation_requires_fhir_source_id_header(
    config: IngestConfig,
):
    """Derived HRV features route to the aux handler.

    The aux handler 400s without ``X-JHE-FHIR-Source-ID``. With the
    header threaded through (``IngestConfig.fhir_source_id``), the
    write succeeds.

    This is the third real-JHE-only bug surfaced in the 2026-06-16 run
    (after invalid_scope + Content-Type fhir+json) and the contract
    the wire-level mock now mirrors.
    """
    if not config.fhir_source_id:
        pytest.fail(
            "JHE_FHIR_SOURCE_ID is unset. The bootstrap script prints "
            "the correct value (FhirSource pk) on a successful seed; "
            "copy it into pause_ingest/.env before running this test."
        )

    no_source_config = dataclasses.replace(config, fhir_source_id=None)
    hrv = hrv_time_domain_fallback(
        [800.0, 820.0, 790.0, 810.0, 805.0, 815.0]
    )
    derived_observation = hrv_features_to_fhir_observation(
        hrv=hrv,
        patient_fhir_id=config.patient_fhir_id,
        data_source_id=config.data_source_id,
        derived_from_observation_ids=[],
        window_start="2026-04-09T08:00:00Z",
        window_end="2026-04-09T08:05:00Z",
    )

    # No fhir_source_id -> 400 from the aux handler.
    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        upload_observation(derived_observation, config=no_source_config)
    assert exc_info.value.response.status_code == 400
    assert "X-JHE-FHIR-Source-ID" in exc_info.value.response.text

    # With fhir_source_id -> success.
    stored = upload_observation(derived_observation, config=config)
    assert stored["code"]["coding"][0]["code"] == "hrv-time-domain"
    assert stored.get("id"), "real JHE must echo back an assigned id"


def test_upload_fails_on_invalid_client_credentials(config: IngestConfig):
    """A bad client_secret surfaces as an HTTPStatusError (4xx).

    Real JHE returns 401 from /o/token/ with ``invalid_client``. We
    assert on the response status range rather than exact code +
    body to insulate the test from minor OAuth provider drift.
    """
    bad_config = dataclasses.replace(config, jhe_client_secret="this-is-wrong")
    observation, _ = _unique_oura_observation(config)

    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        upload_observation(observation, config=bad_config)
    assert exc_info.value.response.status_code in {400, 401}, (
        f"bad credentials must produce a 4xx; got "
        f"{exc_info.value.response.status_code}"
    )


def test_upload_then_list_round_trips_through_client(config: IngestConfig):
    """End-to-end: upload an Observation, locate it via the read client.

    Real JHE accumulates observations across runs so we tag with a
    per-test marker and look up *that* observation by marker — never
    by total bundle size.
    """
    observation, marker = _unique_oura_observation(config, bpm=88)
    stored = upload_observation(observation, config=config)
    assigned_id = stored["id"]

    fetched = read_recent_observations(config=config, count=50)
    assert fetched, "read_recent_observations must not return empty after an upload"

    located = _find_by_marker(fetched, marker)
    assert located is not None, (
        f"the just-uploaded observation (marker={marker!r}, "
        f"assigned id={assigned_id!r}) must be present in the read-back"
    )
    assert located["resourceType"] == "Observation"
    assert located["subject"]["reference"] == f"Patient/{config.patient_fhir_id}"


def test_fhir_observation_rejected_when_subject_reference_missing(
    config: IngestConfig,
):
    """A malformed Observation is rejected by JHE's FHIR validator.

    Real JHE returns a 4xx (typically 400). Asserting on the range
    rather than the exact code keeps the test robust to JHE's
    validator surfacing slightly different errors for different
    malformations.
    """
    observation, _ = _unique_oura_observation(config)
    observation["subject"] = {}  # strip the patient reference

    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        upload_observation(observation, config=config)
    assert 400 <= exc_info.value.response.status_code < 500


def test_list_with_unknown_patient_returns_no_observations_for_that_patient(
    config: IngestConfig,
):
    """A patient_id with no observations must not surface as that patient's data.

    Real JHE's FHIR ``GET /Observation?patient=<unknown>`` does NOT
    return an empty Bundle — it returns whatever the OAuth client is
    authorized to see across the studies it's a member of, ignoring
    the unknown ``patient=`` filter. (This is itself a real-JHE-only
    contract surprise the mock papered over: the mock filters strictly
    by patient_id.) So the testable invariant is the negative one:
    nothing in the result must be subject-referenced at the unknown
    patient. That's what protects ``read_recent_observations`` callers
    from cross-patient data leakage on an unknown id.
    """
    other_patient_config = dataclasses.replace(
        config, patient_fhir_id="99999"
    )
    fetched = read_recent_observations(config=other_patient_config, count=10)
    leaked = [
        obs
        for obs in fetched
        if obs.get("subject", {}).get("reference") == "Patient/99999"
    ]
    assert leaked == [], (
        f"no observation should be subject-referenced at the unknown "
        f"Patient/99999; got {len(leaked)} leaked"
    )


def test_full_pipeline_raw_plus_derived_features_round_trips(
    config: IngestConfig,
):
    """The end-to-end pipeline against real JHE.

    Upload N raw observations, compute features, upload the derived
    observation with derivedFrom pointers, read everything back and
    confirm both kinds are present and the derivedFrom references
    resolve to the raw observation ids JHE assigned.

    Unlike the mock test, we cannot assert ``len(fetched) == N+1`` — real
    JHE accumulates state across runs. Instead, we tag every raw
    observation with a per-run marker and assert on the *subset*
    relating to this run.
    """
    if not config.fhir_source_id:
        pytest.fail(
            "JHE_FHIR_SOURCE_ID is unset. The bootstrap script prints "
            "the correct value (FhirSource pk) on a successful seed; "
            "copy it into pause_ingest/.env before running this test."
        )

    ibi_ms_series = [800.0, 820.0, 790.0, 810.0, 805.0, 815.0]
    n_raw = len(ibi_ms_series)

    # 1. Upload N raw heart-rate observations, each carrying a marker
    #    that ties it to this run.
    raw_ids: list[str] = []
    raw_markers: list[str] = []
    for i, ibi in enumerate(ibi_ms_series):
        bpm = round(60000.0 / ibi, 1)
        marker = f"pause-real-jhe-full-{uuid.uuid4()}"
        omh = convert_sample(
            source="oura_raw",
            data_type="heart_rate",
            sample={"bpm": bpm, "timestamp": f"2026-04-09T08:0{i}:00Z"},
            default_tz=config.default_tz,
        )
        omh.setdefault("header", {})["acquisition_provenance"] = {
            "source_name": marker,
        }
        observation = omh_to_fhir_observation(
            omh_record=omh,
            patient_fhir_id=config.patient_fhir_id,
            data_source_id=config.data_source_id,
        )
        stored = upload_observation(observation, config=config)
        raw_ids.append(stored["id"])
        raw_markers.append(marker)

    # 2. Compute HRV features over the synthetic IBI series.
    hrv = hrv_time_domain_fallback(ibi_ms_series)
    assert hrv.sample_count == n_raw

    # 3. Wrap features as a FHIR Observation with derivedFrom and a
    #    feature-level marker so the read-back can locate it.
    feature_marker = f"pause-real-jhe-features-{uuid.uuid4()}"
    feature_observation = hrv_features_to_fhir_observation(
        hrv=hrv,
        patient_fhir_id=config.patient_fhir_id,
        data_source_id=config.data_source_id,
        derived_from_observation_ids=raw_ids,
        window_start="2026-04-09T08:00:00Z",
        window_end="2026-04-09T08:05:00Z",
    )
    # Sneak the marker into the encoded payload by decoding, augmenting,
    # re-encoding. Keeps fhir.py free of test-only seams.
    feat_encoded = feature_observation["valueAttachment"]["data"]
    feat_decoded = json.loads(base64.b64decode(feat_encoded).decode("utf-8"))
    feat_decoded["header"]["acquisition_provenance"] = {
        "source_name": feature_marker,
    }
    feature_observation["valueAttachment"]["data"] = base64.b64encode(
        json.dumps(feat_decoded, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")

    assert len(feature_observation["derivedFrom"]) == n_raw

    # 4. Upload the feature observation.
    stored_feature = upload_observation(feature_observation, config=config)
    assert stored_feature["code"]["coding"][0]["code"] == "hrv-time-domain"

    # 5. Read everything back; locate just this run's observations.
    #    Bump the page size so a busy patient doesn't push our tail
    #    off the first page.
    fetched = read_recent_observations(config=config, count=200)

    # Every raw marker we uploaded must come back.
    for marker in raw_markers:
        located = _find_by_marker(fetched, marker)
        assert located is not None, (
            f"raw observation with marker {marker!r} missing from read-back"
        )
        assert located["code"]["coding"][0]["code"] == "omh:heart-rate:2.0"

    # And the derived observation.
    derived = _find_by_marker(fetched, feature_marker)
    assert derived is not None, (
        f"derived feature observation with marker {feature_marker!r} "
        "missing from read-back"
    )
    assert derived["code"]["coding"][0]["code"] == "hrv-time-domain"

    # derivedFrom must point at exactly the raw ids JHE assigned.
    assert "derivedFrom" in derived
    referenced_ids = {
        ref["reference"].split("/")[-1] for ref in derived["derivedFrom"]
    }
    assert referenced_ids == set(raw_ids), (
        "derivedFrom must reference the raw observation ids JHE assigned "
        f"({raw_ids!r}); got {sorted(referenced_ids)!r}"
    )

    # Feature payload survives the base64 round-trip.
    derived_decoded = json.loads(
        base64.b64decode(derived["valueAttachment"]["data"]).decode("utf-8")
    )
    assert derived_decoded["header"]["schema_id"]["name"] == "hrv-time-domain"
    assert derived_decoded["body"]["sample_count"] == n_raw
    assert derived_decoded["body"]["mean_nn_ms"] == pytest.approx(
        hrv.mean_nn_ms
    )
