# Smoke test results

Last run: 2026-06-26T06:32:35.229Z → 2026-06-26T06:32:46.667Z (11s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 168 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 58872 | 17 |  |
| ✓ | /about | 200 | 57448 | 89 |  |
| ✓ | /blog | 200 | 50795 | 73 |  |
| ✓ | /careers | 200 | 45304 | 76 |  |
| ✓ | /changelog | 200 | 585538 | 114 |  |
| ✓ | /contact | 200 | 46494 | 91 |  |
| ✓ | /hipaa | 200 | 62483 | 84 |  |
| ✓ | /press | 200 | 58841 | 93 |  |
| ✓ | /privacy | 200 | 55674 | 87 |  |
| ✓ | /provider | 200 | 86521 | 221 |  |
| ✓ | /provider?zip=92614&menopause=true&telehealth=true | 200 | 41030 | 14 |  |
| ✓ | /provider/1730155570?from=92614 | 200 | 37572 | 351 |  |
| ✓ | /research | 200 | 56696 | 110 |  |
| ✓ | /roadmap | 200 | 96077 | 118 |  |
| ✓ | /security | 200 | 71369 | 119 |  |
| ✓ | /terms | 200 | 56224 | 135 |  |
| ✓ | /proposal | 200 | 61052 | 121 |  |
| ✓ | /proposal/agent-fabric | 200 | 63547 | 156 |  |
| ✓ | /proposal/agentforce | 200 | 79175 | 137 |  |
| ✓ | /proposal/agentforce-voice | 200 | 66074 | 144 |  |
| ✓ | /proposal/headless-360 | 200 | 88726 | 157 |  |
| ✓ | /proposal/competition | 200 | 69919 | 144 |  |
| ✓ | /proposal/customers | 200 | 65564 | 145 |  |
| ✓ | /proposal/data | 200 | 74921 | 140 |  |
| ✓ | /proposal/data-360 | 200 | 106872 | 149 |  |
| ✓ | /proposal/dbdp | 200 | 81303 | 148 |  |
| ✓ | /proposal/full | 200 | 128129 | 17 |  |
| ✓ | /proposal/insights | 200 | 75729 | 148 |  |
| ✓ | /proposal/integration | 200 | 88219 | 152 |  |
| ✓ | /proposal/mcp | 200 | 98730 | 160 |  |
| ✓ | /proposal/menopause-society | 200 | 76306 | 166 |  |
| ✓ | /proposal/mulesoft | 200 | 79798 | 260 |  |
| ✓ | /proposal/provider-graph | 200 | 108493 | 172 |  |
| ✓ | /proposal/strategy | 200 | 75682 | 168 |  |
| ✓ | /proposal/technology | 200 | 75859 | 177 |  |
| ✓ | /demo/intake | 200 | 42231 | 249 |  |
| ✓ | /demo/patient | 200 | 40738 | 195 |  |
| ✓ | /demo/routing | 200 | 47330 | 193 |  |
| ✓ | /demo/agent-fabric | 200 | 37027 | 207 |  |
| ✓ | /demo/analytics | 200 | 42491 | 192 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 42403 | 16 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40910 | 15 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47502 | 16 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37368 | 14 |  |

## Internal links

104 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 6 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 4 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 174 | 150 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 6 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 4102 | 6 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3941 | 7 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1342 | 6 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 10 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 7 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 7 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 1915 | 12 | meta, query, matchType, sort, total, returned |  |
| ✓ | GET /api/agentforce/voice/config | 200 | 148 | 176 | meta, status |  |
| ✓ | GET /api/salesforce/headless-360/config | 200 | 144 | 160 | meta, status |  |
| ✓ | GET /api/agent-fabric/sf-sink/config | 200 | 223 | 157 | meta, status, counters |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 158 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 632 | 164 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 162 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5515 | 488 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 4 | jsonrpc, id, result |  |

## MCP Streamable HTTP

| ✓/✗ | Probe | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | POST /api/mcp (initialize) | 200 | 194 | 247 | serverInfo=pause-health-mcp@0.3.0 tools=advertised |

