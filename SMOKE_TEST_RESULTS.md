# Smoke test results

Last run: 2026-06-07T23:55:28.039Z → 2026-06-07T23:55:29.548Z (2s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 132 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 50645 | 18 |  |
| ✓ | /about | 200 | 52362 | 15 |  |
| ✓ | /blog | 200 | 50672 | 14 |  |
| ✓ | /careers | 200 | 45181 | 12 |  |
| ✓ | /changelog | 200 | 126507 | 17 |  |
| ✓ | /contact | 200 | 46371 | 15 |  |
| ✓ | /hipaa | 200 | 62360 | 14 |  |
| ✓ | /press | 200 | 58696 | 14 |  |
| ✓ | /privacy | 200 | 55551 | 14 |  |
| ✓ | /research | 200 | 56573 | 13 |  |
| ✓ | /roadmap | 200 | 79779 | 14 |  |
| ✓ | /security | 200 | 65950 | 14 |  |
| ✓ | /terms | 200 | 56101 | 13 |  |
| ✓ | /proposal | 200 | 60929 | 15 |  |
| ✓ | /proposal/agent-fabric | 200 | 63424 | 14 |  |
| ✓ | /proposal/agentforce | 200 | 76557 | 15 |  |
| ✓ | /proposal/competition | 200 | 69796 | 14 |  |
| ✓ | /proposal/customers | 200 | 65441 | 14 |  |
| ✓ | /proposal/data | 200 | 66426 | 13 |  |
| ✓ | /proposal/data-360 | 200 | 98857 | 15 |  |
| ✓ | /proposal/dbdp | 200 | 81180 | 16 |  |
| ✓ | /proposal/full | 200 | 106015 | 15 |  |
| ✓ | /proposal/insights | 200 | 75606 | 14 |  |
| ✓ | /proposal/integration | 200 | 80365 | 14 |  |
| ✓ | /proposal/mcp | 200 | 85962 | 14 |  |
| ✓ | /proposal/menopause-society | 200 | 76183 | 13 |  |
| ✓ | /proposal/mulesoft | 200 | 76390 | 16 |  |
| ✓ | /proposal/provider-graph | 200 | 83105 | 14 |  |
| ✓ | /proposal/strategy | 200 | 69793 | 14 |  |
| ✓ | /proposal/technology | 200 | 75736 | 15 |  |
| ✓ | /demo/intake | 200 | 45544 | 15 |  |
| ✓ | /demo/patient | 200 | 40615 | 13 |  |
| ✓ | /demo/routing | 200 | 47207 | 13 |  |
| ✓ | /demo/agent-fabric | 200 | 36904 | 13 |  |
| ✓ | /demo/analytics | 200 | 42368 | 15 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 45716 | 13 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40787 | 12 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47379 | 13 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37245 | 12 |  |

## Internal links

77 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 3 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 3 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 224 | 3 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 3 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 3988 | 5 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3826 | 6 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1291 | 4 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4566 | 3 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 5 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 5 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 816 | 6 | meta, query, total, returned, providers, provenance |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 9 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 631 | 8 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 6 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5400 | 13 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 5 | jsonrpc, id, result |  |

