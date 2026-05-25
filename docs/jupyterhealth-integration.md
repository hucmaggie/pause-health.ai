# JupyterHealth Integration Design

**Status:** Draft v0.1
**Owner:** Pause-Health.ai engineering
**Last updated:** 2026-05-25

## TL;DR

Pause-Health.ai builds the menopause-specific intelligence layer.
[JupyterHealth](https://github.com/jupyterhealth) builds the open
FHIR-native substrate underneath it. Adopting JupyterHealth lets us inherit:

- A standards-based FHIR R5 data plane (HL7 + IEEE 1752 / Open mHealth).
- Patient consent, scope management, and OAuth2/OIDC out of the box.
- A way to deploy data infrastructure into a customer's VPC without rebuilding it.
- A growing open ecosystem of wearable-to-OMH converters.

We do not fork JupyterHealth. We compose with it.

## The pieces we use

| Repo | What it provides | How we use it |
|---|---|---|
| [jupyterhealth-exchange](https://github.com/jupyterhealth/jupyterhealth-exchange) | Django web app: OAuth2/OIDC, FHIR R5 API, consent + scope mgmt, OMH validation, multi-tenant orgs/studies | Substrate that stores patient timelines, runs consent, talks FHIR |
| [jupyterhealth-client](https://github.com/jupyterhealth/jupyterhealth-client) | Python client library (`pip install jupyterhealth-client`) | Our FastAPI backend uses it to read observations |
| [omh-shim](https://github.com/jupyterhealth/omh-shim) | Vendor wearable JSON → Open mHealth schema converters | Our ingest worker uses it to normalize Oura, Apple Health, etc. |
| [jupyter-smart-on-fhir](https://github.com/jupyterhealth/jupyter-smart-on-fhir) | SMART-on-FHIR launch reference | Reference for our EHR-embedded launch flow |
| [helm-charts](https://github.com/jupyterhealth/helm-charts) | Kubernetes deployment charts | How customer health systems run JHE in their own VPC |

## Architecture

```
Patient wearables (Oura / Apple Health / Whoop / Garmin / Empatica E4)
   │  vendor JSON / zip
   ▼
Pause-Health ingest worker
   │  omh-shim → Open mHealth JSON  (normalization)
   │       │
   │       ▼
   │  pause_ingest.features → FLIRT + DBDP HRV  (feature engineering)
   │  sliding-window HRV / EDA / ACC metrics
   ▼
JupyterHealth Exchange  (customer-hosted, per-tenant VPC)
   ├─ FHIR R5 Patient / Observation / Group / Consent
   ├─ OAuth2 + OIDC
   ├─ Raw OMH Observations (one per sample window)
   └─ Computed feature Observations (one per metric per window)
   │
   │  FHIR REST API (OAuth2 bearer)
   ▼
Pause-Health backend  (FastAPI)
   ├─ jupyterhealth-client: read patient timeline + features
   ├─ Menopause classifiers + RAG over guideline corpus
   └─ Writes recommendations back as FHIR
     Observation / CarePlan / DocumentReference
   │
   ├──► EHR (via SMART-on-FHIR launch)
   └──► Pause web app (clinician view)
```

The architectural punchline: **JHE is the FHIR + consent backbone.
Pause is the menopause-specific reasoning layer on top.**

## Why this matters for the business

- **Sales acceleration.** "We sit on top of JupyterHealth, an open project from
  Project Jupyter and UC Berkeley" lands better with CIOs than "we built our
  own data plane." Open standards reduce procurement and security review.
- **Compounding ecosystem.** Every device converter added to `omh-shim` (by us
  or anyone else) becomes a new data source for our model. We get pull
  requests instead of integrations.
- **Customer-controlled data.** JHE runs in the customer's VPC. PHI never
  leaves their boundary. Our inference layer can run federated in-VPC, or
  read summarized features over a service mesh, depending on the contract.
- **Audit and explainability.** Every recommendation is a FHIR resource with a
  reproducible input set. Compliance teams understand the model.

## Data flow detail

### Ingest (patient side)

1. Patient enrolls in a Pause-managed Study via JHE invitation link.
2. Patient grants OAuth2 consent for the requested Scopes (e.g., heart rate,
   sleep, HRV, oxygen saturation, activity).
3. Patient connects their wearable. Pause holds the vendor OAuth tokens.
4. Pause ingest worker pulls samples (poll or webhook), runs them through
   `omh_shim.convert(source=..., data_type=..., sample=...)`.
5. Worker POSTs the resulting OMH JSON as a FHIR `Observation` with the
   patient as `subject` and a registered Data Source as `device`.

### Inference (provider side)

1. Clinician launches Pause from the EHR via SMART-on-FHIR, or opens the
   Pause web app directly.
2. FastAPI backend uses `jupyterhealth-client` to pull a windowed set of
   `Observation` resources for the patient across the consented scopes.
3. The backend runs:
   - **Symptom clustering** — embedding model over PRO + EHR free text.
   - **Risk stratification** — gradient-boosted classifier on structured
     features (vitals, labs, history, wearable signals).
   - **Recommendation generation** — RAG over the curated menopause
     guideline corpus, conditioned on the patient timeline.
4. The result is rendered to the clinician with cited evidence.

### Persistence (write back)

Every accepted/edited/rejected recommendation is written back to JHE as:

- `Observation` of type "menopause symptom cluster" (LOINC where possible,
  custom code where not).
- `CarePlan` with the proposed pathway, status, and follow-up date.
- `DocumentReference` with the narrative explanation and the evidence
  citations.

This is what makes the system auditable, lets the EHR consume our output,
and feeds the outcomes registry described in the investor brief.

## Wearable data types

The `omh-shim` v1.0.1 registry (validated by introspecting the actual
shipped dispatch table) covers most of what we care about for menopause:

| Data type | omh-shim sources | Menopause relevance |
|---|---|---|
| `heart_rate` | `oura_raw`, `ow_normalized` | Vasomotor signal; sympathetic drive |
| `heart_rate_variability` | `oura_raw`, `ow_normalized` | Autonomic dysregulation, sleep quality |
| `sleep_duration`, `sleep_episode` | `oura_raw`, `ow_normalized` | Night sweats, sleep fragmentation |
| `oxygen_saturation` | `ow_normalized` only | Sleep-disordered breathing |
| `step_count`, `physical_activity` | `oura_raw`, `ow_normalized` | Fatigue, activity drop |

**Known gaps:**

- `oxygen_saturation` is not yet wired up for `oura_raw` (only for the
  Open Wearables normalized format). Easy upstream contribution.
- `skin_temperature` is not in `omh-shim` v1.0.1 at all, but Oura exposes
  it and it's one of the strongest hot-flash signals. We plan to
  contribute both a converter and the corresponding Open mHealth schema
  proposal.

## Feature engineering layer (DBDP)

The [Digital Biomarker Discovery Pipeline](https://www.dbdp.org/code-repository)
(DBDP) is a Duke University-led open-source ecosystem of wearable feature
engineering tools. We compose with the DBDP layer between `omh-shim`
(normalization) and our menopause models (inference). Features are
computed at ingest time and persisted alongside the raw OMH data inside
JupyterHealth Exchange, so the provider read path never has to recompute
them and every feature is traceable to a specific raw window.

### What we use today

| Project | License | Status | Where it lives in pause_ingest |
|---|---|---|---|
| [FLIRT](https://github.com/im-ethz/flirt) (PyPI: `flirt`) | MIT | **In use** — Phase 1 | `pause_ingest.features.hrv_features_flirt` |
| [DBDP `Heart-Rate-Variability`](https://github.com/DigitalBiomarkerDiscoveryPipeline/Heart-Rate-Variability) (Kubios-validated) | Apache-2.0 | **Ported** as a dependency-light fallback | `pause_ingest.features.hrv_time_domain_fallback` |
| [DBDP `Digital_Health_Data_Repository`](https://github.com/DigitalBiomarkerDiscoveryPipeline/Digital_Health_Data_Repository) | Apache-2.0 | **In use** for test fixtures | `pause_ingest/examples/fixtures/dhdr_ibi_sample.csv` |
| [devicely](https://github.com/hpi-dhc/devicely) (Empatica E4 reader) | MIT | **Scoped, Phase 2** — see gating note below | `pause_ingest.empatica` (stub) |

### Why two HRV implementations

The FLIRT-backed path is the production default — it does proper
sliding-window feature generation across time, frequency, and statistical
domains, which is what the menopause classifiers actually consume.

The hand-rolled `hrv_time_domain_fallback` exists for three reasons:

1. It runs without `flirt`, `scipy`, or `numba` installed. Useful in
   lightweight serverless contexts and in CI where install time matters.
2. It is small enough to read end-to-end and reason about, so it serves
   as a deterministic reference in tests. The closed-form RMSSD test
   (`test_fallback_alternating_ibi_has_closed_form_rmssd`) is what
   catches regressions if anyone "improves" the formula.
3. It directly mirrors the DBDP HRV calculator, which was validated
   against Kubios (the clinical HRV reference). That gives us
   defensible numbers to show a clinical advisor.

### Phase 2 gating: Empatica E4

`devicely` is the most natural reader for Empatica E4 archives and is
what the DBDP `Pre-process` repo recommends. As of this writing it pins
`numpy<2.0` and `pandas<2.0`, which is incompatible with the rest of the
Python 3.13 scientific stack we already depend on (jupyterhealth-client,
omh-shim, flirt all run on numpy 2.x). Until `devicely` is updated or we
isolate the Empatica path into its own subprocess with a pinned environment,
`pause_ingest.empatica.ingest_empatica_e4_zip` raises a loud
`EmpaticaIngestNotImplemented`. FLIRT's own `flirt.with_.empatica(zip_path)`
already runs on the modern stack, so Phase 2 will wire that in directly and
treat `devicely` as the de-identification step we can opt into per pilot.

### How features become FHIR

Each sliding-window feature row from `hrv_features_flirt` becomes one or
more FHIR R5 `Observation` resources:

- `code` — LOINC where available (e.g. RMSSD has no LOINC code yet, so we
  use a custom CodeableConcept in the Pause code system and link to the
  FLIRT feature name as a secondary coding).
- `effectivePeriod` — start = window start, end = window end.
- `derivedFrom` — references the raw IBI `Observation` resources that fed
  the window. This is the audit trail.
- `device` — registered Data Source in JHE that produced the raw signal.

This pattern keeps Pause's read path fast (no recompute) while preserving
full lineage — exactly what a security review wants to see.

## Phased plan

### Phase 1 — Local dev loop  *(1–2 weeks)*
- Stand up JHE locally per its README (Postgres + Django + seed data).
- Add `jupyterhealth-client` and `omh-shim` to `requirements.txt`.
- Build a `pause_ingest/` worker that takes a sample wearable JSON,
  converts via `omh-shim`, and uploads to local JHE as a FHIR
  `Observation`.
- Add a FastAPI endpoint that reads it back. **End-to-end proof.**

### Phase 2 — Real wearable ingest  *(2–3 weeks)*
- Vendor OAuth flows for Oura first, then HealthKit bridge for Apple Health.
- Background worker (Celery / RQ) that pulls samples and runs the convert →
  upload pipeline.
- Patient mobile experience for connecting wearables (React Native, separate
  surface from the marketing site).

### Phase 3 — Provider read path  *(2–3 weeks)*
- FastAPI service uses `jupyterhealth-client` to assemble a patient timeline.
- Wire the menopause classifier and RAG layer (initially against a curated
  guideline corpus snapshot).
- Render the clinician view in the Pause web app.

### Phase 4 — Provider write path  *(3–4 weeks)*
- Write `Observation`, `CarePlan`, and `DocumentReference` back to JHE.
- Capture clinician accept / edit / reject as discrete events on the
  outcomes registry.

### Phase 5 — Customer-VPC deployment  *(4+ weeks per customer)*
- Deploy JHE into the customer VPC using the `helm-charts` repo.
- Wire SAML SSO via JHE's `grafana-django-saml2-auth`.
- Deploy Pause inference layer alongside JHE (federated mode).
- Negotiate data egress: model weights leave; PHI does not.

## Open contributions back to JupyterHealth

This is part of the strategy, not an afterthought. Things Pause should
upstream:

- `omh-shim` converter for Apple HealthKit (today only Oura and a generic
  Open Wearables normalized format).
- `omh-shim` converter and OMH schema proposal for `skin_temperature`.
- Helm chart values tuned for healthcare-grade compliance (HIPAA-friendly
  defaults: TLS everywhere, audit logging, restricted egress).
- Open mHealth schema for a structured menopause symptom cluster (Pause-led,
  community-reviewed).

This earns us standing in the community and lowers the barrier for the
next customer's procurement team.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| JupyterHealth Exchange is still pre-1.0 | Pin to specific commits; contribute fixes; maintain an internal fork for hot patches if needed |
| `omh-shim` covers limited sources today | Contribute Apple Health converter ourselves; not blocking — we can keep raw vendor JSON alongside OMH during early pilots |
| Customer health systems may resist a third-party Django app in their VPC | Helm chart with hardened defaults; pen-test results published; offer Pause-managed deployment as a fallback |
| FHIR R5 adoption in EHRs is still partial | Use R4 → R5 translation at the boundary; JHE already supports this lift |

## References

- [JupyterHealth Exchange README](https://github.com/jupyterhealth/jupyterhealth-exchange/blob/main/README.md)
- [JupyterHealth client docs](https://jupyterhealth-client.readthedocs.io/)
- [omh-shim README](https://github.com/jupyterhealth/omh-shim/blob/main/README.md)
- [Open mHealth schemas](https://www.openmhealth.org/documentation/#/overview/get-started)
- [HL7 FHIR R5](https://hl7.org/fhir/R5/)
- [IEEE 1752.1 (digital health data envelope)](https://standards.ieee.org/ieee/1752.1/)
- [Digital Biomarker Discovery Pipeline (DBDP)](https://www.dbdp.org/code-repository)
- [FLIRT — feature generation toolkit for wearable data](https://github.com/im-ethz/flirt) ([paper](https://doi.org/10.1016/j.cmpb.2021.106461))
- [DBDP Heart Rate Variability (Kubios-validated)](https://github.com/DigitalBiomarkerDiscoveryPipeline/Heart-Rate-Variability)
- [DBDP Digital Health Data Repository (DHDR)](https://github.com/DigitalBiomarkerDiscoveryPipeline/Digital_Health_Data_Repository)
- [devicely (Empatica E4 reader)](https://github.com/hpi-dhc/devicely)
