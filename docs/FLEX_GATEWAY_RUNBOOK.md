# Flex Gateway Runbook (Iteration 3)

**Status:** ✅ DONE — Flex Gateway is live in front of the CloudHub 2.0 worker,
now enforcing a **JWT Validation** policy (Auth0 RS256/JWKS) + Rate Limiting.
Note: the JWT Validation policy *replaced* the Client ID Enforcement policy this
runbook's prerequisite refers to (see the change log in
[MULESOFT_API_MANAGER_RUNBOOK.md](./MULESOFT_API_MANAGER_RUNBOOK.md), entry
2026-06-09) — that runbook is the current source of truth for the live policy
posture. The steps below are preserved as the gateway stand-up record.
**Estimated time:** 2–2.5 hours  
**Prerequisite:** Iteration 2 complete — CloudHub 1.0.2 live, API Manager instance `20954842` configured with Client ID Enforcement + Rate Limiting SLA policies, `pause-prototype-client` approved on Demo tier.

See [MULESOFT_API_MANAGER_RUNBOOK.md](./MULESOFT_API_MANAGER_RUNBOOK.md) for the full iteration 2 state.

---

## Why Flex Gateway

CloudHub 2.0 Shared Space runs the Mule runtime in a managed container that blocks the Mule agent's autodiscovery channel.  The `api.id` / `anypoint.platform.client_id` properties are set on the deployment but the agent cannot reach API Manager to pull down policies.

Flex Gateway is a separate, lightweight proxy that *can* register with API Manager.  Traffic flows:

```
Browser / Next.js proxy
        │
        ▼
  Flex Gateway  ← API Manager pushes policy config here
        │         (Client ID Enforcement, Rate Limiting SLA)
        ▼
CloudHub 2.0 worker  (pause-mulesoft-health-v1)
```

Once the gateway is wired up, the existing API Manager instance (`20954842`), its policies, SLA tiers, and the `pause-prototype-client` credentials all work without changes.

---

## Architecture for this runbook

- **Flex Gateway** runs in Docker on your local machine.
- **ngrok** exposes it with a public HTTPS URL so Anypoint API Manager can push config and so the Next.js proxy can reach it.
- The CloudHub worker URL stays the same — Flex Gateway proxies to it.

> **Demo vs. production:** ngrok + Docker is fine for investor demos.  When you move to production replace the ngrok tunnel with a stable VM (Digital Ocean, EC2, GCP) running the same Docker compose, or deploy Flex Gateway into a Kubernetes cluster.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Docker Desktop | ≥ 4.x | https://www.docker.com/products/docker-desktop |
| ngrok | ≥ 3.x | `brew install ngrok` |
| flexctl | latest | see Step 1 |

ngrok auth token — sign up free at https://ngrok.com, then:

```bash
ngrok config add-authtoken <your-token>
```

---

## Step 1 — Pull the image and register the gateway

No separate CLI install needed — the `flexctl` binary runs inside the container.

### 1a — Pull the image

```bash
docker pull mulesoft/flex-gateway
```

### 1b — Run the registration command

Anypoint pre-fills this command on the "Add a Flex Gateway → Container" page with your org ID and a one-time token.  Copy it from there and substitute `pause-flex-gateway` for `<gateway-name>`:

```bash
cd mulesoft/flex-gateway

docker run --entrypoint flexctl -u $UID \
  -v "$(pwd)":/registration mulesoft/flex-gateway \
  registration create \
  --organization=<YOUR_ORG_ID> \
  --token=<YOUR_ONE_TIME_TOKEN> \
  --output-directory=/registration \
  --connected=true \
  pause-flex-gateway
```

This drops `registration.yaml` into `mulesoft/flex-gateway/`.  **Do not commit it** — it contains org credentials and is in `.gitignore`.

> **Note:** The `--token` value is a one-time token shown on that Anypoint page.  If it expires (usually 24h) you can generate a new one by starting "Add a Flex Gateway" again.

