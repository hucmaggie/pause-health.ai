# Smoke test results

Last run: 2026-06-08T01:01:31.014Z → 2026-06-08T01:01:37.589Z (7s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 132 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 50645 | 18 |  |
| ✓ | /about | 200 | 52362 | 167 |  |
| ✓ | /blog | 200 | 50672 | 51 |  |
| ✓ | /careers | 200 | 45181 | 47 |  |
| ✓ | /changelog | 200 | 138524 | 112 |  |
| ✓ | /contact | 200 | 46371 | 84 |  |
| ✓ | /hipaa | 200 | 62360 | 59 |  |
| ✓ | /press | 200 | 58696 | 58 |  |
| ✓ | /privacy | 200 | 55551 | 66 |  |
| ✓ | /research | 200 | 56573 | 62 |  |
| ✓ | /roadmap | 200 | 80413 | 75 |  |
| ✓ | /security | 200 | 65950 | 69 |  |
| ✓ | /terms | 200 | 56101 | 67 |  |
| ✓ | /proposal | 200 | 60929 | 73 |  |
| ✓ | /proposal/agent-fabric | 200 | 63424 | 78 |  |
| ✓ | /proposal/agentforce | 200 | 76557 | 78 |  |
| ✓ | /proposal/competition | 200 | 69796 | 81 |  |
| ✓ | /proposal/customers | 200 | 65441 | 101 |  |
| ✓ | /proposal/data | 200 | 66426 | 104 |  |
| ✓ | /proposal/data-360 | 200 | 98857 | 87 |  |
| ✓ | /proposal/dbdp | 200 | 81180 | 89 |  |
| ✓ | /proposal/full | 200 | 106015 | 98 |  |
| ✓ | /proposal/insights | 200 | 75606 | 95 |  |
| ✓ | /proposal/integration | 200 | 81788 | 114 |  |
| ✓ | /proposal/mcp | 200 | 85962 | 103 |  |
| ✓ | /proposal/menopause-society | 200 | 76183 | 104 |  |
| ✓ | /proposal/mulesoft | 200 | 76390 | 104 |  |
| ✓ | /proposal/provider-graph | 200 | 83105 | 108 |  |
| ✓ | /proposal/strategy | 200 | 69793 | 111 |  |
| ✓ | /proposal/technology | 200 | 75736 | 113 |  |
| ✓ | /demo/intake | 200 | 45536 | 159 |  |
| ✓ | /demo/patient | 200 | 40615 | 124 |  |
| ✓ | /demo/routing | 200 | 47207 | 134 |  |
| ✓ | /demo/agent-fabric | 200 | 36904 | 134 |  |
| ✓ | /demo/analytics | 200 | 42368 | 137 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 45708 | 22 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40787 | 22 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47379 | 18 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37245 | 16 |  |

## Internal links

77 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 6 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 5 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 259 | 117 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 5 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 3988 | 9 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3826 | 9 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1291 | 7 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4566 | 4 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 5 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 6 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 816 | 6 | meta, query, total, returned, providers, provenance |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 133 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 631 | 169 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 126 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5400 | 283 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 7 | jsonrpc, id, result |  |

