"""End-to-end smoke test: convert one Oura sample, upload to JHE, read it back.

Run with:

    python -m examples.oura_sample_upload

Requires a configured ``.env`` at the pause_ingest package root and a
running JupyterHealth Exchange instance. See ``pause_ingest/README.md``.

Two observations are uploaded so both JHE write paths get exercised:

  * the raw OMH heart-rate sample → routes to JHE's mapped Observation
    handler via the OMH coding criteria (system
    https://w3id.org/openmhealth, code omh:heart-rate:2.0).
  * a derived HRV-time-domain feature set computed from a synthetic IBI
    series → routes to JHE's auxiliary handler because the coding sits
    under https://pause-health.ai/schemas/derived. The aux handler
    requires X-JHE-FHIR-Source-ID, threaded via JHE_FHIR_SOURCE_ID in
    the env. The derived observation carries derivedFrom pointers to
    the just-uploaded raw observation's server id.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pause_ingest import (
    IngestConfig,
    convert_sample,
    hrv_features_to_fhir_observation,
    hrv_time_domain_fallback,
    omh_to_fhir_observation,
    read_recent_observations,
    upload_observation,
)

FIXTURE = Path(__file__).parent / "fixtures" / "oura_heart_rate_sample.json"

# A short, realistic IBI series in milliseconds for the derived-features
# leg. Real ingest uses sliding windows over thousands of intervals; this
# is just enough to produce a non-trivial RMSSD / SDNN.
SYNTHETIC_IBI_MS = [800.0, 805.0, 795.0, 810.0, 800.0, 790.0, 815.0, 800.0, 802.0, 798.0]


def main() -> int:
    config = IngestConfig.from_env()

    # ---- Raw OMH path (mapped handler) ----
    sample = json.loads(FIXTURE.read_text())
    print(f"Loaded fixture: {sample}")

    omh = convert_sample(
        source="oura_raw",
        data_type="heart_rate",
        sample=sample,
        default_tz=config.default_tz,
    )
    print(f"Converted to OMH (schema={omh['header']['schema_id']})")

    raw_observation = omh_to_fhir_observation(
        omh_record=omh,
        patient_fhir_id=config.patient_fhir_id,
        data_source_id=config.data_source_id,
    )
    print(f"Built raw FHIR Observation id={raw_observation['id']}")

    raw_uploaded = upload_observation(raw_observation, config=config)
    raw_server_id = raw_uploaded.get("id", "(no id returned)")
    print(f"Uploaded raw observation to JHE; server id={raw_server_id}")

    # ---- Derived HRV-features path (auxiliary handler) ----
    if not config.fhir_source_id:
        print(
            "WARN: JHE_FHIR_SOURCE_ID not set — skipping the derived-features "
            "leg (real JHE will 400 without X-JHE-FHIR-Source-ID)."
        )
        derived_server_id = None
    else:
        hrv = hrv_time_domain_fallback(SYNTHETIC_IBI_MS)
        print(
            f"Computed HRV: rmssd={hrv.rmssd_ms:.2f} ms, sdnn={hrv.sdnn_ms:.2f} ms, "
            f"n={hrv.sample_count}"
        )
        window = omh["body"]["effective_time_frame"]["date_time"]
        derived_observation = hrv_features_to_fhir_observation(
            hrv=hrv,
            patient_fhir_id=config.patient_fhir_id,
            data_source_id=config.data_source_id,
            derived_from_observation_ids=[str(raw_server_id)],
            window_start=window,
            window_end=window,
        )
        print(f"Built derived FHIR Observation id={derived_observation['id']}")

        derived_uploaded = upload_observation(derived_observation, config=config)
        derived_server_id = derived_uploaded.get("id", "(no id returned)")
        print(f"Uploaded derived observation to JHE; server id={derived_server_id}")

    # ---- Read back ----
    recent = read_recent_observations(config=config, count=10)
    print(f"Read back {len(recent)} recent observation(s) for patient")

    if not recent:
        print("WARN: no observations read back. Check Study/Scope consent in JHE.")
        return 1

    expected = 2 if derived_server_id is not None else 1
    print(f"OK — uploaded and round-tripped {expected} observation(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
