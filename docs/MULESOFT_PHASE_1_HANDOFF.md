# MuleSoft Anypoint Phase 1 — Handoff Runbook

**Audience:** the user, when they next sit down at the Anypoint console.
**Estimated total time:** 2–4 hours of active Anypoint UI time.
**Prerequisite reading:** [`docs/MULESOFT_RUNBOOK.md`](./MULESOFT_RUNBOOK.md)
(the investigation results) and
[`mulesoft/pause-mulesoft-health-v1/README.md`](../mulesoft/pause-mulesoft-health-v1/README.md)
(the deployable artifact).

## What was done while you weren't at the Anypoint UI

The repo-side half of Phase 1 was completed in a separate session
(see `/changelog` for the dated entry). What changed:

| Surface | Before | After |
|---|---|---|
| `/api/mulesoft/health` route | Always served mock | Live-vs-mock branched on `MULESOFT_HEALTH_BASE_URL`, with graceful degradation |
| Live client module | None | `frontend/lib/mulesoft/health.ts` mirrors the `lib/salesforce/grounding.ts` warn-once / prefer-real pattern |
| Tests | None for live path | 31 new tests: 22 in `lib/mulesoft/health.test.ts` + 9 in `app/api/mulesoft/health/route.test.ts` |
| Deployable Mule artifact | Reference XML only (`mulesoft/flows/pause-process-api.example.xml`, not deployable) | New project `mulesoft/pause-mulesoft-health-v1/` (pom, mule-artifact, one flow XML, README) |
| `frontend/.env.example` | Salesforce + newsletter only | `MULESOFT_HEALTH_BASE_URL` + `ANYPOINT_*` documented inline |
| `/proposal/mulesoft` "Touch the architecture" | Static "mocked" framing | Live-vs-mock badge that flips on `MULESOFT_HEALTH_BASE_URL` |

**Important:** today the prototype behavior is unchanged. The env var
is unset, so every response still reports `_source: "mock"`. The
swap happens the instant you set `MULESOFT_HEALTH_BASE_URL` in
Vercel and redeploy.

## Defaults I picked for the deployable artifact

The Phase 0 runbook listed five open questions and recommended you
answer them before the implementation session. To keep moving I
picked defaults — all overridable when you actually deploy. If any
default is wrong, override it as noted:

| Open question | Default in repo | Override |
|---|---|---|
| Anypoint control plane region | US (`anypoint.mulesoft.com`) | `ANYPOINT_CONTROL_PLANE` in env (unused today, reserved for iteration 2) |
| Target environment | Sandbox | CLI flag at `mvn deploy` time: `-Dcloudhub2.environment=Sandbox` |
| Code Builder vs Studio | Code Builder | Either works; the project layout is canonical Mule 4 |
| Connected App | Create new, suggested name `pause-prototype-cloudhub` | Use any existing app with the required scopes |
| App name | `pause-mulesoft-health-v1` | Rename in `mulesoft/pause-mulesoft-health-v1/pom.xml` (one place) |
| CloudHub 2.0 region | `Cloudhub-US-East-2` | Pick from the Code Builder deploy dropdown |
| vCores | 0.1 | Smallest Sandbox slice; bump later if you need it |

## Step-by-step Anypoint UI walkthrough

### Step 0 — 5 minutes — Confirm your env

Open https://anypoint.mulesoft.com (or `eu1` / `gov`) and confirm:

1. You can log in.
2. You see at least one Business Group + one Environment (Sandbox).
3. Access Management → Connected Apps is reachable (you have the
   admin role you need to create one).

If any of those don't work, stop and resolve before continuing. The
remaining steps depend on all three.

### Step 1 — 10 minutes — Create the Connected App

Access Management → Connected Apps → **+ Create app**.

- **App name:** `pause-prototype-cloudhub`
- **App acts on its own behalf** (this is the OAuth Client
  Credentials flow — the one our `lib/salesforce/auth.ts` already
  established the pattern for).
- **Scopes to grant** (minimum for Phase 1):
  - `View Organization` (Anypoint Platform)
  - `Read Servers` (Runtime Manager)
  - `Manage Applications` (CloudHub 2.0)
  - `Read Applications` (CloudHub 2.0)
  - `Deploy Applications` (CloudHub 2.0)

Click Save, then copy the Client ID + Client Secret to a temp
location. You will NOT be able to see the secret again.

### Step 2 — 10 minutes — Import the project into Code Builder

