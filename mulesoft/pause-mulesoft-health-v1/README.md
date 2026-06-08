# pause-mulesoft-health-v1

Phase 1 deployable Mule application for the Pause-Health.ai prototype.
This is **not a reference artifact** — unlike
`../flows/pause-process-api.example.xml`, this directory is a real
Mule 4 project that builds, tests, and deploys to CloudHub 2.0.

## What it does

One flow. One endpoint.

- `GET /health` → static FHIR R5 Bundle (Patient + 2 raw Observations
  + 1 DBDP-derived feature Observation with `derivedFrom` provenance).

The returned shape is **byte-compatible** with the bundle generated
by `frontend/lib/mulesoft-mocks.ts`, so the Next.js proxy at
`/api/mulesoft/health` can swap mock → live by setting one env var
(`MULESOFT_HEALTH_BASE_URL`) without any consumer code change. The
swap is verified by the test suite at
`frontend/lib/mulesoft/health.test.ts` and
`frontend/app/api/mulesoft/health/route.test.ts`.

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
