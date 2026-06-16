# pause-mulesoft-health-v1

Phase 1 deployable Mule application for the Pause-Health.ai prototype.
This is **not a reference artifact** — unlike
`../flows/pause-process-api.example.xml`, this directory is a real
Mule 4 project that builds, tests, and deploys to CloudHub 2.0.

## What it does

Two flows.

- `GET /health` → static FHIR R5 Bundle (Patient + 3 raw Observations —
  heart rate, sleep duration, and the raw RR-interval window — + 1
  DBDP-derived RMSSD feature Observation whose `derivedFrom` references
  the raw window). Shape-identical to `buildPatientTimelineBundle()` in
  `frontend/lib/mulesoft-mocks.ts`.
- `GET /providers?zip=&menopause=&limit=&fallback=&insurance=` →
  ranked menopause-relevant provider directory, full Phase-2 contract
  shape (matchType tier ladder, serviceSignals, licenseStatus,
  insuranceAccepted, dataset provenance).

The returned shapes are **field-compatible** with the responses generated
by `frontend/lib/mulesoft-mocks.ts`, so the Next.js proxies at
`/api/mulesoft/health` and `/api/mulesoft/providers` swap mock → live by
setting `MULESOFT_HEALTH_BASE_URL` / `MULESOFT_PROVIDERS_BASE_URL`
without any consumer code change. The swap is verified by the test suite
under `frontend/lib/mulesoft/`.

### Two intentional differences between live and mock for `/providers`

1. **Breadth.** The live worker bakes a curated 9-row slice (the 6 demo
   personas' local certified providers + 2 relevant-local OB/GYNs + a
   telehealth-capable certified-remote example) so every demo persona
   resolves green when the agent calls live. The committed mock loads
   the 2,015-row NPPES-derived JSON. Same shape, narrower coverage.
   Hosting the full directory inside the JAR would balloon the
   deployable; loading it from blob storage on cold start would add
   latency without helping the demo. The contract is what matters.
2. **Distance ranking.** The live worker doesn't carry the Census 2020
   ZCTA centroid table, so it leaves `distanceMiles: null` on each row
   and reports `sort: "score"`. The mock resolves the patient ZIP →
   centroid and stamps Haversine miles when it can. Both honor the
   contract; the route handler picks the higher-fidelity ranking.

## What it does NOT do (Phase 1 scope)

Deliberately:

- No upstream JupyterHealth Exchange call. The bundle is static.
- No DBDP feature computation. The derived-feature Observation is
  hard-coded with the same numerical value as the mock.
- No wearable System APIs. No vendor OAuth, no rate-limited
  third-party calls.
- No API Manager policy. Iteration 2 adds rate limiting + client
  credentials.
- No DataWeave-from-OMH transform. That lives in
  `../transforms/omh-to-fhir.example.dwl` and will be wired into
  iteration 3.

The whole point of Phase 1 is to prove **the integration path
exists, deploys, and serves real bytes from the customer's Anypoint
platform.** Everything else is an iteration.

## Deploy path

See [`docs/MULESOFT_PHASE_1_HANDOFF.md`](../../docs/MULESOFT_PHASE_1_HANDOFF.md)
for the click-by-click runbook. Tl;dr:

1. Open Anypoint Code Builder in the browser.
2. **File → Import → Existing Mule Project → from local folder**,
   pick this directory.
3. **Deploy → CloudHub 2.0 → Sandbox**.
4. Copy the resulting worker URL (e.g.
   `https://pause-mulesoft-health-v1.us-e2.cloudhub.io`).
5. Set `MULESOFT_HEALTH_BASE_URL=<worker-url>` in
   `frontend/.env.local` and in the Vercel project env.
6. `curl https://pause-health.ai/api/mulesoft/health` → response
   metadata reports `"_source": "live-mulesoft"`.

## Local development

```bash
# From inside Anypoint Code Builder or Anypoint Studio:
#   1. Open this directory as a Mule project.
#   2. Run As → Mule Application.
#   3. curl http://localhost:8081/health
#
# Or from Maven CLI (requires Anypoint credentials in ~/.m2/settings.xml):
mvn clean package
mvn mule:run
curl http://localhost:8081/health
```

## File layout

```
pause-mulesoft-health-v1/
├── README.md                    ← this file
├── mule-artifact.json           ← runtime descriptor (Mule 4.6.0)
├── pom.xml                      ← Maven build + CloudHub 2.0 deploy config
└── src/main/mule/health-flow.xml ← the one HTTP listener + DataWeave transform
```

That's the entire project. By design.
