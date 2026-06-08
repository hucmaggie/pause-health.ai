# MuleSoft reference artifacts (Pause-Health.ai)

This directory holds **reference** MuleSoft artifacts illustrating how
Pause-Health.ai integrates with [JupyterHealth
Exchange](https://github.com/jupyterhealth/jupyterhealth-exchange),
the [Digital Biomarker Discovery
Pipeline](https://www.dbdp.org/code-repository) (via our `pause_ingest`
Python worker), and consumer wearables. They are **not deployable as-is**.

For the full architecture, see
[`docs/mulesoft-integration.md`](../docs/mulesoft-integration.md). For the
investor-facing summary, see `/proposal/mulesoft` on the deployed site.

## What's here

```
mulesoft/
├── README.md                                   <- this file
├── flows/
│   └── pause-process-api.example.xml           <- Mule 4 Process API flow (reference)
├── transforms/
│   └── omh-to-fhir.example.dwl                 <- DataWeave 2.0 transform (reference)
└── pause-mulesoft-health-v1/                   <- Phase 1 DEPLOYABLE Mule app
    ├── README.md
    ├── mule-artifact.json
    ├── pom.xml                                 <- CloudHub 2.0 deploy config
    └── src/main/mule/health-flow.xml           <- GET /health -> FHIR Bundle
```

### `pause-mulesoft-health-v1/` (Phase 1, deployable)

Unlike the `.example.xml` reference, this is a real Mule 4 project
that builds and deploys to CloudHub 2.0. It serves a single Pause
Experience-API surface — `GET /health` returning a static FHIR R5
Bundle — and is shape-compatible with the Next.js mock at
`/api/mulesoft/health`. The Phase 1 handoff doc walks through the
Code Builder import and deploy click-by-click:
[`docs/MULESOFT_PHASE_1_HANDOFF.md`](../docs/MULESOFT_PHASE_1_HANDOFF.md).

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

## Why these aren't a real Mule project (yet)

A real Mule project has additional moving parts that are environment- and
customer-specific:

- `pom.xml` with Mule Maven plugin and per-environment deployment goals.
- `mule-artifact.json` with the deployed runtime version and resource
  declarations.
- `src/main/resources/*.yaml` property files per environment.
- API specs in Anypoint Exchange (RAML or OAS).
- Customer-managed secret references (Anypoint Secrets Manager, Vault, or
  the customer's existing platform).

We will materialize all of the above during **Phase 1** of the MuleSoft
integration plan (see `docs/mulesoft-integration.md` § "Phased plan"),
once we are working against a Pause-managed Anypoint trial org. The
artifacts in this directory are the templates that work will start from.

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

## Mocked Experience API

While the Mule project doesn't exist yet, the Next.js frontend exposes a
mocked Experience-tier endpoint at `/api/mulesoft/health`. It returns a
realistic FHIR Bundle (Patient + raw wearable Observations + a
DBDP-derived computed-feature Observation with proper `derivedFrom`
provenance) so prospects can `curl` the URL and see the exact response
shape the production Experience API would produce. The bundle is served
by Next.js — there is no live MuleSoft runtime behind it.

## Related Pause-Health.ai docs

- [`docs/mulesoft-integration.md`](../docs/mulesoft-integration.md) —
  full architecture and phased plan.
- [`docs/jupyterhealth-integration.md`](../docs/jupyterhealth-integration.md)
  — the FHIR substrate that this Mule plane connects to on the back end.
- [`pause_ingest/`](../pause_ingest/) — the Python feature-engineering
  worker the Process API calls into for DBDP-derived signals.
