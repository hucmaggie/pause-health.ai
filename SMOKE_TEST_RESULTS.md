# Smoke test results

Last run: 2026-06-24T06:03:35.608Z → 2026-06-24T06:03:45.576Z (10s elapsed)

Target: `http://localhost:3000`

Run via `node frontend/scripts/smoke-test.mjs` against a local dev server, or set `BASE_URL=https://pause-health.ai` to smoke production. Source: [`frontend/scripts/smoke-test.mjs`](./frontend/scripts/smoke-test.mjs).

**Summary:** 160 pass · 0 warn · 0 fail

## Static pages

| ✓/✗ | Route | Status | Bytes | ms | Notes |
|---|---|---|---|---|---|
| ✓ | / | 200 | 58872 | 16 |  |
| ✓ | /about | 200 | 52491 | 113 |  |
| ✓ | /blog | 200 | 50795 | 71 |  |
| ✓ | /careers | 200 | 45304 | 66 |  |
| ✓ | /changelog | 200 | 503724 | 99 |  |
| ✓ | /contact | 200 | 46494 | 177 |  |
| ✓ | /hipaa | 200 | 62483 | 83 |  |
| ✓ | /press | 200 | 58841 | 83 |  |
| ✓ | /privacy | 200 | 55674 | 85 |  |
| ✓ | /provider | 200 | 86908 | 189 |  |
| ✓ | /provider?zip=92614&menopause=true&telehealth=true | 200 | 41417 | 13 |  |
| ✓ | /provider/1730155570?from=92614 | 200 | 37572 | 355 |  |
| ✓ | /research | 200 | 56696 | 100 |  |
| ✓ | /roadmap | 200 | 95939 | 108 |  |
| ✓ | /security | 200 | 71369 | 117 |  |
| ✓ | /terms | 200 | 56224 | 118 |  |
| ✓ | /proposal | 200 | 61052 | 118 |  |
| ✓ | /proposal/agent-fabric | 200 | 63547 | 144 |  |
| ✓ | /proposal/agentforce | 200 | 77414 | 134 |  |
| ✓ | /proposal/competition | 200 | 69919 | 129 |  |
| ✓ | /proposal/customers | 200 | 65564 | 126 |  |
| ✓ | /proposal/data | 200 | 74921 | 135 |  |
| ✓ | /proposal/data-360 | 200 | 105389 | 137 |  |
| ✓ | /proposal/dbdp | 200 | 81303 | 138 |  |
| ✓ | /proposal/full | 200 | 113634 | 146 |  |
| ✓ | /proposal/insights | 200 | 75729 | 142 |  |
| ✓ | /proposal/integration | 200 | 88219 | 146 |  |
| ✓ | /proposal/mcp | 200 | 86085 | 159 |  |
| ✓ | /proposal/menopause-society | 200 | 76306 | 159 |  |
| ✓ | /proposal/mulesoft | 200 | 79798 | 163 |  |
| ✓ | /proposal/provider-graph | 200 | 108493 | 160 |  |
| ✓ | /proposal/strategy | 200 | 75682 | 152 |  |
| ✓ | /proposal/technology | 200 | 75859 | 188 |  |
| ✓ | /demo/intake | 200 | 42231 | 248 |  |
| ✓ | /demo/patient | 200 | 40738 | 182 |  |
| ✓ | /demo/routing | 200 | 47330 | 190 |  |
| ✓ | /demo/agent-fabric | 200 | 37027 | 211 |  |
| ✓ | /demo/analytics | 200 | 42491 | 190 |  |
| ✓ | /demo/intake?personaId=anika-patel | 200 | 42403 | 15 |  |
| ✓ | /demo/patient?personaId=anika-patel | 200 | 40910 | 14 |  |
| ✓ | /demo/routing?personaId=anika-patel | 200 | 47502 | 15 |  |
| ✓ | /demo/agent-fabric?personaId=anika-patel | 200 | 37368 | 11 |  |

## Internal links

102 link(s) resolve (200/OK); 0 broken or unexpected.

## API endpoints

| ✓/✗ | Endpoint | Status | Bytes | ms | Shape | Notes |
|---|---|---|---|---|---|---|
| ✓ | GET /api/agent-fabric/agents | 200 | 3419 | 4 | meta, agents |  |
| ✓ | GET /api/agent-fabric/policies | 200 | 5255 | 6 | meta, policies |  |
| ✓ | GET /api/agent-fabric/traces | 200 | 174 | 153 | meta, recentTaskIds |  |
| ✓ | GET /api/data-360/segments | 200 | 2093 | 18 | meta, segments |  |
| ✓ | GET /api/data-360/patient/[id]/record | 200 | 4102 | 6 | meta, record |  |
| ✓ | GET /api/data-360/patient/[id]/grounding | 200 | 3941 | 6 | meta, grounding |  |
| ✓ | GET /api/intake/prechat-context?personaId=anika-patel | 200 | 1342 | 4 | meta, prechatFields |  |
| ✓ | GET /api/mulesoft/health | 200 | 4576 | 8 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/timeline | 200 | 4708 | 8 | meta, bundle |  |
| ✓ | GET /api/mulesoft/patient/[id]/intake | 200 | 1748 | 7 | meta, intake |  |
| ✓ | GET /api/mulesoft/providers?zip=10001 | 200 | 1915 | 11 | meta, query, matchType, sort, total, returned |  |
| ✓ | GET /api/agents/care-router/.well-known/agent.json | 200 | 1413 | 177 | name, description, url, provider, version, capabilities |  |
| ✓ | POST /api/data-360/identity/resolve | 200 | 632 | 151 | meta, resolution |  |
| ✓ | POST /api/agent-fabric/governance/evaluate (pass) | 200 | 2723 | 153 | meta, result |  |
| ✓ | POST /api/intake/route-to-care-router | 200 | 5515 | 434 | meta, taskId, sessionId, task, decision, data360 |  |
| ✓ | POST /api/agents/care-router/tasks (A2A JSON-RPC) | 200 | 1015 | 4 | jsonrpc, id, result |  |

