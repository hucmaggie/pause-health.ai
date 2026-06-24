# Smoke test results

Last run: 2026-06-24T09:34:22.185Z → 2026-06-24T09:34:33.717Z (12s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 166 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 58872 | 18 |  |
| ✓ | /about | 200 | 57448 | 97 |  |
| ✓ | /blog | 200 | 50795 | 73 |  |
| ✓ | /careers | 200 | 45304 | 81 |  |
| ✓ | /changelog | 200 | 555586 | 112 |  |
| ✓ | /contact | 200 | 46494 | 89 |  |
| ✓ | /hipaa | 200 | 62483 | 82 |  |
| ✓ | /press | 200 | 58841 | 88 |  |
| ✓ | /privacy | 200 | 55674 | 88 |  |
| ✓ | /provider | 200 | 86908 | 195 |  |
| ✓ | /provider?zip=92614&menopause=true&telehealth=true | 200 | 41417 | 13 |  |
| ✓ | /provider/1730155570?from=92614 | 200 | 37572 | 348 |  |
| ✓ | /research | 200 | 56696 | 109 |  |
| ✓ | /roadmap | 200 | 96077 | 138 |  |
| ✓ | /security | 200 | 71369 | 127 |  |
| ✓ | /terms | 200 | 56224 | 114 |  |
| ✓ | /proposal | 200 | 61052 | 118 |  |
| ✓ | /proposal/agent-fabric | 200 | 63547 | 129 |  |
| ✓ | /proposal/agentforce | 200 | 79175 | 134 |  |
| ✓ | /proposal/agentforce-voice | 200 | 66074 | 135 |  |
| ✓ | /proposal/headless-360 | 200 | 85316 | 19 |  |
| ✓ | /proposal/competition | 200 | 69919 | 132 |  |
| ✓ | /proposal/customers | 200 | 65564 | 139 |  |
| ✓ | /proposal/data | 200 | 74921 | 142 |  |
| ✓ | /proposal/data-360 | 200 | 106872 | 151 |  |
| ✓ | /proposal/dbdp | 200 | 81303 | 156 |  |
| ✓ | /proposal/full | 200 | 113634 | 158 |  |
| ✓ | /proposal/insights | 200 | 75729 | 169 |  |
| ✓ | /proposal/integration | 200 | 88219 | 195 |  |
| ✓ | /proposal/mcp | 200 | 98730 | 172 |  |
| ✓ | /proposal/menopause-society | 200 | 76306 | 165 |  |
| ✓ | /proposal/mulesoft | 200 | 79798 | 181 |  |
| ✓ | /proposal/provider-graph | 200 | 108493 | 180 |  |
| ✓ | /proposal/strategy | 200 | 75682 | 174 |  |
| ✓ | /proposal/technology | 200 | 75859 | 169 |  |
| ✓ | /demo/intake | 200 | 42231 | 241 |  |
| ✓ | /demo/patient | 200 | 40738 | 187 |  |
| ✓ | /demo/routing | 200 | 47330 | 196 |  |
| ✓ | /demo/agent-fabric | 200 | 37027 | 200 |  |
| ✓ | /demo/analytics | 200 | 42491 | 202 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 42403 | 14 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40910 | 13 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47502 | 16 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37368 | 14 |  |

## Internal links

104 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 6 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 10 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 174 | 152 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 4 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 4102 | 4 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3941 | 6 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1342 | 4 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 7 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 9 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 8 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 1915 | 12 | meta, query, matchType, sort, total, returned |  |
| ✓ | GET /api/agentforce/voice/config | 200 | 148 | 171 | meta, status |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 156 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 632 | 167 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 159 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5515 | 816 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 4 | jsonrpc, id, result |  |

## MCP Streamable HTTP

| ✓/✗ | Probe | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | POST /api/mcp (initialize) | 200 | 194 | 246 | serverInfo=pause-health-mcp@0.3.0 tools=advertised |

