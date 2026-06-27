# MuleSoft Anypoint Integration — Next-Session Runbook

**Status:** ✅ EXECUTED / SUPERSEDED. This was the pre-implementation
investigation snapshot (2026-06-02). The runbook has since been carried out:
the `pause-mulesoft-health-v1` worker is **deployed to CloudHub 2.0** serving
`/health` + `/providers` behind Flex Gateway (JWT Validation + rate limiting),
and the Next.js routes proxy to it (live-or-mock). For the current state see
[`mulesoft-integration.md`](mulesoft-integration.md) § "Phased plan",
[`MULESOFT_PHASE_1_HANDOFF.md`](MULESOFT_PHASE_1_HANDOFF.md), and
[`MULESOFT_API_MANAGER_RUNBOOK.md`](MULESOFT_API_MANAGER_RUNBOOK.md). The text
below is preserved as the historical investigation record — statements like "no
live Mule app deployed" describe the 2026-06-02 starting point, not today.
**Last updated:** 2026-06-02 (end of investigate-only session)
**Companion docs:** [`mulesoft-integration.md`](mulesoft-integration.md) (design),
[`PHASE_3_RUNBOOK.md`](PHASE_3_RUNBOOK.md) (parallel pattern, Agentforce)

## Why this doc exists

The user has a real Anypoint Platform org and wants to use it in the
prototype. Today's session was scoped to **investigation only** — no
Anypoint UI clickthrough, no commits to wiring, no env vars exposed.

This runbook captures what we learned about the current MuleSoft surface
area in the repo, what we still need from the user's org, the
network/Zscaler posture, and the recommended next step that will produce
the highest investor-visible payoff for the least UI work.

## What is already in the repo (and what's mocked)

The MuleSoft story in the prototype is **substantially more developed
than the Salesforce story was at this point.** The shapes are real, the
investor narrative is real, and the only thing missing is an actual Mule
runtime behind the mocks.

| Surface | File / route | What it is today |
|---|---|---|
| Investor page | `/proposal/mulesoft` (`frontend/app/proposal/mulesoft/page.tsx`) | Polished. Tiers, "why MuleSoft", prototype-vs-production table, phased plan, investor takeaways. **No claims about live integration** — explicitly says "mocked Experience API." |
| Design doc | `docs/mulesoft-integration.md` | Full API-Led Connectivity three-tier design. Six System APIs, three Process APIs, three Experience APIs. Risks and mitigations. |
| Reference Mule project | `mulesoft/flows/pause-process-api.example.xml` | Real Mule 4 XML. Reference-grade, intentionally not deployable. |
| Reference DataWeave | `mulesoft/transforms/omh-to-fhir.example.dwl` | Real DataWeave 2.0 transform (Open mHealth → FHIR R5 Observation). |
| Mocked Experience APIs (4 routes) | `frontend/app/api/mulesoft/*` | Real-shape FHIR Bundles and structured intake records, served by Next.js. Cache-Control 5 min. |
| Mock data fixtures | `frontend/lib/mulesoft-mocks.ts` | Deterministic FHIR Bundle (Patient + 3 raw Observations + 1 DBDP-derived feature Observation with `derivedFrom` provenance). |
| MCP server | `mcp/src/server.ts` | Wraps the four mocked Experience APIs as MCP tools (`get_patient_timeline`, `get_patient_intake`, `find_menopause_providers`, plus the health check). Already supports `PAUSE_MCP_BASE_URL` env var to swap the mock for a real Mule runtime — **no code change needed when we point it at Anypoint**. |
| Demo cohort id | `DEMO_PATIENT_ID = "pause-demo-patient-001"` | Used across every Mule mock route and the MCP server. |

The four mocked Experience-API routes are:

1. `GET /api/mulesoft/health` — liveness + patient timeline FHIR Bundle.
2. `GET /api/mulesoft/patient/{id}/timeline` — patient timeline FHIR Bundle (aliases unknown ids to the demo patient).
3. `GET /api/mulesoft/patient/{id}/intake` — structured intake record produced by Agentforce, persisted by `pause-intake-process-api`.
4. `GET /api/mulesoft/providers?zip=…&menopause=…&limit=…` — ranked menopause-experienced provider directory.

**The crucial architectural property:** every mock route knows its
"production equivalent" by name (e.g. `pause-patient-bundle-process-api`,
`pause-intake-process-api`, `pause-provider-directory-experience-api`).
When we swap to a real Mule runtime we are honoring an existing contract,
not inventing one.

