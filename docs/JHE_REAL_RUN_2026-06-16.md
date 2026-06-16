# JHE Real Run — 2026-06-16

**Result:** `examples/oura_sample_upload.py` round-trips a real Oura sample
end-to-end against a real JupyterHealth Exchange Django instance.
`Uploaded to JHE; server id=60010 / Read back 3 recent observation(s) for
patient / OK — uploaded and round-tripped 1 observation`. The
`/fhir/r5/Observation?patient=40001` search returns a real FHIR R5
search-set Bundle with the uploaded record.

This is the artifact the runbook (`docs/JHE_SETUP_RUNBOOK.md`) describes
in its Phase 4 ("capture evidence"). It promotes the integration line on
`/proposal/integration` and `/roadmap` from `designed` to `prototype`.

## Stack the run was executed against

| Component | Version | How it was provisioned |
|---|---|---|
| jupyterhealth-exchange | `main` HEAD on 2026-06-16, depth 1 clone of `https://github.com/jupyterhealth/jupyterhealth-exchange.git` | Built locally as `jhe-local:latest` from the upstream `Dockerfile` (`docker build --build-arg TARGETARCH=arm64`). Image is ~1 GB; published JHE images do not exist. |
| postgres | `postgres:16` (Docker Hub) | One-shot `docker run -d --name jhe-postgres ...` on a private `jhe-net` Docker network. Volume `jhe-pgdata`. Port published only to `127.0.0.1:5433`. |
| OIDC signing key | RS256 4096-bit | `openssl genrsa -out oidc.key 4096`, then `awk` collapsed to a single-line `\n`-delimited string and passed to JHE via `OIDC_RSA_PRIVATE_KEY` env. |
| pause_ingest | this repo, editable install in `pause_ingest/.venv` (Python 3.13.12) | `pip install -e .`; runs the same `exchange.upload_observation` + `read_recent_observations` paths the contract test exercises. |
| ngrok / VPN | n/a | Real JHE was reached at `http://localhost:8000` from the host. |

Container summary at the moment of the successful run:

```
$ docker ps --filter network=jhe-net
NAMES          STATUS                  PORTS
jhe-postgres   Up 5 minutes            127.0.0.1:5433->5432/tcp
jhe-web        Up 4 minutes            127.0.0.1:8000->8000/tcp
```

## The five JHE-side configuration steps

The runbook called these out in advance; recording the exact commands so
they're repeatable without UI.

### 1 · Migrate + seed

```
docker exec jhe-web python manage.py migrate
docker exec jhe-web python manage.py seed
```

Seed creates root org `Planetary Research Institute`, three nested orgs,
patients `40001..40005`, data sources `70001..70006` (CareX, Dexcom,
iHealth, Oura, Questionnaire, Epic MyChart), and four authorization-code
OAuth apps (CareX, CommonHealth, MyChart, JHE Admin UI). It also seeds 16
`CodeableConcept` rows including `omh:heart-rate:2.0` (50004) and
`omh:rr-interval:1.0` (50007).

### 2 · Create a `client_credentials` OAuth app

The seeded apps are all `authorization-code` grant. pause_ingest uses
`client_credentials`. Created via `python manage.py shell`:

```python
App = get_application_model()
app, _ = App.objects.get_or_create(
    name="pause-ingest",
    defaults={
        "client_id": "pause-ingest-client-id",
        "client_secret": "pause-ingest-client-secret-xyz123",
        "client_type": App.CLIENT_CONFIDENTIAL,
        "authorization_grant_type": App.GRANT_CLIENT_CREDENTIALS,
        "skip_authorization": True,
        "hash_client_secret": False,
        "algorithm": "RS256",
    },
)
JheClient.objects.get_or_create(application=app)
ClientDataSource.objects.get_or_create(client=app, data_source=DataSource.objects.get(id=70004))
```

### 3 · Bind the OAuth app to a real Patient

