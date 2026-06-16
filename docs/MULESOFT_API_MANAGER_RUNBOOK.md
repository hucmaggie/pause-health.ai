# MuleSoft API Manager Policy Runbook

**Status as of 2026-06-07:** Governance plane configured; runtime enforcement
deferred to Flex Gateway (see "What's live vs. deferred" below).

**Audience:** Pause-Health.ai engineering, when attaching policies to the
deployed `pause-mulesoft-health-v1` app.

**Prerequisite:** Phase 1b is complete — the app is deployed and
`curl https://<worker-url>/health` returns a FHIR Bundle.
See [`docs/MULESOFT_PHASE_1_HANDOFF.md`](./MULESOFT_PHASE_1_HANDOFF.md).

**Estimated time:** 1–1.5 hours of Anypoint UI work.

---

## What's live (2026-06-09)

| Item | Status | Notes |
|---|---|---|
| Exchange asset `pause-provider-experience-api` v1.0.0 | **Live** | HTTP API type |
| Exchange asset `pause-provider-experience-api-spec` v1.0.2 | **Live** | OAS 3.0 REST API type, interactive docs |
| API Manager instance ID `20954842` | **Live** | `pause-provider-experience-api-sandbox`, Mule Gateway runtime |
| API Manager instance ID `20955827` | **Live** | `pause-flex-gateway`, Omni Gateway (Flex) runtime — active instance |
| Flex Gateway | **Live** | Docker + ngrok, static domain `cattail-reactive-sassy.ngrok-free.dev` |
| JWT Validation policy | **Live** | Auth0 RS256 / JWKS, audience-validated, expiry mandatory |
| Rate Limiting policy (plain) | **Live** | 10 req/min global, x-ratelimit headers exposed |
| Auth0 M2M app `pause-prototype-client` | **Live** | Client credentials grant, audience = gateway URL |
| `AUTH0_MULESOFT_*` env vars | **Live** | Set in Vercel production; Next.js proxy fetches JWT automatically |
| Runtime policy enforcement | **Live** | 401 on missing/invalid JWT; 429 on rate limit exceeded |

**Architecture note:** CloudHub 2.0 Shared Space doesn't expose the Mule agent
autodiscovery channel, so policy enforcement runs on the Flex Gateway proxy
(instance 20955827) rather than on the CloudHub worker directly. The worker is
reachable directly but bypasses all gateway policies — only go direct for
debugging. All production traffic routes through the ngrok tunnel.

---

## What this runbook covers

Iteration 2 adds two policies to the live Mule app via Anypoint API Manager:

| Policy | What it does | Investor talking-point |
|---|---|---|
| **Client ID Enforcement** | Callers must present a registered `client_id` + `client_secret`. Unregistered calls get 401. | "API governance — same policy surface the customer's IT team already manages" |
| **Rate Limiting — SLA** | Per-client-app rate limit tied to an SLA tier. Demo tier: 10 req / min. Production tier: unlimited (or whatever you negotiate). | "Metered access, SLA-backed" |

Exchange asset registration (making the API discoverable in the customer's
catalog) is covered separately in Step 6 — it takes 15 minutes and is worth
doing immediately after the policy steps because it's the same Anypoint
Manager session.

---

## Step 0 — Understand the surface you're working on

```
Browser tab A: Anypoint API Manager
  https://anypoint.mulesoft.com/apimanager

Browser tab B: Anypoint Runtime Manager (to watch the app)
  https://anypoint.mulesoft.com/runtime-manager

Browser tab C: Anypoint Exchange (for asset registration)
  https://anypoint.mulesoft.com/exchange
```

API Manager is the policy plane; Runtime Manager is the deploy plane.
You will flip between the two frequently in this runbook.

---

## Step 1 — Create the API definition in API Manager

> **Why:** CloudHub 2.0 apps are not auto-discoverable by API Manager.
> You register the app here, which gives you an **API Instance ID** that
> the Mule runtime reads at startup to pull down its policy list.

1. Open API Manager → **+ Add API**.
2. Choose **Add new API** (not "Import from Exchange" — we register to
   Exchange in Step 6).
3. Fill the fields:

   | Field | Value |
   |---|---|
   | Runtime type | Mule Gateway |
   | Proxy type | Deployed API (the app itself is the proxy — we don't need a separate Mule gateway proxy layer) |
   | Target type | CloudHub 2.0 |
   | API name | `pause-provider-experience-api` |
   | API version | `1.0` |
   | Implementation URL | `http://0.0.0.0:8081` (port the Mule app binds to internally) |

4. Click **Save & Deploy**.
5. On the next screen Anypoint shows you the **API Instance ID** (a
   numeric string, e.g., `18350743`). **Copy it.** You need it in Step 2.

---

## Step 2 — Inject the API Instance ID into the deployed app

The Mule agent only enforces policies when it knows which API instance it
belongs to. You inject this via an application property, not by rebuilding
the jar.

### Option A — Runtime Manager UI (no redeploy)

1. Runtime Manager → Applications → `pause-mulesoft-health-v1` → **Settings**.
2. Scroll to **Properties**.
3. Add: `anypoint.platform.client_id` = your org's client ID (from
   Access Management → Organization → Client ID).
