# @pause-health/mcp

**Model Context Protocol (MCP) server that exposes the Pause-Health.ai
MuleSoft Experience APIs as tools for AI agents.**

Any MCP-aware client — Claude Desktop, Cursor, the Salesforce
Agentforce 3.0 Registry, OpenAI Responses API, or your own JSON-RPC
harness — can register this server and call Pause's clinical APIs as
native tools.

The Pause MCP surface ships in two transports, with the same four tools
and the same Experience API contract behind them:

| Transport       | Endpoint                                         | Best for                                                 |
| --------------- | ------------------------------------------------ | -------------------------------------------------------- |
| Streamable HTTP | `https://pause-health.ai/api/mcp`                | Agentforce 3.0 Registry, remote / HTTP-based MCP clients |
| stdio           | `npx @pause-health/mcp` (this package)           | Claude Desktop, Cursor, any local MCP client             |

Tool definitions are single-sourced in `mcp/src/tools.ts` and
duplicated into `frontend/lib/mcp/tools.ts` for the Next.js route. A
parity test (`frontend/lib/mcp/tools.parity.test.ts`) fails CI if the
two copies drift — edit the canonical copy, then `cp` it across.

Today, two of the four Experience APIs are **LIVE on Anypoint CloudHub
2.0** (worker `pause-mulesoft-health-v1` v1.0.5 behind Flex Gateway with
Auth0-JWT validation + rate limiting). The other two remain Next.js
mocks. Every tool reads from `/api/mulesoft/*`, a live-or-mock proxy
that flips per endpoint based on whether the corresponding
`MULESOFT_*_BASE_URL` env var is set:

| Tool | Backing Experience API | Today |
|---|---|---|
| `get_patient_timeline` | `/api/mulesoft/health` | **live-mulesoft** (CloudHub v1.0.5; consumes `pause-omh-to-fhir-library` v1.0.0 from Anypoint Exchange as a Maven dependency) |
| `find_menopause_providers` | `/api/mulesoft/providers` | **live-mulesoft** (CloudHub v1.0.5; DataWeave serves the Phase-2 contract — distance ranking, sanctions filtering, MSCP overlay, insurance/telehealth filters) |
| `get_patient_intake` | `/api/mulesoft/patient/[id]/intake` | mock (Next.js fixtures) |
| `experience_api_health` | `/api/mulesoft/health` (root liveness) | **live-mulesoft** |

The proxy degrades gracefully: when the CloudHub tunnel is down (e.g.
laptop sleep), the response flips to `_source: "mock-fallback"` without
500-ing. See `frontend/lib/mulesoft/{health,providers}.ts` for the
proxy code and `meta._source` discriminator.

When a customer's MuleSoft Anypoint runtime takes over the remaining
two Experience APIs, point `PAUSE_MCP_BASE_URL` at their Experience-
tier base URL and the same four tools transparently call production.

See [`/proposal/mcp`](../frontend/app/proposal/mcp/page.tsx) and
[`/proposal/mulesoft`](../frontend/app/proposal/mulesoft/page.tsx) for
the full architecture; the latter page covers the nine Anypoint
Exchange assets (Phase 3) that complete the API-led tier coverage.

## Tools exposed

| Tool name | What it does | Production-equivalent MuleSoft API |
|---|---|---|
| `get_patient_timeline` | Returns a FHIR R5 Bundle (Patient + raw Observations + DBDP-derived feature Observation with `derivedFrom` provenance). | `pause-patient-bundle-process-api` |
| `get_patient_intake` | Returns the structured intake record produced by the Agentforce Service Agent (chief complaint, symptom cluster, red-flag screen, triage recommendation). | `pause-intake-process-api` |
| `find_menopause_providers` | Searches Pause's 2,015-row NPPES-derived provider directory. Filters: `zip` (3-digit-prefix), `menopause` (narrow to MSCP-certified), `limit`, `fallback` (open the certified-local → relevant-local → certified-remote tier ladder when strict certified-local is empty), `insurance` (canonical plan token), `telehealth`. Returns distance-ranked rows (Census ZCTA centroids) with `licenseStatus`, `serviceSignals` (six NPPES board-cert / multi-specialty signals), and `credentialSource` (`curated-overlay` vs `self-reported`). Sanctioned providers (1,720 dropped from CA Medi-Cal + NY OPMC + TX TMB in the latest build) cannot surface; the patient-safety filter is verifiable per response under `provenance.dataset.sanctionedFilteredBySource`. | `pause-provider-directory-experience-api` |
| `experience_api_health` | Liveness check for the Experience API plane. | `pause-patient-bundle-process-api` (root) |

