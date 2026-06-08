# JupyterHealth Exchange Setup — Next-Session Runbook

**Status:** Wire-level contract test shipped (`pause_ingest/tests/test_exchange_integration.py`, 7 tests). Real JHE Docker deployment deferred to a dedicated session.
**Last updated:** 2026-06-07
**Companion docs:** [`jupyterhealth-integration.md`](jupyterhealth-integration.md) (design),
[`MULESOFT_RUNBOOK.md`](MULESOFT_RUNBOOK.md) (parallel pattern, MuleSoft Anypoint)

## Why this doc exists

The `pause_ingest` Python package round-trips an Oura sample
end-to-end through:

1. omh-shim normalization (`convert_sample`)
2. OMH → FHIR R5 envelope (`omh_to_fhir_observation`)
3. OAuth2 client-credentials grant against JHE (`exchange._fetch_oauth_token`)
4. FHIR `POST /fhir/r5/Observation` to JHE (`exchange.upload_observation`)
5. DBDP/FLIRT HRV feature computation (`hrv_time_domain_fallback`)
6. Derived OMH → FHIR with `derivedFrom` provenance
   (`hrv_features_to_fhir_observation`)
7. FHIR `GET /fhir/r5/Observation?patient=...` read-back
   (`exchange.read_recent_observations` → `JupyterHealthClient`)

The full pipeline is exercised by an in-process **wire-level contract
test** (`pause_ingest/tests/jhe_mock_server.py` +
`test_exchange_integration.py`). The contract test runs the production
`exchange.py` code path against a Python mock server that mimics the
JHE OAuth2 + FHIR endpoints. **All 7 tests pass.** This pinned a real
bug in the original `read_recent_observations` — it was calling
`JupyterHealthClient(base_url=, client_id=, client_secret=)` which is
not the 0.2.0 API.

What the contract test does **not** do is hit a real JupyterHealth
Exchange Django instance. This runbook captures the steps for swapping
the mock for a real JHE so anyone (Pause-Health.ai engineering, a
contributor, a design partner) can promote the pipeline from
"wire-level prototype" to "verified against canonical JHE" in an
afternoon.

## What you'll need

| Resource | Why |
|---|---|
| Docker Desktop or compatible runtime (Colima, Podman, OrbStack) | JupyterHealth Exchange ships docker-compose for local dev |
| ~4 GB free disk + ~2 GB RAM available to Docker | Postgres + Redis + Django app |
| ~30–45 min for clean setup, more if anything in the JHE README has drifted | JHE is active development; expect minor doc-vs-reality gaps |
| Python 3.12+ with the `pause_ingest` venv already configured | The existing `pip install -e ".[dev]"` (with omh-shim from GitHub) is the only Python prereq |
| Read access to https://github.com/jupyterhealth/jupyterhealth-exchange | The setup steps assume you can clone it |

If you don't have Docker, the contract test (no setup, instant
feedback) is what's already running. The real-JHE path below is
strictly an *augmentation* — it doesn't replace the contract test, it
runs alongside.

## Phase 0 — verify the contract test is green

Before spending time on real JHE, confirm the existing test suite
passes on your machine:

```bash
cd pause_ingest
source .venv/bin/activate         # or python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q                          # expect 27 passed
```

The 7 integration tests in `tests/test_exchange_integration.py` are
what the real-JHE run will be compared against. If they fail on your
machine you have a Python environment problem, not a JHE problem.

## Phase 1 — bring up JupyterHealth Exchange locally

JHE's canonical setup lives in their README:
https://github.com/jupyterhealth/jupyterhealth-exchange. Read it first
in case anything below has drifted.

The short version:

```bash
git clone https://github.com/jupyterhealth/jupyterhealth-exchange.git
cd jupyterhealth-exchange

cp .env.example .env               # if they ship one
docker compose up -d               # postgres + redis + django web

# Wait for the web container to be healthy
docker compose ps
docker compose logs -f web         # quit with Ctrl-C once you see "Listening on..."

# Run migrations + create the superuser the first time
docker compose exec web python manage.py migrate
docker compose exec web python manage.py createsuperuser
```

When everything is up, JHE should be reachable at http://localhost:8000
(or whichever port their docker-compose maps).

Sanity check from inside the pause_ingest venv:

```bash
curl -fsS http://localhost:8000/healthz   # adjust per their actual health endpoint
```

## Phase 2 — register an OAuth client for pause_ingest

Pause_ingest authenticates via OAuth2 client credentials. JHE's admin
UI is the path:

1. Log in at http://localhost:8000/admin/ with the superuser you just
   created.
