# MuleSoft Integration Design

**Status:** Draft v0.1
**Owner:** Pause-Health.ai engineering
**Last updated:** 2026-05-25

## TL;DR

Pause-Health.ai uses **MuleSoft Anypoint Platform** as the integration layer
between vendor wearables, JupyterHealth Exchange (our FHIR substrate), and
the DBDP feature engineering pipeline. We follow MuleSoft's
[API-Led Connectivity](https://www.mulesoft.com/api-led-connectivity)
three-tier pattern (System APIs → Process APIs → Experience APIs).

This is a deliberate choice for one reason: **the buyer**. Most US health
systems and large payers already license Anypoint. Routing our integration
through their existing Mule plane converts a "third-party data integration"
security review into "another Mule app on the existing fabric."

## The three tiers, made concrete

### System APIs (wrap each upstream)

Each upstream gets its own System API. The System API is the **only** place
that knows the vendor's authentication scheme, rate limits, error semantics,
and request shape.

| System API | Wraps | Responsibility |
|---|---|---|
| `oura-system-api` | Oura Cloud v2 | OAuth2 token vault, polling, daily-summary + raw signal pulls |
| `apple-health-system-api` | Apple HealthKit bridge | Receive shareable bundles, transform to OMH-shaped JSON |
| `whoop-system-api` | Whoop developer API | OAuth2, webhook ingestion |
| `empatica-system-api` | Empatica E4 archive uploads | File ingest, virus scan, archive validation |
| `jhe-system-api` | JupyterHealth Exchange | FHIR R5 read/write, OAuth2 client credentials grant |
| `dbdp-system-api` | pause_ingest feature service | Trigger HRV / EDA feature computation, return computed features |

### Process APIs (orchestrate cross-system flows)

| Process API | What it does |
|---|---|
| `pause-ingest-process-api` | When a System API emits a new sample → call `omh-shim` (via DataWeave or via a downcall to `dbdp-system-api`) → POST the FHIR Observation to `jhe-system-api` → fire-and-forget a feature compute request to `dbdp-system-api` for the window |
| `pause-patient-bundle-process-api` | On a clinician request, fan out reads to `jhe-system-api` (raw observations) and `dbdp-system-api` (computed features), assemble a single FHIR Bundle, return to the caller |
| `pause-consent-process-api` | Sync consent state between Salesforce Agentforce (where it's captured) and `jhe-system-api` (where it's enforced) |

### Experience APIs (Pause-facing)

| Experience API | Consumer | Shape |
|---|---|---|
| `/api/v1/patient/{id}/timeline` | Pause clinician web app | FHIR Bundle: Patient + 90 days of Observations + computed feature Observations + active CarePlan |
| `/api/v1/patient/{id}/intake` | Agentforce Service Agent | Read-only: the structured intake record |
| `/api/v1/admin/health` | Pause SRE + customer ops | Liveness + per-System-API uptime |

## Architecture

```
Patient wearables (Oura / Apple Health / Whoop / Empatica E4)
   │  vendor JSON / archive
   ▼
┌─────────────────────────────────────────────────────────┐
│  MuleSoft Anypoint Platform  (customer-hosted)          │
│                                                          │
│  System APIs                                             │
│   ├─ oura-system-api                                     │
│   ├─ apple-health-system-api                             │
│   ├─ whoop-system-api                                    │
│   ├─ empatica-system-api                                 │
│   ├─ jhe-system-api      → JupyterHealth Exchange       │
│   └─ dbdp-system-api     → pause_ingest worker          │
│                                                          │
│  Process APIs                                            │
│   ├─ pause-ingest-process-api                            │
│   ├─ pause-patient-bundle-process-api                    │
│   └─ pause-consent-process-api                           │
│                                                          │
│  Experience APIs                                         │
│   ├─ /patient/{id}/timeline                              │
│   ├─ /patient/{id}/intake                                │
│   └─ /admin/health                                       │
└──────────┬──────────────────────────────────────┬───────┘
           │                                       │
           ▼                                       ▼
   JupyterHealth Exchange              pause_ingest worker
   (FHIR R5 substrate)                 (DBDP feature engineering)
           │
           ▼
   Pause-Health backend (FastAPI)
   ├─ Reads via Experience APIs only
   ├─ Menopause classifiers + RAG
   └─ Writes back via Experience APIs

           Agentforce Service Agent (Salesforce Service Cloud)
            ├─ Patient intake conversation
            └─ Reads/writes via pause-consent-process-api
```

The architectural punchline: **everything Pause talks to goes through
Mule**. The Pause backend never speaks directly to a wearable vendor or to
JupyterHealth — it speaks to Experience APIs that the customer's IT team
owns the policy on.

## Why this matters for the business

- **CIO-friendly security review.** "Another Mule app on your existing
  Anypoint platform" is roughly the easiest possible answer to a procurement
  questionnaire. We adopt the customer's existing controls (auth, audit,
  rate-limit, DLP) instead of asking them to trust ours.
- **Vendor swap without code change.** Adding a new wearable (e.g., Garmin)
  is a System API + one row in the Process API's routing table. No change
  to the Pause backend.