## What we know about the user's Anypoint org

| Field | Value |
|---|---|
| Edition | Full Anypoint Platform (paid, CloudHub 2.0 or Runtime Fabric available) — per the user, 2026-06-02 |
| Control plane region | Unknown. Default is US (`anypoint.mulesoft.com`); EU is `eu1.anypoint.mulesoft.com`; gov is `gov.anypoint.mulesoft.com`. **Ask the user which region.** |
| Business Group / Environment | Unknown. Most orgs have at least `Sandbox` + `Production` envs. **Ask the user which env to target for the prototype.** |
| Connected Apps (OAuth client credentials) | Unknown. Need a Connected App with `Read Organization`, `Read Servers`, `Manage Applications` scopes minimum, depending on which path we take below. |
| Deployed Mule apps today | Unknown — out of scope for this session. The user will share when we're ready to wire. |
| Anypoint Exchange assets | Unknown. The user may already have System APIs published. |

**What we need from the user when we move to implementation:**

```bash
# Anypoint Platform Connected App (Access Management → Connected Apps → New)
ANYPOINT_CLIENT_ID=...                      # Connected App ID
ANYPOINT_CLIENT_SECRET=...                  # Connected App secret
ANYPOINT_ORG_ID=...                         # Master organization ID (UUID)
ANYPOINT_ENV_ID=...                         # Environment ID (UUID) for Sandbox or Production
ANYPOINT_CONTROL_PLANE=https://anypoint.mulesoft.com   # or eu1/gov as appropriate
```

These are all the same kind of "server-to-server OAuth client
credentials" pattern we just used for Salesforce in
`lib/salesforce/auth.ts`. The implementation pattern carries over almost
1-to-1.

## Network and Zscaler posture

Probed on 2026-06-02 from the local dev environment (Zscaler currently
paused per the Phase 1 fix). Findings:

