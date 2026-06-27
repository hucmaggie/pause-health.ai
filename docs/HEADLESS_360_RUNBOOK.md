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

## Closing gap #2 — `mcp_api` scope on the Pause MCP server (SHIPPED 2026-06-27)

Shipped as an env-gated middleware. The audit page on `/proposal/headless-360` now shows gap #2 with the `prototype` pill.

### What activates the gate

Set `SF_HEADLESS360_REQUIRE_MCP_AUTH=on` (or `1` or `true`) **alongside** the existing `SF_HEADLESS360_*` env vars provisioned during gap #1. The gate is structurally tied to the same External Client App because it calls Salesforce's `/services/oauth2/introspect` with the same `clientId`.

When unset (the default), `/api/mcp` stays public — exactly the posture the Agentforce 3.0 Registry expects today. The gate is opt-in per environment.

### Validation flow

Implementation lives in `frontend/lib/salesforce-headless360.ts` (`validateMcpApiBearer`), wired into `frontend/app/api/mcp/route.ts`'s `handle()` via the `guardMcpAuth()` pre-check.

1. **Extract bearer.** `Authorization: Bearer <token>` only — non-Bearer schemes return `missing-bearer` immediately.
2. **Introspect (strict path).** `POST ${cfg.authBaseUrl}/services/oauth2/introspect` with `token`, `token_type_hint=access_token`, and `client_id`. If the response is 200 + `active=true`:
   - Scope contains `mcp_api` → `{ok: true, via: "introspect", scope, username}`.
   - Scope does NOT contain `mcp_api` → `{ok: false, reason: "scope-mismatch"}` → HTTP 403.
   - `active=false` → `{ok: false, reason: "token-inactive"}` → HTTP 401.
3. **Userinfo fallback (permissive path).** Reached when introspect 404s (org disabled it), errors at the network layer, or returns a 200 with an unexpected body shape. `GET ${cfg.authBaseUrl}/services/oauth2/userinfo` with `Authorization: Bearer <token>`:
   - 200 → `{ok: true, via: "userinfo-fallback", scope: null, username}` (note: scope is NOT verified by this path; the result self-documents the weaker guarantee).
   - 401 → `{ok: false, reason: "token-inactive"}` → HTTP 401.
   - any other failure → `{ok: false, reason: "introspect-error", detail}` → HTTP 401.

### HTTP semantics on /api/mcp

| Outcome | Status | `WWW-Authenticate` |
|---|---|---|
| Gate off | n/a | n/a — request handled normally |
| Gate on, env unprovisioned | 503 | (none) — body explains the misconfig |
| `missing-bearer` | 401 | `Bearer realm="mcp_api", error="missing-bearer"` |
| `token-inactive` | 401 | `Bearer realm="mcp_api", error="token-inactive"` |
| `scope-mismatch` | 403 | `Bearer realm="mcp_api", error="scope-mismatch"` |
| `introspect-error` | 401 | `Bearer realm="mcp_api", error="introspect-error"` (body carries `detail`) |
| Valid | (passes through to MCP handler; response carries `X-Pause-MCP-User` + `X-Pause-MCP-Via`) | n/a |

### Identity headers on every successful response

When the gate is on and a request validates, the MCP response carries two headers (added 2026-06-27):

- `X-Pause-MCP-User: <preferred_username>` — Salesforce-side identity from the introspect or userinfo payload. Absent if Salesforce didn't return one (rare).
- `X-Pause-MCP-Via: introspect | userinfo-fallback` — which validation path answered, so the trace plane can distinguish the strict RFC 7662 path from the permissive aliveness-only path.

The Agent Fabric trace plane should pick these up and stamp them on every recorded span originating from a gated `/api/mcp` request.

### /api/mcp/whoami — gate diagnostic

`GET /api/mcp/whoami` returns plain JSON describing the gate state and the resolved identity. Same authentication path as `/api/mcp` — useful for operator smoke tests without parsing the SSE stream:

```bash
# Gate off
curl -s https://pause-health.ai/api/mcp/whoami
# → {"gate":"off"}

# Gate on, no bearer
curl -s https://pause-health.ai/api/mcp/whoami
# → HTTP 401, WWW-Authenticate: Bearer realm="mcp_api", error="missing-bearer"

# Gate on, valid bearer
curl -s -H "Authorization: Bearer <token>" https://pause-health.ai/api/mcp/whoami
# → {"gate":"on","via":"introspect","username":"u@example.com"}
```

