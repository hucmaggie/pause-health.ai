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

Today the server fronts the **mocked** Experience APIs in this repo at
`https://pause-health.ai/api/mulesoft/*` so investors, prospects, and
partners can integrate against the real shape with zero deployment. When
a customer's MuleSoft Anypoint runtime is live, point
`PAUSE_MCP_BASE_URL` at their Experience-tier base URL and these same
tools transparently call production.

This is the same swap-the-base-URL pattern we use for Agentforce
(`NEXT_PUBLIC_AGENTFORCE_*` env vars) — see
[`/proposal/mcp`](../frontend/app/proposal/mcp/page.tsx) and
[`/proposal/mulesoft`](../frontend/app/proposal/mulesoft/page.tsx).

## Tools exposed

| Tool name | What it does | Production-equivalent MuleSoft API |
|---|---|---|
| `get_patient_timeline` | Returns a FHIR R5 Bundle (Patient + raw Observations + DBDP-derived feature Observation with `derivedFrom` provenance). | `pause-patient-bundle-process-api` |
| `get_patient_intake` | Returns the structured intake record produced by the Agentforce Service Agent (chief complaint, symptom cluster, red-flag screen, triage recommendation). | `pause-intake-process-api` |
| `find_menopause_providers` | Searches Pause's provider directory by ZIP / menopause-certified flag, ranked by graph score. | `pause-provider-directory-experience-api` |
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
      "args": ["/absolute/path/to/shipping-quote-by-zip-api/mcp/dist/server.js"],
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
- **Reference Mule flow + DataWeave transform**: `../mulesoft/`
- **Investor view of this MCP server**: `/proposal/mcp` (Next.js route)
- **Mocked Experience API source**: `../frontend/lib/mulesoft-mocks.ts`