| Hostname | Reachable | Notes |
|---|---|---|
| `anypoint.mulesoft.com` | ✅ HTTP 301 (redirect to login) | Resolves to `*.edge2.salesforce.com` — same edge as Salesforce. **Implication:** if Zscaler later blocks `*.salesforce.com` it will also block Anypoint. |
| `eu1.anypoint.mulesoft.com` | ✅ HTTP 301 | Same edge family. |
| `gov.anypoint.mulesoft.com` | ✅ HTTP 301 | Same edge family. |
| `anypoint.mulesoft.com/accounts/api/v2/oauth2/token` | ✅ HTTP 401 with `Unauthorized` body to bogus creds | **This is the expected healthy response.** OAuth client credentials flow works the same as Salesforce. |
| `us-e1.cloudhub.io` | ✅ HTTP 301 | CloudHub 1.0 worker base. |
| `us-east-1.cloudhub.io` | ✅ HTTP 502 | CloudHub 2.0 worker base. 502 here is fine — no app deployed at that bare host. |
| `mq-us-east-1.anypoint.mulesoft.com` | ✅ HTTP 500 | Anypoint MQ. 500 to GET is expected (it's an AMQP/HTTP hybrid endpoint). |
| `exchange2-asset-manager-kprod.s3.amazonaws.com` | ✅ HTTP 403 | Anypoint Exchange asset CDN, S3-backed. |
| `cloudhub.io` (bare) | ❌ DNS failure | Expected — never a real host, only used as a suffix. |

**Headline finding:** Anypoint hostnames go through the **same Salesforce
edge** (`*.edge2.salesforce.com`) that we hit with the regular Salesforce
org. That's both good news and a risk:

- ✅ Good: the same Zscaler exception that already permits the user's
  Salesforce org should generally cover Anypoint. We don't expect a
  fresh fight here like we had with `*.c360a.salesforce.com`.
- ⚠️ Risk: if Zscaler tightens `*.salesforce.com` later, both Salesforce
  AND MuleSoft break for the prototype. Worth documenting in the security
  posture page eventually.

CloudHub workers live on dedicated `cloudhub.io` subdomains that are NOT
on `*.salesforce.com`. Those are independent network paths and would need
to be probed separately if/when we point the prototype at a deployed app.

## Recommended scope: "Real Anypoint API on top of one mocked Experience API"

Given (a) the prototype already has rich mocks, (b) the user has a full
Anypoint Platform org, (c) the architecture is already correct, and (d)
the highest ROI is a single live data path the investor can `curl`, the
recommendation is:

**Pick ONE of the four mocked Experience APIs and replace its mock with
a real Mule application deployed to CloudHub 2.0 in the user's org.**

The strongest choice is `/api/mulesoft/health` (and the equivalent
`/api/mulesoft/patient/{id}/timeline`, since they share the bundle
generator). Reasons:

1. **It's the canonical demo URL** — linked from `/proposal/mulesoft`,
   the README, the design doc, and the MCP server descriptor. Making it
   live makes everything downstream more credible without any new UI work.
2. **The payload is fully synthetic** — a Patient resource with no PHI
   and three Observation resources with deterministic values. Safe to put
   on a public CloudHub worker.
3. **No upstream dependencies** — the bundle doesn't actually need JHE or
   `pause_ingest` to be live. A Mule app can return the same JSON. That
   makes Phase 1 a one-day exercise, not a three-week one.
4. **The MCP server already supports it** — set
   `PAUSE_MCP_BASE_URL=https://<your-cloudhub-app>.cloudhub.io` and the
   MCP tools transparently flip from mock to live. We covered this design
   when we built the MCP server; the runbook is just to actually do it.
5. **It tells the right story** — "every Pause Experience API ships as a
   Mule app on the customer's Anypoint platform" goes from being a
   slide-deck claim to a `curl`-able demonstration.

Out of scope for the first iteration (deliberately):

- **Real System APIs** for wearables (Oura, Apple, Whoop, Empatica). That
  needs vendor OAuth setup per wearable; weeks of work each.
- **Real `jhe-system-api`** — needs a deployed JupyterHealth Exchange
  instance.
- **Real `dbdp-system-api`** — needs `pause_ingest` running somewhere
  reachable from CloudHub.
- **API Manager policies** (rate limiting, OAuth). Worth adding in
  iteration 2 once the live path exists.
- **Anypoint MQ orchestration.** Investor-impressive but not on the demo
  path. Leave for iteration 3.

## Phase 1 step-by-step (estimated 3-5 hours, mostly Anypoint UI)

This will be the next session. Pre-work for the user is **just step 0**;
everything else is shared between the user clicking and the agent wiring.

### Step 0 — Pre-session prep (user, ~10 min)

Before starting the implementation session, the user should:

1. Confirm the **control plane region** (`anypoint.mulesoft.com` vs
   `eu1` vs `gov`).
2. Confirm which **Business Group** + **Environment** to target. For a
   demo deployment, "Sandbox" inside the root Business Group is fine.
3. (Nice to have, not blocking) Look at Runtime Manager → Applications
   to see if anything is already deployed in that env. If yes, note the
   app names — we can avoid name collisions.

### Step 1 — Create the Connected App (Anypoint UI, ~10 min)

In Anypoint Platform → Access Management → Connected Apps → **New
Connected App**:

- App acts on its own behalf (client credentials).
- Scopes to grant:
  - `View Organization`
  - `Manage Organization` *(only if we want to introspect — otherwise skip)*
  - `Read Servers`
  - `Manage Applications` (CloudHub 2.0)
  - `Read Applications` (CloudHub 2.0)
- Save the Client ID and Secret. We will put them in
  `frontend/.env.local` and ALSO in CI later.

### Step 2 — Author the Mule app (~1 hour)

Two options, pick based on the user's Anypoint Studio comfort level:

**Option A: Anypoint Code Builder (browser-based, no install).** Open
Code Builder, create a new project from
`mulesoft/flows/pause-process-api.example.xml` (or a stripped-down
version that just returns the static bundle from
`frontend/lib/mulesoft-mocks.ts`). One HTTP listener flow, returns the
same JSON shape the mock returns today.

**Option B: Anypoint Studio (desktop).** Same project, just authored
locally. Requires Java + Anypoint Studio install (~600 MB).

Either way the Mule app is **one flow**: `GET /health` → set-payload =
the static FHIR Bundle JSON → return.

For Phase 1 we deliberately do NOT hook this up to live JHE or DBDP.
That's iteration 2.

### Step 3 — Deploy to CloudHub 2.0 (~30 min)

From Code Builder or Studio: deploy to CloudHub 2.0. We get a worker URL
like `https://pause-mulesoft-health-v1.us-e2.cloudhub.io/health`.

Probe it with curl first to verify it works standalone.

### Step 4 — Wire the prototype (~30 min, agent-driven)

This is the part that lives in this repo. We'll add:

```bash
# frontend/.env.local (or Vercel project env vars for prod)
MULESOFT_HEALTH_BASE_URL=https://pause-mulesoft-health-v1.us-e2.cloudhub.io
```

And modify `frontend/app/api/mulesoft/health/route.ts` to do this:

```ts
// Pseudocode of the modification
const liveUrl = process.env.MULESOFT_HEALTH_BASE_URL;
if (liveUrl) {
  try {
    const res = await fetch(`${liveUrl}/health`, { /* short timeout */ });
    if (res.ok) {
      const live = await res.json();
      return NextResponse.json({ meta: { ...META, _source: "live-mulesoft", _liveUrl: liveUrl }, bundle: live });
    }
  } catch (err) {
    // graceful degradation — same pattern as lib/salesforce/grounding.ts
    warnMulesoftDegradationOnce("mulesoft.health.live-fetch", err);
  }
}
return NextResponse.json({ meta: { ...META, _source: "mock-fallback" }, bundle: FHIR_BUNDLE });
```

The pattern is **identical** to the Salesforce grounding fallback in
`lib/salesforce/grounding.ts`. We have a tested template.

### Step 5 — Update investor page + Agent Fabric trace (~30 min)

- `/proposal/mulesoft`: change the "Touch the architecture" section's
  status indicator from "mocked" to "live on Anypoint Platform (CloudHub
  2.0)" when `MULESOFT_HEALTH_BASE_URL` is set. Add a small badge to the
  `curl` button that says "LIVE" vs "MOCK".