## Install & run

```bash
cd mcp
npm install
npm run build
node dist/server.js
```

Or, after publishing:

```bash
npx -y @pause-health/mcp
```

The server speaks **stdio** — the standard transport for local MCP
clients. There is no HTTP listener; the parent client process spawns it
and talks over `stdin`/`stdout` using JSON-RPC.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PAUSE_MCP_BASE_URL` | `https://pause-health.ai` | Base URL for the Experience APIs. Set to `http://localhost:3000` against the local Next.js dev server, or to a customer's Anypoint Experience-tier base URL in production. |
| `PAUSE_MCP_API_KEY` | _(unset)_ | Optional bearer token. Sent as `Authorization: Bearer <key>`. Not used against the public mock. |

## HTTP endpoint: `mcp_api` bearer gate (Headless 360 audit gap #2)

The Streamable HTTP endpoint at `https://pause-health.ai/api/mcp` is
**public by default** — that posture is what the Agentforce 3.0
Registry expects, and what the audit page's "REST + MCP" pattern map
relies on for the public-mock demo.

When the operator sets `SF_HEADLESS360_REQUIRE_MCP_AUTH=on` (alongside
the `SF_HEADLESS360_*` env vars provisioned during gap #1 activation),
the endpoint switches to a Salesforce-issued OAuth bearer with the
`mcp_api` scope. Validation is **introspect-first** (RFC 7662 strict
path: requires `active=true` AND `scope` contains `mcp_api`) with a
**userinfo fallback** for orgs that disable introspect (permissive
path: verifies token aliveness only; the result self-documents as
`via: "userinfo-fallback"` so callers can log the weaker guarantee).

Behavior summary:

| Outcome | HTTP | `WWW-Authenticate` |
|---|---|---|
| Gate off (default) | passes through | — |
| Gate on, env unprovisioned | 503 | — (fail closed) |
| `missing-bearer` | 401 | `Bearer realm="mcp_api", error="missing-bearer"` |
| `token-inactive` | 401 | `Bearer realm="mcp_api", error="token-inactive"` |
| `scope-mismatch` | 403 | `Bearer realm="mcp_api", error="scope-mismatch"` |
| Valid bearer | 200 + `X-Pause-MCP-User` + `X-Pause-MCP-Via` headers | — |

Successful responses carry two identity headers so the Agent Fabric
trace plane can attribute tool calls:

- `X-Pause-MCP-User: <preferred_username>` — Salesforce-side identity.
- `X-Pause-MCP-Via: introspect | userinfo-fallback` — which validation
  path answered.

Positive introspect results are cached process-locally for 60s (bounded
LRU at 1024 entries) to avoid hammering Salesforce on hot Vercel
instances. Negatives re-check every call. Revocation latency is bounded
at one TTL window.

### `GET /api/mcp/whoami` — operator diagnostic

Plain JSON envelope for verifying gate wiring without parsing the SSE
response stream from `/api/mcp`:

```bash
# Gate off
curl -s https://pause-health.ai/api/mcp/whoami
# → {"gate":"off"}

# Gate on, valid bearer
curl -s -H "Authorization: Bearer <token>" https://pause-health.ai/api/mcp/whoami
# → {"gate":"on","via":"introspect","username":"u@example.com"}
```

Returns the same 401 / 403 / 503 errors as `/api/mcp` on failure.

### stdio binary and the bearer gate

The stdio binary in this package **does not** speak the `mcp_api`
bearer flow — stdio MCP doesn't have a request/response auth model. If
your client needs the gated endpoint, register the Streamable HTTP URL
with whatever credential mechanism your MCP client supports
(Agentforce Registry's connection profile, an HTTP-aware client's
`Authorization` header, etc.). The stdio binary stays useful for
local development against `PAUSE_MCP_BASE_URL=http://localhost:3000` or
against the un-gated public endpoint.

For the full gap-#2 architecture, see
[`docs/HEADLESS_360_RUNBOOK.md`](../docs/HEADLESS_360_RUNBOOK.md)
§ "Closing gap #2".

## MCP Bridge: the Care Router is itself an MCP host

Beyond serving tools, Pause's Care Router is itself a *host* that
loads remote MCP servers per-request and calls their tools as part of
routing decisions. Implementation in
[`frontend/lib/mcp/host.ts`](../frontend/lib/mcp/host.ts).

Two remote slots:

1. **`loopback`** — Pause's own `/api/mcp`. Always on (unless
   `PAUSE_MCP_HOST_LOOPBACK=off`). Demonstrates the host pattern
   against the four tools shipped here without a partner dependency.
