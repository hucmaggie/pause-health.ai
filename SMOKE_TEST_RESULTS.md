# Smoke test results

Last run: 2026-06-24T07:03:12.459Z → 2026-06-24T07:03:22.810Z (10s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 161 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 58872 | 17 |  |
| ✓ | /about | 200 | 52491 | 107 |  |
| ✓ | /blog | 200 | 50795 | 68 |  |
| ✓ | /careers | 200 | 45304 | 68 |  |
| ✓ | /changelog | 200 | 514612 | 113 |  |
| ✓ | /contact | 200 | 46494 | 133 |  |
| ✓ | /hipaa | 200 | 62483 | 81 |  |
| ✓ | /press | 200 | 58841 | 83 |  |
| ✓ | /privacy | 200 | 55674 | 83 |  |
| ✓ | /provider | 200 | 86908 | 217 |  |
| ✓ | /provider?zip=92614&menopause=true&telehealth=true | 200 | 41417 | 12 |  |
| ✓ | /provider/1730155570?from=92614 | 200 | 37572 | 370 |  |
| ✓ | /research | 200 | 56696 | 107 |  |
| ✓ | /roadmap | 200 | 96077 | 116 |  |
| ✓ | /security | 200 | 71369 | 118 |  |
| ✓ | /terms | 200 | 56224 | 122 |  |
| ✓ | /proposal | 200 | 61052 | 129 |  |
| ✓ | /proposal/agent-fabric | 200 | 63547 | 130 |  |
| ✓ | /proposal/agentforce | 200 | 77700 | 140 |  |
| ✓ | /proposal/competition | 200 | 69919 | 134 |  |
| ✓ | /proposal/customers | 200 | 65564 | 134 |  |
| ✓ | /proposal/data | 200 | 74921 | 137 |  |
| ✓ | /proposal/data-360 | 200 | 105389 | 162 |  |
| ✓ | /proposal/dbdp | 200 | 81303 | 149 |  |
| ✓ | /proposal/full | 200 | 113634 | 150 |  |
| ✓ | /proposal/insights | 200 | 75729 | 145 |  |
| ✓ | /proposal/integration | 200 | 88219 | 146 |  |
| ✓ | /proposal/mcp | 200 | 88716 | 149 |  |
| ✓ | /proposal/menopause-society | 200 | 76306 | 152 |  |
| ✓ | /proposal/mulesoft | 200 | 79798 | 161 |  |
| ✓ | /proposal/provider-graph | 200 | 108493 | 184 |  |
| ✓ | /proposal/strategy | 200 | 75682 | 164 |  |
| ✓ | /proposal/technology | 200 | 75859 | 161 |  |
| ✓ | /demo/intake | 200 | 42231 | 259 |  |
| ✓ | /demo/patient | 200 | 40738 | 198 |  |
| ✓ | /demo/routing | 200 | 47330 | 201 |  |
| ✓ | /demo/agent-fabric | 200 | 37027 | 218 |  |
| ✓ | /demo/analytics | 200 | 42491 | 204 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 42403 | 15 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40910 | 17 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47502 | 13 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37368 | 12 |  |

## Internal links

102 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 3 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 4 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 174 | 145 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 4 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 4102 | 6 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3941 | 6 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1342 | 5 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 8 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 11 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 11 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 1915 | 13 | meta, query, matchType, sort, total, returned |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 165 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 632 | 151 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 152 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5515 | 450 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 5 | jsonrpc, id, result |  |

## MCP Streamable HTTP

| ✓/✗ | Probe | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | POST /api/mcp (initialize) | 200 | 194 | 297 | serverInfo=pause-health-mcp@0.3.0 tools=advertised |