4. Add: `anypoint.platform.client_secret` = corresponding secret.
5. Add: `api.id` = the API Instance ID from Step 1.
6. Click **Apply Changes**. The app restarts (~30s); no new artifact
   is uploaded.

### Option B — Repo property file (survives redeployment)

Add to `mulesoft/pause-mulesoft-health-v1/src/main/resources/mule-app.properties`:

```properties
anypoint.platform.client_id=${ANYPOINT_CLIENT_ID}
anypoint.platform.client_secret=${ANYPOINT_CLIENT_SECRET}
api.id=${API_INSTANCE_ID}
```

Then set `ANYPOINT_CLIENT_ID`, `ANYPOINT_CLIENT_SECRET`, and
`API_INSTANCE_ID` as CloudHub 2.0 deployment properties (Runtime Manager →
app → Settings → Properties) so the values are injected at deploy time, not
baked into the repo.

> **Option B is the production stance.** Option A is faster for a demo.

---

## Step 3 — Verify the Mule agent connected

After properties are in and the app has restarted:

```bash
curl -i https://<worker-url>/health
```

Check the response headers. When the agent connected successfully you'll
see:

```
X-Correlation-ID: <uuid>    ← API Manager is tagging requests
```

In API Manager → **Analytics** (left sidebar), you should see one hit
appear within 30–60 seconds.

If analytics shows nothing after 2–3 test curls:
- Re-check the `api.id` value — it must match the API Instance ID from
  Step 1 exactly.
- Check Runtime Manager → app → **Logs** for lines beginning with
  `[com.mulesoft.agent]` — they surface agent registration errors.

---

## Step 4 — Apply the Client ID Enforcement policy

> This is the policy that makes the API governor-controlled. Without it,
> anyone with the worker URL can call the API.

1. API Manager → your API instance → **Policies** → **+ Apply New Policy**.
2. Select **Client ID Enforcement** (MuleSoft-provided, always available,
   no Exchange install required).
3. Configure:

   | Setting | Value |
   |---|---|
   | Credentials origin | HTTP Basic Auth header |
   | Client ID expression | `#[attributes.headers.'client_id']` |
   | Client Secret expression | `#[attributes.headers.'client_secret']` |

   > **Alternative credential origin:** query params (`?client_id=&client_secret=`).
   > For the demo, header-based is cleaner. For the MCP tool caller, either
   > works — the tool already passes headers via `fetchImpl`.

4. Click **Apply**. Policy propagates to the worker in ~15–30 seconds.
5. Test the rejection:

   ```bash
   curl -i https://<worker-url>/health
   # Expected: 401 Unauthorized  (no credentials)

   curl -i -H "client_id: bogus" -H "client_secret: bogus" \
     https://<worker-url>/health
   # Expected: 401 Unauthorized  (credentials not registered)
   ```

---

## Step 5 — Create client apps + apply Rate Limiting SLA

### 5a — Create a client application

Client apps are how you issue valid credentials to callers.

1. Go to **Anypoint Exchange** → **Request Access** on the asset you'll
   register in Step 6 — OR create the client app from the API Manager
   side: API Manager → your API → **Client Applications** → **+ Create
   Application**.

2. Fill:

   | Field | Value |
   |---|---|
   | Name | `pause-prototype-client` |
   | Description | `Demo client for the Pause-Health.ai prototype` |
   | OAuth grant type | Client Credentials |

3. Click **Save**. Copy the generated **Client ID** and **Client Secret**.
   These are the credentials you'll put in `.env.local` in Step 5c.

### 5b — Apply Rate Limiting SLA policy

1. API Manager → your API → **Policies** → **+ Apply New Policy**.
2. Select **Rate Limiting — SLA based**.
3. Define SLA tiers:

   | Tier name | Limit | Period | Auto-approved |
   |---|---|---|---|
   | Demo | 10 | 1 minute | ✓ |
   | Production | 1000 | 1 minute | — (manual approval) |

4. Configure header credentials (same as Client ID Enforcement):

   | Setting | Value |
   |---|---|
   | Client ID expression | `#[attributes.headers.'client_id']` |
   | Client Secret expression | `#[attributes.headers.'client_secret']` |

5. Click **Apply**.

### 5c — Request access for the demo client app

