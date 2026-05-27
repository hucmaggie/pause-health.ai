"""
Generates Pause-Health.ai-Build-Journal.docx -- a chronological record
of the prototype's construction, distilled from the full agent-chat
transcript that produced the codebase.

Output: <repo-root>/Pause-Health.ai-Build-Journal.docx

Run:
    .venv/bin/python scripts/build_journal.py
"""

from __future__ import annotations

import os
import sys
from datetime import date
from pathlib import Path
from typing import Iterable

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor, Inches
from docx.oxml.ns import qn
from docx.oxml import OxmlElement


REPO_ROOT = Path(__file__).resolve().parent.parent
# The build journal lives outside this repo, alongside the Pause-Health.ai
# project deliverables. Override with PAUSE_JOURNAL_PATH if needed.
DEFAULT_OUTPUT_DIR = Path("/Users/maggie.hu/Projects/pause-health.ai")
OUTPUT_PATH = Path(
    os.environ.get(
        "PAUSE_JOURNAL_PATH",
        DEFAULT_OUTPUT_DIR / "Pause-Health.ai-Build-Journal.docx",
    )
)


# ---------- content ------------------------------------------------------

DOC_TITLE = "Pause-Health.ai — Build Journal"
DOC_SUBTITLE = (
    "A chronological record of how the prototype, investor brief, and "
    "multi-agent control plane were built — distilled from the full agent "
    "engineering chat."
)
DOC_AUTHOR_LINE = (
    "Authored from the Cursor agent transcript that produced the codebase. "
    "Compiled " + date.today().isoformat() + "."
)

OVERVIEW_PARAGRAPHS = [
    "Pause-Health.ai is an AI-led care platform for women navigating "
    "menopause. The repository in this journal contains everything built "
    "to date: the marketing site, the investor brief, the clickable "
    "prototype, the Python wearable-ingest worker, the MuleSoft mock "
    "integration plane, a Model Context Protocol server, a four-agent "
    "control plane with Google A2A handoff and a mocked MuleSoft Agent "
    "Fabric, and most recently a Salesforce Data 360 grounding layer "
    "feeding the Care Router.",
    "Each section of this journal corresponds to one focused build phase. "
    "Phases are listed in the order they happened. For each phase the "
    "journal records the ask, the decision points and trade-offs, what "
    "was actually built, and how it was verified. Where a phase changed "
    "the architecture or the investor narrative, that change is called "
    "out explicitly.",
    "Two ground rules across every phase. First, nothing in the prototype "
    "lies about what is real and what is mocked — every mocked surface "
    "carries a clear note in the API meta payload and a prototype-vs-"
    "production table on the corresponding investor page. Second, real "
    "credentials are never required for the prototype to demonstrate "
    "value; every external integration (Anthropic, Salesforce, MuleSoft, "
    "JupyterHealth) is gated behind an environment variable with a "
    "deterministic fallback so a reviewer can run the entire flow with "
    "no setup.",
]

ARCH_DIAGRAM = """\
                          Pause-Health.ai end-state architecture

   ┌───────────────────────────────────────────────────────────────────────┐
   │  Marketing site & investor brief        Clickable prototype           │
   │  (/, /about, /proposal/*)                (/demo/intake -> /demo/...)   │
   └───────────────────────────────────────────────────────────────────────┘
                                  │
                                  │  Patient submits intake
                                  ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │  Agentforce Service Agent (front door)                                │
   │  Real Embedded Messaging when configured, scripted fallback otherwise │
   └───────────────────────────────────────────────────────────────────────┘
                                  │
                                  │  Google A2A `tasks/send` with intake + grounding
                                  ▼
   ┌────────────┐                 ┌────────────────────────────────────┐
   │ Salesforce │ <───── REST ─── │ Pause Care Router (Anthropic Claude)│
   │  Data 360  │  IR + grounding │ Real Claude when ANTHROPIC_API_KEY  │
   │   (mock)   │ federated query │ set; deterministic policy fallback  │
   └────────────┘                 └────────────────────────────────────┘
                                  │
                                  │  Tool calls over MCP
                                  ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │  Pause MCP server (@pause-health/mcp)                                 │
   │  Four tools, each backed by a mocked MuleSoft Experience API         │
   └───────────────────────────────────────────────────────────────────────┘
                                  │
                                  │  REST over the integration plane
                                  ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │  MuleSoft Experience APIs (mocked)                                    │
   │   /api/mulesoft/health, /patient/[id]/timeline, /patient/[id]/intake, │
   │   /providers                                                          │
   └───────────────────────────────────────────────────────────────────────┘
                                  │
                                  │  Federated to / written to
                                  ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │  Clinical substrate: JupyterHealth Exchange (FHIR R5) + DBDP feature  │
   │  pipeline (FLIRT-based wearable HRV ingest)                           │
   └───────────────────────────────────────────────────────────────────────┘

   Cross-cutting:
     • MuleSoft Agent Fabric (mock) governs every agent — registry,
       policies, end-to-end traces, /demo/agent-fabric live console.
     • Salesforce Data 360 sits as a fifth agent on the Fabric and
       grounds the Care Router with longitudinal calculated insights.
"""