- **Operational ownership flows correctly.** The customer's integration
  team operates the System APIs and Process APIs. Pause owns the Experience
  APIs and the menopause-specific logic. Clean responsibility boundary.
- **Reuse, not rebuild.** Many AMC customers already have Mule System APIs
  for their Epic / Cerner / Workday instances. We compose with theirs.

## Reference artifacts in this repo

`mulesoft/flows/pause-process-api.example.xml` — a labeled Mule 4 Process
API flow showing what the production `pause-ingest-process-api` would look
like. Comments call out each scope and where customer-specific
configuration lives.

`mulesoft/transforms/omh-to-fhir.example.dwl` — a DataWeave 2.0 transform
that converts an Open mHealth `heart_rate` payload into a FHIR R5
`Observation`. Inputs and outputs are typed; this is what the Process API
would invoke between the wearable System API and `jhe-system-api`.

Neither file is deployable as-is. They are intentionally reference-grade
so a customer's Mule developer can drop them into Anypoint Studio, set
their own Anypoint Platform credentials, and have a working starting
point.

## Live mock

The Next.js frontend exposes a mock Experience API at
`/api/mulesoft/health`. It returns a realistic FHIR Bundle with:

- One `Patient` resource (synthetic identifier, no PHI)
- Three raw wearable `Observation` resources (heart rate, sleep duration,
  HRV)
- One DBDP-derived computed-feature `Observation` (sliding-window RMSSD)
  with a `derivedFrom` reference pointing back to the raw HRV input

This lets prospects, partners, and reviewers `curl` the URL and see the
exact shape the production Experience API would return. The bundle is
served by Next.js — there is no live MuleSoft runtime behind it.

## Deployment options

### CloudHub 2.0 (managed, Pause-hosted reference org)
Used during sales and design partner stage. We host a Pause-managed
Anypoint org for demos and design partner pilots.

### Runtime Fabric / Hybrid (customer VPC)
The production stance. Customer deploys the Mule apps into their own
Runtime Fabric or Hybrid runtime, inside their VPC. PHI never leaves
their boundary. Pause inference runs federated alongside.

### Anypoint Code Builder + GitHub
All Mule project source lives in this repo (under `mulesoft/`). CI/CD
deploys to whichever runtime the customer points us at via environment
variables. Same pattern as the Agentforce env-var graceful fallback in the
frontend.

## Phased plan

### Phase 0 — Reference artifacts  *(today)*
- `mulesoft/` directory with the example flow + DataWeave transform.
- Mocked Experience API at `/api/mulesoft/health`.
- Design doc (this file).
- Investor-facing page at `/proposal/mulesoft`.

### Phase 1 — Working sandbox  *(2-3 weeks)*
- Stand up a Pause-managed Anypoint trial org.
- Author the six System APIs as real Mule projects.
- Connect `jhe-system-api` and `dbdp-system-api` to local instances of
  JupyterHealth Exchange and `pause_ingest`.
- One Process API end-to-end (`pause-ingest-process-api`).

### Phase 2 — First customer deployment  *(4-6 weeks with customer)*
- Deploy the Mule apps into the customer's Runtime Fabric.
- Wire the customer's existing identity provider (PingFederate / Azure AD)
  to the Experience APIs.
- Cut over the Pause backend's reads to go through the customer's
  Experience API instead of the Pause-managed sandbox.

### Phase 3 — Multi-customer fabric  *(ongoing)*
- Promote shared System APIs (Oura, Apple Health, JHE) to versioned
  artifacts in Anypoint Exchange.
- Customer-specific Process APIs and Experience APIs continue to live in
  the customer's own org.

## What we contribute back

- A reference Mule Connector for JupyterHealth Exchange. We propose this
  to the JupyterHealth project as a way to lower friction for any
  Mule-using health system.
- A reference Mule Connector for Open mHealth (OMH). Wraps `omh-shim`
  semantics for use directly from DataWeave.
- Anypoint Exchange asset templates for the three-tier pattern we use,
  contributed back to MuleSoft's community library.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Customer doesn't license MuleSoft | Fall back to a Pause-managed CloudHub deployment with a per-customer Mule org. Higher Pause ops cost, same architecture. |
| Mule version drift between customers | Pin to Mule 4.6 LTS for shared System APIs. Customer-specific Process APIs can move faster. |
| DataWeave transform divergence over time | Centralize OMH→FHIR transforms in a shared Anypoint Exchange asset; customer-specific transforms must call the shared one. |
| FHIR R5 vs R4 mismatch with EHR | Translate at the Mule boundary; both versions are first-class in our Process APIs. |

## References

- [MuleSoft API-Led Connectivity](https://www.mulesoft.com/api-led-connectivity)
- [Anypoint Platform docs](https://docs.mulesoft.com/anypoint-platform/)
- [DataWeave 2.0 reference](https://docs.mulesoft.com/dataweave/latest/)
- [MuleSoft Accelerator for Healthcare](https://www.mulesoft.com/accelerators/healthcare)
- Pause docs: [`docs/jupyterhealth-integration.md`](jupyterhealth-integration.md)