2. **`external`** — driven by `PAUSE_MCP_HOST_REMOTES` (JSON array of
   `{ id, url, headers? }`). Empty by default. Wire a customer's
   Salesforce-hosted MCP server, a partner Apex tool surface, or any
   other Streamable-HTTP MCP server here.

Loopback bearer propagation: when an inbound request to the Care
Router carries `Authorization: Bearer ...`, the host attaches that
bearer to the **loopback remote only** — never to external remotes.
The same-origin guarantee is structural (the loopback URL is built
from the request origin), so a Salesforce-issued user token can't
leak cross-origin.

## Register with an MCP client

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pause-health": {
      "command": "npx",
      "args": ["-y", "@pause-health/mcp"],
      "env": {
        "PAUSE_MCP_BASE_URL": "https://pause-health.ai"
      }
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json` (or your project's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "pause-health": {
      "command": "npx",
      "args": ["-y", "@pause-health/mcp"],
      "env": {
        "PAUSE_MCP_BASE_URL": "https://pause-health.ai"
      }
    }
  }
}
```

### Local development against your own dev server

```json
{
  "mcpServers": {
    "pause-health-local": {
      "command": "node",
      "args": ["/absolute/path/to/pause-health.ai/mcp/dist/server.js"],
      "env": {
        "PAUSE_MCP_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

### Agentforce 3.0 — register the HTTP endpoint with the Agentforce Registry

For Salesforce orgs on Agentforce 3.0 (the June-2025 release that
introduced the native MCP client), the Pause MCP server is registered
through the **Agentforce Registry**, not the legacy External Services
connector. The Registry expects an HTTP-fronted server — stdio is not
registry-callable — so use the Next.js route at
`https://pause-health.ai/api/mcp` (or your own Vercel preview URL) as
the registration target.

Steps:

1. **Setup → Agentforce Registry → New MCP server.** Paste the
   Streamable HTTP URL (`https://pause-health.ai/api/mcp`). Salesforce
   calls `tools/list` against it and auto-populates the four Pause
   tools (`get_patient_timeline`, `get_patient_intake`,
   `find_menopause_providers`, `experience_api_health`).
2. **Allowlist the tools you want.** Each allowlisted tool is
   persisted to the **Agentforce Asset Library** as a callable
   action. The verbose tool descriptions are intentional — they
   become the agent's reasoning instructions inside Builder.
3. **Agentforce Builder → your agent → Topic → This Topic's Actions.**
   Add the Pause tools from the Asset Library. Validate in **Plan
   Canvas** with a representative patient prompt.
4. **(Optional) Agentforce Gateway** — layer rate-limit / policy
   governance over the registered server.

Authentication specifics for the Registry's connection profile live in
the gated *MCP for Agentforce* help article; we'll wire OAuth or
Named-Credential auth when a partner needs it. The prototype endpoint
serves the public mock APIs and runs unauthenticated by design.

### Customer-Anypoint deployment

When a customer's MuleSoft Anypoint Experience tier is live, set
`PAUSE_MCP_BASE_URL` on the Vercel deployment to that base URL and the
same four tools transparently call the customer's APIs. The Registry
registration URL doesn't change; only the underlying base URL does.

## Smoke test

With a Pause Experience API reachable (local dev server or production):

```bash
PAUSE_MCP_BASE_URL=http://localhost:3000 node scripts/smoke.mjs
```

This spawns the built server, drives it over real stdio MCP, lists
tools, and calls each one. Expect:

```
PASS  listTools returns 4 tools
PASS  experience_api_health
PASS  get_patient_timeline (demo id)
PASS  get_patient_intake (demo id)
PASS  find_menopause_providers (zip=926)
All Pause MCP tools healthy.
```

## Where to look next

- **MuleSoft architecture & API design**: `../docs/mulesoft-integration.md`
- **Live CloudHub worker source**: `../mulesoft/pause-mulesoft-health-v1/` (v1.0.5, serving `/health` + `/providers`)
- **Phase-3 Anypoint Exchange assets**: `../mulesoft/specs/` (eight OAS-3.0 spec assets + `../mulesoft/pause-omh-to-fhir-library/`)
- **Investor view of this MCP server**: `/proposal/mcp` (Next.js route)
- **Headless 360 audit (gap #2 lives here)**: `/proposal/headless-360` + `../docs/HEADLESS_360_RUNBOOK.md`
- **MCP Bridge / host implementation**: `../frontend/lib/mcp/host.ts`
- **Live-or-mock proxy code**: `../frontend/lib/mulesoft/{health,providers}.ts`
- **Mock fixtures (timeline / intake)**: `../frontend/lib/mulesoft-mocks.ts`