MONOREPO_LAYOUT = """\
shipping-quote-by-zip-api/                  ← legacy repo name; retained
├── frontend/                               ← Next.js 14 App Router site
│   ├── app/                                  Pages + API routes
│   │   ├── (marketing routes)
│   │   ├── proposal/*                        Investor brief deep-dives
│   │   ├── demo/*                            Clickable prototype
│   │   └── api/                              All mocked APIs live here
│   │       ├── agents/care-router/           A2A agent endpoints
│   │       ├── agent-fabric/                 Agent Fabric console APIs
│   │       ├── intake/route-to-care-router/  Handoff orchestrator
│   │       ├── mulesoft/                     Mocked Experience APIs
│   │       └── data-360/                     Mocked Salesforce Data 360
│   ├── components/                           UI components + intake fallback
│   ├── lib/                                  a2a, care-router, agent-fabric, data-360, mulesoft-mocks
│   └── public/.well-known/mcp.json           MCP discovery descriptor
│
├── pause_ingest/                           ← Python wearable ingest worker
│   ├── flirt-based feature pipeline          HRV, sleep, vasomotor windows
│   └── pyproject.toml
│
├── mcp/                                    ← @pause-health/mcp MCP server
│   ├── src/server.ts                         Four MCP tools wrapping the Experience APIs
│   └── scripts/smoke.mjs                     End-to-end MCP smoke test
│
├── mulesoft/                               ← MuleSoft reference artifacts
│   ├── system-api/, process-api/, experience-api/   API-led tiers
│   └── dataweave/omh-to-fhir.dwl             OMH → FHIR R5 transform
│
├── app.py                                  ← Legacy FastAPI service (still functional)
├── requirements.txt                          Python runtime deps
└── README.md                                 Updated each phase
"""

