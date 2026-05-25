# Branch protection — recommended settings for `main`

This document captures the suggested branch-protection rules for `main`. Configure them in GitHub once and they'll guard every future merge.

> GitHub path: **Settings → Branches → Branch protection rules → Add rule** (or edit the existing rule for `main`).

## Rule scope

- **Branch name pattern:** `main`
- Apply rule to administrators as well? **Yes** for production safety. Toggle off only when bootstrapping the repo.

## Required pull request before merging

- [x] **Require a pull request before merging**
  - **Required approvals:** `1` (raise to `2` once the team grows past 3 people)
  - [x] **Dismiss stale pull request approvals when new commits are pushed**
  - [x] **Require approval of the most recent reviewable push**
  - [ ] *Require review from Code Owners* — enable once a `CODEOWNERS` file lands.

## Required status checks

- [x] **Require status checks to pass before merging**
- [x] **Require branches to be up to date before merging**

Required check names (add each one — the names must match the GitHub Actions job titles exactly):

| Check name | Workflow | Job |
| --- | --- | --- |
| `Lint, Test, Build` | `frontend-check.yml` | `check` |
| `Analyze (javascript-typescript)` | `codeql.yml` | `analyze` matrix |
| `Analyze (python)` | `codeql.yml` | `analyze` matrix |

Notes:

- **Do not** require `Deploy Preview` (`vercel-preview.yml`). That workflow is informational and is skipped intentionally when Vercel secrets aren't configured.
- If you add Lighthouse CI (see `frontend-check.yml` for the optional `lighthouse` job), add `Lighthouse Audit` here too.

## Required conversation resolution

- [x] **Require conversation resolution before merging** — keeps unresolved review threads from sneaking through.

## Required signed commits

- [ ] **Require signed commits** — recommended once contributors have GPG / SSH commit signing set up. Off by default to avoid blocking quick fixes.

## Required linear history

- [x] **Require linear history**
  - Forces merges via squash or rebase. Keeps `git log --oneline` readable.

## Restrict who can push

- [x] **Restrict who can push to matching branches**
  - **Allow specified actors:**
    - `dependabot[bot]` (so grouped dependency PRs can auto-merge after CI passes)
    - The repo owner / release maintainers

## Force pushes & deletions

- [x] **Do not allow bypassing the above settings**
- [x] **Restrict deletions**
- [x] **Allow force pushes** → off (default)

## Optional but recommended

- **Auto-merge:** enable on the repo (Settings → General → Pull Requests). Combined with required status checks, Dependabot PRs can be auto-merged the moment CI is green.
- **Squash merging only:** disable "Allow merge commits" and "Allow rebase merging" in Settings → General → Pull Requests, then keep "Allow squash merging" on. This produces a clean, linear `main` history.

## Verifying the configuration

After saving the rule, push a tiny no-op branch and open a PR. You should see:

1. The `Lint, Test, Build` and `Analyze` checks appear under the PR status section.
2. The merge button stays disabled until those checks are green and the branch is up to date.
3. The Vercel preview comment posts (if Vercel secrets are configured).
4. Direct pushes to `main` are rejected — even by admins, if the bypass setting above is enabled.

## When to revisit

- After hiring the first additional engineer → raise required approvals to `2`.
- After enabling Vercel secrets → consider making the `Deploy Preview` check required *if and only if* the team relies on previews for QA sign-off.
- After adopting commit signing → flip "Require signed commits" on.
- When the API surface stabilizes → add a `CODEOWNERS` file and enable code-owner reviews.