JHE's `Observation.fhir_create` checks `user.is_practitioner()` first
(needs org-membership grants to write on a patient's behalf) and
otherwise demands `user.get_patient() == subject`. The simplest path for
a wearable client is to set the OAuth Application's `user` field to the
Patient's `JheUser` so a `client_credentials` token authenticates *as the
patient*:

```python
patient = Patient.objects.get(id=40001)   # Mcfarland, LlPatientPeter
app.user = patient.jhe_user
app.save()
```

### 4 · Wire a Study with the right Data Source + Scopes + Consent

A real JHE patient cannot be written to until they are on a Study that
declares (a) the Data Source the upload claims, (b) a scope request for
the OMH coding being uploaded, and (c) an explicit consent row for that
patient on that scope.

```python
study, _ = Study.objects.get_or_create(
    name="pause-ingest demo study",
    defaults={"organization": patient.organizations.first()},
)
StudyClient.objects.get_or_create(study=study, client=app)
StudyDataSource.objects.get_or_create(study=study, data_source=DataSource.objects.get(id=70004))
sp, _ = StudyPatient.objects.get_or_create(study=study, patient=patient)
for code in ("omh:heart-rate:2.0", "omh:rr-interval:1.0",
             "omh:sleep-duration:2.0", "omh:sleep-episode:1.1",
             "omh:physical-activity:1.2", "omh:step-count:3.0"):
    cc = CodeableConcept.objects.filter(coding_code=code).first()
    if not cc:
        continue
    sr, _ = StudyScopeRequest.objects.update_or_create(
        study=study, scope_code=cc, defaults={"scope_actions": "rs"},
    )
    StudyPatientScopeConsent.objects.update_or_create(
        study_patient=sp, scope_code=cc,
        defaults={"consented": True, "scope_actions": sr.scope_actions,
                  "consented_time": timezone.now()},
    )
```

The `consented_time` is required (NOT NULL); the order
`get_or_create(... defaults=)` matters because the `unique_together` is
`(study, scope_code)` and `scope_actions` is a separate column.

### 5 · `pause_ingest/.env`

```
JHE_BASE_URL=http://localhost:8000
JHE_CLIENT_ID=pause-ingest-client-id
JHE_CLIENT_SECRET=pause-ingest-client-secret-xyz123
JHE_PATIENT_FHIR_ID=40001
JHE_DATA_SOURCE_ID=70004
PAUSE_INGEST_DEFAULT_TZ=UTC
```

## Real-JHE-only bugs the wire-level mock had not pinned

The runbook predicted there would be ~5 known unknowns. Three actually
fired on the first real-JHE run, and all three were `pause_ingest`-side
bugs (the mock had been over-permissive). All three are fixed in the
commit that ships this transcript; the existing 66-test suite passes
against the updated mock, and the same pipeline now passes against real
JHE.

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | `POST /o/token/` → `400 {"error":"invalid_scope"}` | pause_ingest requested OAuth `scope=observation.write` and `scope=observation.read`. JHE's OAuth2 vocabulary is fixed at `openid email` and rejects everything else with `invalid_scope`. JHE authorizes FHIR writes by Study/Patient/Scope consent at the resource layer, not by OAuth scope. | `_fetch_oauth_token` in `pause_ingest/exchange.py` no longer requires a `scope` argument; both call sites stopped passing one. |
| 2 | `POST /fhir/r5/Observation` → `415 {"diagnostics":"Unsupported media type \"application/fhir+json\""}` | pause_ingest set both `Content-Type` and `Accept` to `application/fhir+json`. JHE's DRF parser only registers `application/json`. | Both headers in `upload_observation` are now `application/json`. |
| 3 | `POST /fhir/r5/Observation` → `400 {"diagnostics":"Header 'X-JHE-FHIR-Source-ID' is required to write this resource."}` | JHE routes Observations between a *mapped* (Open mHealth) handler and an *aux* (opaque JSON) handler based on `core/fhir/fhir_config.json`'s criteria `code=https://w3id.org/openmhealth\|`. pause_ingest emitted `system: https://w3id.org/openmhealth/schemas/<namespace>` with code `<schema-name>` (`heart-rate`), which did not match the criteria. The Observation silently fell through to the aux handler, which then 400'd because aux writes require an `X-JHE-FHIR-Source-ID` header. | `omh_to_fhir_observation` in `pause_ingest/fhir.py` now emits `system: https://w3id.org/openmhealth` with code in the colon-namespaced `omh:<schema>:<version>` form (e.g. `omh:heart-rate:2.0`). The wire-level mock's round-trip assertion was updated from `{"heart-rate"}` to `{"omh:heart-rate:2.0"}` so it pins the new shape too. |

## Update — derived-features (auxiliary handler) write path now wired

A second pass in the same session closed out the auxiliary-handler
write path that the original smoke script had skipped. The HRV-features
helper (`hrv_features_to_fhir_observation`) emits
`system: https://pause-health.ai/schemas/derived` which JHE routes to
its `FhirAuxResource` handler — and that handler 400s without an
`X-JHE-FHIR-Source-ID` header pointing at a registered `FhirSource` row.

Changes:

- `IngestConfig` got a new optional `fhir_source_id: str | None` field,
  loaded from `JHE_FHIR_SOURCE_ID` in the env (kept optional so a
  raw-only config still works).
- `upload_observation` adds the `X-JHE-FHIR-Source-ID` request header
  whenever the config carries the id. The mapped (OMH) handler ignores
  the header so always sending it is safe.
- `examples/oura_sample_upload.py` now uploads BOTH the raw OMH
  heart-rate observation (mapped handler, integer pk) and a derived
  HRV-time-domain observation (auxiliary handler, UUID pk) computed from
  a synthetic IBI series, with `derivedFrom` pointing at the raw row's
  server id. End-of-run prints `OK — uploaded and round-tripped 2
  observation(s)`.
- `jhe-local/bootstrap.sh` reads back the `FhirSource.pk` after creation
  and surfaces it in the printed `.env` block as `JHE_FHIR_SOURCE_ID=`,
  so the next contributor's first run uploads through both paths
  without extra Django shell work.
- Wire-level mock now mirrors JHE's mapped-vs-aux routing: codings
  outside `https://w3id.org/openmhealth` 400 without the header. A new
  `test_upload_aux_routed_observation_requires_fhir_source_id_header`
  test pins both directions of the contract — without the id the upload
  raises `HTTPStatusError` with status 400, with the id the mock
  observes the header and the write succeeds. The existing core test
  was tightened to also assert the mock did NOT observe the header on
  a mapped-handler write.

The two-row real-JHE output (run after the wiring landed):

```
Loaded fixture: {'bpm': 72, 'timestamp': '2026-04-09T08:00:00Z'}
Converted to OMH (schema={'namespace': 'omh', 'name': 'heart-rate', 'version': '2.0'})
Built raw FHIR Observation id=...
Uploaded raw observation to JHE; server id=60014
Computed HRV: rmssd=12.56 ms, sdnn=7.15 ms, n=10
Built derived FHIR Observation id=...
Uploaded derived observation to JHE; server id=1d752859-fef9-4c9c-9d13-fb117fc58c8a
Read back 9 recent observation(s) for patient
OK — uploaded and round-tripped 2 observation(s)
```

The integer vs. UUID server id is the visible signal of the routing
split — JHE's mapped Observation handler returns a Postgres integer pk,
while the auxiliary `FhirAuxResource` handler returns a UUID. The
`/fhir/r5/Observation?patient=40001` Bundle search returns both in a
single search-set Bundle, with the derived row carrying its
`derivedFrom` pointer back at the raw row.

## Original (raw-only) Known Unknowns assessment

The first pass of the smoke script wrote only a single raw Observation,
so the remaining two known unknowns from the runbook (FHIR R5 strict-
validator quirks beyond header validation; `derivedFrom` resolution) did
not fire on that run. With the derived-features path now wired, the
`derivedFrom` field is populated with a server-issued raw-row id and
JHE accepts it without complaint — that closes the fourth known unknown
empirically. The fifth (FHIR R5 strict-validator quirks) is still
unverified beyond the header / OAuth / Content-Type checks JHE imposes
in its current shape.

## The actual round-trip

```
$ cd pause_ingest
$ .venv/bin/python -m examples.oura_sample_upload
Loaded fixture: {'bpm': 72, 'timestamp': '2026-04-09T08:00:00Z'}
Converted to OMH (schema={'namespace': 'omh', 'name': 'heart-rate', 'version': '2.0'})
Built FHIR Observation id=684594fe-1b69-4e09-8feb-76a83334b041
Uploaded to JHE; server id=60010
Read back 3 recent observation(s) for patient
OK — uploaded and round-tripped 1 observation
```

And the same observation by the FHIR API:

```
$ curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
       'http://localhost:8000/fhir/r5/Observation?patient=40001' | jq .total
3
```

The Bundle's first entry has `resource.id = "60010"`, `code.coding[0]`
`{system: "https://w3id.org/openmhealth", code: "omh:heart-rate:2.0",
display: "Heart Rate"}`, `subject.reference = "Patient/40001"`, and the
base64 `valueAttachment.data` decodes back to the IEEE-1752-headered OMH
record pause_ingest synthesized.

## What's ready to be re-run

Everything above is captured in a re-runnable bootstrap under
`jhe-local/`. The next session — or a contributor's first stand-up — is:

```
cd jhe-local
./bootstrap.sh           # builds image, starts containers, seeds, prints env
cd ../pause_ingest
.venv/bin/python -m examples.oura_sample_upload
```

The bootstrap is idempotent — re-running it skips work already done.