PHASES = [
    {
        "title": "Phase 1 — Foundation: Next.js prototype, deploy, mobile nav",
        "ask": (
            "Bootstrap a credible marketing-quality Next.js site and an "
            "investor-ready prototype on top of the existing FastAPI repo. "
            "Edit the About page (HQ -> Irvine, CA; add Maggie C. Hu as "
            "Founder & CEO). Check the project into GitHub. Deploy to "
            "Vercel. Make the top navigation mobile-friendly."
        ),
        "decisions": [
            "Kept the FastAPI app and the new Next.js frontend side-by-side "
            "in one monorepo rather than splitting repos. The legacy app is "
            "still useful for tests; the new product surface lives in "
            "frontend/.",
            "Vercel application preset switched from FastAPI to Next.js so "
            "the right framework detection runs. The 404 after first deploy "
            "was the result of the wrong preset; once switched, the App "
            "Router routes resolved.",
            "Mobile nav implemented as a separate client component "
            "(MobileNav) so the desktop header remains a server component. "
            "Hamburger toggles a portal-style drawer instead of stacking "
            "links on top of content.",
        ],
        "built": [
            "frontend/ — Next.js 14 App Router, marketing pages, footer, "
            "manifest, sitemap, robots, OpenGraph, Twitter card metadata, "
            "SEO basics.",
            "GitHub repository at github.com/hucmaggie/pause-health.ai.",
            "Vercel deployment with the Next.js preset and a working "
            "production URL.",
            "components/mobile-nav.tsx with a responsive hamburger drawer.",
        ],
        "verified": [
            "ESLint clean across the frontend.",
            "Lighthouse nightly workflow scheduled via GitHub Actions.",
            "Manual smoke check of every top-level page on both desktop "
            "and mobile widths.",
        ],
    },
    {
        "title": "Phase 2 — Investor brief: /proposal/full and deep-dives",
        "ask": (
            "Expand the prototype with detailed investor-focused content. "
            "Cover customer selection (health system + payer profiles), "
            "key customer insights from research, data inventory and "
            "strategy, competition, digital strategy, and technology "
            "choices. Convert the single long page into a /proposal/full "
            "route that shares the layout, with clean prose styling."
        ),
        "decisions": [
            "Composed every investor page through a shared ProposalShell "
            "component so the side navigation, eyebrow/title/subtitle "
            "rhythm, and prose styling stay consistent.",
            "Standardized on three primitives across every investor page: "
            "card-grid (for items), table-wrap (for prototype-vs-production "
            "comparisons), and metric-list (for takeaways). Avoids ad-hoc "
            "layouts.",
            "The /proposal page itself became an index with one-paragraph "
            "summaries pointing into each deep-dive, so reviewers can "
            "skim or drill in without backtracking.",
        ],
        "built": [
            "/proposal index page with summarized links to every deep-dive.",
            "/proposal/full — the single-document narrative for a complete "
            "investor read.",
            "/proposal/customers, /proposal/insights, /proposal/data, "
            "/proposal/competition, /proposal/strategy, /proposal/technology.",
        ],
        "verified": [
            "ESLint clean.",
            "next build passes; sitemap regenerated to include all new "
            "investor routes.",
        ],
    },
    {
        "title": "Phase 3 — JupyterHealth integration design (Option C)",
        "ask": (
            "Figure out how to integrate JupyterHealth via their GitHub "
            "organization. Choose the deepest viable integration option."
        ),
        "decisions": [
            "Option C selected: compose with three JupyterHealth projects "
            "rather than picking one — JupyterHealth Exchange (the FHIR R5 "
            "+ Open mHealth data plane), omh-shim (wearable -> OMH "
            "conversion), and jupyterhealth-client (Python API client).",
            "Treated JupyterHealth as Pause's clinical substrate rather "
            "than as 'one of N integrations' — every wearable signal lands "
            "in FHIR via JupyterHealth, and the Care Router's longitudinal "
            "view federates over the same store.",
            "Authored an investor page that frames JupyterHealth as the "
            "open-source data substrate so that the customer's data team "
            "sees Pause as additive, not as a competing data platform.",
        ],
        "built": [
            "/proposal/integration investor page covering the three-piece "
            "composition, the FHIR R5 substrate, and the data plane.",
            "Design doc identifying the contract points: how OMH payloads "
            "from wearables become FHIR Observations posted to the "
            "JupyterHealth Exchange, and how the Python client reads them "
            "back for feature computation.",
            "README updated to enumerate the JupyterHealth pieces.",
        ],
        "verified": [
            "Investor page renders, links to upstream JupyterHealth repos, "
            "and is referenced from the /proposal index.",
        ],
    },
    {
        "title": "Phase 4 — DBDP wearable ingest (Steps 1 and 2)",
        "ask": (
            "Integrate with DBDP's code repository for wearable ingest — "
            "research the ecosystem, identify FLIRT and a particular HRV "
            "script, and integrate them into a Python ingest worker. Use "
            "both synthetic and DHDR-style test data."
        ),
        "decisions": [
            "Step 1 scaffolded a pause_ingest/ Python package on top of "
            "FLIRT (DBDP's feature-generation toolkit). FLIRT handles "
            "windowing, sleep detection, and HRV feature extraction; "
            "Pause wraps it for the menopause-specific feature set.",
            "Step 2 ported the DBDP HRV calculator and an Empatica E4 "
            "ingestion path. Devicely was deferred — it does not yet "
            "support Python 3.13, and forcing 3.11 would have churned the "
            "rest of the toolchain.",
            "Tests run against both synthetic fixtures and a DHDR-style "
            "sample so reviewers can verify the pipeline with no external "
            "data set.",
        ],
        "built": [
            "pause_ingest/ Python package — FLIRT-based feature pipeline, "
            "HRV calculator, Empatica E4 reader, synthetic + DHDR-style "
            "test fixtures, pytest suite, pyproject.toml.",
            "/proposal/dbdp investor page covering the DBDP ecosystem, "
            "FLIRT integration, the calculated features Pause needs, and "
            "the deferred devicely work.",
            "README updated to describe the wearable ingest worker.",
        ],
        "verified": [
            "Python tests green (synthetic + DHDR fixtures).",
            "Investor page renders and cross-links from /proposal/integration.",
        ],
    },
    {
        "title": "Phase 5 — The Menopause Society and provider graph",
        "ask": (
            "Integrate with the National Menopause Society's data and "
            "provider list. Implement Path C (deep-link referral) "
            "immediately and document Path B (NPPES-derived provider "
            "graph) for investors."
        ),
        "decisions": [
            "Path C ships now: a deterministic deep-link to the "
            "Menopause Society's MSCP-credentialed clinician directory "
            "with the patient's filters preserved. Zero data-licensing "
            "risk, immediate clinical value, real signal in the demo.",
            "Path B documented: a Pause-owned provider graph derived "
            "from CMS NPPES (NPI Registry) data, joined to MSCP "
            "credential status. This becomes the long-term competitive "
            "moat; the investor page lays out the build plan rather than "
            "shipping a half-built directory now.",
            "Provider mock data reused in the MuleSoft providers Experience "
            "API so the prototype already exercises the shape Pause will "
            "ship in production.",
        ],
        "built": [
            "/proposal/menopause-society — Path C live, Path B documented.",
            "/proposal/provider-graph — the NPPES-derived graph plan, the "
            "competitive moat argument, the phased build.",
            "Mock provider directory used by /api/mulesoft/providers.",
        ],
        "verified": [
            "Deep-link Path C resolves to the Menopause Society directory "
            "with filters preserved.",
            "Mock provider API returns deterministic results filterable "
            "by ZIP and menopause-experience flag.",
        ],
    },
    {
        "title": "Phase 6 — Agentforce Service Agent (Option A)",
        "ask": (
            "Integrate Salesforce Agentforce Service Agent for patient "
            "intake. Implement Option A: a real Embedded Messaging "
            "Service Agent with the Pause-branded palette, plus a "
            "graceful scripted fallback if credentials are not "
            "configured."
        ),
        "decisions": [
            "Real Salesforce Embedded Messaging for Web (Enhanced Chat v2 "
            "inline mode) loaded when the Vercel environment variables are "
            "set; scripted React fallback runs otherwise. One environment "
            "flag, two code paths, identical UX shape.",
            "All Salesforce configuration kept as Vercel environment "
            "variables — no secrets in the repo. Documented in .env.example.",
            "The intake completion event is the trigger for everything "
            "downstream (Care Router handoff, Data 360 grounding). The "
            "fallback emits the same event so the rest of the multi-agent "
            "trace works identically whether Salesforce is configured or not.",
        ],
        "built": [
            "components/agentforce-fallback.tsx — scripted intake mirroring "
            "the real agent's question set.",
            "Real Agentforce embed gated by Vercel env vars.",
            "/proposal/agentforce investor page covering Embedded "
            "Messaging, configuration model, fallback strategy.",
            ".env.example updated.",
        ],
        "verified": [
            "Fallback runs end-to-end with no env vars set.",
            "Real Agentforce embed renders correctly when env vars are set "
            "(verified against a Salesforce trial org).",
        ],
    },
    {
        "title": "Phase 7 — MuleSoft integration plane (Option C)",
        "ask": (
            "Add MuleSoft to the prototype for integrations with "
            "JupyterHealth and DBDP. Option C: design doc + investor "
            "page + reference Mule/DataWeave files + mocked API "
            "endpoints, with cross-links from existing investor pages."
        ),
        "decisions": [
            "API-led connectivity adopted as the contract: System APIs "
            "wrap raw sources (JupyterHealth FHIR, DBDP feature store, "
            "EHR-of-record); Process APIs orchestrate validation and "
            "writes; Experience APIs serve the agents and the UI.",
            "DataWeave omh-to-fhir.dwl included as a real artifact, not a "
            "screenshot — reviewers can read the transform end to end.",
            "Mocked Experience APIs centralized in frontend/lib/"
            "mulesoft-mocks.ts so the same fixtures back the Experience "
            "API routes and the MCP server in the next phase.",
        ],
        "built": [
            "mulesoft/ directory — system-api, process-api, experience-api "
            "reference scaffolds, plus dataweave/omh-to-fhir.dwl.",
            "frontend/lib/mulesoft-mocks.ts — shared fixtures.",
            "Mocked Experience APIs: /api/mulesoft/health (kept for backward "
            "compatibility), /api/mulesoft/patient/[id]/timeline, "
            "/api/mulesoft/patient/[id]/intake, /api/mulesoft/providers.",
            "/proposal/mulesoft investor page covering API-led tiers, "
            "DataWeave, deployment topology, and the prototype-vs-production "
            "table.",
            "Cross-links added from /proposal/integration and /proposal/dbdp.",
        ],
        "verified": [
            "curl smoke tests against all four mocked Experience APIs.",
            "ESLint clean; next build passes with the new routes.",
        ],
    },
    {
        "title": "Phase 8 — Pause MCP server",
        "ask": (
            "Add MuleSoft MCP servers for the mock APIs. Resolved with "
            "the user: this is really 'expose the MuleSoft Experience "
            "APIs as MCP tools so Claude Desktop, Cursor, and Agentforce "
            "can call them.' Build a real MCP server, three new mock "
            "Experience API routes, a .well-known descriptor, and an "
            "investor page (Option C — the most complete option)."
        ),
        "decisions": [
            "Standalone Node package mcp/ rather than embedding the MCP "
            "server in Next.js. The MCP transport is stdio, not HTTP — "
            "embedding it would have been the wrong shape.",
            "Four tools, one per Experience API: get_patient_timeline, "
            "get_patient_intake, find_menopause_providers, "
            "experience_api_health. Inputs validated with Zod.",
            "Published /.well-known/mcp.json from the Next.js public "
            "directory so any MCP client can auto-discover Pause's tools.",
            "Smoke test (mcp/scripts/smoke.mjs) drives the server through "
            "the official MCP SDK client to prove the tools resolve "
            "end-to-end.",
        ],
        "built": [
            "mcp/ package — package.json, src/server.ts, "
            "scripts/smoke.mjs, README.md, tsconfig.json.",
            "Three new mocked Experience APIs in frontend/app/api/mulesoft/ "
            "to back the new MCP tools.",
            "frontend/public/.well-known/mcp.json discovery descriptor.",
            "/proposal/mcp investor page covering the four tools, why MCP, "
            "client registration snippets (Claude Desktop, Cursor), "
            "prototype-vs-production table, phased plan.",
        ],
        "verified": [
            "npm run smoke against the built MCP server: list-tools and "
            "every individual tool call return expected payloads.",
            "Discovery descriptor served at /.well-known/mcp.json with the "
            "right content type.",
            "MCP client registration tested with Cursor's mcp.json format.",
        ],
    },
    {
        "title": "Phase 9 — Multi-agent control plane: Anthropic + A2A + Agent Fabric (L3)",
        "ask": (
            "Add an Anthropic agent that processes care details and "
            "routes the case to the appropriate pathway, showing the A2A "
            "protocol. Add MuleSoft Agent Fabric to showcase multi-agent "
            "orchestration, monitoring, security, and governance. L3 "
            "implementation: investor page, mocked Agent Fabric console, "
            "and a real end-to-end A2A handoff from intake to Care Router "
            "with traces appearing live in the console."
        ),
        "decisions": [
            "Anthropic Care Router gated by ANTHROPIC_API_KEY: real Claude "
            "Sonnet 4.5 when the key is set, deterministic policy engine "
            "as a graceful fallback. Same decision shape from either path.",
            "Google A2A used for agent-to-agent handoff (Agentforce -> "
            "Care Router). MCP retained as the tool-call surface to the "
            "data plane. Two open protocols, two different concerns — "
            "documented as such on the investor page.",
            "MuleSoft Agent Fabric implemented as an in-memory mock: agent "
            "registry, policy catalog, ring-buffer trace store, governance "
            "evaluator. Module-scoped global so traces persist across "
            "Next.js dev hot reloads and every API route in the same Node "
            "process sees the same store.",
            "/demo/agent-fabric became a live console: polls the registry, "
            "shows policy catalog, lists recent tasks, renders parent/child "
            "spans for any taskId. Test-case buttons drive real A2A flows.",
            "Twelve governance policies authored covering PHI, model "
            "allow-list, clinical rationale requirement, MCP allow-list, "
            "audit, network, FHIR substrate — each tagged enforced/advisory "
            "and block/audit.",
        ],
        "built": [
            "frontend/lib/a2a.ts — A2A protocol types and helpers.",
            "frontend/lib/care-router.ts — scripted policy engine plus "
            "Anthropic Claude integration.",
            "frontend/lib/agent-fabric.ts — registry, policies, trace "
            "store, governance evaluator.",
            "/api/agents/care-router/.well-known/agent.json — A2A Agent "
            "Card discovery document.",
            "/api/agents/care-router/tasks — A2A tasks/send endpoint.",
            "/api/agent-fabric/agents, /policies, /traces, "
            "/governance/evaluate — console-backing endpoints.",
            "/api/intake/route-to-care-router — handoff orchestrator that "
            "stitches Agentforce intake to the Care Router over A2A.",
            "components/latest-care-router-decision.tsx — polls traces and "
            "shows the most recent decision on /demo/routing.",
            "/demo/agent-fabric — the live multi-agent console.",
            "/proposal/agent-fabric investor page covering the four agents, "
            "the two protocols, the Fabric's role, prototype-vs-production, "
            "and phased plan.",
            "Anthropic SDK added as a soft dependency (dynamic import).",
        ],
        "verified": [
            "End-to-end POST to /api/intake/route-to-care-router produces a "
            "RoutingDecision and a trace span tree visible at /demo/agent-"
            "fabric.",
            "Governance policies block red-flag-missing intakes; the trace "
            "shows the blocked span and the A2A task in failed state.",
            "Anthropic path verified with a live API key (still falls back "
            "gracefully when the key is removed).",
            "ESLint clean; next build passes.",
        ],
    },
    {
        "title": "Phase 10 — Code Repository link in the top nav",
        "ask": (
            "Add a 'Code Repository' link to the top navigation menu with "
            "the GitHub repository URL."
        ),
        "decisions": [
            "Added to both desktop (frontend/app/layout.tsx) and mobile "
            "(components/mobile-nav.tsx) navigation, behind external-link "
            "rendering with target=_blank and rel=noopener noreferrer.",
            "MobileNav's NavLink type extended with an `external?: boolean` "
            "flag so external links are handled uniformly going forward "
            "rather than as a special case for this one entry.",
        ],
        "built": [
            "frontend/app/layout.tsx — desktop nav.",
            "frontend/components/mobile-nav.tsx — external NavLink "
            "rendering.",
        ],
        "verified": [
            "Visual check via curl against the dev server on both desktop "
            "and mobile widths.",
            "ESLint clean.",
        ],
    },
    {
        "title": "Phase 11 — Salesforce Data 360 grounding (L2)",
        "ask": (
            "How could we incorporate Data 360 into the prototype? "
            "Decided on L2: investor page + mocked Data 360 read APIs + "
            "Care Router actually fetches grounding from Data 360 before "
            "deciding, with the fetch recorded as a trace span. Grounding "
            "fetched before the Care Router (cleanest trace). Leave "
            "/demo/patient alone for now but add a 'View Data 360 record' "
            "link from the Agent Fabric console."
        ),
        "decisions": [
            "Data 360 is the unified-read plane on top of the existing "
            "integration plane (MuleSoft) and the clinical substrate "
            "(JupyterHealth + DBDP). Composes with everything else; "
            "replaces nothing.",
            "Grounding fetched in /api/intake/route-to-care-router before "
            "the A2A handoff, attached to the A2A message as a data part. "
            "The Care Router does not need to know about Data 360 — it "
            "just consumes more context.",
            "Care Router updated (both scripted and Claude paths) to read "
            "the grounding and cite specific calculated insights in its "
            "rationale. A virtual MSCP visit gets promoted to in-person "
            "when vasomotor burden >= 60 or cohort percentile >= 75 — a "
            "visible, defensible decision change driven by the grounding.",
            "Data 360 registered as the fifth agent on the Agent Fabric, "
            "with three new block-enforced policies: zero-copy federation, "
            "consent required before grounding, segment activation "
            "allow-list. Audit policy extended to cover Data 360.",
            "Federated-record JSON deep-link added to /demo/agent-fabric "
            "so reviewers can see the underlying patient record for any "
            "traced task in one click.",
        ],
        "built": [
            "frontend/lib/data-360.ts — federated patient store, four "
            "calculated insights (HRV z-score, vasomotor burden, sleep, "
            "days-since-MSCP), longitudinal observations, cohort "
            "comparison with pathway-outcome breakdown, identity "
            "resolution stub, four population segments.",
            "/api/data-360/patient/[id]/grounding — the bundle the Care "
            "Router consumes.",
            "/api/data-360/patient/[id]/record — full federated record.",
            "/api/data-360/segments — population segment catalog.",
            "/api/data-360/identity/resolve — IR endpoint.",
            "Updated /api/intake/route-to-care-router to fetch IR + "
            "grounding before the A2A handoff and record two new spans.",
            "Updated frontend/lib/care-router.ts to consume grounding "
            "and surface it on every decision.",
            "Updated /api/agents/care-router/tasks to pass grounding "
            "through to route().",
            "/proposal/data-360 investor page — zero-copy federation, "
            "four-span trace, prototype-vs-production table, four-phase "
            "plan, investor takeaways.",
            "Wired into ProposalShell nav, /proposal index, sitemap; "
            "cross-linked from /proposal/agent-fabric, /proposal/mulesoft, "
            "/proposal/agentforce.",
            "README updated.",
        ],
        "verified": [
            "ESLint clean across 17 touched files.",
            "next build passes with 54 routes (4 new Data 360 endpoints + "
            "the new investor page).",
            "End-to-end smoke test: POST a moderate hot-flash intake -> "
            "decision routes to mscp-in-person (correctly promoted from "
            "virtual by grounding) -> trace shows four spans "
            "(intake.complete -> data360.identity.resolve -> "
            "data360.grounding.federated-query -> a2a.tasks/send) with "
            "parent/child correlation intact and grounding insights cited.",
            "Agent Fabric registry shows Data 360 with data-grounding "
            "governance tier; three Data 360 policies showing as "
            "block/enforced.",
        ],
    },
]