Open https://anypoint.mulesoft.com → Design Center → Code Builder.

There are two ways to load `mulesoft/pause-mulesoft-health-v1/`:

**Option A — From local folder (recommended for the first deploy):**

1. Code Builder → File → Open Folder
2. Browse to `<repo>/mulesoft/pause-mulesoft-health-v1`
3. Trust the workspace when prompted.

**Option B — From GitHub:**

1. Code Builder → File → Open Repository
2. URL: `https://github.com/hucmaggie/pause-health.ai`
3. After clone: open `mulesoft/pause-mulesoft-health-v1` as the
   project root.

When the project loads, Code Builder reads `mule-artifact.json` and
should automatically recognize this as a Mule 4.6 app. The
`src/main/mule/health-flow.xml` file should render in the visual
flow designer if you click on it.

### Step 3 — 5 minutes — Run locally to verify

Before deploying to CloudHub, verify the app runs locally inside
Code Builder.

1. Right-click the project → **Run Mule project**.
2. Wait for `DEPLOYED Successfully` in the Mule console (~30s).
3. Open a Code Builder terminal: `curl http://localhost:8081/health`.
4. You should see a FHIR R5 Bundle JSON with `resourceType: "Bundle"`
   and 4 entries (1 Patient + 3 Observations).

If that doesn't work, fix it here before touching CloudHub. Common
issues: port 8081 already in use (edit `health-flow.xml` to set a
different port), or a Mule runtime version mismatch (the
`mule-artifact.json` declares `4.6.0`; Code Builder must support it).

### Step 4 — 20 minutes — Deploy to CloudHub 2.0 from Code Builder

1. Right-click the project → **Deploy** → **CloudHub 2.0**.
2. **Environment:** Sandbox (or whichever target you confirmed in
   Step 0).
3. **Region:** Cloudhub-US-East-2 (default; pick another if your
   org is in a different region — note that worker URL paths change
   accordingly).
4. **App name:** `pause-mulesoft-health-v1` (matches the pom).
5. **Replicas:** 1.
6. **vCores:** 0.1.
7. **Authentication:** Anypoint Platform credentials (the ones you
   logged in with) — or paste the Connected App credentials from
   Step 1 if Code Builder prompts.
8. Click Deploy.

Watch the deploy. You'll see four stages:
- Uploading application → Deploying → Starting → Started.

The worker URL pattern will be:

```
https://pause-mulesoft-health-v1.us-e2.cloudhub.io
```

