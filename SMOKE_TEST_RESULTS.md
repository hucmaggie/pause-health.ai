# Smoke test results

Last run: 2026-06-24T08:30:47.699Z → 2026-06-24T08:30:59.220Z (12s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 163 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 58872 | 17 |  |
| ✓ | /about | 200 | 57448 | 120 |  |
| ✓ | /blog | 200 | 50795 | 88 |  |
| ✓ | /careers | 200 | 45304 | 75 |  |
| ✓ | /changelog | 200 | 547276 | 109 |  |
| ✓ | /contact | 200 | 46494 | 129 |  |
| ✓ | /hipaa | 200 | 62483 | 86 |  |
| ✓ | /press | 200 | 58841 | 91 |  |
| ✓ | /privacy | 200 | 55674 | 87 |  |
| ✓ | /provider | 200 | 86908 | 196 |  |
| ✓ | /provider?zip=92614&menopause=true&telehealth=true | 200 | 41417 | 13 |  |
| ✓ | /provider/1730155570?from=92614 | 200 | 37572 | 364 |  |
| ✓ | /research | 200 | 56696 | 106 |  |
| ✓ | /roadmap | 200 | 96077 | 109 |  |
| ✓ | /security | 200 | 71369 | 114 |  |
| ✓ | /terms | 200 | 56224 | 117 |  |
| ✓ | /proposal | 200 | 61052 | 142 |  |
| ✓ | /proposal/agent-fabric | 200 | 63547 | 132 |  |
| ✓ | /proposal/agentforce | 200 | 77700 | 128 |  |
| ✓ | /proposal/agentforce-voice | 200 | 64549 | 142 |  |
| ✓ | /proposal/competition | 200 | 69919 | 134 |  |
| ✓ | /proposal/customers | 200 | 65564 | 155 |  |
| ✓ | /proposal/data | 200 | 74921 | 145 |  |
| ✓ | /proposal/data-360 | 200 | 105389 | 156 |  |
| ✓ | /proposal/dbdp | 200 | 81303 | 147 |  |
| ✓ | /proposal/full | 200 | 113634 | 162 |  |
| ✓ | /proposal/insights | 200 | 75729 | 154 |  |
| ✓ | /proposal/integration | 200 | 88219 | 171 |  |
| ✓ | /proposal/mcp | 200 | 97234 | 171 |  |
| ✓ | /proposal/menopause-society | 200 | 76306 | 163 |  |
| ✓ | /proposal/mulesoft | 200 | 79798 | 180 |  |
| ✓ | /proposal/provider-graph | 200 | 108493 | 172 |  |
| ✓ | /proposal/strategy | 200 | 75682 | 166 |  |
| ✓ | /proposal/technology | 200 | 75859 | 170 |  |
| ✓ | /demo/intake | 200 | 42231 | 279 |  |
| ✓ | /demo/patient | 200 | 40738 | 206 |  |
| ✓ | /demo/routing | 200 | 47330 | 211 |  |
| ✓ | /demo/agent-fabric | 200 | 37027 | 218 |  |
| ✓ | /demo/analytics | 200 | 42491 | 215 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 42403 | 16 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40910 | 14 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47502 | 15 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37368 | 15 |  |

## Internal links

102 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 7 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 5 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 174 | 151 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 5 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 4102 | 5 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3941 | 6 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1342 | 4 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 6 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 7 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 9 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 1915 | 13 | meta, query, matchType, sort, total, returned |  |
| ✓ | GET /api/agentforce/voice/config | 200 | 148 | 173 | meta, status |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 158 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 632 | 166 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 162 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5515 | 863 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 5 | jsonrpc, id, result |  |

## MCP Streamable HTTP

| ✓/✗ | Probe | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | POST /api/mcp (initialize) | 200 | 194 | 232 | serverInfo=pause-health-mcp@0.3.0 tools=advertised |