OPERATIONS_LOG = {
    "title": "Operations log — recurring patterns across the build",
    "items": [
        {
            "name": "Dev server stale-cache failures (Cannot find module './<id>.js')",
            "detail": (
                "Repeatedly observed during long sessions: Next.js dev "
                "occasionally drifts its .next webpack runtime out of sync "
                "with the on-disk routes after large structural changes. "
                "Resolution that worked every time: kill the dev server "
                "(lsof -ti:3000 | xargs kill -9), rm -rf frontend/.next, "
                "restart with WATCHPACK_POLLING=true CHOKIDAR_USEPOLLING=1 "
                "after raising ulimit -n. Documented in README."
            ),
        },
        {
            "name": "EMFILE / file-descriptor limits on macOS",
            "detail": (
                "The Next.js watcher plus dev-mode hot-reload plus polling "
                "exceeds the default macOS open-files cap. ulimit -n 8192 "
                "(or 10240) per shell session before npm run dev resolves "
                "it. Polling watchers (WATCHPACK_POLLING + CHOKIDAR_USE"
                "POLLING) used as a belt-and-suspenders measure."
            ),
        },
        {
            "name": "Module-scoped global for cross-route state",
            "detail": (
                "Both lib/agent-fabric.ts and the Data 360 mock state need "
                "to survive Next dev hot reload AND be the same instance "
                "across every API route. Pattern: store the state object "
                "on globalThis under a private key, lazily initialize, "
                "type the global with a one-line type extension. Lets one "
                "API route record a span that a different API route can "
                "read in the same process."
            ),
        },
        {
            "name": "Soft / dynamic imports for optional SDKs",
            "detail": (
                "Anthropic SDK is imported via `await import('@anthropic"
                "-ai/sdk')` inside the Claude code path so the rest of the "
                "build does not depend on the SDK being installed. The "
                "scripted-policy fallback runs even if @anthropic-ai/sdk "
                "is missing. Same pattern works for any future agent SDK."
            ),
        },
        {
            "name": "Environment-variable gating everywhere",
            "detail": (
                "Every external integration follows the same pattern: read "
                "an env var; if present, run the real path; if absent, run "
                "a deterministic fallback that produces a payload of the "
                "same shape. Documented in .env.example. Lets a reviewer "
                "run the entire prototype with zero credentials."
            ),
        },
        {
            "name": "npm install inside nested monorepo packages",
            "detail": (
                "Initial mcp/ install failed because npm walked up to find "
                "the repo's root and there is no root package.json (this "
                "is intentional). Resolution: cd mcp && npm install "
                "--prefix . explicitly scoped to the package directory."
            ),
        },
        {
            "name": "Commit discipline",
            "detail": (
                "One commit per coherent feature. Every commit message "
                "follows the same shape: title line, blank line, motivation, "
                "blank line, bulleted list of new surface and wiring. Commit "
                "history reads as a build journal on its own."
            ),
        },
    ],
}

