# Salesforce Headless 360 — Activation Runbook

**Status (2026-06-24):** PKCE seam shipped (`lib/salesforce-headless360.ts` + the five routes under `/api/salesforce/headless-360/*`). The seam is dormant — five env vars set it to `prototype`, a sixth to `shipped` after operator verification.

This runbook is the procurement-and-activation checklist that turns gap #1 from [/proposal/headless-360](https://pause-health.ai/proposal/headless-360) (PKCE External Client App OAuth flow) from `designed` to `prototype` to `shipped`. It mirrors the pattern from `docs/AGENTFORCE_VOICE_RUNBOOK.md`.

## What this seam does

Implements **OAuth 2.0 Authorization Code + PKCE** against a Salesforce **External Client App** with scopes **`mcp_api` + `refresh_token`** — the trust model Salesforce documents for Headless 360 (TDX 2026). Once activated, the routes let a Pause page sign a clinician into Salesforce, get back a bearer token, and use that token to call Data 360 grounding, MCP `tools/call`, or A2A `tasks/send` under the clinician's identity (so Event Monitoring + Shield can attribute every call).

**Authoritative sources:**
- https://www.salesforce.com/blog/headless-trust-model-agentic-architecture/
- https://www.salesforce.com/blog/headless-360-integration-architecture/
- https://www.salesforce.com/blog/how-to-choose-integration-pattern-for-agentforce/

## Phase 0 — verify the seam is in this checkout

```bash
ls frontend/lib/salesforce-headless360.ts
ls frontend/app/api/salesforce/headless-360/config/route.ts
ls frontend/app/api/salesforce/headless-360/authorize/route.ts
ls frontend/app/api/salesforce/headless-360/callback/route.ts
ls frontend/app/api/salesforce/headless-360/token/refresh/route.ts
ls frontend/app/api/salesforce/headless-360/me/route.ts
ls frontend/app/api/salesforce/headless-360/logout/route.ts
```

All seven must exist. If any is missing, `git pull origin main`.

Smoke the API contract against a local dev server:

```bash
cd frontend
npm run dev &
curl -sS http://localhost:3000/api/salesforce/headless-360/config | jq .
# Expected with no env vars set:
# {
#   "meta": { "_source": "designed", "_doc": "..." },
#   "status": "designed"
# }
```

## Phase 1 — procure (Salesforce side)

### 1a. Create a Salesforce External Client App

In your Salesforce org: **Setup → External Client Apps → New External Client App**.

- App name: `Pause Health Headless 360` (or your tenant-specific name).
- API name: auto-generated; can stay.
- Contact email: an admin you trust.
- Distribution: select **Local** for a tenant-only app, or **Packaged** if you intend to install it into multiple orgs.

In the OAuth Settings panel:

