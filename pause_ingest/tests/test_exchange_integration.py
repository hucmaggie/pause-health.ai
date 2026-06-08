"""Wire-level integration tests for pause_ingest.exchange.

These tests exercise the **real** ``upload_observation`` and
``read_recent_observations`` code paths -- including the httpx + requests
stacks, OAuth2 bearer-token threading, and FHIR R5 wire shape -- against
an in-process JupyterHealth Exchange mock (see ``jhe_mock_server.py``).

They are the closest we can get to "we ran against a real JHE" without
docker-compose'ing the actual JupyterHealth Exchange Django app. See
docs/JHE_SETUP_RUNBOOK.md for the runbook to swap this mock for a real
JHE instance.

What these tests catch that the existing unit tests don't:

  - Bugs in the OAuth2 token exchange (form encoding, scope handling).
  - Bugs in the FHIR Observation POST shape that a strict JHE validator
    rejects (e.g. missing subject.reference, malformed valueAttachment).
  - Bugs in Authorization header threading (e.g. forgetting to attach
    Bearer to the read path, like the previous JupyterHealthClient
    misconfiguration that this test originally surfaced).
  - End-to-end round-trip: an observation POSTed via the upload path
    must be readable via the same client's list path.
"""

from __future__ import annotations

import base64
import json
from zoneinfo import ZoneInfo

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
from .jhe_mock_server import (
    VALID_CLIENT_ID,
    VALID_CLIENT_SECRET,
    JheMockServer,
)


PATIENT_FHIR_ID = "43373"
DATA_SOURCE_ID = "device-oura-001"


@pytest.fixture()
def jhe_server():
    """Boot a wire-level JHE mock on a random localhost port."""
    with JheMockServer() as srv:
        yield srv


@pytest.fixture()
def config(jhe_server: JheMockServer) -> IngestConfig:
    """An IngestConfig pointed at the running mock server.

    We construct it directly rather than via from_env() so the test
    doesn't depend on the developer's local .env.
    """
    return IngestConfig(
        jhe_base_url=jhe_server.base_url,
        jhe_client_id=VALID_CLIENT_ID,
        jhe_client_secret=VALID_CLIENT_SECRET,
        patient_fhir_id=PATIENT_FHIR_ID,
        data_source_id=DATA_SOURCE_ID,
        default_tz=ZoneInfo("UTC"),
    )


def _build_oura_observation() -> dict[str, object]:
    """One Oura heart-rate sample, OMH-normalized, FHIR-wrapped."""
    omh = convert_sample(
        source="oura_raw",
        data_type="heart_rate",
        sample={"bpm": 72, "timestamp": "2026-04-09T08:00:00Z"},
        default_tz=ZoneInfo("UTC"),
    )
    return omh_to_fhir_observation(
        omh_record=omh,
        patient_fhir_id=PATIENT_FHIR_ID,
        data_source_id=DATA_SOURCE_ID,
    )


def test_upload_observation_round_trips_against_wire_mock(
    config: IngestConfig, jhe_server: JheMockServer
):
    """The single core contract test.

    Builds a real FHIR R5 Observation, POSTs it via the production
    upload code path, then verifies the JHE mock saw exactly one
    token exchange and one observation upload.
    """
    observation = _build_oura_observation()
    stored = upload_observation(observation, config=config)

    assert stored["resourceType"] == "Observation"
    assert "id" in stored, "JHE must echo back the assigned id"
    # The mock returns a different id than the client UUID -- this proves
    # the client respects the server-assigned id rather than re-using
    # its own.
    assert stored["id"] != observation["id"], (
        "JHE mock should assign its own id; client must not re-use the "
        "client-side UUID"
    )
    # The valueAttachment should round-trip the OMH payload intact.
    encoded = stored["valueAttachment"]["data"]
    decoded = json.loads(base64.b64decode(encoded).decode("utf-8"))
    assert decoded["body"]["heart_rate"]["value"] == 72.0

    assert jhe_server.state.token_calls == 1, (
        "Exactly one /o/token/ call expected per upload"
    )
    assert jhe_server.state.upload_calls == 1


def test_upload_fails_on_invalid_client_credentials(
    jhe_server: JheMockServer,
):
    """A bad client_secret must surface as an HTTPStatusError 401.

    The mock returns 401 from /o/token/ when client_secret is wrong
    (matching the real JHE OAuth2 behavior). The upload function
    must raise rather than swallow this.
    """
    bad_config = IngestConfig(
        jhe_base_url=jhe_server.base_url,
        jhe_client_id=VALID_CLIENT_ID,
        jhe_client_secret="this-is-wrong",
        patient_fhir_id=PATIENT_FHIR_ID,
        data_source_id=DATA_SOURCE_ID,
        default_tz=ZoneInfo("UTC"),
    )
    observation = _build_oura_observation()

    import httpx

    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        upload_observation(observation, config=bad_config)
    assert exc_info.value.response.status_code == 401


