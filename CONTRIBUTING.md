# Contributing to Pause-Health.ai

Thanks for your interest. This document explains what kinds of
contributions are welcome today, how to set up the project locally,
and the conventions the codebase follows.

## Project posture

Pause-Health.ai is a **prototype-in-the-open** for a healthcare-AI
platform that has not yet onboarded a design partner. That status
shapes what contribution looks like here:

- **Bug reports, doc fixes, small refactors, and dependency bumps
  are welcome** via GitHub issues and pull requests.
- **Security issues** should follow [`SECURITY.md`](./SECURITY.md),
  not the public issue tracker.
- **Larger feature work** — new agents, new API surfaces, new
  proposal sections — is best discussed in an issue first. The
  codebase is opinionated about its "today vs. designed" framing
  (see "Honesty conventions" below), and changes that drift from
  that posture are usually rejected.
- **Clinical-content contributions** (new guideline references,
  validated-instrument tunings, risk-band thresholds) require
  citation of the source. The `lib/risk-band.ts` and
  `lib/care-router-pathways.ts` modules are the canonical homes
  for that logic — please don't duplicate it elsewhere.

We are **not** soliciting code contributions toward a specific
roadmap right now. If you are an engineer, clinician, or design
partner interested in working with us more substantially, see
[`/careers`](https://pause-health.ai/careers) and
[`/contact`](https://pause-health.ai/contact).

## Local setup

```bash
# Frontend (Next.js + demo APIs + MCP descriptor)
cd frontend
npm install
npm run dev                   # http://localhost:3000

# Python ingest worker
cd pause_ingest
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q                     # ~20 tests

# MCP server
cd mcp
npm install                   # also runs `npm run build`
PAUSE_MCP_BASE_URL=http://localhost:3000 node scripts/smoke.mjs
```

See the top-level [`README.md`](./README.md) for details on the
optional Salesforce real-org grounding path and the seeder.

## Required checks before opening a PR

Run all three locally before pushing:

```bash
cd frontend
npm run lint                  # next lint
npm run test                  # vitest run
npm run build                 # next build (also runs tsc)

# or all at once:
npm run check
```

The `frontend-check.yml` GitHub Action will re-run these on every
PR. PRs cannot land while any check is failing.

For Python changes:

```bash
cd pause_ingest
pytest -q
```

### Optional: smoke test

After a polish pass that touches multiple pages or API routes, run
the end-to-end smoke test against your local dev server:

```bash
cd frontend
npm run dev                  # leave running in another terminal
npm run smoke                # in a second terminal
```

The script hits every public page, follows every internal link,
and POSTs realistic fixtures to every API endpoint. Results land
at [`SMOKE_TEST_RESULTS.md`](./SMOKE_TEST_RESULTS.md) in the repo
root — commit it alongside any regression fixes so future reviewers
have a record of what passed. Set `BASE_URL=https://pause-health.ai`
to smoke production instead of dev.

## Honesty conventions

The single strongest convention in this codebase is the **"today
vs. designed"** framing, enforced everywhere via the
[`<StatusPill>`](./frontend/components/status-pill.tsx) component.

When you add a feature card, claim, or metric on any page, you
**must** pill it with one of these statuses:

- `shipped` — running in production today, end users can hit it.
- `prototype` — running in the codebase, exercised by tests or
  the demo, but not against a customer.
- `partial` — partially shipped; the rest is still in-progress.
- `designed` — has a code path / spec / API contract but isn't
  exercised end-to-end yet.
- `planned` — committed to the roadmap; no code yet.
- `future` — directional intent; no commitment to timeline.
- `research` — a literature-derived estimate (cite the source).
- `target` — a forward-looking commercial or clinical target
  (must be flagged as not-yet-achieved).
- `estimate` — a back-of-envelope figure (be honest about the
  assumptions).
- `illustrative` — placeholder data for the demo, not real.

Pages that violate this convention (e.g. claiming present-tense
"we operate as a Business Associate" when we don't, or citing an
ACV range without flagging it as a target) get rewritten on the
next polish pass. Save the polish pass effort and pill correctly
the first time.

## Code conventions

- **TypeScript** strict mode is on. Don't disable it for new files.
- **React** components use the `function ComponentName(props) {}`
  form, not `const Component = () => {}`. Match the existing style.
- **Styling** is inline + global CSS at `frontend/app/globals.css`.
  We deliberately do not use Tailwind, CSS-in-JS libraries, or
  shadcn/ui — the design language is Salesforce-inspired and
  hand-rolled.
- **API routes** under `frontend/app/api/` follow the App Router
  conventions. Add a comment at the top of each route explaining
  whether it's a demo mock, a real-org passthrough, or both.
- **Demo personas** are defined in `frontend/lib/demo-cohort.ts`.
  When adding a persona, add intake hints (`preferredName`,
  `ageBand`) that match a seeded Salesforce Health Cloud record
  in `frontend/scripts/salesforce-seed.mjs`.
- **Python** code follows PEP 8 with 100-character lines. The
  `pause_ingest` package uses `pytest` with no other framework
  layered on top.

## Commit messages

We use longer-than-average commit messages because the codebase is
investor-facing and the git log is part of the artifact.

Format:

```
<surface>: <one-line summary>

<paragraph explaining what changed and why; reference the
relevant page paths, file paths, and StatusPill changes>
```

Look at any of the last 30 commits for examples. The pattern is:

- Surface prefix: `proposal/full`, `demo/intake`, `home`, `license`,
  `frontend`, `pause_ingest`, `mcp`, etc.
- Past-tense summary, no period.
- Body wraps at ~72 characters.

## Code of Conduct

By participating in this project you agree to abide by the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

By submitting a contribution to this repository, you agree that
your contribution will be licensed under the Apache License,
Version 2.0 — the same license that covers the rest of the
project. See [`LICENSE`](./LICENSE) for the full text and
[`NOTICE`](./NOTICE) for upstream attributions.

We do not currently require a Contributor License Agreement (CLA)
or a Developer Certificate of Origin (DCO) sign-off. If the
project grows to the point where one becomes appropriate, this
document will be updated and existing contributors notified.