1. Go back to Exchange → your asset → **Request access**.
2. Select `pause-prototype-client` and the **Demo** SLA tier.
3. Because the Demo tier is auto-approved, access is granted immediately.

### 5d — Smoke-test the full stack

```bash
CLIENT_ID="<from Step 5a>"
CLIENT_SECRET="<from Step 5a>"

# Should 200 and return FHIR Bundle:
curl -i \
  -H "client_id: $CLIENT_ID" \
  -H "client_secret: $CLIENT_SECRET" \
  https://<worker-url>/health

# Should 200 and return provider list:
curl -i \
  -H "client_id: $CLIENT_ID" \
  -H "client_secret: $CLIENT_SECRET" \
  "https://<worker-url>/providers?zip=92614&menopause=true&limit=5"

# Hit the rate limit (11th request in <60s should return 429):
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "client_id: $CLIENT_ID" \
    -H "client_secret: $CLIENT_SECRET" \
    https://<worker-url>/health
done
# Expected: 10× 200, then 429 Too Many Requests
```

---

## Step 6 — Register the API in Anypoint Exchange

Exchange is the customer-facing API catalog. Registration here turns
"a URL on a CloudHub worker" into "a discoverable, versioned, governed
API asset in your Anypoint org."

1. API Manager → your API → **Publish to Exchange** (top-right button).
2. Fill:

   | Field | Value |
   |---|---|
   | Asset name | `Pause Provider Experience API` |
   | Asset version | `1.0.0` |
   | API version | `1.0` |
   | Main file | *(leave blank — no RAML/OAS yet)* |

3. Click **Publish**. The asset appears in Exchange immediately.
4. Optional but recommended: paste the provider directory endpoint
   documentation into the Exchange asset's **Description** tab so
   prospects browsing the catalog understand what the API does without
   needing to call it.

---

## Step 7 — Wire credentials into the Next.js proxy

The Next.js `/api/mulesoft/providers` and `/api/mulesoft/health` routes
proxy to the worker. Once Client ID Enforcement is on, every request from
the Next.js proxy needs to carry the credentials.