CURRENT_STATE = {
    "title": "Current state — what is live, what is mocked",
    "live": [
        "Marketing site, About page, blog and press scaffolds, footer, "
        "legal pages, SEO surface (sitemap, robots, OG, Twitter).",
        "Investor brief: 14 deep-dive pages plus the /proposal/full "
        "single-document narrative.",
        "Clickable prototype: /demo/intake (Agentforce real or scripted "
        "fallback), /demo/patient, /demo/routing (with live Care Router "
        "decision card), /demo/analytics, /demo/agent-fabric (live "
        "console).",
        "Real Code Repository nav link to the GitHub repo.",
        "Python wearable-ingest worker (pause_ingest/) — FLIRT-based, "
        "pytest-covered.",
        "MCP server (mcp/) — four real MCP tools wrapping the Experience "
        "APIs.",
        "Multi-agent control plane: real A2A handoff, real Agent Fabric "
        "trace store, real governance evaluation, real Anthropic path "
        "when configured.",
        "Salesforce Data 360 grounding wired into every Care Router "
        "decision; four-span trace verified end-to-end.",
        "GitHub Actions: frontend-check, codeql, dependabot, vercel-"
        "preview, lighthouse-nightly.",
        "Production deployment on Vercel.",
    ],
    "mocked": [
        "Salesforce Agentforce — real when env vars are set, scripted "
        "fallback otherwise. The scripted path emits the same events as "
        "the real one.",
        "MuleSoft Experience APIs — fixture-backed Next.js routes. "
        "Production swaps the base URL for the customer's Anypoint "
        "deployment without contract changes.",
        "MuleSoft Agent Fabric — in-memory registry, policy catalog, "
        "trace store. Production swaps for the real Anypoint Agent "
        "Fabric service.",
        "Salesforce Data 360 — in-memory federated patient store, "
        "calculated insights as deterministic fixtures, IR stub, four "
        "hand-curated segments. Production swaps for the Data 360 "
        "Federated Query API against the customer's real federated "
        "sources.",
        "Anthropic Claude — real when ANTHROPIC_API_KEY is set, "
        "deterministic policy engine fallback otherwise.",
        "JupyterHealth + DBDP — design documented and reference "
        "scaffolds present; live federation happens when a customer "
        "deployment wires the System APIs to their real JupyterHealth "
        "instance and DBDP feature warehouse.",
    ],
}