- `/demo/agent-fabric`: when a trace touches the patient timeline, show
  whether it hit live Mule or mocked Mule (same `_source: "real" | "mock"`
  pattern we used for the Salesforce data source).

### Step 6 — Add MCP wiring (~10 min)

The MCP server already supports `PAUSE_MCP_BASE_URL`. We just document
that pointing it at the prototype URL (`https://pause-health.ai`) still
works because the Next.js route now proxies to Mule. Optionally we add a
`PAUSE_MCP_DIRECT_MULE_URL` mode that bypasses the Next.js proxy and
talks straight to CloudHub.

### Step 7 — Verification + commit (~30 min)

1. `curl https://pause-health.ai/api/mulesoft/health` returns a response
   with `meta._source = "live-mulesoft"`.
2. With `MULESOFT_HEALTH_BASE_URL` unset locally, the route returns
   `meta._source = "mock-fallback"`. Graceful degradation works.
3. With `MULESOFT_HEALTH_BASE_URL` set but the CloudHub worker down, the
   route returns `meta._source = "mock-fallback"` and warns once. Same
   pattern as Salesforce.
4. Unit test for the live-vs-mock branching in the route handler.
5. Update `README.md` "Live integrations" section. Update
   `mulesoft-integration.md` Phase 0/1 status.
6. Commit + push.

## Iteration 2+ (out of scope for first deployment)

Once iteration 1 is live, the high-leverage additions in priority order:

1. **API Manager policy** on the deployed Mule app — rate limit, basic
   auth or client credentials. Surface a "policy applied" badge in the
   investor page. ~1 hour.
2. **Anypoint Exchange asset registration** — promote the deployed API to
   an Exchange asset so it shows up in the user's API catalog. Investor
   talking point: "discoverable inside the customer's Anypoint Exchange."
   ~30 min.
3. **Second Experience API live** — `/api/mulesoft/providers` is the next
   strongest candidate (small static dataset, no upstream deps). ~2 hours
   following the same pattern.
4. **DataWeave transform in the live flow** — replace the static
   set-payload with the real `omh-to-fhir.example.dwl` transform running
   against a small static OMH input. Demonstrates real DataWeave on the
   demo path. ~2 hours.
5. **Anypoint MQ orchestration** in the Agent Fabric trace — Care Router
   posts an `intake.completed` event to a queue, a Mule subscriber writes
   back to Salesforce Health Cloud. Real cross-platform event-driven
   demo. ~1 day.

## Calibration vs the Salesforce session

This runbook follows the same pattern that worked well in the Salesforce
Phase 1 session and that we failed to anticipate in the Salesforce
Phase 3 / Agentforce session:

- **What worked in Phase 1:** narrow scope, one data path, server-to-
  server OAuth, graceful degradation. ~5 hours, fully working.
- **What didn't work in Phase 3:** sprawling scope, third-party (SDO
  sample) integration we didn't control, undocumented platform
  restrictions (CORS, CSP `frame-ancestors`). ~8 hours, deferred.

The MuleSoft iteration above looks much more like Phase 1 than Phase 3:

