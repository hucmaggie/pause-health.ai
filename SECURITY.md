# Security Policy

Pause-Health.ai is a **prototype-in-the-open**. This document explains what
"security" means for the source code in this repository today, how to report
vulnerabilities, and how that posture is expected to evolve as we approach a
production deployment.

## What this repository is — and isn't

This repo holds:

- A **Next.js marketing site + investor brief + clickable demo** (`frontend/`).
  Deployed at https://pause-health.ai. Collects newsletter signups and
  contact-form submissions. Does **not** collect PHI. Does **not** route real
  clinical traffic.
- A **Python wearable-ingest worker** (`pause_ingest/`). Has unit tests but is
  not deployed anywhere today.
- A **MuleSoft Anypoint reference artifact set** (`mulesoft/`). XML + DataWeave
  files, not running anywhere.
- An **MCP server** (`mcp/`). Wraps mocked Experience APIs. No PHI.

The full production-posture roadmap — HIPAA Security Rule controls, BAA scope,
SOC 2 Type II timeline, HITRUST CSF target, encryption-at-rest, identity &
access, vulnerability management — lives at
[**/security**](https://pause-health.ai/security) on the deployed site.
That page is the source of truth for "what's designed for production."
This document is scoped narrowly to the **source code in this GitHub repo**.

## Reporting a vulnerability

Please use **GitHub's Private Vulnerability Reporting** for any
security issue:

1. Go to the [Security tab](https://github.com/hucmaggie/pause-health.ai/security)
   of this repository.
2. Click **Report a vulnerability**.
3. Fill in the form — please include reproduction steps, affected files, and
   the impact you observed.

GitHub will create a private advisory visible only to the maintainer. You will
receive an acknowledgement reply via GitHub within **5 business days** of
submission.

**Please do NOT** open a public GitHub issue or pull request for a
vulnerability. Public disclosure should happen only after we have a fix
ready, or 90 days after the report — whichever comes first.

> **Note for the maintainer:** Private Vulnerability Reporting must be
> enabled at `Settings → Security → Private vulnerability reporting →
> Enable`. Without this, the "Report a vulnerability" button above will
> not appear. Enable it once when this file lands.

## What's in scope

Vulnerabilities in any of the following are in scope:

- The Next.js frontend source code (`frontend/`), including the demo APIs
  it serves under `/api/*`.
- The `pause_ingest` Python package source.
- The `mcp/` MCP server source.
- The MuleSoft reference artifacts in `mulesoft/`.
- The `.well-known/mcp.json` descriptor served at
  https://pause-health.ai/.well-known/mcp.json.
- Dependencies listed in any `package.json`, `pyproject.toml`, or
  `requirements.txt` in this repo.

## What's out of scope

The following are **out of scope** for this disclosure policy:

- The deployed Salesforce Health Cloud / Data 360 / Agentforce / MuleSoft
  org. That's a connected Trailhead Playground used for demos; vulnerabilities
  in the Salesforce platform itself should be reported to Salesforce via
  [trust.salesforce.com](https://trust.salesforce.com).
- Anthropic Claude (consumed at runtime by the Care Router agent).
  Vulnerabilities in the Anthropic API should be reported to Anthropic.
- The JupyterHealth Exchange and DBDP open-source upstreams.
  Report those to their respective project maintainers.
- Findings that require physical access to a maintainer's machine.
- Findings that are purely informational (e.g. "the site uses HTTP/2",
  "the Vercel preview deploys are publicly accessible"). The latter is a
  deliberate choice — preview deploys carry no PHI and are the same
  surface as production.
- Denial-of-service via traffic floods. The site is behind Vercel's edge
  network; capacity testing is Vercel's concern, not ours.

## Severity expectations and response time

Because this is a single-maintainer prototype, **we do not commit to a
fix SLA**. We will:

- Acknowledge your report within 5 business days.
- Triage severity using rough CVSS-3.1 buckets.
- Communicate via the private GitHub advisory thread until the issue
  is resolved or closed as out-of-scope.
- Credit you in the advisory if you'd like (or keep you anonymous —
  your choice).

For genuinely critical findings (RCE, auth bypass, secret leak from
a deployed env var, etc.), expect a same-day or next-business-day reply.

## Hardening pre-disclosed

A few things that are **known to be true today** and do not need to be
reported:

- The Next.js frontend has no authentication. Every page is publicly
  accessible by design — this is a marketing site and a demo, not a
  patient portal.
- The demo APIs at `/api/intake/*`, `/api/agents/care-router/*`,
  `/api/data-360/*`, and `/api/agent-fabric/*` accept unauthenticated
  POST requests and return deterministic mock data (or, if `SF_*` env
  vars are set, real grounding data from a connected dev org). They are
  rate-limited by Vercel's edge but not authenticated. This is
  intentional for the prototype — the production posture introduces
  auth via the customer's MuleSoft Anypoint Experience tier.
- The contact form and newsletter endpoints use Cloudflare Turnstile
  for bot mitigation but do not require login.
- The Salesforce client credentials in `frontend/.env.local` are
  **gitignored**. The deployed Vercel production environment does not
  carry these credentials by design (see README → "Deploying real-org
  grounding to Vercel"). If you find them committed anywhere in the
  repo history, **that** is a critical-severity report.

Thank you for helping keep Pause-Health.ai safe.
