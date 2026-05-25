# Lighthouse nightly history

This directory is auto-maintained by [`.github/workflows/lighthouse-nightly.yml`](../.github/workflows/lighthouse-nightly.yml).

## Structure

```
lighthouse-history/
├─ README.md          # This file (overwritten with the latest summary table each run).
├─ summary.json       # Full time-series: one entry per nightly run, with per-page scores.
└─ runs/
   └─ YYYY-MM-DD/     # One folder per run date.
      ├─ root.json
      ├─ _about.json
      ├─ _proposal.json
      └─ _demo_intake.json
```

## How to read `summary.json`

Each array entry is one nightly run:

```json
{
  "timestamp": "2026-05-25T09:00:00.000Z",
  "target": "https://pause-health.ai",
  "commit": "abc1234...",
  "runId": "1234567890",
  "pages": [
    { "page": "https://pause-health.ai/", "performance": 96, "accessibility": 100, "bestPractices": 100, "seo": 100 }
  ]
}
```

Scores are 0-100 (multiplied from Lighthouse's 0-1 floats).

## Triggering a run manually

Run the workflow on demand from the Actions tab (workflow_dispatch). You can pass a `url_override` to audit a different URL (e.g. a Vercel preview) without changing the `PROD_URL` repo variable.

## First run

The first nightly run will populate this directory. Until then, the audits are not in git history — only this README placeholder lives here.
