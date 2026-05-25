# Pause-Health.ai · Frontend

The marketing site and clickable prototype for Pause-Health.ai, built with Next.js 14 (App Router) and TypeScript.

## Quick start

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:3000.

## Available scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server on `:3000` with hot reload. |
| `npm run build` | Production build (used by Vercel + the CI pipeline). |
| `npm run start` | Serve the production build locally on `:3000`. |
| `npm run lint` | ESLint with `next/core-web-vitals`. |
| `npm run test` | Run all Vitest suites once (CI mode). |
| `npm run test:watch` | Vitest in watch mode for local development. |
| `npm run check` | **Pre-deploy gate**: runs lint → test → build in sequence. |

## Project structure

```
frontend/
├─ app/
│  ├─ layout.tsx           # Root layout: header, footer, OG metadata, viewport
│  ├─ page.tsx             # Landing page
│  ├─ about/               # About page
│  ├─ proposal/            # Investor brief
│  ├─ contact/             # Contact form (uses /api/contact)
│  ├─ careers/             # Careers page with prefilled contact links
│  ├─ demo/                # Clickable prototype (intake → patient → routing → analytics)
│  ├─ api/
│  │  ├─ subscribe/        # Newsletter API route
│  │  └─ contact/          # Contact API route
│  ├─ sitemap.ts           # /sitemap.xml
│  ├─ robots.ts            # /robots.txt
│  ├─ manifest.ts          # /manifest.webmanifest
│  ├─ icon.png             # Favicon (auto-served by Next.js)
│  └─ apple-icon.png       # iOS home-screen icon
├─ components/             # Reusable UI: navbar, footer pieces, forms, toast, demo shell
├─ lib/
│  ├─ anti-bot.ts          # Honeypot + time-trap + Turnstile helpers
│  ├─ anti-bot.test.ts     # Unit tests
│  └─ page-metadata.ts     # Per-page OpenGraph/Twitter card helper
├─ public/
│  ├─ brand/               # Logo + OG card assets
│  └─ docs/                # Static investor proposal HTML
└─ vitest.config.ts
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in only the providers you need. Everything has safe defaults so the app runs without any env vars.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical URL for sitemap, robots, and OG metadata. Defaults to `https://pause-health.ai`. Set this to your Vercel preview URL or custom domain in production. |
| `NEWSLETTER_PROVIDER` | One of `log` (default), `formspree`, `resend`, `mailchimp`, `buttondown`, `convertkit`. |
| `CONTACT_PROVIDER` | One of `log` (default), `formspree`, `resend`. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Optional. Renders a Cloudflare Turnstile widget on both forms when set. |
| `TURNSTILE_SECRET_KEY` | Optional. Server-side Turnstile verification. Must be set together with the site key. |

Provider-specific keys (Formspree form IDs, Resend audience IDs, Mailchimp lists, etc.) are documented inline in [`.env.example`](./.env.example).

### Enable Cloudflare Turnstile

1. Create a site in the [Cloudflare Turnstile dashboard](https://dash.cloudflare.com/?to=/:account/turnstile).
2. Add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to your env.
3. Restart the dev server. Both the newsletter and contact forms will render a compact dark-theme widget and the submit button stays disabled until verification passes. The server route validates the token against Cloudflare's `siteverify` endpoint.

If neither is set, the forms still ship two passive bot defenses out of the box:

- Hidden honeypot field (`name="website"`) — silently absorbed if filled.
- Time-trap — submissions under 1.5 seconds after page render are silently absorbed.

## Testing

Vitest runs in Node mode. Three suites today:

- `lib/anti-bot.test.ts` — unit tests for validation helpers (30 tests).
- `app/api/subscribe/route.test.ts` — integration tests for `POST /api/subscribe` (10 tests).
- `app/api/contact/route.test.ts` — integration tests for `POST /api/contact` (10 tests).

Run them with:

```bash
npm run test        # CI / single run
npm run test:watch  # watch mode
```

## Deployment

### Vercel (recommended)

1. Push to GitHub.
2. Import the repo into Vercel — set **Root Directory** to `frontend`.
3. Add any env vars you want (newsletter / contact providers, Turnstile, `NEXT_PUBLIC_SITE_URL`).
4. Deploy.

Vercel preview deployments are also wired up via GitHub Actions — see [Vercel preview workflow](#vercel-preview-workflow) below.

### Other hosts

Any Next.js-compatible host works: Netlify (set base directory `frontend`), Cloudflare Pages (framework preset Next.js, root `frontend`), Render (add a second service alongside the FastAPI backend), or a Node server running `npm run start`.

## CI / CD

Three GitHub Actions workflows live in [`.github/workflows/`](../.github/workflows/):

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `frontend-check.yml` | PRs + push to `main` (paths: `frontend/**`) | Lint → Test → Build. Optional Lighthouse audit. |
| `codeql.yml` | PRs, push to `main`, weekly schedule | CodeQL security scanning for JS/TS + Python. |
| `vercel-preview.yml` | PRs (paths: `frontend/**`) | Builds + deploys a Vercel preview and posts a sticky PR comment. Skipped gracefully if Vercel secrets aren't configured. |

### Vercel preview workflow

To enable preview deployments + auto-posted PR comments, add three secrets to GitHub (Settings → Secrets and variables → Actions):

- `VERCEL_TOKEN` — personal token from your Vercel dashboard.
- `VERCEL_ORG_ID` — from Project Settings → General.
- `VERCEL_PROJECT_ID` — from Project Settings → General.

Until all three are set, the workflow emits a notice and exits cleanly without failing the PR check.

### Dependabot

[`.github/dependabot.yml`](../.github/dependabot.yml) runs every Monday at 8am Pacific across `npm`, `pip`, and `github-actions`. Updates are grouped so you get one PR per logical cluster (Next.js, React, Vitest, type-defs, ESLint) rather than dozens of individual bumps.

## Branding & design system

- Color palette: deep mauve (`#190b16`), brand pink (`#ff5da8`), accent lavender / coral / teal — defined as CSS variables at the top of [`app/globals.css`](./app/globals.css).
- Typography: Inter via system font stack.
- All logos and OG cards live in [`public/brand/`](./public/brand/).
- The favicon + Apple touch icon are served via Next.js conventions (`app/icon.png`, `app/apple-icon.png`).

## Adding a new page

1. Create `app/<route>/page.tsx`.
2. (Optional) Export `metadata` using the [`pageMetadata()`](./lib/page-metadata.ts) helper to get consistent OpenGraph + Twitter cards.
3. Update [`app/sitemap.ts`](./app/sitemap.ts) so the URL is included in `/sitemap.xml`.
4. Run `npm run check` before opening a PR.