# ---------- styling helpers ----------------------------------------------

BRAND_COLOR = RGBColor(0x6A, 0x1B, 0x9A)  # Pause purple
HEADING_COLOR = RGBColor(0x2D, 0x2D, 0x2D)
MUTED_COLOR = RGBColor(0x55, 0x55, 0x55)


def _set_paragraph_spacing(p, space_before: float = 4, space_after: float = 6):
    fmt = p.paragraph_format
    fmt.space_before = Pt(space_before)
    fmt.space_after = Pt(space_after)


def _add_run(p, text: str, *, bold=False, italic=False, size: float = 11,
             color: RGBColor | None = None, monospace: bool = False):
    run = p.add_run(text)
    run.bold = bold
    run.italic = italic
    font = run.font
    font.size = Pt(size)
    if color is not None:
        font.color.rgb = color
    if monospace:
        font.name = "Menlo"
        rPr = run._element.get_or_add_rPr()
        rFonts = OxmlElement("w:rFonts")
        rFonts.set(qn("w:ascii"), "Menlo")
        rFonts.set(qn("w:hAnsi"), "Menlo")
        rFonts.set(qn("w:cs"), "Menlo")
        rPr.append(rFonts)
    return run


def add_title(doc: Document, text: str):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    _add_run(p, text, bold=True, size=26, color=BRAND_COLOR)
    _set_paragraph_spacing(p, 0, 8)