### Loopback bearer propagation

`frontend/lib/mcp/host.ts` reads the inbound `Authorization` header off the request and propagates it to the **loopback remote only** — the `MCPRemoteConfig` for `https://<this-origin>/api/mcp`. External remotes configured via `PAUSE_MCP_HOST_REMOTES` keep their own headers; Salesforce-issued bearers must never be forwarded cross-origin. The same-origin guarantee is structural: the loopback URL is built from the request origin, so there's no path by which an externally-configured remote could end up carrying it.

### Operator activation steps

After gap #1 is provisioned (see the procurement section above):

1. **Configure your External Client App** to grant `mcp_api` to the same client that calls `/api/mcp`. If `mcp_api` doesn't yet surface in your org's scope list, the introspect-only path will reject all tokens — switch to userinfo fallback by ensuring introspect is disabled (or accept the weaker guarantee documented above).
2. **Set `SF_HEADLESS360_REQUIRE_MCP_AUTH=on`** in Vercel Production + Preview env. No other env var is needed.
3. **Redeploy.** The new env propagates to the next preview build.
4. **Smoke-test:**
   ```bash
   # Expect 401 without bearer
   curl -i "https://pause-health.ai/api/mcp" -X POST | head -5
   # Expect 401/403 with a known-bad bearer
   curl -i "https://pause-health.ai/api/mcp" -H "Authorization: Bearer fake" -X POST | head -5
   # Expect a normal MCP initialize response with a real Salesforce-issued mcp_api-scoped bearer
   curl -i "https://pause-health.ai/api/mcp" -H "Authorization: Bearer <real-token>" -X POST \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'
   ```
5. **Rollback** is `unset SF_HEADLESS360_REQUIRE_MCP_AUTH`. Restoring public access is one env-var deletion away.

### Tests pinning the contract

- `frontend/lib/salesforce-headless360.test.ts` adds 22 unit tests covering: `isMcpApiAuthRequired` truthy-table, introspect happy path, scope-mismatch, token-inactive, introspect 404 → userinfo fallback, fallback 401, network errors → `introspect-error`, bogus introspect body falls through to userinfo, bearer whitespace handling.
- `frontend/lib/mcp/host.test.ts` adds 3 tests pinning that the inbound bearer attaches to loopback only (NOT to external remotes), no bearer is attached when the verifier returns empty, and disabling loopback drops the bearer entirely.
- `createMCPHostFromRequest(req)` reads the request's `Authorization` header and passes it through `resolveRemotesFromEnv(origin, { loopbackBearer })` — the connecting glue between the inbound request and the loopback transport.

### Follow-ups shipped 2026-06-27

Two limitations the initial gap #2 ship flagged are now addressed:

- **Validated identity surfaced as response headers + a diagnostic endpoint.** `guardMcpAuth` now returns the validated identity (`username` + `via`) instead of swallowing it. `/api/mcp` attaches `X-Pause-MCP-User` and `X-Pause-MCP-Via` headers to every successful response so the Agent Fabric trace plane can attribute tool calls. A new `GET /api/mcp/whoami` endpoint lets operators verify the gate is wired correctly without parsing the SSE stream — returns `{gate: "off"}` when the gate is unset, `{gate: "on", via, username}` when the bearer validates, and the same 401/403/503 errors as `/api/mcp` otherwise.
- **Positive introspect results cached for 60s.** A bounded process-local cache (`Map<token, {expiresAt, result}>`, capped at 1024 entries, LRU-on-insert) in `lib/salesforce-headless360.ts` avoids hammering Salesforce on a hot Vercel instance. Only `ok: true` results are cached — negatives re-check so a freshly-issued token doesn't stay rejected and a scope grant flips through immediately. Revocation latency is bounded at one TTL window (60s). Process restart wipes the cache; cross-instance sharing belongs at a dedicated KV layer when traffic justifies it.

### Still open

- **Userinfo-fallback path does not enforce scope.** Operators who need RFC 7662-strict scope validation must keep introspect enabled on their External Client App. The runbook flags this honestly so the audit posture matches the deployed behavior. This is a Salesforce-side configuration choice, not something Pause can close from this side.