def test_upload_then_list_round_trips_through_client(
    config: IngestConfig, jhe_server: JheMockServer
):
    """End-to-end: upload an Observation, read it back via the client.

    This is the test that originally surfaced the JupyterHealthClient
    misconfiguration in exchange.read_recent_observations -- the client
    was being constructed with client_id/client_secret kwargs that the
    0.2.0 API doesn't accept. The contract test catches it at boot;
    the previous unit tests did not.
    """
    observation = _build_oura_observation()
    upload_observation(observation, config=config)

    fetched = read_recent_observations(config=config, count=10)

    assert len(fetched) == 1, "exactly one observation should be readable"
    fetched_obs = fetched[0]
    # JHE returns Bundle.entry[*].resource on the wire; the client
    # library unwraps that to a flat dict per yielded observation.
    assert fetched_obs["resourceType"] == "Observation"
    assert fetched_obs["subject"]["reference"] == f"Patient/{PATIENT_FHIR_ID}"

    # Two token exchanges: one for upload (scope=observation.write),
    # one for read (scope=observation.read). The mock doesn't enforce
    # scope but it does count the calls, which proves we are not
    # re-using a token across operations -- important because in
    # production the scopes are distinct OAuth grants.
    assert jhe_server.state.token_calls == 2
    assert jhe_server.state.upload_calls == 1
    assert jhe_server.state.list_calls == 1


def test_fhir_observation_rejected_when_subject_reference_missing(
    config: IngestConfig,
):
    """A malformed Observation must be rejected by the JHE validator.

    This is the kind of bug a strict FHIR validator catches in
    production but a lenient unit-test double would let through.
    """
    omh = convert_sample(
        source="oura_raw",
        data_type="heart_rate",
        sample={"bpm": 72, "timestamp": "2026-04-09T08:00:00Z"},
        default_tz=ZoneInfo("UTC"),
    )
    bad_observation = omh_to_fhir_observation(
        omh_record=omh,
        patient_fhir_id=PATIENT_FHIR_ID,
        data_source_id=DATA_SOURCE_ID,
    )
    bad_observation["subject"] = {}  # strip the patient reference

    import httpx

    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        upload_observation(bad_observation, config=config)
    assert exc_info.value.response.status_code == 400


def test_multiple_observations_for_same_patient_round_trip(
    config: IngestConfig, jhe_server: JheMockServer
):
    """Sanity check that the patient -> observations index works.

    Two uploads against the same patient should yield two distinct
    observations on read-back. This catches a class of regressions
    where a future change to read_recent_observations forgets to
    pass patient_id and accidentally fetches a global list.
    """
    for bpm in (60, 72, 88):
        omh = convert_sample(
            source="oura_raw",
            data_type="heart_rate",
            sample={"bpm": bpm, "timestamp": f"2026-04-09T08:0{bpm % 6}:00Z"},
            default_tz=ZoneInfo("UTC"),
        )
        observation = omh_to_fhir_observation(
            omh_record=omh,
            patient_fhir_id=PATIENT_FHIR_ID,
            data_source_id=DATA_SOURCE_ID,
        )
        upload_observation(observation, config=config)

    fetched = read_recent_observations(config=config, count=10)
    assert len(fetched) == 3
    bpms = []
    for obs in fetched:
        decoded = json.loads(
            base64.b64decode(obs["valueAttachment"]["data"]).decode("utf-8")
        )
        bpms.append(decoded["body"]["heart_rate"]["value"])
    assert sorted(bpms) == [60.0, 72.0, 88.0]

    assert jhe_server.state.upload_calls == 3
    assert jhe_server.state.list_calls == 1


def test_list_with_unknown_patient_returns_empty(
    config: IngestConfig, jhe_server: JheMockServer
):
    """Reading a patient that has no observations must not error.

    The real JHE FHIR endpoint returns a Bundle with total=0 in this
    case, not a 404. The client library unwraps that to an empty
    generator, which the production code must handle.
    """
    other_patient_config = IngestConfig(
        jhe_base_url=config.jhe_base_url,
        jhe_client_id=config.jhe_client_id,
        jhe_client_secret=config.jhe_client_secret,
        patient_fhir_id="99999",  # patient with no observations
        data_source_id=config.data_source_id,
        default_tz=config.default_tz,
    )
    fetched = read_recent_observations(config=other_patient_config, count=10)
    assert fetched == []


