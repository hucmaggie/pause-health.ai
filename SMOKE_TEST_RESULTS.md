# Smoke test results

Last run: 2026-06-24T07:24:34.028Z → 2026-06-24T07:24:44.095Z (10s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 161 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 58872 | 18 |  |
| ✓ | /about | 200 | 52491 | 206 |  |
| ✓ | /blog | 200 | 50795 | 61 |  |
| ✓ | /careers | 200 | 45304 | 60 |  |
| ✓ | /changelog | 200 | 522877 | 158 |  |
| ✓ | /contact | 200 | 46494 | 116 |  |
| ✓ | /hipaa | 200 | 62483 | 72 |  |
| ✓ | /press | 200 | 58841 | 73 |  |
| ✓ | /privacy | 200 | 55674 | 73 |  |
| ✓ | /provider | 200 | 86908 | 207 |  |
| ✓ | /provider?zip=92614&menopause=true&telehealth=true | 200 | 41417 | 11 |  |
| ✓ | /provider/1730155570?from=92614 | 200 | 37572 | 351 |  |
| ✓ | /research | 200 | 56696 | 97 |  |
| ✓ | /roadmap | 200 | 96077 | 107 |  |
| ✓ | /security | 200 | 71369 | 107 |  |
| ✓ | /terms | 200 | 56224 | 104 |  |
| ✓ | /proposal | 200 | 61052 | 110 |  |
| ✓ | /proposal/agent-fabric | 200 | 63547 | 125 |  |
| ✓ | /proposal/agentforce | 200 | 77700 | 123 |  |
| ✓ | /proposal/competition | 200 | 69919 | 118 |  |
| ✓ | /proposal/customers | 200 | 65564 | 118 |  |
| ✓ | /proposal/data | 200 | 74921 | 126 |  |
| ✓ | /proposal/data-360 | 200 | 105389 | 127 |  |
| ✓ | /proposal/dbdp | 200 | 81303 | 133 |  |
| ✓ | /proposal/full | 200 | 113634 | 133 |  |
| ✓ | /proposal/insights | 200 | 75729 | 131 |  |
| ✓ | /proposal/integration | 200 | 88219 | 131 |  |
| ✓ | /proposal/mcp | 200 | 97234 | 153 |  |
| ✓ | /proposal/menopause-society | 200 | 76306 | 145 |  |
| ✓ | /proposal/mulesoft | 200 | 79798 | 152 |  |
| ✓ | /proposal/provider-graph | 200 | 108493 | 161 |  |
| ✓ | /proposal/strategy | 200 | 75682 | 151 |  |
| ✓ | /proposal/technology | 200 | 75859 | 151 |  |
| ✓ | /demo/intake | 200 | 42231 | 239 |  |
| ✓ | /demo/patient | 200 | 40738 | 188 |  |
| ✓ | /demo/routing | 200 | 47330 | 183 |  |
| ✓ | /demo/agent-fabric | 200 | 37027 | 196 |  |
| ✓ | /demo/analytics | 200 | 42491 | 188 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 42403 | 14 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40910 | 14 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47502 | 16 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37368 | 14 |  |

## Internal links

102 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 4 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 5 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 174 | 136 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 4 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 4102 | 5 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3941 | 5 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1342 | 4 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 8 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 8 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 12 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 1915 | 14 | meta, query, matchType, sort, total, returned |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 184 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 632 | 148 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 148 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5515 | 485 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 4 | jsonrpc, id, result |  |

## MCP Streamable HTTP

| ✓/✗ | Probe | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | POST /api/mcp (initialize) | 200 | 194 | 244 | serverInfo=pause-health-mcp@0.3.0 tools=advertised |