Update `frontend/lib/mulesoft/providers.ts` and `health.ts` to inject the
headers (add to the `fetchFn` call's `headers` object):

```typescript
// In fetchLiveProviders / fetchLiveHealthBundle:
headers: {
  Accept: "application/json",
  "client_id": process.env.MULESOFT_CLIENT_ID ?? "",
  "client_secret": process.env.MULESOFT_CLIENT_SECRET ?? ""
},
```

Then add the env vars to Vercel:

```bash
# Local:
echo "MULESOFT_CLIENT_ID=<from Step 5a>" >> frontend/.env.local
echo "MULESOFT_CLIENT_SECRET=<from Step 5a>" >> frontend/.env.local

# Vercel production (use the Vercel dashboard or CLI — never commit secrets):
vercel env add MULESOFT_CLIENT_ID
vercel env add MULESOFT_CLIENT_SECRET
```

Confirm end-to-end after the header injection:

```bash
curl https://pause-health.ai/api/mulesoft/health | jq '.meta._source'
# Expected: "live-mulesoft"

curl "https://pause-health.ai/api/mulesoft/providers?zip=92614&menopause=true" \
  | jq '.meta._source'
# Expected: "live-mulesoft"
```

---

## Verification checklist

All of these must be true before calling iteration 2 complete:

- [ ] `curl <worker>/health` without credentials returns **401**.
- [ ] `curl <worker>/health` with valid credentials returns **200** + FHIR Bundle.
- [ ] `curl <worker>/providers?zip=92614&menopause=true` with valid credentials
      returns **200** + providers array.
- [ ] 11th request within 60s returns **429**.
- [ ] Vercel production `/api/mulesoft/health` reports `_source: "live-mulesoft"`.
- [ ] Vercel production `/api/mulesoft/providers` reports `_source: "live-mulesoft"`.
- [ ] Exchange asset is visible at `https://anypoint.mulesoft.com/exchange`.
- [ ] Degradation still works: stopping the worker makes the Next.js routes
      fall back to `mock-fallback`, not 5xx.

---

## Iteration history

| Iteration | Date | What shipped |
|---|---|---|
| 1 | 2026-05-xx | CloudHub 2.0 worker live (`pause-mulesoft-health-v1` v1.0.2), `/health` + `/providers` endpoints |
| 2 | 2026-06-07 | API Manager governance plane: Exchange asset, Client ID Enforcement + Rate Limiting SLA policies, SLA tiers, `pause-prototype-client` app |
| 3 | 2026-06-08 | Flex Gateway (Docker + ngrok), runtime enforcement active, Client ID Enforcement enforcing 401 |
| 4 | 2026-06-09 | Rate Limiting SLA (10 req/min Demo tier), x-ratelimit headers, Next.js proxy sends dual auth headers |
| 5 | 2026-06-09 | OAS 3.0 spec (`pause-provider-experience-api.oas3.yaml`), published to Exchange as `pause-provider-experience-api-spec` v1.0.1 |
| 6 | 2026-06-09 | Stable ngrok domain (`cattail-reactive-sassy.ngrok-free.dev`) pinned in docker-compose |
| 7 | 2026-06-09 | JWT Validation (Auth0 RS256/JWKS) replaces Client ID Enforcement; plain Rate Limiting replaces SLA-based; Next.js proxy fetches Auth0 M2M token via `lib/mulesoft/auth.ts`; OAS spec updated to v1.0.2 |
| 8 | 2026-06-15 | Phase-2 contract DataWeave (commit `cf4a42d`): 9-row curated slice with `lat`/`lng`, `serviceSignals`, `licenseStatus`, `insuranceAccepted`, `matchType` tier ladder, `?insurance=` filter. Source updated; **deploy is the maintainer's manual step** (not yet on CloudHub). |

---

## Phase-2 deploy verification checklist (iteration 8)

Source landed in `cf4a42d` but is **not yet deployed**. Production
`https://pause-health.ai/api/mulesoft/providers` currently reports
`_source: "mock-fallback"` because (a) the new DataWeave hasn't been
pushed and (b) the ngrok tunnel host (`cattail-reactive-sassy.ngrok-
free.dev`) is dormant — TLS handshake gets `Connection reset by peer`,
which is the documented free-tier-tunnel-not-running gotcha. The route
handler degrades cleanly to the mock so production keeps serving the
full Phase-2 contract via the in-process directory; no patient-visible
regression. After redeploy:

1. **Restart the local ngrok tunnel** (off VPN):
   ```bash
   ngrok http 8081
   ```
   Confirm the URL is still `cattail-reactive-sassy.ngrok-free.dev`
   (free tier pins the subdomain).

2. **Deploy the new DataWeave to CloudHub 2.0** via Anypoint Code
   Builder or Maven (Zulu 17 `JAVA_HOME`). The artifact is
   `mulesoft/pause-mulesoft-health-v1/`.

3. **Probe the live worker directly** with a fresh Auth0 M2M JWT:
   ```bash
   TOKEN=$(curl -sX POST -H "Content-Type: application/json" \
     -d '{
       "client_id":"<AUTH0_MULESOFT_CLIENT_ID>",
       "client_secret":"<AUTH0_MULESOFT_CLIENT_SECRET>",
       "audience":"<AUTH0_MULESOFT_AUDIENCE>",
       "grant_type":"client_credentials"
     }' \
     "https://<AUTH0_MULESOFT_DOMAIN>/oauth/token" | jq -r '.access_token')

   curl -sH "Authorization: Bearer $TOKEN" \
     "https://cattail-reactive-sassy.ngrok-free.dev/providers?zip=92614&menopause=true&limit=2" \
     | jq '.providers[0] | keys'
   ```
   Expect the keys to include `serviceSignals`, `licenseStatus`,
   `insuranceAccepted`, `latitude`, `longitude`, `distanceMiles`. Top
   level should include `matchType`, `sort`, `provenance.dataset`.

4. **Verify the production route flips to live**:
   ```bash
   curl -s "https://pause-health.ai/api/mulesoft/providers?zip=92614&menopause=true" \
     | jq '.meta._source'
   # Expected: "live-mulesoft"  (was "mock-fallback" pre-deploy)
   ```

5. **Verify the contract-shape test stays green** with live data flowing:
   ```bash
   cd frontend && ./node_modules/.bin/vitest run lib/mulesoft/providers.test.ts
   ```
   The hand-authored snapshot in
   `frontend/lib/mulesoft/providers.test.ts` mirrors what the live
   worker emits today; if the deploy adds or renames a field, that test
   tells you to update both the snapshot and the DataWeave row schema.

## Remaining backlog

1. **Stable VM** — replace Docker + ngrok with a persistent VM (Digital Ocean, EC2) so the gateway survives machine restarts without updating Vercel env vars.
2. **Anypoint MQ fanout** — the `pause-ingest-process-api` posts events to an Anypoint MQ queue; downstream System APIs subscribe. Turns the sequential DataWeave pipeline into an event-driven one.
3. **DataWeave OMH→FHIR transform on the live `/health` path** — replaces the static hand-coded bundle with a real DataWeave transform applied to synthetic Oura input.
4. **Multi-tenant JWT** — swap the Auth0 dev tenant for a customer IdP (Azure AD, Okta) to demonstrate enterprise SSO.