(replace `us-e2` with your region's suffix).

### Step 5 — 5 minutes — curl the live worker

```bash
curl -i https://pause-mulesoft-health-v1.us-e2.cloudhub.io/health
```

Expected:
- HTTP/2 200
- `X-Pause-App: pause-mulesoft-health-v1` response header
- `X-Pause-Source: mulesoft-cloudhub2` response header
- JSON body with `resourceType: "Bundle"` and 4 entries.

If you don't see the Bundle, check Runtime Manager → Applications →
pause-mulesoft-health-v1 → Logs. The most common Phase 1 failures
are network-level (Zscaler blocking `*.cloudhub.io`, see
`docs/MULESOFT_RUNBOOK.md` "Network and Zscaler posture") or a Mule
4 runtime version that Code Builder downgraded silently.

### Step 6 — 5 minutes — Flip the env var

**Local:**

```bash
# frontend/.env.local
MULESOFT_HEALTH_BASE_URL=https://pause-mulesoft-health-v1.us-e2.cloudhub.io
```

```bash
cd frontend && npm run dev
# Then:
curl http://localhost:3000/api/mulesoft/health | jq '.meta._source'
# Expected: "live-mulesoft"
```

**Production (Vercel):**

1. Vercel dashboard → pause-health project → Settings → Environment
   Variables.
2. Add `MULESOFT_HEALTH_BASE_URL` with the worker URL.
3. Apply to Production + Preview.
4. Redeploy main, OR wait for the next push.

After deploy:

```bash
curl https://pause-health.ai/api/mulesoft/health | jq '.meta._source'
# Expected: "live-mulesoft"
```

Open https://pause-health.ai/proposal/mulesoft and confirm the
"Touch the architecture" badge now reads **LIVE on Anypoint Platform**
(green) instead of **MOCK · served by Next.js** (grey).

### Step 7 — 10 minutes — Test the degradation path

This is the test the runbook explicitly calls out as Phase 1's
correctness check:

1. In Anypoint Runtime Manager, **stop** the
   `pause-mulesoft-health-v1` app.
2. `curl https://pause-health.ai/api/mulesoft/health | jq '.meta._source'`
3. Expected: `"mock-fallback"` (not `"mock"` — the difference is
   that `_liveAttempted: true` distinguishes "tried and failed" from
   "never configured").
4. Re-start the app.
5. After ~30 seconds: `_source` returns to `"live-mulesoft"`.

This proves the graceful-degradation path the unit tests pin.

## Verification checklist

When all of these are true, Phase 1 is done:

- [ ] CloudHub 2.0 worker is deployed and reachable.
- [ ] `curl <worker-url>/health` returns a FHIR Bundle with 4 entries.
- [ ] `MULESOFT_HEALTH_BASE_URL` is set in Vercel production env.
- [ ] `curl https://pause-health.ai/api/mulesoft/health` reports
      `meta._source: "live-mulesoft"` and `meta._liveUrl` matches
      the worker URL.
- [ ] `/proposal/mulesoft` shows the green LIVE badge.
- [ ] Stopping the Mule app surfaces `meta._source: "mock-fallback"`,
      not a 5xx — the prototype never goes hard-down.
- [ ] `/changelog` entry updated with the deploy date and worker URL.

## What to do AFTER Phase 1 ships

Update the following so the public site reflects the new state:

1. **`/changelog`** — bump the existing MuleSoft Phase 1 entry from
   `prototype` → `partial` (or `shipped` if you want — but the rest
   of the four Experience APIs are still mocked, so `partial` is the
   more honest pill).
2. **`/roadmap`** — move the MuleSoft Anypoint Phase 1 item from
   `partial` to `shipped` (this is the right `shipped` — Phase 1 is
   one Experience API live, which is exactly what we promised).
3. **`docs/mulesoft-integration.md`** — update the Phase 0 / Phase 1
   status table to reflect what's live.
4. **`README.md`** — add the worker URL to the "Live integrations"
   section.

I'll happily drive all four of those changes when you tell me the
worker URL is live. They each take ~2 minutes.

## What's iteration 2 (out of scope for Phase 1)

Per the original runbook:

1. **API Manager policy** on the deployed Mule app (rate limit,
   client credentials) — ~1 hour, big investor talking-point.
2. **Anypoint Exchange asset registration** — ~30 min, "discoverable
   in the customer's API catalog" story.
3. **Second Experience API live** (`/api/mulesoft/providers` is the
   easiest next pick) — ~2 hours following the same pattern.
4. **DataWeave OMH→FHIR transform on the live path** — ~2 hours,
   demonstrates a real DataWeave transform on the demo path.
5. **Anypoint MQ orchestration** in the Agent Fabric trace — ~1 day,
   real cross-platform event-driven demo.

When you're ready for iteration 2, the work is "more of the same"
— the lib + route + test pattern carries over directly. The bigger
investment is API Manager policy authoring, which is mostly
Anypoint UI work, not repo work.

## Failure modes I'm watching for

The repo side is well-tested (31 unit tests pin the live/mock matrix),
but the deploy side has three real risks worth naming explicitly:

1. **CloudHub 2.0 + the `mule-maven-plugin` configuration changed
   semantics between 3.x and 4.x.** The `pom.xml` ships 4.3.0 which
   is current as of 2026-06-08, but if MuleSoft has shipped 5.x by
   the time you sit down, the `<cloudhub2Deployment>` element schema
   may need updating. Look at
   https://docs.mulesoft.com/mule-runtime/latest/deploy-mule-application-cloudhub-2
   for the current canonical example.

2. **The `mule-artifact.json` schema occasionally adds required
   fields.** If Code Builder rejects the project on import with a
   schema error, the fix is usually to let Code Builder regenerate
   the file (right-click project → Rebuild project skeleton) and
   then merge any new keys it added.

3. **Zscaler.** The investigation found Anypoint shares the
   Salesforce edge (`*.salesforce.com`), which is currently
   permitted — but CloudHub workers live on `*.cloudhub.io` which is
   a separate path. If `curl` from your dev machine to the worker
   URL hangs or returns 403 from a Zscaler-branded page, that's the
   most likely cause. Pause Zscaler or get the host added to your
   org's allowlist.

If you hit any of the three, capture the exact error (screenshot or
copy-paste the message) and we'll diagnose together — the second
half of the session is a much better fit for pairing than the first
half was.
