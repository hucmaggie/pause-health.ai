# pause_ingest

Pause-Health.ai wearable ingest worker.

Takes raw wearable JSON (Oura, Apple Health, Whoop, Garmin, etc.),
normalizes it through [`omh-shim`](https://github.com/jupyterhealth/omh-shim)
to Open mHealth / IEEE 1752.1 records, and uploads it to a
[JupyterHealth Exchange](https://github.com/jupyterhealth/jupyterhealth-exchange)
instance as FHIR Observations.

This package is the "ingest" half of the Pause data plane. The provider-side
read path lives in the FastAPI service at the repository root.

## Status

Scaffold — Phase 1 of the JupyterHealth integration design
(see `docs/jupyterhealth-integration.md`). The local-dev loop works against
a JHE instance you stand up yourself; production wiring is in flight.

## Requirements

- Python 3.12+
- A running JupyterHealth Exchange (local dev or remote). The README at
  https://github.com/jupyterhealth/jupyterhealth-exchange covers a local
  setup in under 30 minutes.

## Install (development)

```bash
cd pause_ingest
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Configure

Copy `.env.example` to `.env` at the package root and fill in:

```env
JHE_BASE_URL=http://localhost:8000
JHE_CLIENT_ID=<oauth-client-id-from-jhe-admin>
JHE_CLIENT_SECRET=<oauth-client-secret-from-jhe-admin>
JHE_PATIENT_FHIR_ID=<fhir-patient-id>
JHE_DATA_SOURCE_ID=<jhe-data-source-id>
```

See the JHE quick-start walkthrough for how to create the OAuth client,
register a Data Source, and obtain a Patient ID.

## Run the end-to-end smoke test

The `examples/oura_sample_upload.py` script:

1. Loads a fixture Oura heart-rate sample.
2. Runs it through `omh-shim` → Open mHealth record.
3. Wraps the OMH record as a FHIR R5 `Observation` resource.
4. POSTs it to the configured JHE instance.
5. Reads the most recent observations back to confirm.

```bash
python -m pause_ingest.examples.oura_sample_upload
```

Expected output ends with `OK — uploaded and round-tripped 1 observation`.

## Layout

```
pause_ingest/
├── README.md
├── pyproject.toml
├── .env.example
├── pause_ingest/
│   ├── __init__.py
│   ├── config.py        # env-driven configuration
│   ├── convert.py       # omh-shim wrapper with menopause-relevant types
│   ├── fhir.py          # OMH → FHIR R5 Observation envelope
│   └── exchange.py      # JHE upload + readback (uses jupyterhealth-client)
├── examples/
│   ├── __init__.py
│   ├── fixtures/
│   │   └── oura_heart_rate_sample.json
│   └── oura_sample_upload.py
└── tests/
    ├── __init__.py
    └── test_convert.py
```

## What's intentionally not here yet

- Vendor OAuth flows (Oura, HealthKit). Phase 2.
- Background worker / queue. Phase 2.
- `skin_temperature` converter — `omh-shim` v1.0 doesn't ship it, and we
  plan to upstream a converter + schema proposal.
