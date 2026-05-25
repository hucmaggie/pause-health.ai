"""End-to-end smoke test: convert one Oura sample, upload to JHE, read it back.

Run with:

    python -m pause_ingest.examples.oura_sample_upload

Requires a configured ``.env`` at the pause_ingest package root and a
running JupyterHealth Exchange instance. See ``pause_ingest/README.md``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pause_ingest import (
    IngestConfig,
    convert_sample,
    omh_to_fhir_observation,
    read_recent_observations,
    upload_observation,
)

FIXTURE = Path(__file__).parent / "fixtures" / "oura_heart_rate_sample.json"


def main() -> int:
    config = IngestConfig.from_env()

    sample = json.loads(FIXTURE.read_text())
    print(f"Loaded fixture: {sample}")

    omh = convert_sample(
        source="oura_raw",
        data_type="heart_rate",
        sample=sample,
        default_tz=config.default_tz,
    )
    print(f"Converted to OMH (schema={omh['header']['schema_id']})")

    observation = omh_to_fhir_observation(
        omh_record=omh,
        patient_fhir_id=config.patient_fhir_id,
        data_source_id=config.data_source_id,
    )
    print(f"Built FHIR Observation id={observation['id']}")

    uploaded = upload_observation(observation, config=config)
    server_id = uploaded.get("id", "(no id returned)")
    print(f"Uploaded to JHE; server id={server_id}")

    recent = read_recent_observations(config=config, count=5)
    print(f"Read back {len(recent)} recent observation(s) for patient")

    if not recent:
        print("WARN: no observations read back. Check Study/Scope consent in JHE.")
        return 1

    print("OK — uploaded and round-tripped 1 observation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