- Enable OAuth Settings: ✅
- Callback URL: `https://pause-health.ai/api/salesforce/headless-360/callback` (use the deployment's actual host; preview URLs need their own External Client App).
- **Selected OAuth scopes:**
  - `Manage user data via APIs (api)` — required for Data 360 / Connect REST calls under the user's identity.
  - `Perform requests at any time (refresh_token, offline_access)` — required for refresh.
  - `Access Model Context Protocol tools (mcp_api)` — required for MCP-mediated calls when Salesforce ships its server-side scope.
- **Flow Enablement: Require PKCE Verifier.** This is the Headless 360 trust-model invariant. Toggle ON.
- **Require Secret for Web Server Flow / for Refresh Token Flow: OFF.** PKCE replaces the client secret.

Save. Salesforce returns a **Consumer Key** — this is the `client_id`. There is intentionally no Consumer Secret because we toggled PKCE.

### 1b. (Optional) Pre-authorize the app

For a smoother first-run, mark the External Client App as **Pre-authorized** in **Manage Profiles** / **Manage Permission Sets** so the user doesn't see a consent dialog. Skip this if you want the explicit consent screen as part of your demo.

### 1c. Generate a session secret

The seam HMAC-signs its session cookies with a Pause-side secret. Generate 32 bytes of entropy and keep it on the deployment side only:

```bash
openssl rand -hex 32   # produces 64 hex chars = 32 bytes
```

## Phase 2 — set the deploy-side env vars

```bash
cd frontend
vercel env add SF_HEADLESS360_CLIENT_ID         production   # paste the Consumer Key
vercel env add SF_HEADLESS360_AUTH_BASE_URL     production   # https://<my-org>.my.salesforce.com
vercel env add SF_HEADLESS360_REDIRECT_URI      production   # https://pause-health.ai/api/salesforce/headless-360/callback
vercel env add SF_HEADLESS360_SESSION_SECRET    production   # the openssl-rand-hex output
# Optional override; defaults to "mcp_api refresh_token":
vercel env add SF_HEADLESS360_SCOPES            production   # mcp_api refresh_token api
```

Trigger a redeploy:

```bash
vercel --prod --yes
```

Verify:

```bash
curl -sS https://pause-health.ai/api/salesforce/headless-360/config | jq .
# Expected:
# {
#   "meta": { "_source": "prototype", "_doc": "..." },
#   "status": "prototype",
#   "scopes": "mcp_api refresh_token api",
#   "authorizeUrl": "/api/salesforce/headless-360/authorize"
# }
```

If you see `designed`, the env vars didn't reach this deployment. Re-check `vercel env ls production`.

## Phase 3 — end-to-end verification

1. Open https://pause-health.ai/api/salesforce/headless-360/authorize?next=/proposal/headless-360 in a logged-out browser. Expected: 302 redirect to `https://<my-org>.my.salesforce.com/services/oauth2/authorize?...`.
2. Sign in as a Salesforce user with the necessary licenses (Data Cloud / Agentforce Service / MCP).
3. Consent (if not pre-authorized).
4. Salesforce redirects back to `/api/salesforce/headless-360/callback?code=...&state=...`.
5. Browser should land on `/proposal/headless-360` (or the `?next=` you sent).
6. Hit https://pause-health.ai/api/salesforce/headless-360/me in the same browser. Expected: 200 with `meta.expiresAt` + a `user` object containing `email`, `preferred_username`, `name`, etc.
7. Wait until the access token is near expiry, then `POST /api/salesforce/headless-360/token/refresh`. Expected: 200 with a new `meta.expiresAt`; the `me` route still returns 200 after.
8. `POST /api/salesforce/headless-360/logout`. Expected: 200; subsequent `GET /me` returns 401 `not-signed-in`.

Record the verified session in `docs/HEADLESS_360_REAL_RUN_<YYYY-MM-DD>.md` (one paragraph + the curl traces).

Flip the verified flag:

```bash
vercel env add SF_HEADLESS360_VERIFIED production   # true
vercel --prod --yes
```

Confirm:

```bash
curl -sS https://pause-health.ai/api/salesforce/headless-360/config | jq .status
# Expected: "shipped"
```

The status pill on `/proposal/headless-360` for gap #1 will now read `shipped`.

## Rollback

Same shape as Agentforce Voice — safe at every step:

```bash
vercel env rm SF_HEADLESS360_CLIENT_ID         production
vercel env rm SF_HEADLESS360_AUTH_BASE_URL     production
vercel env rm SF_HEADLESS360_REDIRECT_URI      production
vercel env rm SF_HEADLESS360_SESSION_SECRET    production
vercel env rm SF_HEADLESS360_VERIFIED          production   # if set
vercel --prod --yes
```

After redeploy the `/config` route reports `designed` again and all five OAuth routes return 503. Existing signed cookies become unverifiable (different secret on a fresh activation) — users will silently re-sign-in on next visit.

## Known unknowns

- **Salesforce-side `mcp_api` scope availability.** The Headless 360 blog calls out `mcp_api` as the canonical scope. As of 2026-06-24 the scope is on Salesforce's documented OAuth scope list; if your org's Setup doesn't surface it yet, fall back to `api` only (the routes will still work, just not under MCP-attributed identity). Re-check when the Salesforce MCP server registry GA's broadly.
- **Token rotation policy.** Some Salesforce orgs are configured to rotate the refresh token on every refresh; some are not. The seam handles both (uses the new refresh_token when returned, falls back to the existing one). If your org has rotation enabled, ensure long-lived sessions aren't depending on the original refresh_token surviving.
- **PKCE downgrade attacks.** The seam requires `code_challenge_method=S256`; do not enable `plain` on the External Client App.

## Next: closing gap #2 (`mcp_api` scope on the Pause MCP server)

After this seam ships, gap #2 in the audit becomes the natural follow-up: validating incoming `Bearer` tokens with `mcp_api` scope on the Pause `/api/mcp` endpoint. Specifically:

1. Extract a middleware from this seam's verify-cookie path.
2. Apply it conditionally on `/api/mcp` — public when `SF_HEADLESS360_REQUIRE_MCP_AUTH` is unset, gated when set.
3. Update `frontend/lib/mcp/host.ts` so the host attaches the user's bearer token when the loopback remote is in the same origin.

That work depends on this PKCE seam being live, which is why it's gated behind this activation.
