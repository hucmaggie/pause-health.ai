# Smoke test results

Last run: 2026-06-26T05:33:58.684Z → 2026-06-26T05:34:10.552Z (12s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 168 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 58872 | 17 |  |
| ✓ | /about | 200 | 57448 | 143 |  |
| ✓ | /blog | 200 | 50795 | 107 |  |
| ✓ | /careers | 200 | 45304 | 102 |  |
| ✓ | /changelog | 200 | 576890 | 141 |  |
| ✓ | /contact | 200 | 46494 | 133 |  |
| ✓ | /hipaa | 200 | 62483 | 116 |  |
| ✓ | /press | 200 | 58841 | 117 |  |
| ✓ | /privacy | 200 | 55674 | 115 |  |
| ✓ | /provider | 200 | 86521 | 136 |  |
| ✓ | /provider?zip=92614&menopause=true&telehealth=true | 200 | 41030 | 13 |  |
| ✓ | /provider/1730155570?from=92614 | 200 | 37572 | 350 |  |
| ✓ | /research | 200 | 56696 | 124 |  |
| ✓ | /roadmap | 200 | 96077 | 127 |  |
| ✓ | /security | 200 | 71369 | 135 |  |
| ✓ | /terms | 200 | 56224 | 134 |  |
| ✓ | /proposal | 200 | 61052 | 138 |  |
| ✓ | /proposal/agent-fabric | 200 | 63547 | 152 |  |
| ✓ | /proposal/agentforce | 200 | 79175 | 145 |  |
| ✓ | /proposal/agentforce-voice | 200 | 66074 | 156 |  |
| ✓ | /proposal/headless-360 | 200 | 88726 | 17 |  |
| ✓ | /proposal/competition | 200 | 69919 | 161 |  |
| ✓ | /proposal/customers | 200 | 65564 | 159 |  |
| ✓ | /proposal/data | 200 | 74921 | 157 |  |
| ✓ | /proposal/data-360 | 200 | 106872 | 162 |  |
| ✓ | /proposal/dbdp | 200 | 81303 | 172 |  |
| ✓ | /proposal/full | 200 | 113634 | 168 |  |
| ✓ | /proposal/insights | 200 | 75729 | 164 |  |
| ✓ | /proposal/integration | 200 | 88219 | 216 |  |
| ✓ | /proposal/mcp | 200 | 98730 | 185 |  |
| ✓ | /proposal/menopause-society | 200 | 76306 | 178 |  |
| ✓ | /proposal/mulesoft | 200 | 79798 | 189 |  |
| ✓ | /proposal/provider-graph | 200 | 108493 | 237 |  |
| ✓ | /proposal/strategy | 200 | 75682 | 200 |  |
| ✓ | /proposal/technology | 200 | 75859 | 191 |  |
| ✓ | /demo/intake | 200 | 42231 | 268 |  |
| ✓ | /demo/patient | 200 | 40738 | 212 |  |
| ✓ | /demo/routing | 200 | 47330 | 215 |  |
| ✓ | /demo/agent-fabric | 200 | 37027 | 210 |  |
| ✓ | /demo/analytics | 200 | 42491 | 224 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 42403 | 14 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40910 | 15 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47502 | 13 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37368 | 14 |  |

## Internal links

104 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 6 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 5 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 191 | 168 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 4 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 4102 | 4 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3941 | 6 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1342 | 5 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 7 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 10 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 7 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 1915 | 12 | meta, query, matchType, sort, total, returned |  |
| ✓ | GET /api/agentforce/voice/config | 200 | 148 | 191 | meta, status |  |
| ✓ | GET /api/salesforce/headless-360/config | 200 | 144 | 181 | meta, status |  |
| ✓ | GET /api/agent-fabric/sf-sink/config | 200 | 223 | 6 | meta, status, counters |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 183 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 632 | 194 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 179 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5515 | 247 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 5 | jsonrpc, id, result |  |

## MCP Streamable HTTP

| ✓/✗ | Probe | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | POST /api/mcp (initialize) | 200 | 194 | 223 | serverInfo=pause-health-mcp@0.3.0 tools=advertised |

