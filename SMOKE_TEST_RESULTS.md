# Smoke test results

Last run: 2026-06-26T05:00:25.514Z → 2026-06-26T05:00:37.578Z (12s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 167 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 58872 | 18 |  |
| ✓ | /about | 200 | 57448 | 159 |  |
| ✓ | /blog | 200 | 50795 | 91 |  |
| ✓ | /careers | 200 | 45304 | 91 |  |
| ✓ | /changelog | 200 | 576890 | 129 |  |
| ✓ | /contact | 200 | 46494 | 193 |  |
| ✓ | /hipaa | 200 | 62483 | 107 |  |
| ✓ | /press | 200 | 58841 | 108 |  |
| ✓ | /privacy | 200 | 55674 | 106 |  |
| ✓ | /provider | 200 | 86521 | 36 |  |
| ✓ | /provider?zip=92614&menopause=true&telehealth=true | 200 | 41030 | 13 |  |
| ✓ | /provider/1730155570?from=92614 | 200 | 37572 | 371 |  |
| ✓ | /research | 200 | 56696 | 106 |  |
| ✓ | /roadmap | 200 | 96077 | 117 |  |
| ✓ | /security | 200 | 71369 | 118 |  |
| ✓ | /terms | 200 | 56224 | 117 |  |
| ✓ | /proposal | 200 | 61052 | 120 |  |
| ✓ | /proposal/agent-fabric | 200 | 63547 | 136 |  |
| ✓ | /proposal/agentforce | 200 | 79175 | 134 |  |
| ✓ | /proposal/agentforce-voice | 200 | 66074 | 146 |  |
| ✓ | /proposal/headless-360 | 200 | 87016 | 163 |  |
| ✓ | /proposal/competition | 200 | 69919 | 151 |  |
| ✓ | /proposal/customers | 200 | 65564 | 149 |  |
| ✓ | /proposal/data | 200 | 74921 | 141 |  |
| ✓ | /proposal/data-360 | 200 | 106872 | 153 |  |
| ✓ | /proposal/dbdp | 200 | 81303 | 153 |  |
| ✓ | /proposal/full | 200 | 113634 | 154 |  |
| ✓ | /proposal/insights | 200 | 75729 | 156 |  |
| ✓ | /proposal/integration | 200 | 88219 | 163 |  |
| ✓ | /proposal/mcp | 200 | 98730 | 165 |  |
| ✓ | /proposal/menopause-society | 200 | 76306 | 171 |  |
| ✓ | /proposal/mulesoft | 200 | 79798 | 190 |  |
| ✓ | /proposal/provider-graph | 200 | 108493 | 183 |  |
| ✓ | /proposal/strategy | 200 | 75682 | 186 |  |
| ✓ | /proposal/technology | 200 | 75859 | 187 |  |
| ✓ | /demo/intake | 200 | 42231 | 269 |  |
| ✓ | /demo/patient | 200 | 40738 | 254 |  |
| ✓ | /demo/routing | 200 | 47330 | 210 |  |
| ✓ | /demo/agent-fabric | 200 | 37027 | 208 |  |
| ✓ | /demo/analytics | 200 | 42491 | 200 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 42403 | 16 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40910 | 16 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47502 | 15 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37368 | 14 |  |

## Internal links

104 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 4 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 4 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 174 | 158 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 4 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 4102 | 5 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3941 | 6 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1342 | 5 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 10 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 7 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 6 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 1915 | 12 | meta, query, matchType, sort, total, returned |  |
| ✓ | GET /api/agentforce/voice/config | 200 | 148 | 181 | meta, status |  |
| ✓ | GET /api/salesforce/headless-360/config | 200 | 144 | 165 | meta, status |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 159 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 632 | 168 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 165 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5515 | 814 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 6 | jsonrpc, id, result |  |

## MCP Streamable HTTP

| ✓/✗ | Probe | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | POST /api/mcp (initialize) | 200 | 194 | 261 | serverInfo=pause-health-mcp@0.3.0 tools=advertised |