| Property | Salesforce Phase 1 | MuleSoft Phase 1 (planned) | Salesforce Phase 3 |
|---|---|---|---|
| Auth model | OAuth client credentials | OAuth client credentials | Embedded widget + Experience site |
| Origin embedding | None (server-to-server) | None (server-to-server) | Required, blocked |
| Browser CORS/CSP | N/A | N/A | Hard blocker |
| Zscaler ceiling | Hit once on Data Cloud (`*.c360a.salesforce.com`), paused | Same edge as Salesforce — likely OK | N/A |
| Graceful degradation | Worked | Will work | N/A |
| Investor payoff | High | High | High but blocked |

Probability the next-session plan ships in one sitting: **high** (~85%).
The remaining 15% is whatever the user's specific Anypoint env requires
that we can't predict without seeing it (e.g. a corporate firewall on the
CloudHub worker, an obscure scope requirement on the Connected App, a
required VPC peering setup we don't expect a Sandbox env to need).

## Open questions (for the user, before the next session)

1. **Control plane region?** US (`anypoint.mulesoft.com`), EU (`eu1`),
   or Gov (`gov`)?
2. **Target environment?** Sandbox is the default recommendation;
   Production would also work but adds a step to delete the demo app
   afterward.
3. **Anypoint Code Builder or Anypoint Studio?** Code Builder is browser-
   based, no install; Studio is more powerful and more familiar to
   experienced Mule developers.
4. **Any Connected Apps already created** in this org? If yes, we can
   reuse one with the right scopes instead of creating a new one.
5. **Existing CloudHub apps in the target env?** Helps us avoid name
   collisions and decide whether to deploy under a Pause-namespaced name
   like `pause-mulesoft-health-v1`.

## What is explicitly NOT in this runbook

- ❌ No code changes were made in the investigation session.
- ❌ No env vars added to `.env.example` or `.env.local`. Those go in
  during Step 4 of the implementation session.
- ❌ No new dependencies installed.
- ❌ No Anypoint UI screenshots — we'll capture those during the
  implementation session.
- ❌ No live Mule app deployed. The user has the org; the deployment is
  the work itself, not a prerequisite.

When the user is ready to execute this runbook, the agent has everything
needed in the repo. The only external dependency is the Connected App
credentials from Step 1.

## Phase 3 — first shared Exchange asset shipped (2026-06-26)

**Status: SHIPPED.** `pause-omh-to-fhir-library` v1.0.0 is published to
Anypoint Exchange. The CloudHub worker `pause-mulesoft-health-v1` is
deployed at v1.0.5 consuming it as a Maven dependency. Phase 3 pill on
`/proposal/mulesoft` flipped `future` → `prototype`.

**Why this counts as Phase 3 and not Phase 1c:** the `/proposal/mulesoft`
investor page defines Phase 3 as "promote shared System APIs to versioned
Anypoint Exchange assets … Customer-specific Process and Experience APIs
remain in customer orgs." This ship is exactly that pattern, just with a
DataWeave library instead of an OAS-spec'd System API — the same multi-
customer wiring story, scoped down to one freestanding artifact that was
already inside the live worker. Phase 1c (real System APIs against JHE +
`pause_ingest`) still hasn't shipped; it's gated on a `pause-ingest-process-api`
Mule project materializing.

### What was promoted

The OMH (IEEE 1752.1) → FHIR R5 Observation transform. It existed in the
worker as `pause-mulesoft-health-v1/src/main/resources/transforms/omh-to-fhir-observation.dwl`
(reachable from inside the worker classpath only; never invoked because the
flow XML still inlines its bundle). Promoting it changes nothing for the
runtime response shape; it makes the function `omhToObservation(sample, patientRef, idx)`
callable as `dw::pause::health::omh` from any future Mule app that adds the
dependency.

### Coordinates

| | |
|---|---|
| groupId | `56707cc3-a0e3-4318-b110-78126aace370` (Pause Health business group) |
| assetId | `pause-omh-to-fhir-library` |
| version | `1.0.0` |
| packaging | `jar` (no classifier — see gotchas) |
| Exchange asset type | `unknown` (plain Maven jar; not a Mule SDK extension) |
| Status | `published` |

### Consumer pattern (now live in `pause-mulesoft-health-v1` 1.0.5)

```xml
<dependency>
    <groupId>56707cc3-a0e3-4318-b110-78126aace370</groupId>
    <artifactId>pause-omh-to-fhir-library</artifactId>
    <version>1.0.0</version>
</dependency>
```