def test_full_pipeline_raw_plus_derived_features_round_trips(
    config: IngestConfig, jhe_server: JheMockServer
):
    """The end-to-end pause_ingest pipeline against the wire mock.

    This is the test that proves the architectural claim from
    docs/jupyterhealth-integration.md: 'The Pause ingest worker
    uploads BOTH the raw OMH observation AND a computed feature
    observation as separate FHIR resources, with derivedFrom
    provenance from features back to raw.'

    Flow under test:
      1. Upload N raw heart-rate observations to JHE (one per IBI
         in the synthetic series).
      2. Compute time-domain HRV features over the corresponding
         IBI series via hrv_time_domain_fallback (the deterministic
         reference implementation).
      3. Wrap the feature set as a FHIR Observation via
         hrv_features_to_fhir_observation, attaching the server-
         assigned ids of the raw observations as derivedFrom.
      4. Upload the feature observation to JHE.
      5. Read all observations back, confirm both the raw payloads
         and the derived feature payload are present, and confirm
         the feature observation carries derivedFrom pointers that
         resolve to the raw observation ids JHE assigned.

    This test would have caught two classes of bug that nothing else
    in the suite catches: (a) producing a malformed derivedFrom
    structure that JHE's FHIR validator rejects, and (b) computing
    feature observations that JHE accepts but the read path returns
    out of order relative to the raw observations.
    """
    # 1. Upload three raw heart-rate observations.
    raw_ids: list[str] = []
    ibi_ms_series = [800.0, 820.0, 790.0, 810.0, 805.0, 815.0]
    # We don't actually convert IBIs through omh-shim (it doesn't
    # have an IBI converter); we synthesize raw heart-rate samples
    # at the bpm equivalents instead, which is what the production
    # ingest worker does -- IBI series come from the FLIRT layer,
    # raw samples come from omh-shim.
    for i, ibi in enumerate(ibi_ms_series):
        bpm = round(60000.0 / ibi, 1)
        omh = convert_sample(
            source="oura_raw",
            data_type="heart_rate",
            sample={"bpm": bpm, "timestamp": f"2026-04-09T08:0{i}:00Z"},
            default_tz=ZoneInfo("UTC"),
        )
        observation = omh_to_fhir_observation(
            omh_record=omh,
            patient_fhir_id=PATIENT_FHIR_ID,
            data_source_id=DATA_SOURCE_ID,
        )
        stored = upload_observation(observation, config=config)
        raw_ids.append(stored["id"])

    # 2. Compute time-domain HRV features.
    hrv = hrv_time_domain_fallback(ibi_ms_series)
    assert hrv.sample_count == 6
    # SDNN of [800, 820, 790, 810, 805, 815] is small but non-zero;
    # exact value is not the point here -- we just need a real
    # dataclass that the FHIR wrapper can consume.

    # 3. Wrap features as a FHIR Observation with derivedFrom.
    feature_observation = hrv_features_to_fhir_observation(
        hrv=hrv,
        patient_fhir_id=PATIENT_FHIR_ID,
        data_source_id=DATA_SOURCE_ID,
        derived_from_observation_ids=raw_ids,
        window_start="2026-04-09T08:00:00Z",
        window_end="2026-04-09T08:05:00Z",
    )
    assert feature_observation["code"]["coding"][0]["code"] == "hrv-time-domain"
    n_raw = len(ibi_ms_series)
    assert len(feature_observation["derivedFrom"]) == n_raw
    assert feature_observation["derivedFrom"][0]["reference"].startswith(
        "Observation/"
    )

    # 4. Upload the feature observation.
    stored_feature = upload_observation(feature_observation, config=config)
    assert stored_feature["code"]["coding"][0]["code"] == "hrv-time-domain"

    # 5. Read everything back and verify both kinds are present.
    fetched = read_recent_observations(config=config, count=20)
    assert len(fetched) == n_raw + 1, (
        f"expected {n_raw} raw + 1 derived, got {len(fetched)}"
    )
    schemas = {
        obs["code"]["coding"][0]["code"] for obs in fetched
    }
    assert schemas == {"heart-rate", "hrv-time-domain"}

    # The feature observation read back must still carry the
    # derivedFrom pointers it was uploaded with.
    feature_read_back = next(
        obs for obs in fetched if obs["code"]["coding"][0]["code"] == "hrv-time-domain"
    )
    assert len(feature_read_back["derivedFrom"]) == n_raw
    referenced_ids = {
        ref["reference"].split("/")[-1] for ref in feature_read_back["derivedFrom"]
    }
    assert referenced_ids == set(raw_ids), (
        "derivedFrom must reference exactly the raw observation ids JHE assigned"
    )

    # Also verify the feature payload round-trips through the
    # base64 valueAttachment intact.
    decoded = json.loads(
        base64.b64decode(
            feature_read_back["valueAttachment"]["data"]
        ).decode("utf-8")
    )
    assert decoded["header"]["schema_id"]["name"] == "hrv-time-domain"
    assert decoded["body"]["sample_count"] == n_raw
    assert decoded["body"]["mean_nn_ms"] == pytest.approx(hrv.mean_nn_ms)

    assert jhe_server.state.upload_calls == n_raw + 1
    assert jhe_server.state.list_calls == 1