def add_subtitle(doc: Document, text: str):
    p = doc.add_paragraph()
    _add_run(p, text, italic=True, size=12, color=MUTED_COLOR)
    _set_paragraph_spacing(p, 0, 14)


def add_h1(doc: Document, text: str):
    p = doc.add_paragraph()
    _add_run(p, text, bold=True, size=18, color=HEADING_COLOR)
    _set_paragraph_spacing(p, 18, 8)


def add_h2(doc: Document, text: str):
    p = doc.add_paragraph()
    _add_run(p, text, bold=True, size=14, color=HEADING_COLOR)
    _set_paragraph_spacing(p, 12, 4)


def add_h3(doc: Document, text: str):
    p = doc.add_paragraph()
    _add_run(p, text, bold=True, size=12, color=HEADING_COLOR)
    _set_paragraph_spacing(p, 10, 2)


def add_paragraph(doc: Document, text: str, *, italic: bool = False,
                  color: RGBColor | None = None):
    p = doc.add_paragraph()
    _add_run(p, text, size=11, italic=italic, color=color)
    _set_paragraph_spacing(p, 2, 6)


def add_bullets(doc: Document, items: Iterable[str]):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        _add_run(p, item, size=11)
        _set_paragraph_spacing(p, 1, 2)


def add_monospace_block(doc: Document, text: str):
    """Render preformatted text in a monospace font, no wrapping changes."""
    for line in text.splitlines() or [""]:
        p = doc.add_paragraph()
        _add_run(p, line if line else "\u00a0", size=9, monospace=True)
        _set_paragraph_spacing(p, 0, 0)


