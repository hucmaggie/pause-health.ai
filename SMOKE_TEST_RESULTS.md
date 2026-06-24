# Smoke test results

Last run: 2026-06-24T15:24:03.282Z → 2026-06-24T15:24:14.858Z (12s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 167 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 58872 | 17 |  |
| ✓ | /about | 200 | 57448 | 110 |  |
| ✓ | /blog | 200 | 50795 | 83 |  |
| ✓ | /careers | 200 | 45304 | 79 |  |
| ✓ | /changelog | 200 | 563256 | 115 |  |
| ✓ | /contact | 200 | 46494 | 98 |  |
| ✓ | /hipaa | 200 | 62483 | 89 |  |
| ✓ | /press | 200 | 58841 | 92 |  |
| ✓ | /privacy | 200 | 55674 | 93 |  |
| ✓ | /provider | 200 | 86908 | 203 |  |
| ✓ | /provider?zip=92614&menopause=true&telehealth=true | 200 | 41417 | 14 |  |
| ✓ | /provider/1730155570?from=92614 | 200 | 37572 | 348 |  |
| ✓ | /research | 200 | 56696 | 111 |  |
| ✓ | /roadmap | 200 | 96077 | 135 |  |
| ✓ | /security | 200 | 71369 | 126 |  |
| ✓ | /terms | 200 | 56224 | 125 |  |
| ✓ | /proposal | 200 | 61052 | 118 |  |
| ✓ | /proposal/agent-fabric | 200 | 63547 | 127 |  |
| ✓ | /proposal/agentforce | 200 | 79175 | 131 |  |
| ✓ | /proposal/agentforce-voice | 200 | 66074 | 147 |  |
| ✓ | /proposal/headless-360 | 200 | 87016 | 16 |  |
| ✓ | /proposal/competition | 200 | 69919 | 138 |  |
| ✓ | /proposal/customers | 200 | 65564 | 147 |  |
| ✓ | /proposal/data | 200 | 74921 | 145 |  |
| ✓ | /proposal/data-360 | 200 | 106872 | 163 |  |
| ✓ | /proposal/dbdp | 200 | 81303 | 155 |  |
| ✓ | /proposal/full | 200 | 113634 | 161 |  |
| ✓ | /proposal/insights | 200 | 75729 | 153 |  |
| ✓ | /proposal/integration | 200 | 88219 | 157 |  |
| ✓ | /proposal/mcp | 200 | 98730 | 163 |  |
| ✓ | /proposal/menopause-society | 200 | 76306 | 195 |  |
| ✓ | /proposal/mulesoft | 200 | 79798 | 182 |  |
| ✓ | /proposal/provider-graph | 200 | 108493 | 176 |  |
| ✓ | /proposal/strategy | 200 | 75682 | 169 |  |
| ✓ | /proposal/technology | 200 | 75859 | 173 |  |
| ✓ | /demo/intake | 200 | 42231 | 227 |  |
| ✓ | /demo/patient | 200 | 40738 | 189 |  |
| ✓ | /demo/routing | 200 | 47330 | 188 |  |
| ✓ | /demo/agent-fabric | 200 | 37027 | 208 |  |
| ✓ | /demo/analytics | 200 | 42491 | 196 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 42403 | 13 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40910 | 15 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47502 | 15 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37368 | 16 |  |

## Internal links

104 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 4 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 4 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 174 | 154 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 4 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 4102 | 5 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3941 | 5 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1342 | 4 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 8 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 6 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 10 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 1915 | 12 | meta, query, matchType, sort, total, returned |  |
| ✓ | GET /api/agentforce/voice/config | 200 | 148 | 180 | meta, status |  |
| ✓ | GET /api/salesforce/headless-360/config | 200 | 144 | 7 | meta, status |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 163 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 632 | 174 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 175 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5515 | 878 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 5 | jsonrpc, id, result |  |

## MCP Streamable HTTP

| ✓/✗ | Probe | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | POST /api/mcp (initialize) | 200 | 194 | 249 | serverInfo=pause-health-mcp@0.3.0 tools=advertised |

