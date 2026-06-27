# @pause-health/cli

Salesforce-style CLI for the Pause-Health.ai Experience APIs. Wraps the
same `/api/mulesoft/*` surface that the [Pause MCP server](../mcp/) exposes
as agent tools — so an operator gets byte-identical results to what an
agent gets.

This package closes audit gap #4 ("Salesforce CLI parity for Pause tools")
on [`/proposal/headless-360`](https://pause-health.ai/proposal/headless-360).
The Salesforce Headless 360 trust model exposes every agent capability
through three surfaces: REST API, MCP tool, AND `sf` CLI command. Pause
shipped REST + MCP during the prototype build-out; `pause` is the third
surface.

## Install

```bash
cd cli
npm install
npm run build
# Optional: link globally for ad-hoc use
npm link
```

Once linked, `pause --help` works from any directory.

## Usage

```
pause health
pause providers --zip 92614 --menopause --limit 3
pause providers --zip 92614 --menopause --insurance aetna --telehealth
pause timeline pause-demo-patient-001
pause intake pause-demo-patient-001
```

Add `--json` to any command for the raw API response (pipe into `jq`).

## Configuration

| | |
|---|---|
| `PAUSE_BASE_URL` | API base URL. Defaults to `https://pause-health.ai`. Override with `--base-url` per invocation. |
| `PAUSE_API_KEY` | Optional Bearer token. When set, sent as `Authorization: Bearer ...` on every request. |

Set `PAUSE_BASE_URL=http://localhost:3000` to hit a local dev server.

## Commands

### `pause health`

Calls `GET /api/mulesoft/health`. Returns a FHIR R5 Bundle with the demo
patient timeline.

### `pause providers [options]`

Calls `GET /api/mulesoft/providers`. Same options as the MCP
`find_menopause_providers` tool:

| Flag | Maps to query param |
|---|---|
| `--zip <zip>` | `?zip=<zip>` |
| `--menopause` | `?menopause=true` (narrows to MSCP-certified) |
| `--limit <n>` | `?limit=<n>` |
| `--fallback` | `?fallback=true` (opens the relevant-local → certified-remote ladder when certified-local is empty) |
| `--insurance <plan>` | `?insurance=<plan>` (lowercased canonical token: `aetna`, `bcbs`, `cigna`, `humana`, `kaiser`, `medicaid`, `medicare`, `uhc`) |
| `--telehealth` | `?telehealth=true` (narrows to telehealth-capable providers) |

### `pause timeline <patient-id>`

Calls `GET /api/mulesoft/patient/<id>/timeline`. Returns the per-patient
FHIR Bundle.

### `pause intake <patient-id>`

Calls `GET /api/mulesoft/patient/<id>/intake`. Returns the structured
intake record produced by Agentforce.

## What's NOT in scope

- **Write commands.** The Experience APIs are read-only today. When
  Phase 1c ships a write-capable Process API
  (`pause-ingest-process-api`), the CLI grows `pause intake create` and
  friends.
- **Auth flow.** The CLI inherits `PAUSE_API_KEY` from env; it does not
  walk an OAuth flow. When the Headless 360 PKCE seam (audit gap #1)
  ships its activation step, this package grows `pause auth login`
  that walks the same Authorization Code + PKCE handshake the
  `/api/salesforce/headless-360/*` routes implement.
- **Publishing to npm.** This package is `"private": true` until a
  product decision is made about ownership of the `@pause-health` npm
  scope. Gap #4 of the audit ships the artifact; npm publish is a
  separate ops step.

## Development

```bash
npm install
npm test              # unit tests (parser + client)
npm run build         # tsc -> dist/
npm run smoke         # exercises the built bin against the live Experience APIs
npm run dev -- health # tsx-based hot-reload during development
```

## Related

- [Pause MCP server](../mcp/) — same Experience API contract, MCP transport.
- [`/proposal/headless-360`](https://pause-health.ai/proposal/headless-360)
  — the audit gap this closes.
- [`docs/HEADLESS_360_RUNBOOK.md`](../docs/HEADLESS_360_RUNBOOK.md) —
  procurement-side activation runbook.