Verify registration appeared in Anypoint:
- Runtime Manager → **Omni Gateways** → **Self-Managed Omni Gateway** tab → `pause-flex-gateway` should appear with status **Connected** (may take ~30s after `docker compose up` in Step 2).

---

## Step 2 — Start the gateway and ngrok

```bash
cd mulesoft/flex-gateway
cp .env.example .env
# Edit .env: paste your NGROK_AUTHTOKEN

docker compose up -d
```

Watch startup:

```bash
docker compose logs -f flex-gateway
# Wait for: "Flex Gateway started successfully"

docker compose logs -f ngrok
# Look for: "started tunnel"  and the public URL, e.g.
# url=https://abc123.ngrok-free.app
```

Also open http://localhost:4040 in a browser — ngrok's web UI shows the public URL prominently.

**Copy the ngrok public URL.**  You need it in Step 3.  If you're using a free ngrok account the URL changes every time you restart, so you'll need to update Anypoint + Vercel env vars when you restart.

---

## Step 3 — Create an API proxy in API Manager pointing at Flex Gateway

You need a *new* API Manager instance that uses Flex Gateway as the runtime (separate from the existing instance `20954842` which targets Mule Gateway).

1. Anypoint → **API Manager → + Add API**.
2. **Add new API**.
3. Fields:

   | Field | Value |
   |---|---|
   | Runtime type | **Flex Gateway** |
   | Flex Gateway | `pause-flex-gateway` (the one you just registered) |
   | API name | `pause-provider-experience-api` |
   | API version | `1.0` |
   | Implementation URL | `https://pause-mulesoft-health-v1-zkeniz.scqos5-1.usa-w1.cloudhub.io` |
   | Inbound URL | `https://<ngrok-url>` (from Step 2) |
   | Port | `8081` |
   | Base path | `/` |

4. **Save & Deploy**.  Anypoint assigns a new API Instance ID (e.g. `21xxxxxx`).

> **Why a new instance?**  The existing instance `20954842` is typed as "Mule Gateway" and cannot be reassigned to Flex Gateway in place.  The new instance gets the same policies applied in Steps 4–5.

---

## Step 4 — Apply policies to the Flex Gateway instance

The policies from iteration 2 need to be applied to the new Flex Gateway instance.  The existing instance `20954842` retains its policies but isn't enforcing them (the deferred state from iteration 2).

1. API Manager → select the **new** Flex Gateway instance.
2. **Policies → + Apply New Policy → Client ID Enforcement**:

   | Setting | Value |
   |---|---|
   | Credentials origin | HTTP Basic Auth header |
   | Client ID expression | `#[attributes.headers.'client_id']` |
   | Client Secret expression | `#[attributes.headers.'client_secret']` |

3. **Policies → + Apply New Policy → Rate Limiting — SLA based**:

   | Setting | Value |
   |---|---|
   | Client ID expression | `#[attributes.headers.'client_id']` |
   | Client Secret expression | `#[attributes.headers.'client_secret']` |
   | SLA tiers | Demo: 10 req/min (auto-approve); Production: 1000 req/min |

4. Both policies should show as **Applied** within ~30 seconds.

---

## Step 5 — Grant the existing client app access to the new instance

`pause-prototype-client` was approved on the old instance.  Approve it on the new one:

1. API Manager → new instance → **Client Applications → + Add client application**.
2. Search for `pause-prototype-client` → select → assign **Demo** tier → **Save**.

Alternatively do it from Exchange:
- Exchange → `pause-provider-experience-api` asset → **Request access** → select `pause-prototype-client` + Demo tier on the new instance.

---

## Step 6 — Smoke-test through the gateway

```bash
NGROK_URL="https://<your-ngrok-url>"
CLIENT_ID="<from pause-prototype-client>"
CLIENT_SECRET="<from pause-prototype-client>"

# No credentials → 401 from the gateway (policy enforced)
curl -i "$NGROK_URL/health"

# Valid credentials → 200 from CloudHub worker (proxied through gateway)
curl -i \
  -H "client_id: $CLIENT_ID" \
  -H "client_secret: $CLIENT_SECRET" \
  "$NGROK_URL/health"

# Providers endpoint
curl -i \
  -H "client_id: $CLIENT_ID" \
  -H "client_secret: $CLIENT_SECRET" \
  "$NGROK_URL/providers?menopause=true&limit=5"

# Rate limit — 11th request in <60s should 429
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "client_id: $CLIENT_ID" \
    -H "client_secret: $CLIENT_SECRET" \
    "$NGROK_URL/health"
done
# Expected: 10× 200, then 429
```

