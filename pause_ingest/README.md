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

Phase 1 of the JupyterHealth integration design
(see `docs/jupyterhealth-integration.md`).

**What's verified today (Wire-level prototype):**
- omh-shim conversion of Oura / OpenWearable samples to Open mHealth
- OMH → FHIR R5 Observation envelope (raw)
- DBDP-style HRV time-domain features (validated against Kubios)
- HRV features → FHIR R5 Observation with `derivedFrom` provenance
- OAuth2 client-credentials grant against a JHE-shaped token endpoint
- FHIR `POST /fhir/r5/Observation` upload
- FHIR `GET /fhir/r5/Observation?patient=...` read-back via `jupyterhealth-client`
- Full pipeline (raw upload → feature compute → derived upload → both readable)
  exercised end-to-end by an in-process JHE wire-level mock.
  27 / 27 tests pass.

**What's deferred:**
- Running the same flow against a real JupyterHealth Exchange Django
  instance. See [`docs/JHE_SETUP_RUNBOOK.md`](../docs/JHE_SETUP_RUNBOOK.md)
  for the step-by-step (docker-compose, OAuth client + Patient + Data
  Source setup, pointing `.env` at it).
- Vendor OAuth flows (Oura, HealthKit). Phase 2.
- Background worker / queue. Phase 2.
- `skin_temperature` converter — `omh-shim` v1.0 doesn't ship it; we
  plan to upstream a converter + schema proposal.

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

## Run the wire-level contract test (no JHE required)

The contract test boots an in-process Python mock of JHE's OAuth +
FHIR endpoints, then runs the **production** `upload_observation`,
`hrv_features_to_fhir_observation`, and `read_recent_observations`
code paths against it. It catches the same class of bugs a real JHE
instance would (FHIR validator rejections, OAuth scope mismatches,
missing Authorization headers) without needing Docker.

```bash
pytest -v                          # 27 tests; 7 are wire-level integration
```

Implementation: [`tests/jhe_mock_server.py`](tests/jhe_mock_server.py)
+ [`tests/test_exchange_integration.py`](tests/test_exchange_integration.py).
For the path to swap the mock for a real JHE, see
[`docs/JHE_SETUP_RUNBOOK.md`](../docs/JHE_SETUP_RUNBOOK.md).

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
