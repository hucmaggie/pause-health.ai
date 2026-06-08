# Smoke test results

Last run: 2026-06-08T01:31:51.837Z → 2026-06-08T01:32:06.980Z (15s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 132 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 50879 | 18 |  |
| ✓ | /about | 200 | 52362 | 152 |  |
| ✓ | /blog | 200 | 50672 | 83 |  |
| ✓ | /careers | 200 | 45181 | 85 |  |
| ✓ | /changelog | 200 | 148591 | 95 |  |
| ✓ | /contact | 200 | 46371 | 164 |  |
| ✓ | /hipaa | 200 | 62360 | 84 |  |
| ✓ | /press | 200 | 58696 | 84 |  |
| ✓ | /privacy | 200 | 55551 | 86 |  |
| ✓ | /research | 200 | 56573 | 86 |  |
| ✓ | /roadmap | 200 | 80958 | 89 |  |
| ✓ | /security | 200 | 65950 | 91 |  |
| ✓ | /terms | 200 | 56101 | 93 |  |
| ✓ | /proposal | 200 | 60929 | 95 |  |
| ✓ | /proposal/agent-fabric | 200 | 63424 | 98 |  |
| ✓ | /proposal/agentforce | 200 | 76557 | 105 |  |
| ✓ | /proposal/competition | 200 | 69796 | 105 |  |
| ✓ | /proposal/customers | 200 | 65441 | 108 |  |
| ✓ | /proposal/data | 200 | 66426 | 109 |  |
| ✓ | /proposal/data-360 | 200 | 98857 | 120 |  |
| ✓ | /proposal/dbdp | 200 | 81180 | 118 |  |
| ✓ | /proposal/full | 200 | 106015 | 127 |  |
| ✓ | /proposal/insights | 200 | 75606 | 122 |  |
| ✓ | /proposal/integration | 200 | 81788 | 123 |  |
| ✓ | /proposal/mcp | 200 | 85962 | 154 |  |
| ✓ | /proposal/menopause-society | 200 | 76183 | 134 |  |
| ✓ | /proposal/mulesoft | 200 | 78238 | 141 |  |
| ✓ | /proposal/provider-graph | 200 | 83105 | 138 |  |
| ✓ | /proposal/strategy | 200 | 69793 | 141 |  |
| ✓ | /proposal/technology | 200 | 75736 | 142 |  |
| ✓ | /demo/intake | 200 | 45536 | 197 |  |
| ✓ | /demo/patient | 200 | 40615 | 156 |  |
| ✓ | /demo/routing | 200 | 47207 | 162 |  |
| ✓ | /demo/agent-fabric | 200 | 36904 | 172 |  |
| ✓ | /demo/analytics | 200 | 42368 | 190 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 45708 | 18 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40787 | 15 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47379 | 15 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37245 | 17 |  |

## Internal links

77 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 5 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 8 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 174 | 123 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 4 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 3988 | 4 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3805 | 1083 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1288 | 1416 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 13 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 11 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 8 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 816 | 19 | meta, query, total, returned, providers, provenance |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 147 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 530 | 639 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 148 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5293 | 1581 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 4 | jsonrpc, id, result |  |

