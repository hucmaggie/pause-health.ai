# Smoke test results

Last run: 2026-06-26T05:07:07.345Z → 2026-06-26T05:07:19.189Z (12s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 167 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 58872 | 18 |  |
| ✓ | /about | 200 | 57448 | 165 |  |
| ✓ | /blog | 200 | 50795 | 90 |  |
| ✓ | /careers | 200 | 45304 | 90 |  |
| ✓ | /changelog | 200 | 576890 | 127 |  |
| ✓ | /contact | 200 | 46494 | 165 |  |
| ✓ | /hipaa | 200 | 62483 | 100 |  |
| ✓ | /press | 200 | 58841 | 102 |  |
| ✓ | /privacy | 200 | 55674 | 102 |  |
| ✓ | /provider | 200 | 86521 | 23 |  |
| ✓ | /provider?zip=92614&menopause=true&telehealth=true | 200 | 41030 | 11 |  |
| ✓ | /provider/1730155570?from=92614 | 200 | 37572 | 349 |  |
| ✓ | /research | 200 | 56696 | 108 |  |
| ✓ | /roadmap | 200 | 96077 | 113 |  |
| ✓ | /security | 200 | 71369 | 116 |  |
| ✓ | /terms | 200 | 56224 | 125 |  |
| ✓ | /proposal | 200 | 61052 | 120 |  |
| ✓ | /proposal/agent-fabric | 200 | 63547 | 129 |  |
| ✓ | /proposal/agentforce | 200 | 79175 | 132 |  |
| ✓ | /proposal/agentforce-voice | 200 | 66074 | 141 |  |
| ✓ | /proposal/headless-360 | 200 | 87016 | 175 |  |
| ✓ | /proposal/competition | 200 | 69919 | 143 |  |
| ✓ | /proposal/customers | 200 | 65564 | 141 |  |
| ✓ | /proposal/data | 200 | 74921 | 141 |  |
| ✓ | /proposal/data-360 | 200 | 106872 | 147 |  |
| ✓ | /proposal/dbdp | 200 | 81303 | 146 |  |
| ✓ | /proposal/full | 200 | 113634 | 156 |  |
| ✓ | /proposal/insights | 200 | 75729 | 149 |  |
| ✓ | /proposal/integration | 200 | 88219 | 159 |  |
| ✓ | /proposal/mcp | 200 | 98730 | 162 |  |
| ✓ | /proposal/menopause-society | 200 | 76306 | 162 |  |
| ✓ | /proposal/mulesoft | 200 | 79798 | 188 |  |
| ✓ | /proposal/provider-graph | 200 | 108493 | 181 |  |
| ✓ | /proposal/strategy | 200 | 75682 | 169 |  |
| ✓ | /proposal/technology | 200 | 75859 | 179 |  |
| ✓ | /demo/intake | 200 | 42231 | 269 |  |
| ✓ | /demo/patient | 200 | 40738 | 209 |  |
| ✓ | /demo/routing | 200 | 47330 | 200 |  |
| ✓ | /demo/agent-fabric | 200 | 37027 | 199 |  |
| ✓ | /demo/analytics | 200 | 42491 | 195 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 42403 | 14 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40910 | 14 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47502 | 14 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37368 | 15 |  |

## Internal links

104 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 5 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 4 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 174 | 157 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 4 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 4102 | 6 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3941 | 6 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1342 | 4 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 11 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 8 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 7 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 1915 | 12 | meta, query, matchType, sort, total, returned |  |
| ✓ | GET /api/agentforce/voice/config | 200 | 148 | 179 | meta, status |  |
| ✓ | GET /api/salesforce/headless-360/config | 200 | 144 | 170 | meta, status |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 163 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 632 | 166 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 163 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5515 | 871 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 5 | jsonrpc, id, result |  |

## MCP Streamable HTTP

| ✓/✗ | Probe | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | POST /api/mcp (initialize) | 200 | 194 | 254 | serverInfo=pause-health-mcp@0.3.0 tools=advertised |

