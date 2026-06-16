# MuleSoft reference artifacts (Pause-Health.ai)

This directory holds the Pause-Health.ai MuleSoft artifacts. They fall into two
groups:

- **Live, deployable** — `pause-mulesoft-health-v1/` is a real Mule 4 app that
  is **deployed to CloudHub 2.0** and serves the `GET /health` + `GET /providers`
  Experience APIs behind Flex Gateway (JWT Validation + rate limiting). The
  published OAS lives in `pause-provider-experience-api.oas3.yaml`.
- **Reference-grade** — the `flows/` and `transforms/` `.example` files
  illustrate the not-yet-built ingestion Process API (`pause-ingest-process-api`)
  that wires [JupyterHealth
  Exchange](https://github.com/jupyterhealth/jupyterhealth-exchange), the
  [Digital Biomarker Discovery
  Pipeline](https://www.dbdp.org/code-repository) (via our `pause_ingest` Python
  worker), and consumer wearables. These are **not deployable as-is**.

For the full architecture, see
[`docs/mulesoft-integration.md`](../docs/mulesoft-integration.md). For the
investor-facing summary, see `/proposal/mulesoft` on the deployed site.

## What's here

```
mulesoft/
├── README.md                                   <- this file
├── pause-provider-experience-api.oas3.yaml     <- OAS 3.0 spec (published to Exchange v1.0.2)
├── flex-gateway/                               <- Flex Gateway (Docker + ngrok)
│   ├── docker-compose.yml                      <- runs flex-gateway container
│   ├── .env.example                            <- NGROK_AUTHTOKEN template
│   └── .gitignore                              <- excludes registration.yaml + .env
├── flows/
│   └── pause-process-api.example.xml           <- Mule 4 Process API flow (reference)
├── transforms/
│   └── omh-to-fhir.example.dwl                 <- DataWeave 2.0 transform (reference)
└── pause-mulesoft-health-v1/                   <- Phase 1 DEPLOYABLE Mule app
    ├── README.md
    ├── mule-artifact.json
    ├── pom.xml                                 <- CloudHub 2.0 deploy config
    └── src/main/mule/health-flow.xml           <- GET /health + GET /providers
```

### `pause-mulesoft-health-v1/` (Phase 1, deployable — LIVE)

Unlike the `.example.xml` reference, this is a real Mule 4 project that builds
and is **deployed to CloudHub 2.0**. It serves two Pause Experience-API
surfaces — `GET /health` (a FHIR R5 Bundle including the raw RR-interval window
and the DBDP-derived RMSSD feature with `derivedFrom` lineage) and
`GET /providers` (the menopause provider directory) — both shape-compatible with
the Next.js mocks at `/api/mulesoft/health` and `/api/mulesoft/providers`. The
worker runs behind Flex Gateway with a JWT Validation policy (Auth0 RS256/JWKS)
and rate limiting; the Next.js proxy authenticates with an Auth0 M2M Bearer-JWT
and degrades to the mock on any failure. The Phase 1 handoff doc walks through
the Code Builder import and deploy click-by-click
([`docs/MULESOFT_PHASE_1_HANDOFF.md`](../docs/MULESOFT_PHASE_1_HANDOFF.md)); the
gateway/policy setup is in
[`docs/MULESOFT_API_MANAGER_RUNBOOK.md`](../docs/MULESOFT_API_MANAGER_RUNBOOK.md).

### `flows/pause-process-api.example.xml`

A labeled Mule 4 Process API flow showing the production
`pause-ingest-process-api`. It demonstrates the five-step orchestration:

1. Validate the incoming Open mHealth payload.
2. Transform OMH → FHIR R5 Observation (via the DataWeave file below).
3. POST the Observation to the `jhe-system-api` (JupyterHealth Exchange).
4. Fire-and-forget trigger to `dbdp-system-api` to compute features.
5. Return the created Observation id + correlation id to the caller.

Customer-specific configuration (Anypoint Platform org, secret manager
keys, endpoint URLs) lives in Mule property files, **not** in this XML.

### `transforms/omh-to-fhir.example.dwl`

A DataWeave 2.0 transform converting an Open mHealth envelope (heart rate,
HRV, or sleep duration) into a FHIR R5 `Observation` with the right LOINC
codings, UCUM units, and Pause-specific provenance extension.

This is the canonical transform we propose as a shared Anypoint Exchange
asset so customer-specific Process APIs can call it directly instead of
re-implementing the OMH↔FHIR mapping.

## Why the `flows/` + `transforms/` references aren't a real Mule project (yet)

The Experience worker (`pause-mulesoft-health-v1/`) already IS a real, deployed
Mule project — it has the `pom.xml`, `mule-artifact.json`, and a published OAS,
and runs on CloudHub 2.0. This section is about the **ingestion** reference
artifacts (`flows/pause-process-api.example.xml`,
`transforms/omh-to-fhir.example.dwl`), which model the not-yet-built
`pause-ingest-process-api` and still need the customer- and environment-specific
moving parts a deployable project requires:

- `pom.xml` with Mule Maven plugin and per-environment deployment goals.
- `mule-artifact.json` with the deployed runtime version and resource
  declarations.
- `src/main/resources/*.yaml` property files per environment.
- API specs in Anypoint Exchange (RAML or OAS).
- Customer-managed secret references (Anypoint Secrets Manager, Vault, or
  the customer's existing platform).

These are materialized in **Phase 1c** of the integration plan (see
`docs/mulesoft-integration.md` § "Phased plan"), once the System APIs are wired
to live JupyterHealth Exchange + `pause_ingest` instances. The artifacts here are
the templates that work starts from — the same path the Experience worker
already took.

## How to upgrade to a real Mule project

When you're ready:

1. Open Anypoint Studio (or Anypoint Code Builder) and create a new
   project named `pause-ingest-process-api`.
2. Copy `flows/pause-process-api.example.xml` into the project's
   `src/main/mule/` directory.
3. Copy `transforms/omh-to-fhir.example.dwl` into
   `src/main/resources/transforms/`.
4. Add the OMH JSON Schema referenced by the flow's `json:validate-schema`
   step into `src/main/resources/schemas/omh-envelope.json`. We will
   contribute this schema to the upstream Open mHealth project.
5. Fill in the property files for the System APIs the Process API depends
   on (`jhe-system-api`, `dbdp-system-api`).
6. Wire CI/CD via Anypoint Code Builder → GitHub. CD targets the
   customer's CloudHub 2.0 or Runtime Fabric environment via env vars.

## Live-or-mock Experience API

The Next.js frontend exposes the Experience-tier endpoints at
`/api/mulesoft/health` and `/api/mulesoft/providers`. When the matching base-URL
env var is set (`MULESOFT_HEALTH_BASE_URL` / `MULESOFT_PROVIDERS_BASE_URL`) the
route **proxies to the live CloudHub worker above** (Auth0 M2M Bearer-JWT) and
reports `meta._source: "live-mulesoft"`; otherwise — or on any upstream failure
— it serves a deterministic mock and reports `mock` / `mock-fallback`. Either
way the response is a realistic, shape-identical payload (the `/health` bundle
carries the Patient + raw wearable Observations + the DBDP-derived RMSSD feature
with `derivedFrom` provenance) so prospects can `curl` the URL and see exactly
what the production Experience API returns. As of 2026-06 both endpoints are live
in production; the mock is the zero-credential default for previews and CI.

## Related Pause-Health.ai docs

- [`docs/mulesoft-integration.md`](../docs/mulesoft-integration.md) —
  full architecture and phased plan.
- [`docs/jupyterhealth-integration.md`](../docs/jupyterhealth-integration.md)
  — the FHIR substrate that this Mule plane connects to on the back end.
- [`pause_ingest/`](../pause_ingest/) — the Python feature-engineering
  worker the Process API calls into for DBDP-derived signals.