```dataweave
%dw 2.0
import dw::pause::health::omh
output application/json
---
omh::omhToObservation(payload, "Patient/pause-demo-patient-001", 0)
```

The deployable mule-application jar verifies this end-to-end — it ships
the dependency at `repository/56707cc3-a0e3-4318-b110-78126aace370/pause-omh-to-fhir-library/1.0.0/pause-omh-to-fhir-library-1.0.0.jar`.

### Two non-obvious gotchas hit during the publish

1. **POM Content-Type.** `mvn-deploy-plugin` sends `.pom` uploads with
   `Content-Type: application/x-www-form-urlencoded` (its default for
   text-ish files); Anypoint Exchange v2 responds with
   `500 java.io.EOFException: input contained no data`. The `.jar` upload
   works fine because aether sends `application/java-archive` for jars.
   Workaround: direct curl PUT for the POM with `Content-Type: application/xml`.
   See `mulesoft/pause-omh-to-fhir-library/README.md` § "Build & publish"
   for the full recipe (jar upload through curl too, for symmetry).

2. **Don't use `classifier=mule-plugin` on a DataWeave-only library.**
   Tagging triggers Exchange's `ms-exchange-tooling-service`
   extension-model extraction step, which expects Mule SDK metadata in
   `META-INF`. With a no-SDK jar it 502s with
   `BadGatewayError: invalid json response body: Error proc... is not valid JSON`.
   Plain `jar` packaging is correct — the Mule runtime picks up the
   `dw/` namespace from any jar on the classpath without the classifier.
   Use `classifier=mule-plugin` only for real Mule Custom Connectors
   (built with the Mule SDK + Studio packager).

### Publish recipe (Phase 3 future versions)

Bump version in `mulesoft/pause-omh-to-fhir-library/pom.xml`. Then:

```bash
cd mulesoft/pause-omh-to-fhir-library
export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home
export PATH=$JAVA_HOME/bin:$PATH

# 1. Build
mvn -B clean package

# 2. Mint an Anypoint Platform access token from the Connected App creds
CRED=$(grep -A 3 anypoint-exchange-v2 ~/.m2/settings.xml | grep password | sed 's/.*>\(.*\)<.*/\1/')
CLIENT_ID=$(echo $CRED | cut -d'~' -f1)
CLIENT_SECRET=$(echo $CRED | cut -d'~' -f3)
TOKEN=$(curl -s -X POST "https://anypoint.mulesoft.com/accounts/api/v2/oauth2/token" \
  -d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET" \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

# 3. PUT POM + jar with the right Content-Types
BASE=https://maven.anypoint.mulesoft.com/api/v2/organizations/56707cc3-a0e3-4318-b110-78126aace370/maven/56707cc3-a0e3-4318-b110-78126aace370/pause-omh-to-fhir-library/<NEW_VERSION>
curl -s -X PUT "$BASE/pause-omh-to-fhir-library-<NEW_VERSION>.pom" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/xml" \
  --data-binary @pom.xml -w "POM HTTP %{http_code}\n"
curl -s -X PUT "$BASE/pause-omh-to-fhir-library-<NEW_VERSION>.jar" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/java-archive" \
  --data-binary @target/pause-omh-to-fhir-library-<NEW_VERSION>.jar -w "JAR HTTP %{http_code}\n"
```

Anypoint Exchange tombstones deleted versions — never re-publish a
version number that's been deleted. Bump to 1.0.1, 1.1.0, 2.0.0, etc.

### How consumer worker re-deploys

When the library bumps and the worker should consume the new version:

1. Edit `mulesoft/pause-mulesoft-health-v1/pom.xml` — bump worker version
   AND the library dependency version.
2. Re-run the two-command CloudHub 2.0 deploy already documented in
   `memory/project_mulesoft_state.md` (Exchange-v2 deploy-file, then
   `-DmuleDeploy deploy`). The library-jar upload works through mvn —
   only the standalone library POM hits the Content-Type gotcha.
3. Smoke-test `/api/mulesoft/health` + `/api/mulesoft/providers` in prod.

### Next assets to promote

The plan called out three System APIs as Phase 3 candidates:
`jhe-system-api`, `dbdp-system-api`, and per-wearable System APIs (Oura,
Apple Health). None of these exist as deployable Mule projects yet —
they're gated on Phase 1c (real System APIs wired to local JHE +
`pause_ingest`). So the next Phase 3 ship is whichever of those Phase 1c
artifacts materializes first; the OAS specs publish to Exchange the same
way this DataWeave library did.
