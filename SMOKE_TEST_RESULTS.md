# Smoke test results

Last run: 2026-06-24T15:42:38.661Z → 2026-06-24T15:42:50.622Z (12s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 167 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 58872 | 17 |  |
| ✓ | /about | 200 | 57448 | 180 |  |
| ✓ | /blog | 200 | 50795 | 110 |  |
| ✓ | /careers | 200 | 45304 | 104 |  |
| ✓ | /changelog | 200 | 571573 | 138 |  |
| ✓ | /contact | 200 | 46494 | 198 |  |
| ✓ | /hipaa | 200 | 62483 | 103 |  |
| ✓ | /press | 200 | 58841 | 104 |  |
| ✓ | /privacy | 200 | 55674 | 102 |  |
| ✓ | /provider | 200 | 86521 | 36 |  |
| ✓ | /provider?zip=92614&menopause=true&telehealth=true | 200 | 41030 | 15 |  |
| ✓ | /provider/1730155570?from=92614 | 200 | 37572 | 391 |  |
| ✓ | /research | 200 | 56696 | 114 |  |
| ✓ | /roadmap | 200 | 96077 | 122 |  |
| ✓ | /security | 200 | 71369 | 124 |  |
| ✓ | /terms | 200 | 56224 | 119 |  |
| ✓ | /proposal | 200 | 61052 | 120 |  |
| ✓ | /proposal/agent-fabric | 200 | 63547 | 127 |  |
| ✓ | /proposal/agentforce | 200 | 79175 | 147 |  |
| ✓ | /proposal/agentforce-voice | 200 | 66074 | 139 |  |
| ✓ | /proposal/headless-360 | 200 | 87016 | 155 |  |
| ✓ | /proposal/competition | 200 | 69919 | 158 |  |
| ✓ | /proposal/customers | 200 | 65564 | 143 |  |
| ✓ | /proposal/data | 200 | 74921 | 145 |  |
| ✓ | /proposal/data-360 | 200 | 106872 | 149 |  |
| ✓ | /proposal/dbdp | 200 | 81303 | 149 |  |
| ✓ | /proposal/full | 200 | 113634 | 152 |  |
| ✓ | /proposal/insights | 200 | 75729 | 149 |  |
| ✓ | /proposal/integration | 200 | 88219 | 161 |  |
| ✓ | /proposal/mcp | 200 | 98730 | 171 |  |
| ✓ | /proposal/menopause-society | 200 | 76306 | 162 |  |
| ✓ | /proposal/mulesoft | 200 | 79798 | 183 |  |
| ✓ | /proposal/provider-graph | 200 | 108493 | 176 |  |
| ✓ | /proposal/strategy | 200 | 75682 | 172 |  |
| ✓ | /proposal/technology | 200 | 75859 | 177 |  |
| ✓ | /demo/intake | 200 | 42231 | 243 |  |
| ✓ | /demo/patient | 200 | 40738 | 224 |  |
| ✓ | /demo/routing | 200 | 47330 | 211 |  |
| ✓ | /demo/agent-fabric | 200 | 37027 | 206 |  |
| ✓ | /demo/analytics | 200 | 42491 | 212 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 42403 | 16 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40910 | 13 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47502 | 15 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37368 | 15 |  |

## Internal links

104 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 5 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 6 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 174 | 155 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 4 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 4102 | 5 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3941 | 5 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1342 | 5 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 6 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 9 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 7 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 1915 | 12 | meta, query, matchType, sort, total, returned |  |
| ✓ | GET /api/agentforce/voice/config | 200 | 148 | 180 | meta, status |  |
| ✓ | GET /api/salesforce/headless-360/config | 200 | 144 | 165 | meta, status |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 168 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 632 | 166 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 163 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5515 | 864 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 4 | jsonrpc, id, result |  |

## MCP Streamable HTTP

| ✓/✗ | Probe | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | POST /api/mcp (initialize) | 200 | 194 | 237 | serverInfo=pause-health-mcp@0.3.0 tools=advertised |

