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

### Path B — run the contract test against real JHE — **shipped 2026-06-23**

The opt-in pytest marker sketched in earlier revisions of this runbook
is now wired into the repo:

- [`pause_ingest/tests/conftest.py`](../pause_ingest/tests/conftest.py)
  registers the `real_jhe` marker and a collection hook that swaps
  modes based on the `PAUSE_USE_REAL_JHE` env var. Default mode runs
  the mock contract tests; `PAUSE_USE_REAL_JHE=1` runs the real-JHE
  tests and skips the mock-only `test_exchange_integration` module.
- [`pause_ingest/tests/test_exchange_real_jhe.py`](../pause_ingest/tests/test_exchange_real_jhe.py)
  carries the same contract assertions as the mock suite (token
  exchange, OMH mapped-handler write, OMH auxiliary-handler write with
  `X-JHE-FHIR-Source-ID`, FHIR validator rejection, end-to-end
  derivedFrom round-trip). Every test is tagged
  `pytest.mark.real_jhe`.
- The fixture is `IngestConfig.from_env()`, so the real-JHE run reads
  `pause_ingest/.env` (the same file the smoke script uses). The
  `jhe-local/bootstrap.sh` printout has the exact values to copy in.

Invocation:

```bash
cd pause_ingest
# Default (mock) mode — runs in ~2s, no external dependencies:
.venv/bin/python -m pytest -q   # 67 passed, 7 skipped (real_jhe)

# Real-JHE mode — requires jhe-local stack up + .env populated:
PAUSE_USE_REAL_JHE=1 .venv/bin/python -m pytest -q   # 66 passed, 8 skipped (mock)
```

The two modes are mutually exclusive by design — a single pytest
invocation either exercises the mock or the real instance, never both.
Keeps per-mode test-log output deterministic and obvious in CI.

#### Additional mock-vs-real divergences surfaced on the first green run (2026-06-23)

Beyond the 3 bugs surfaced in the 2026-06-16 real-run (invalid_scope,
Content-Type fhir+json, aux-handler header), the first green pytest
run against real JHE surfaced 2 more wire-level surprises the mock had
papered over. Both are documented inline in
`test_exchange_real_jhe.py` and reflected in the mock-suite docstrings
to avoid drift:

- **POST response shape:** real JHE's `POST /fhir/r5/Observation`
  response body does NOT include `valueAttachment` — only the
  envelope (id, status, code, subject, etc.). The mock echoes the
  full posted resource. The real test validates the OMH payload via
  the read-back path instead.
- **Unknown-patient list filter:** real JHE's
  `GET /Observation?patient=<unknown>` does NOT return an empty
  Bundle — it returns whatever the OAuth client is authorized to see
  across its studies, ignoring an unknown `patient=` filter. The mock
  filters strictly by patient_id. The real test asserts the
  no-leakage invariant (no result is subject-referenced at the
  unknown patient) rather than `fetched == []`.

The result of this work is the line on `/proposal/integration` and
`/roadmap` claim now backed by an opt-in test suite that hits real
JHE on every invocation, not just the periodic manual smoke run.

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