---

## Step 7 — Update Vercel env vars to route through the gateway

The Next.js proxy currently points directly at the CloudHub worker.  Update it to route through the Flex Gateway ngrok URL so all policies are enforced end-to-end.

```bash
# Pull current env to confirm existing values
vercel env pull frontend/.env.local

# Update the base URLs
vercel env rm MULESOFT_HEALTH_BASE_URL production
vercel env rm MULESOFT_PROVIDERS_BASE_URL production

vercel env add MULESOFT_HEALTH_BASE_URL
# Value: https://<ngrok-url>

vercel env add MULESOFT_PROVIDERS_BASE_URL
# Value: https://<ngrok-url>
```

Redeploy to pick up the new env vars:

```bash
vercel --prod
```

End-to-end confirmation:

```bash
curl https://pause-health.ai/api/mulesoft/health | jq '.meta._source'
# Expected: "live-mulesoft"

curl "https://pause-health.ai/api/mulesoft/providers?menopause=true&limit=5" \
  | jq '.meta._source'
# Expected: "live-mulesoft"
```

Also confirm that stopping the CloudHub worker causes the Next.js proxy to fall back to `mock-fallback` (not 5xx) — the existing degradation logic in the Next.js routes handles this.

---

## Verification checklist

- [ ] `flexctl register` produced `registration.yaml`
- [ ] Runtime Manager → Omni Gateways → Self-Managed tab → `pause-flex-gateway` status **Connected**
- [ ] `docker compose up -d` — both containers healthy
- [ ] ngrok public URL visible at http://localhost:4040
- [ ] New API Manager instance created, Flex Gateway runtime selected
- [ ] `curl <ngrok-url>/health` without credentials → **401**
- [ ] `curl <ngrok-url>/health` with valid credentials → **200**
- [ ] `curl <ngrok-url>/providers` with valid credentials → **200**
- [ ] 11th request in 60s → **429**
- [ ] Vercel env vars updated to ngrok URL; redeployed
- [ ] `curl https://pause-health.ai/api/mulesoft/health` → `_source: "live-mulesoft"`
- [ ] `curl https://pause-health.ai/api/mulesoft/providers` → `_source: "live-mulesoft"`

---

## Troubleshooting

**Gateway shows "Disconnected" in Runtime Manager**
- `docker compose logs flex-gateway` — look for TLS or network errors
- Confirm `registration.yaml` is present and mounted correctly
- Try `docker compose down && docker compose up -d` to force reconnect

**401 on valid credentials after policies applied**
- Policy propagation can take up to 60s — wait and retry
- Confirm the client app is approved on the *new* Flex Gateway instance (not just the old Mule Gateway instance)
- Check `client_id` / `client_secret` header names match the policy expression exactly (lowercase, underscore)

**ngrok URL changes on restart**
- Free ngrok accounts get a new random URL each run
- After restarting, update the API Manager instance's Inbound URL AND the Vercel env vars
- To avoid this: buy an ngrok static domain ($8/mo) or move to a VM

**`flexctl register` fails with 401**
- Use Anypoint username/password (not Connected App client_id/secret)
- Confirm the environment name is exactly `Sandbox` (case-sensitive)

---

## What's next (iteration 4)

- **OAS/RAML spec** for the Exchange asset — generates interactive docs and lets customers produce SDK clients from the Anypoint catalog
- **JWT policy** replacing Client ID Enforcement — uses Azure AD / Okta tokens; eliminates credential distribution
- **Static ngrok domain or VM** replacing the ephemeral ngrok URL — makes the gateway stable across restarts