def add_page_break(doc: Document):
    doc.add_page_break()


# ---------- rendering ----------------------------------------------------

def render(doc: Document):
    # cover
    add_title(doc, DOC_TITLE)
    add_subtitle(doc, DOC_SUBTITLE)
    add_paragraph(doc, DOC_AUTHOR_LINE, italic=True, color=MUTED_COLOR)

    add_h2(doc, "How to read this document")
    add_paragraph(
        doc,
        "The document is organized as a series of build phases in the "
        "order they happened. Each phase records the ask, the decisions "
        "and trade-offs made, what was built, and how it was verified. "
        "Two appendices at the end summarize recurring operational "
        "patterns and the current state of the prototype.",
    )

    add_h2(doc, "Project overview")
    for para in OVERVIEW_PARAGRAPHS:
        add_paragraph(doc, para)

    add_page_break(doc)

    add_h1(doc, "End-state architecture")
    add_paragraph(
        doc,
        "The diagram below shows the current shape of the prototype after "
        "the most recent (Data 360) phase. Every block on the diagram is "
        "either a real running surface in the repo or a documented mock "
        "with the same wire shape as its production replacement.",
    )
    add_monospace_block(doc, ARCH_DIAGRAM)

    add_h2(doc, "Monorepo layout")
    add_monospace_block(doc, MONOREPO_LAYOUT)

    add_page_break(doc)

    add_h1(doc, "Build phases")

    for i, phase in enumerate(PHASES, start=1):
        add_h2(doc, phase["title"])

        add_h3(doc, "Ask")
        add_paragraph(doc, phase["ask"])

        add_h3(doc, "Decisions and trade-offs")
        add_bullets(doc, phase["decisions"])

        add_h3(doc, "What was built")
        add_bullets(doc, phase["built"])

        add_h3(doc, "Verification")
        add_bullets(doc, phase["verified"])

        if i != len(PHASES):
            add_page_break(doc)

    add_page_break(doc)

    add_h1(doc, OPERATIONS_LOG["title"])
    add_paragraph(
        doc,
        "Patterns that came up repeatedly across phases. Recording them "
        "here both because they will recur and because they affect how a "
        "reviewer should run the prototype locally.",
    )
    for item in OPERATIONS_LOG["items"]:
        add_h3(doc, item["name"])
        add_paragraph(doc, item["detail"])

    add_page_break(doc)

    add_h1(doc, CURRENT_STATE["title"])
    add_h2(doc, "Live and real in the prototype today")
    add_bullets(doc, CURRENT_STATE["live"])
    add_h2(doc, "Mocked, with documented production shape")
    add_bullets(doc, CURRENT_STATE["mocked"])

    add_h2(doc, "Closing note")
    add_paragraph(
        doc,
        "The prototype is intentionally honest about every mock. Every "
        "mocked API response carries a meta._note explaining what it is "
        "and what replaces it in production; every investor page includes "
        "a prototype-vs-production table. A reviewer can run the full "
        "intake -> A2A -> Care Router -> Data 360 grounding flow locally "
        "with no credentials, see the four-span trace in the live Agent "
        "Fabric console, and open the federated Data 360 record JSON for "
        "the patient — all from a single npm run dev.",
    )


def main() -> int:
    doc = Document()
    # set wider page (still letter), comfortable margins
    for section in doc.sections:
        section.left_margin = Inches(0.9)
        section.right_margin = Inches(0.9)
        section.top_margin = Inches(0.9)
        section.bottom_margin = Inches(0.9)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    render(doc)
    doc.save(OUTPUT_PATH)

    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"wrote {OUTPUT_PATH} ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