2. Create an **OAuth Application** (Django OAuth Toolkit, usually under
   `o/applications/` or similar — check JHE's docs):
   - Client type: **Confidential**
   - Authorization grant type: **Client credentials**
   - Name: `pause-ingest`
   - Allowed scopes: `observation.read observation.write`
   - Save and capture the `client_id` and `client_secret`.
3. Create a **Patient** (FHIR Patient resource):
   - Use any deterministic identifier (e.g. `external_id = pause-demo-patient-001`).
   - Note the JHE-assigned numeric `id` (e.g. `43373`). That's the
     `JHE_PATIENT_FHIR_ID` for pause_ingest.
4. Create a **Data Source** (FHIR Device resource) representing the
   wearable family pause_ingest is uploading on behalf of:
   - Name: `Oura Ring (Pause demo)`
   - Note the JHE-assigned `id`. That's the `JHE_DATA_SOURCE_ID`.
5. Grant the OAuth Application access to the Patient + Data Source —
   the exact mechanism depends on JHE's current consent model
   (Study? Group? Direct grant?). Check the README; if it's
   ambiguous, file a clarification issue against JHE and fall back
   to the contract test for the demo.

Capture the four values:

```env
JHE_BASE_URL=http://localhost:8000
JHE_CLIENT_ID=<from-step-2>
JHE_CLIENT_SECRET=<from-step-2>
JHE_PATIENT_FHIR_ID=<from-step-3>
JHE_DATA_SOURCE_ID=<from-step-4>
```

## Phase 3 — point pause_ingest at the real JHE

Two paths, pick one.

### Path A (recommended) — environment-driven, no code change

```bash
cd pause_ingest
cp .env.example .env             # if not already done
# Edit .env with the five values from Phase 2

source .venv/bin/activate
python -m pause_ingest.examples.oura_sample_upload
```

Expected end-of-output:

```
OK — uploaded and round-tripped 1 observation
```

If you get this, the prototype is now talking to real JHE. The same
`upload_observation` + `read_recent_observations` code that the
contract test exercises is now hitting a real Django app, a real
Postgres, and a real JHE FHIR validator.

### Path B — run the contract test against real JHE

The integration test fixture currently constructs its own
`IngestConfig` pointed at the in-process mock. To run the same test
suite against real JHE, you need to swap the fixture.

The cleanest way is to add an opt-in pytest marker:

```bash
# tests/conftest.py (suggested, not yet in the repo)
import os
import pytest

REAL_JHE = bool(os.environ.get("PAUSE_USE_REAL_JHE"))

def pytest_collection_modifyitems(config, items):
    skip_real = pytest.mark.skip(reason="set PAUSE_USE_REAL_JHE=1 to enable")
    skip_mock = pytest.mark.skip(reason="unset PAUSE_USE_REAL_JHE to run mock tests")
    for item in items:
        if "real_jhe" in item.keywords and not REAL_JHE:
            item.add_marker(skip_real)
        elif item.module.__name__ == "tests.test_exchange_integration" and REAL_JHE:
            # The mock-server fixture would conflict with real-JHE config
            item.add_marker(skip_mock)
```

Then add a new `tests/test_exchange_real_jhe.py` that reads
`IngestConfig.from_env()` (no mock fixture) and re-runs the same
assertions. Tag every test in that file with `@pytest.mark.real_jhe`.

Invocation:

```bash
PAUSE_USE_REAL_JHE=1 pytest -v tests/test_exchange_real_jhe.py
```

The result of this work is the line on `/proposal/integration` and
`/roadmap` flipping from "wire-level prototype" to "verified against
JupyterHealth Exchange v<version>". Worth the afternoon for an
investor demo or design-partner kickoff.

## Phase 4 — capture evidence

Once the real-JHE run is green, commit two artifacts so the work is
durable:

1. `docs/JHE_REAL_RUN_<date>.md` — a transcript: JHE version, the
   docker-compose command, the OAuth client setup steps (any
   deviations from the README), the pytest output, and any wire-level
   gotchas (FHIR validator warnings, deprecation notices, etc.).
2. Update `/proposal/integration` and `/roadmap` to reflect the new
   status — flip the relevant `StatusPill` from `prototype` to
   `partial` (or `shipped` if the run hit a JHE instance that's not
   local-only).

The git history of these artifacts becomes the "we did the work"
proof for anyone evaluating whether the JupyterHealth integration is
real.

## Known unknowns

These are the parts of the JHE setup that the contract test
**cannot** verify — they require real JHE to surface, and may bite on
the first real-JHE run:

| Risk | Why the contract test can't catch it | Mitigation |
|---|---|---|
| **JHE's FHIR validator is stricter than the mock's** | The mock validates only the fields pause_ingest depends on. JHE may require additional FHIR conformance (Resource.meta, security tags, profile claims). | First real-JHE run may fail with a 400 + specific validator error message. Fix by adding the missing field to the relevant FHIR helper in `pause_ingest/pause_ingest/fhir.py`. |
| **Consent model is required for FHIR writes** | The mock has no consent model. JHE may require the OAuth client to have an explicit Consent / Study membership before it can write to a Patient. | Use JHE admin UI to grant the relationship; failure mode is usually a 403 with a clear message. |
| **Date / timezone serialization edge cases** | The mock accepts any ISO-8601 string. JHE may normalize timezones in a way that breaks the read-back equality assertion. | The Phase 1 integration test has been written to compare on numeric / semantic equality (`hrv.mean_nn_ms == pytest.approx(...)`), not string equality, specifically to survive this. |
| **`derivedFrom` references must resolve** | The mock doesn't validate that the referenced Observation ids exist. JHE likely does. | The test already uploads the raw observations first and threads their server-assigned ids into `derivedFrom`. Should be safe; if not, JHE will surface a clear FHIR conformance error. |
| **JHE's OAuth scope vocabulary** | The mock accepts any scope string. JHE has a fixed vocabulary (`observation.read`, `observation.write`, possibly `patient.read`). | If pause_ingest requests a scope JHE doesn't recognize, the token endpoint returns 400 with `invalid_scope`. Trivial fix in `_fetch_oauth_token`. |

## When to do this

The real-JHE run is the right thing to schedule when **any** of:

- You have a design-partner kickoff and want to show "this connects
  to the real substrate" rather than "this connects to a wire-level
  mock of the substrate."
- You're about to start Phase 2 of pause_ingest (real vendor OAuth
  flows for Oura / HealthKit) and want a verified write surface
  before introducing more moving parts.
- A JHE upstream change (new FHIR profile requirement, new auth
  flow) requires re-validating the contract.

Until then, the wire-level contract test is the right level of
investment. It runs in 2 seconds, has no external dependencies, and
catches the same class of bugs the real-JHE run would surface
on the first 90% of changes.
