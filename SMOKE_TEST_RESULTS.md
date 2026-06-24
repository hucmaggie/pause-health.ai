# Smoke test results

Last run: 2026-06-24T07:40:57.878Z → 2026-06-24T07:41:07.523Z (10s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 161 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 58872 | 18 |  |
| ✓ | /about | 200 | 54653 | 13 |  |
| ✓ | /blog | 200 | 50795 | 187 |  |
| ✓ | /careers | 200 | 45304 | 70 |  |
| ✓ | /changelog | 200 | 535596 | 115 |  |
| ✓ | /contact | 200 | 46494 | 153 |  |
| ✓ | /hipaa | 200 | 62483 | 73 |  |
| ✓ | /press | 200 | 58841 | 72 |  |
| ✓ | /privacy | 200 | 55674 | 72 |  |
| ✓ | /provider | 200 | 86908 | 201 |  |
| ✓ | /provider?zip=92614&menopause=true&telehealth=true | 200 | 41417 | 12 |  |
| ✓ | /provider/1730155570?from=92614 | 200 | 37572 | 370 |  |
| ✓ | /research | 200 | 56696 | 91 |  |
| ✓ | /roadmap | 200 | 96077 | 101 |  |
| ✓ | /security | 200 | 71369 | 105 |  |
| ✓ | /terms | 200 | 56224 | 104 |  |
| ✓ | /proposal | 200 | 61052 | 103 |  |
| ✓ | /proposal/agent-fabric | 200 | 63547 | 108 |  |
| ✓ | /proposal/agentforce | 200 | 77700 | 129 |  |
| ✓ | /proposal/competition | 200 | 69919 | 117 |  |
| ✓ | /proposal/customers | 200 | 65564 | 118 |  |
| ✓ | /proposal/data | 200 | 74921 | 122 |  |
| ✓ | /proposal/data-360 | 200 | 105389 | 129 |  |
| ✓ | /proposal/dbdp | 200 | 81303 | 126 |  |
| ✓ | /proposal/full | 200 | 113634 | 125 |  |
| ✓ | /proposal/insights | 200 | 75729 | 131 |  |
| ✓ | /proposal/integration | 200 | 88219 | 130 |  |
| ✓ | /proposal/mcp | 200 | 97234 | 152 |  |
| ✓ | /proposal/menopause-society | 200 | 76306 | 150 |  |
| ✓ | /proposal/mulesoft | 200 | 79798 | 155 |  |
| ✓ | /proposal/provider-graph | 200 | 108493 | 162 |  |
| ✓ | /proposal/strategy | 200 | 75682 | 160 |  |
| ✓ | /proposal/technology | 200 | 75859 | 156 |  |
| ✓ | /demo/intake | 200 | 42231 | 192 |  |
| ✓ | /demo/patient | 200 | 40738 | 154 |  |
| ✓ | /demo/routing | 200 | 47330 | 172 |  |
| ✓ | /demo/agent-fabric | 200 | 37027 | 165 |  |
| ✓ | /demo/analytics | 200 | 42491 | 164 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 42403 | 15 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40910 | 15 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47502 | 13 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37368 | 14 |  |

## Internal links

102 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 4 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 6 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 174 | 129 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 6 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 4102 | 5 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3941 | 5 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1342 | 5 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 7 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 6 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 8 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 1915 | 14 | meta, query, matchType, sort, total, returned |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 152 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 632 | 139 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 143 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5515 | 474 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 8 | jsonrpc, id, result |  |

## MCP Streamable HTTP

| ✓/✗ | Probe | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | POST /api/mcp (initialize) | 200 | 194 | 231 | serverInfo=pause-health-mcp@0.3.0 tools=advertised |

