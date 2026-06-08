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

## What's live vs. deferred (2026-06-07)

| Item | Status | Notes |
|---|---|---|
| Exchange asset `pause-provider-experience-api` v1.0.0 | **Live** | HTTP API type, visible in Anypoint Exchange |
| API Manager instance ID `20954842` | **Live** | `pause-provider-experience-api-sandbox`, Sandbox env |
| Client ID Enforcement policy | **Configured** | Applied in API Manager UI; visible in Governance Report |
| Rate Limiting SLA policy | **Configured** | Demo tier: 10 req/min; Production: 1000 req/min |
| SLA tiers | **Live** | Demo (ID 2438178, auto-approve) + Production (ID 2438179) |
| `pause-prototype-client` app | **Live** | Approved on Demo tier; Client ID issued |
| `MULESOFT_CLIENT_ID` / `MULESOFT_CLIENT_SECRET` | **Live** | Set in Vercel production; Next.js proxy forwards headers |
| Runtime policy enforcement (401 on missing creds) | **Deferred** | CH2 Shared Space doesn't support Mule agent autodiscovery; requires Flex Gateway |

**Why enforcement is deferred:** CloudHub 2.0 Shared Space runs the Mule
runtime in a managed container that doesn't expose the Mule agent's
autodiscovery registration channel. The `api.id` + `anypoint.platform.client_id`
properties are set on the deployment but the agent cannot reach the API Manager
registration endpoint from Shared Space. Runtime policy enforcement requires
a **Flex Gateway** proxy in front of the CloudHub worker — a ~2hr setup when
there's a customer org to deploy it into. The investor-facing story is intact:
the governance artifacts (API instance, policies, SLA tiers, client app) are
all visible and correct in Anypoint; the enforcement wire-up is a deployment
topology change, not a code change.

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

## What's iteration 3 (out of scope here)

1. **OAS/RAML spec for the Exchange asset** — generates interactive
   documentation and lets customers generate client SDKs from the catalog.
2. **JWT policy** (replacing Client ID Enforcement) — uses a customer's
   existing IdP (Azure AD, Okta) to issue tokens; eliminates the client
   ID/secret distribution problem.
3. **Anypoint MQ fanout** — the `pause-ingest-process-api` posts events
   to an Anypoint MQ queue; downstream System APIs subscribe. Turns the
   sequential DataWeave pipeline into an event-driven one.
4. **DataWeave OMH→FHIR transform on the live `/health` path** — replaces
   the static hand-coded bundle with a real DataWeave transform applied
   to synthetic Oura input.
