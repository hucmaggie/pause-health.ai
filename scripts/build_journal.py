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
   │  Agentforce Service Agent (front door) — LIVE**                       │
   │  Pause_Health_Intake_Agent (Service Cloud) embedded via V2 Messaging  │
   │  for Web on pause-health.ai. Scripted Pause fallback for unconfigured │
   │  forks/previews.                                                      │
   └───────────────────────────────────────────────────────────────────────┘
                                  │
                                  │  Google A2A `tasks/send` with intake + grounding
                                  ▼
   ┌────────────┐                 ┌────────────────────────────────────┐
   │ Salesforce │ <───── REST ─── │ Pause Care Router (Anthropic Claude)│
   │ Health     │  IR + grounding │ Real Claude when ANTHROPIC_API_KEY  │
   │ Cloud      │ federated query │ set; deterministic policy fallback  │
   │ (LIVE)*    │                 │                                     │
   └────────────┘                 └────────────────────────────────────┘
       │ * Real OAuth 2.0 client credentials against a connected
       │   Salesforce Developer Edition org. SOQL against Contact +
       │   CareProgramEnrollee + CarePlan + Case. Falls back to the
       │   mocked Data 360 fixtures when SF_INSTANCE_URL / SF_CLIENT_ID
       │   / SF_CLIENT_SECRET are unset (zero-credential default).
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
       The Health Cloud layer (Phase 1) is LIVE against a real org;
       the Data Cloud unified-profile layer (Phase 2) is provisioned
       but deferred — 31 unified DMOs exist with no Data Streams.
     • A real Anypoint Platform org is connected for future MuleSoft
       work; today every Experience API is still served by the Next.js
       mock. Next-session plan lives in docs/MULESOFT_RUNBOOK.md.
     • ** Agentforce embedded chat (Phase 3) shipped 2026-06-02. Real
       Salesforce Agentforce Service Agent on Service Cloud, V2
       Messaging for Web bootstrap, routed through Omni-Channel
       (Agentforce Service Agent routing) directly to the agent.
       See docs/PHASE_3_RUNBOOK.md for the deployment topology and
       the two gotchas we hit (clientVersion=WebV1 default needing a
       Tooling API v65 PATCH; Messaging Channel routing needing to
       point at the agent, not a legacy Omni-Flow).
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
│   ├── components/                           UI components + intake fallback + agentforce-embed
│   ├── lib/                                  a2a, care-router, agent-fabric, data-360, mulesoft-mocks
│   │   └── salesforce/                       auth.ts (OAuth client creds), grounding.ts (real SOQL),
│   │                                         auth.test.ts, grounding.test.ts (vitest)
│   ├── scripts/                              salesforce-smoke.mjs, salesforce-seed.mjs,
│   │                                         grounding-smoke.mjs (idempotent demo data)
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
├── docs/                                   ← Engineering runbooks alongside design docs
│   ├── mulesoft-integration.md               Three-tier API-Led architecture
│   ├── jupyterhealth-integration.md          Clinical substrate design
│   ├── PHASE_3_RUNBOOK.md                    Next-session Agentforce deployment plan
│   └── MULESOFT_RUNBOOK.md                   Next-session Anypoint deployment plan
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
    {
        "title": (
            "Phase 12 — Real Salesforce org integration: Health Cloud "
            "grounding (Full Path A, Phase 1)"
        ),
        "ask": (
            "User stated: 'I have a Salesforce org that I could hook up "
            "the prototype with.' Phase 11 Data 360 was entirely mocked; "
            "this pivot moved the grounding plane from in-memory "
            "fixtures to a real, connected Salesforce Developer Edition "
            "org. Scope agreed: Full Path A (Health Cloud objects + Data "
            "Cloud unified profile + real Agentforce intake), executed "
            "as three sub-phases. Phase 12 covers sub-phase 1: real "
            "Health Cloud grounding."
        ),
        "decisions": [
            "Authentication: OAuth 2.0 Client Credentials Flow via "
            "Salesforce External Client App (modern replacement for the "
            "legacy Connected App). Server-to-server only; no user "
            "redirect, no browser dependency. The same pattern carries "
            "over to MuleSoft, Anypoint, and any future server-to-server "
            "integration.",
            "Real data: six menopause-specific Health Cloud records "
            "seeded into the org via a dedicated idempotent script "
            "(scripts/salesforce-seed.mjs). Used Contact + CarePlan + "
            "CareProgramEnrollee + Case rather than fabricating custom "
            "objects, so the demo composes with any future Health Cloud "
            "package without remapping.",
            "Schema reality forced two adjustments: linked "
            "CareProgramEnrollee to Account (not Contact); dropped the "
            "non-existent EnrolleeType column. The seeding script "
            "introspects the org's actual schema rather than assuming "
            "any documented field.",
            "Graceful degradation preserved: when SF_INSTANCE_URL / "
            "SF_CLIENT_ID / SF_CLIENT_SECRET are unset, the API routes "
            "fall back to the deterministic Data 360 mock. Reviewers, "
            "Vercel previews, and CI run with zero credentials. When set, "
            "every Care Router decision is grounded in real org data and "
            "the Agent Fabric trace span carries _source: 'real'.",
            "Zscaler hit once on the way: the corporate proxy intercepted "
            "*.c360a.salesforce.com (Data Cloud's hostname family) with a "
            "504 Gateway Timeout. Pausing Zscaler resolved it; documented "
            "as a known constraint for any future Salesforce-edge work.",
        ],
        "built": [
            "frontend/lib/salesforce/auth.ts — OAuth client credentials "
            "token acquisition, in-memory caching with expiry, request "
            "deduplication, isSalesforceConfigured() guard.",
            "frontend/lib/salesforce/grounding.ts — real SOQL fetcher "
            "and identity resolver against Contact + CarePlan + "
            "CareProgramEnrollee + Case; preserves the GroundingContext "
            "shape the Care Router already consumes.",
            "frontend/scripts/salesforce-smoke.mjs — standalone "
            "auth-and-query smoke test runnable independently of Next.js.",
            "frontend/scripts/salesforce-seed.mjs — idempotent demo-data "
            "seeder (six Contacts + linked CarePlan/Enrollee/Case rows) "
            "with explicit cleanup logic.",
            "frontend/scripts/grounding-smoke.mjs — end-to-end smoke of "
            "the real grounding fetcher.",
            "Wiring in /api/data-360/identity/resolve and "
            "/api/intake/route-to-care-router to use real Salesforce data "
            "when configured, mock otherwise.",
            "Agent Fabric console (/demo/agent-fabric) extended with a "
            "trace-level _source banner: every span shows 'real' or "
            "'mock' so the demo never lies about provenance.",
            "/proposal/data-360 investor page updated to mark Phase 1 "
            "as LIVE with a banner.",
            "README.md updated with the new live integrations section "
            "and the External Client App setup walkthrough.",
            ".env.example documented SF_INSTANCE_URL, SF_CLIENT_ID, "
            "SF_CLIENT_SECRET, SF_API_VERSION with comments explaining "
            "the OAuth client credentials policy and the My Domain URL "
            "requirement.",
        ],
        "verified": [
            "salesforce-smoke.mjs returns a valid access token against "
            "the connected org.",
            "salesforce-seed.mjs seeds six demo Contacts + linked "
            "Health Cloud records on a fresh run, then re-running "
            "produces zero diffs (idempotent).",
            "grounding-smoke.mjs returns a populated GroundingContext.",
            "End-to-end: POST a moderate hot-flash intake -> trace span "
            "for data360.grounding.federated-query shows _source: 'real' "
            "with citations pulled from the live org -> Care Router "
            "decision visibly changes vs the mocked-only path.",
            "When env vars are removed, the same flow re-runs and the "
            "trace span flips back to _source: 'mock' without code "
            "changes — graceful degradation verified both directions.",
        ],
    },
    {
        "title": (
            "Phase 13 — Polish: schema cleanup, auth unit tests, "
            "warn-once deduplication"
        ),
        "ask": (
            "Before moving to the next sub-phase of the Salesforce "
            "integration, polish three things the Phase 12 implementation "
            "left rough: (1) the seeded Contact.LastName was awkwardly "
            "encoded ('Pause Demo Patient:<name>'); (2) lib/salesforce/"
            "auth.ts had no unit tests; (3) the fallback path warned on "
            "every request when Salesforce was misconfigured, drowning "
            "the dev console."
        ),
        "decisions": [
            "Contact schema fix: chose the delete_reseed approach (user "
            "preference) rather than in-place update. New schema uses "
            "Contact.Title = 'Pause Demo Patient' and Contact.Department "
            "= 'Pause Demo' for demo tagging, with LastName carrying the "
            "actual surname. The cleanup predicate ORs across old and "
            "new tagging so a re-run safely deletes either generation.",
            "Auth tests with vitest covering happy-path, cached token "
            "reuse, in-flight deduplication, error propagation, expiry "
            "handling. Seventeen tests total.",
            "Warn-once helper (warnSalesforceDegradationOnce) keys on "
            "context + error name + error message prefix. Dev console "
            "stays usable even when the org is intentionally unconfigured "
            "for an entire session; the first failure of each category "
            "still surfaces.",
        ],
        "built": [
            "frontend/lib/salesforce/auth.test.ts — 17 unit tests "
            "covering getSalesforceConfig, isSalesforceConfigured, "
            "getAccessToken (cache hit, in-flight dedup, error paths, "
            "expiry).",
            "frontend/lib/salesforce/grounding.test.ts — 6 tests for "
            "warnSalesforceDegradationOnce dedup behavior.",
            "Updated scripts/salesforce-seed.mjs with the new tagging "
            "schema and a unified cleanup predicate.",
            "Updated scripts/grounding-smoke.mjs SOQL to match the new "
            "tagging.",
            "Updated /api/data-360/identity/resolve/route.ts and "
            "/api/intake/route-to-care-router/route.ts to use the "
            "warn-once helper.",
        ],
        "verified": [
            "npm test (vitest) passes including all 23 new salesforce/* "
            "tests.",
            "salesforce-seed.mjs delete + reseed cycle leaves zero "
            "stragglers in the org.",
            "Dev console during a Salesforce-unconfigured run shows one "
            "warn per failure category instead of one warn per request.",
            "Committed and pushed to main.",
        ],
    },
    {
        "title": (
            "Phase 14 — Salesforce Data Cloud (Phase 2): investigation "
            "and deferral"
        ),
        "ask": (
            "Move to sub-phase 2 of the Full Path A integration: real "
            "Data Cloud unified-profile layer feeding the Care Router."
        ),
        "decisions": [
            "Investigation confirmed the org's Data Cloud workspace is "
            "PROVISIONED but EMPTY: 31 unified DMOs exist "
            "(ssot__Individual__dlm etc.) with no Data Streams currently "
            "feeding them. Activation requires creating Data Streams, "
            "DLO mappings, Identity Resolution rules, and Calculated "
            "Insights — a 2-4 hour Setup UI exercise that produces no "
            "engineering artifact in the repo.",
            "Two OAuth scope additions were required to make Data Cloud "
            "even introspectable from outside Salesforce: cdp_api, "
            "cdp_profile_api, cdp_ingest_api on the External Client App. "
            "The /services/a360/token endpoint rejected calls without "
            "them.",
            "Decision: defer Phase 2 to a dedicated session with screen-"
            "share clickthrough. The engineering side is ready (lib/"
            "salesforce/auth.ts handles CDP scopes; the grounding fetcher "
            "is structured to accept a unified Individual record); the "
            "remaining work is entirely UI configuration inside the "
            "Salesforce org.",
        ],
        "built": [
            "Updated External Client App scopes documented in .env.example.",
            "README.md updated to mark Phase 2 as 'Data Cloud workspace "
            "provisioned but no Data Streams currently feed it; "
            "activation is a 2-4 hour Setup UI exercise.'",
            "/proposal/data-360 still accurately reflects Phase 1 LIVE / "
            "Phase 2 documented-but-deferred.",
        ],
        "verified": [
            "OAuth token request against /services/a360/token returns 200 "
            "with the new cdp_* scopes (was 'invalid_scope' before).",
            "SOQL against ssot__Individual__dlm and similar unified DMOs "
            "succeeds but returns zero rows — proving the schema exists "
            "and no Data Streams have hydrated it.",
            "No regression on Phase 1: Health Cloud grounding still "
            "shows _source: 'real' on every span.",
        ],
    },
    {
        "title": (
            "Phase 15 — Real Agentforce embedded chat (Phase 3): "
            "investigation, partial wiring, deferral with runbook"
        ),
        "ask": (
            "Pivot from Phase 2 to sub-phase 3: replace the scripted "
            "/demo/intake fallback with the real Salesforce Agentforce "
            "Embedded Messaging widget, served from a configured "
            "Experience Cloud site."
        ),
        "decisions": [
            "Investigation found the org already had: a Messaging "
            "channel, an Experience site, three agents, and an "
            "Embedded Service deployment named SDO_Messaging_for_Web. "
            "Plumbing this in took ~80% of the session.",
            "All four NEXT_PUBLIC_AGENTFORCE_* env vars set; "
            "components/agentforce-embed.tsx switched from inline to "
            "floating displayMode after extensive DOM debugging; "
            "globals.css updated with a compact launcher-callout and a "
            "minimal #embedded-messaging z-index defence.",
            "Hit a HARD CEILING that we don't control: the SDO sample "
            "deployment's runtime config endpoint (salesforce-scrt.com) "
            "blocks external origins via missing Access-Control-Allow-"
            "Origin, AND the Experience site's commcsp policy hardcodes "
            "frame-ancestors to a DIFFERENT org's domain. Neither is "
            "modifiable from the consumer side. The launcher mounts in "
            "the DOM but its inner iframe stays display:none after the "
            "config fetch is CORS-blocked.",
            "Three Salesforce-side fixes attempted and verified: added "
            "http://localhost:3000 to CorsWhitelistEntry; set "
            "AreGuestUsersAllowed = true via Tooling API (the field is "
            "not directly writable, had to PATCH the Metadata field); "
            "switched the Experience site deployment from V1 to V2. None "
            "lifted the SDO-sample restrictions.",
            "Decision: defer to a dedicated session where the user "
            "authors a Pause-Health-owned Embedded Service deployment "
            "+ Experience site + agent. Captured the full sequence in "
            "docs/PHASE_3_RUNBOOK.md so the next session is "
            "click-through-only rather than re-investigation.",
        ],
        "built": [
            "components/agentforce-embed.tsx — production-shape React "
            "wrapper around the V2 embedded_service_bootstrap, with "
            "floating displayMode and a status-driven launcher callout "
            "(loading / ready / error states).",
            "components/agentforce-fallback.tsx — refined Pause-branded "
            "scripted intake; emits the same intake.completed event as "
            "the real widget so downstream A2A + Care Router + Agent "
            "Fabric flows are unaffected.",
            "globals.css — agentforce-launcher-callout styles plus a "
            "minimal z-index override for #embedded-messaging so the "
            "Salesforce-injected launcher sits above Pause's toast "
            "region (no other overrides — Salesforce owns its own "
            "internal CSS).",
            "lib/agentforce.ts — getAgentforceConfig() helper that "
            "reads and validates the four NEXT_PUBLIC_AGENTFORCE_* env "
            "vars; returns null when any is missing (drives the "
            "fallback).",
            "docs/PHASE_3_RUNBOOK.md — the 2-4 hour next-session "
            "playbook with the exact Salesforce restrictions documented "
            "verbatim from the DevTools Console (CORS missing-header, "
            "commcsp frame-ancestors directive).",
            ".env.example and .env.local annotated with multi-paragraph "
            "comments explaining the SDO-sample restrictions, so the "
            "next agent or developer does not waste a session on the "
            "same dead end.",
            "README.md updated with the /demo/intake status section.",
        ],
        "verified": [
            "Bootstrap script downloads and embedded_service_bootstrap "
            ".init succeeds — the integration code is correct.",
            "DevTools Console reproduces the two specific Salesforce-"
            "side blockers (CORS and CSP frame-ancestors) deterministically.",
            "With env vars unset, /demo/intake renders the polished "
            "Pause-branded scripted fallback end-to-end.",
            "Committed and pushed: floating-mode wiring + investigation "
            "findings + next-session runbook.",
        ],
    },
    {
        "title": (
            "Phase 16 — MuleSoft Anypoint integration: investigation "
            "and next-session runbook"
        ),
        "ask": (
            "User stated: 'I have a MuleSoft org to be used for the "
            "prototype.' Scope agreed: investigate-only (~30 minutes), "
            "no Anypoint UI clickthrough, no commits to wiring. Produce "
            "a runbook calibrated against the Salesforce Phase 1 / "
            "Phase 3 lessons."
        ),
        "decisions": [
            "Inventoried the existing MuleSoft surface area: 4 mocked "
            "Experience-API routes, real Mule 4 reference flow, real "
            "DataWeave 2.0 transform (OMH -> FHIR R5), MCP server "
            "already supporting PAUSE_MCP_BASE_URL for swapping to a "
            "real Anypoint runtime, polished investor page, and full "
            "design doc. The story is more developed than Salesforce "
            "was at the same point — only the live runtime is missing.",
            "Probed Anypoint Platform hostnames. anypoint.mulesoft.com, "
            "eu1, gov, the OAuth token endpoint, us-e1.cloudhub.io, "
            "us-east-1.cloudhub.io, mq-us-east-1.anypoint.mulesoft.com, "
            "and the Exchange asset CDN all resolve and return their "
            "expected status codes. The Anypoint OAuth endpoint cleanly "
            "returns 401 to bogus client credentials — same shape as "
            "Salesforce, which means the auth pattern carries over.",
            "Headline network finding: Anypoint resolves through "
            "*.edge2.salesforce.com — the same edge family as the user's "
            "Salesforce org. Good news (Zscaler exception likely "
            "covers both), risk (if Zscaler tightens *.salesforce.com "
            "later, both Salesforce and MuleSoft break).",
            "Recommended scope: replace ONE mocked Experience API "
            "(/api/mulesoft/health) with a real Mule app deployed to "
            "CloudHub 2.0. Reasons: canonical demo URL linked from "
            "everywhere; payload fully synthetic so safe on a public "
            "worker; no upstream dependencies (the bundle does not "
            "need live JHE or pause_ingest); MCP server already supports "
            "the swap; tells the right investor story (one URL flips "
            "from 'mocked' to 'live on Anypoint Platform').",
            "Calibration against Salesforce: this looks like Phase 1 "
            "(server-to-server OAuth, no embedding, graceful "
            "degradation pattern proven) rather than Phase 3 (CORS/CSP-"
            "bound widget). High confidence the next session ships in "
            "one sitting.",
        ],
        "built": [
            "docs/MULESOFT_RUNBOOK.md (357 lines) — surface-area "
            "inventory, Zscaler probe results table, recommended scope, "
            "7-step playbook (Connected App -> Code Builder/Studio -> "
            "deploy -> wire with graceful degradation -> investor-page "
            "and Agent Fabric trace update -> MCP wiring note -> "
            "verification + commit), iteration 2+ priorities, "
            "calibration table vs Salesforce Phase 1/3, open questions "
            "for the user.",
            "README.md — one-paragraph pointer to the new runbook on "
            "the /proposal/mulesoft line.",
        ],
        "verified": [
            "All Anypoint hostnames reachable (recorded with HTTP code, "
            "TLS verify result, IP, and notes).",
            "Anypoint OAuth endpoint returns Unauthorized to bogus "
            "credentials — auth surface confirmed healthy.",
            "No code changes, no new env vars in .env.local, no new "
            "dependencies — investigation-only scope honored.",
            "Committed and pushed as 59c5d9a.",
        ],
    },
    {
        "title": (
            "Phase 17 — Site polish and recognition: profile, social "
            "links, security.txt, JSON-LD, canonical domain"
        ),
        "ask": (
            "Scattered across phases 12-16: lift the production site's "
            "polish and machine-readability so URL classifiers and "
            "social previews recognize Pause-Health.ai correctly, and "
            "fix the canonical domain so the deployed site advertises "
            "itself as pause-health.ai rather than pause-health-ai.vercel"
            ".app."
        ),
        "decisions": [
            "Canonical URLs handled via NEXT_PUBLIC_SITE_URL + an "
            "absoluteUrl() helper, NOT via assetPrefix. assetPrefix is "
            "for asset paths; we wanted the canonical/OG/sitemap URLs "
            "themselves to be on the apex domain. One environment "
            "variable, every page picks it up.",
            "Find-and-replace pause-health-ai.vercel.app -> pause-health"
            ".ai turned out to be a Vercel project setting + DNS work, "
            "not a code change. Documented the DNS + Zscaler unblocking "
            "steps for the next time the production domain is migrated.",
            "About page: added Maggie C. Hu's profile picture and "
            "LinkedIn social link. Real founder presence rather than a "
            "placeholder.",
            "security.txt + Organization JSON-LD added so URL "
            "classifiers (Slack, LinkedIn, Twitter, Google Search) "
            "recognize Pause-Health.ai as a legitimate organization "
            "rather than as an unverified Vercel preview URL.",
        ],
        "built": [
            "lib/page-metadata.ts (or equivalent) wired to "
            "NEXT_PUBLIC_SITE_URL via the absoluteUrl helper; every "
            "page's metadata.canonical, openGraph.url, twitter.url, and "
            "the sitemap entries derive from one source.",
            "About page updated with the founder profile picture and "
            "LinkedIn link.",
            "frontend/public/.well-known/security.txt — security contact "
            "and policy URL.",
            "Organization JSON-LD on the homepage so classifiers see "
            "name, logo, sameAs (LinkedIn, GitHub), and URL.",
            "README.md and Vercel docs updated with the DNS + Zscaler "
            "guidance for canonical-domain migrations.",
        ],
        "verified": [
            "Production pages return the correct canonical/OG URLs.",
            "security.txt resolves over HTTPS with the right content type.",
            "Organization JSON-LD validates in Google's Rich Results "
            "test.",
            "About page renders the founder picture and LinkedIn link "
            "on both desktop and mobile.",
        ],
    },
    {
        "title": (
            "Phase 18 — Real Agentforce embedded chat (Phase 3) shipped "
            "end-to-end"
        ),
        "ask": (
            "Continue from the Phase 15 deferral: actually stand up a "
            "Pause-Health-owned Agentforce Embedded Messaging deployment "
            "so /demo/intake serves a live Salesforce Agentforce Service "
            "Agent on pause-health.ai, not the scripted fallback."
        ),
        "decisions": [
            "Authored a Pause-Health-owned deployment from scratch "
            "(EmbeddedServiceConfig DeveloperName=Pause_Health_Intake, "
            "DeploymentFeature=EmbeddedMessaging, DeploymentType=Web) "
            "instead of reusing the legacy SDO sample. This is the "
            "only path that gets the Experience site's auto-generated "
            "frame-ancestors header to include our origins.",
            "Built the agent in Agent Builder (NOT the legacy Einstein "
            "Bots UI). Pause_Health_Intake_Agent is a Type=Service Agent "
            "(Agentforce GA), Version 1 Active, with two subagents "
            "(Escalation + Menopause Symptom Intake) and 7 instructions "
            "including red-flag escalation rules. The legacy Einstein "
            "Bots page in Setup does not show Service Agents at all — "
            "a real footgun for anyone porting from older docs.",
            "Bound the agent to the channel via Setup -> Messaging "
            "Settings -> Messaging for In App & Web -> Omni-Channel "
            "Routing -> Routing Type = Agentforce Service Agent -> "
            "Pause_Health_Intake_Agent. Did NOT use Agentforce's own "
            "'Connections' tab on the agent detail page — that tab "
            "only supports Type=API (external app integrations), not "
            "messaging channels. The binding lives on the channel side.",
            "Allowed external origins at the org level via two surfaces, "
            "both required: (a) Setup -> CORS (CorsWhitelistEntry "
            "records https://pause-health.ai + https://*.pause-health.ai), "
            "(b) Setup -> Security -> Trusted URLs (Pause_Health_AI_"
            "Production + Pause_Health_AI_Wildcard with CSP Context=All "
            "and all 6 CSP directives ticked). Both edited from the UI; "
            "SiteIframeWhiteListUrl REST writes return INSUFFICIENT_"
            "ACCESS_ON_CROSS_REFERENCE_ENTITY so the UI is the only "
            "path for the second surface.",
            "Used Tooling API v65 (NOT v60) to PATCH "
            "EmbeddedServiceConfig.Metadata.clientVersion = 'WebV2'. "
            "Older API versions either silently drop the field or "
            "return FIELD_INTEGRITY_EXCEPTION. The deployment defaults "
            "to WebV1 in the UI even though DeploymentFeature is "
            "EmbeddedMessaging, which the SDK runtime interprets as "
            "the V1 wire protocol and which causes the chat panel to "
            "fail its handshake. The field must be explicitly PATCHed, "
            "then the deployment must be republished for SCRT2 to pick "
            "it up.",
            "On every UI screen handoff, asked the user for a "
            "screenshot before guessing at the click path. The "
            "Agentforce vs Einstein Bots UI split, the V1 vs V2 "
            "modal mess, and the Connections-tab-is-API-only "
            "footgun were all caught this way without burning "
            "trial-and-error cycles on the wrong screen.",
        ],
        "built": [
            "Salesforce: Pause_Health_Intake_Agent (BotDefinition "
            "0XxHp0000014tiuKAA, Type=Service Agent, v1 Active) with "
            "two subagents and seven instructions including red-flag "
            "and red-zone safety escalation rules; Pause_Health_Intake "
            "EmbeddedServiceConfig (Id 04IHp0000011V2VMAU, clientVersion=WebV2, "
            "AreGuestUsersAllowed=true, IsEnabled=true); "
            "ESW_Pause_Health_Intake_17804555025671 Experience site "
            "(Id 0DMHp0000019wJoOAI, URL prefix ESWPauseHealthIntake1780455502567, "
            "frame-ancestors=pause-health.ai + *.pause-health.ai); "
            "two CorsWhitelistEntry records; two Trusted URL records; "
            "Omni-Channel Routing on Messaging_for_In_App_Web pointed "
            "directly at the agent.",
            "Frontend: NEXT_PUBLIC_AGENTFORCE_* env vars in .env.local "
            "and Vercel project settings (Production + Preview + "
            "Development); /demo/intake renders the Live agent UI "
            "automatically when all four are set; component handles "
            "the loading / initializing / ready / error lifecycle via "
            "onEmbeddedMessagingReady and onEmbeddedMessagingInitError "
            "listeners.",
            "Diagnostics: frontend/public/agentforce-probe.html — a "
            "self-contained probe page that loads the bootstrap with "
            "the same params and logs every SDK lifecycle event to an "
            "on-page console. Useful when DevTools is ambiguous about "
            "which tab/iframe context it is attached to. Lives at "
            "/agentforce-probe.html on both production and preview "
            "deployments.",
            "Docs: docs/PHASE_3_RUNBOOK.md updated with the final "
            "deployment topology, root-cause analysis of the two "
            "surprises we hit (clientVersion=WebV1 default needs "
            "Tooling API v65 PATCH; legacy HLS - Route to Bot flow "
            "needs to be swapped for Agentforce Service Agent routing), "
            "and the 5-item prereq checklist any future deployment "
            "has to meet.",
        ],
        "verified": [
            "End-to-end conversation on https://pause-health.ai/demo/intake "
            "at 21:46 PT 2026-06-02: launcher renders, panel opens, "
            "agent joins ('Pause Health Intake Agent joined'), agent "
            "replies ('Hi, I'm an AI service assistant. How can I help "
            "you?'), Powered-by-Agentforce footer shows.",
            "SCRT2 embedded-service-config endpoint emits "
            "Access-Control-Allow-Origin: https://pause-health.ai "
            "(and https://www.pause-health.ai) after the CORS + "
            "Trusted URLs + republish round-trip.",
            "bootstrap.min.js serves 200 OK with 101,604 bytes (full "
            "V2 bundle, embeddedservice_bootstrap.init namespace) "
            "across multiple CDN edge nodes.",
            "EmbeddedServiceConfig.Metadata.clientVersion = WebV2 "
            "round-tripped through the Tooling API v65 PATCH and "
            "is now reflected in SCRT2 config payload after republish.",
            "Channel routing: Setup -> Messaging Settings -> "
            "Messaging for In App & Web shows Omni-Channel Routing "
            "= Agentforce Service Agent -> Pause Health Intake Agent.",
            "Graceful degradation preserved: when the four "
            "NEXT_PUBLIC_AGENTFORCE_* env vars are not set, "
            "/demo/intake falls back to the Pause-branded scripted "
            "intake.",
        ],
    },
    {
        "title": (
            "Phase 18a — Pre-fill the live Agentforce chat with patient "
            "context (setHiddenPrechatFields)"
        ),
        "ask": (
            "Make the live Agentforce Service Agent walk into every "
            "conversation already knowing who the patient is. Reuse "
            "the existing Data 360 + Health Cloud Phase 1 grounding "
            "pipeline so the same identity-resolution and federated-"
            "read path that the Care Router consumes also serves the "
            "intake widget."
        ),
        "decisions": [
            "Built /demo/intake's 'View as <patient>' picker over the "
            "six seeded Salesforce Health Cloud demo personas instead "
            "of inventing a new cohort. Centralized the personas in "
            "lib/demo-cohort.ts so the picker, the queue table, and "
            "the seeder all point at one authoritative list. The "
            "Salesforce grounding module already keys on Contact."
            "FirstName, so the picker's personaId -> firstName mapping "
            "deterministically lands on the right real Contact.",
            "Re-mounted <AgentforceEmbed/> with a React key on "
            "personaId rather than trying to swap hidden-prechat "
            "fields inside a live SDK session. Salesforce's Embedded "
            "Messaging SDK is process-global and intentionally has no "
            "swap-mid-conversation API; the supported pattern is "
            "'configure once, before onEmbeddedMessagingReady fires.' "
            "Forcing a clean React remount on persona change is the "
            "tidy way to honor that constraint.",
            "Packed the dossier into ~22 string-typed hidden-prechat "
            "fields PLUS one compact Patient_Context_JSON catch-all. "
            "Reason: Salesforce hidden-prechat field names must be "
            "pre-registered as Parameter Mappings on the Messaging "
            "Channel (unregistered keys are silently dropped) and the "
            "field type is text-only. Splitting first-class fields "
            "(name, age band, scores) from a JSON dossier (longitudinal "
            "observations, insights, narrative profile) gives the "
            "agent prompt clean variables to cite while still carrying "
            "every signal we computed.",
            "Built the prechat-context endpoint as GET, not POST. "
            "The picker selection -> resolved dossier is idempotent "
            "for a given personaId, so GET keeps cache semantics "
            "obvious (no body, cacheable per-querystring if we "
            "want CDN caching later). Mirrors how the rest of the "
            "Data 360 read routes are shaped.",
            "Documented (but did NOT block on) the Parameter Mappings "
            "registration step in PHASE_3_RUNBOOK.md. Standard "
            "underscore fields (_firstName, _lastName) are auto-"
            "accepted by Salesforce so the agent already sees those "
            "without any admin work. The remaining ~20 fields show up "
            "as Conversation Variables once an admin clicks through "
            "Setup -> Messaging Settings -> Messaging for In App & Web "
            "-> Parameter Mappings -> Add (one row per field). The "
            "client sends them regardless of registration, so no "
            "frontend redeploy is required when the registration "
            "happens.",
        ],
        "built": [
            "lib/demo-cohort.ts — single source of truth for the six "
            "seeded personas (Anika Patel, Brianna Okafor, Carmen "
            "Diaz, Deepa Krishnan, Elena Rossi, Fatima Khan) including "
            "display metadata (symptoms / risk tier / wait / source) "
            "and clinical hint signals (ageBand, cycleStatus, "
            "primarySymptom, vasomotor/sleep/mood scores, profile "
            "note). Pure-data module — safe to import from both "
            "server routes and client components.",
            "app/api/intake/prechat-context/route.ts — GET endpoint "
            "that resolves the persona via resolveIdentityFromOrg "
            "(real Salesforce when SF_* env vars are set; deterministic "
            "mock fallback) and getGroundingContextPreferReal (real "
            "Health Cloud Phase 1 SOQL when available; mock baseline "
            "otherwise), then flattens both into a ~22-field hidden-"
            "prechat bag including a clamped (<1800 bytes) "
            "Patient_Context_JSON dossier. Returns 404 on unknown "
            "personaId.",
            "components/intake-patient-stage.tsx — client component "
            "rendering the 'View as <patient>' radio-group picker "
            "above the agent. Fetches /api/intake/prechat-context on "
            "every selection, surfaces identity + grounding source "
            "(real | mock) inline so reviewers can see the wiring, "
            "and re-keys <AgentforceEmbed/> on personaId for a clean "
            "SDK remount.",
            "components/agentforce-embed.tsx updated: typed the "
            "prechatAPI surface (setHiddenPrechatFields / "
            "removeHiddenPrechatFields), accepts a new optional "
            "prechatFields prop, applies it inside the "
            "onEmbeddedMessagingReady listener with a one-shot ref "
            "guard, and surfaces prechatStatus (applied | skipped-"
            "no-api | error) under the ready badge so reviewers can "
            "see whether the dossier was successfully handed off.",
            "app/demo/intake/page.tsx rewired: queue-table rows now "
            "come from DEMO_COHORT (consistent with the live Salesforce "
            "org), and the agent section renders the new "
            "IntakePatientStage when Agentforce is configured.",
            "Docs: PHASE_3_RUNBOOK.md gained a 'Phase 18a follow-up' "
            "section documenting the end-to-end flow, the full hidden-"
            "prechat field schema (22 rows), the Salesforce Parameter "
            "Mappings registration steps, and how the same pattern "
            "would work in a real customer deployment (replace "
            "personaId with the authenticated patient's identity from "
            "their portal SSO). README.md and .env.example also "
            "updated.",
        ],
        "verified": [
            "Vitest: all 73 existing tests still pass — the new "
            "modules ship without breaking any existing surface.",
            "tsc --noEmit: clean across the full frontend monorepo.",
            "next build: clean; /api/intake/prechat-context appears in "
            "the route manifest as a dynamic (server-rendered) "
            "endpoint; /demo/intake static prerendered shell grew "
            "~5 KB (the new client picker hydrates on demand).",
            "End-to-end on production: selecting each of the six "
            "personas re-keys the SDK; ready badge surfaces "
            "'Prechat context pre-loaded: N fields'; agent responds "
            "to 'what's my name?' with the correct first name (the "
            "two Salesforce-standard underscore fields are auto-"
            "accepted even before the custom Parameter Mappings are "
            "registered).",
            "Graceful degradation preserved: when SF_* env vars are "
            "unset, the prechat-context route still returns a full "
            "dossier (Identity_Source: mock + Grounding_Source: mock) "
            "so the picker keeps working in fork/preview deployments.",
        ],
    },
    {
        "title": (
            "Phase 18b — Land the full agent-side wiring for the prechat "
            "dossier (Flow + MessagingSession fields + agent $Context)"
        ),
        "ask": (
            "Finish the second half of Phase 18a: make the live "
            "Agentforce Service Agent actually consume the dossier we "
            "started sending. Phase 18a got the browser SDK and the "
            "/api/intake/prechat-context endpoint live but only the two "
            "Salesforce-standard underscore fields (_firstName / "
            "_lastName) were reaching the agent. The remaining ~20 "
            "fields needed a Salesforce-side data pipeline to surface."
        ),
        "decisions": [
            "Built the Salesforce side the documented way (a 5-component "
            "pipeline) rather than the lightweight 'just add Parameter "
            "Mappings' approach implied by the Phase 18a runbook. "
            "Discovery during recon: Salesforce only accepts Parameter "
            "Mappings on Messaging Channels whose session handler is a "
            "Flow. Our Phase 18 fix had set the channel to route "
            "directly to the Agentforce Service Agent (bypassing the "
            "legacy SDO bot), which silently disabled the custom-"
            "parameter mechanism. Three options on the table: (A) "
            "lightweight 'inject context as first user message' "
            "workaround, (B) defer the full architecture, (C) build "
            "it the Salesforce-documented way. Picked (C) so the "
            "platform demo looks Salesforce-native end-to-end and so "
            "the same wiring scales to real customer deployments.",
            "Did the entire Salesforce-side build via Metadata API "
            "(force-app + sfdx-project.json + sf project deploy) "
            "instead of clicking through Setup. Trade-off: ~30 min of "
            "metadata authoring up front instead of ~3-5 hours of UI "
            "clicks, and the resulting artifacts are versioned XML "
            "that can be replayed on another org. Even the Omni-"
            "Channel routing Flow (typically built in Flow Builder) "
            "was authored as XML directly — Salesforce's Flow XML "
            "schema is well-documented and the round-trip from "
            "retrieve -> hand-author -> deploy worked first try.",
            "Discovered Salesforce hard-caps every Messaging channel "
            "custom parameter at 255 chars regardless of declared "
            "maxLength, and silently truncates oversized values. "
            "Adjusted the frontend's /api/intake/prechat-context to "
            "clamp every field via a new clampForChannel() helper. "
            "Dropped the rich Patient_Context_JSON dossier (1.4KB) "
            "from the prechat payload entirely — the first 252 bytes "
            "would have been useless JSON header noise. Kept the full "
            "dossier in the API response for out-of-band consumers; "
            "a future custom Apex action invoked by the agent can "
            "fetch it when the agent needs it.",
            "Salesforce caps a Bot at 20 contextVariables total. The "
            "Pause agent already had 5 standard ones (ContactId, "
            "EndUserId, EndUserLanguage, RoutableId, VoiceCallId), so "
            "we got to keep 15 dossier fields as $Context. Dropped "
            "the 5 least useful for the LLM (Identity_Confidence, "
            "Identity_Sources, Identity_Ruleset, Cohort_Size, "
            "Grounding_Insights_Count, Patient_Context_JSON — six in "
            "total after the JSON-dossier drop). All 20 fields are "
            "still written to MessagingSession by the Flow and remain "
            "queryable by Apex actions; only the LLM's in-prompt view "
            "is constrained.",
            "Forced an agent deactivate -> deploy -> activate cycle "
            "for every GenAiPlannerBundle change. Salesforce will not "
            "let you mutate an active agent's planner because the "
            "running session schema can drift mid-conversation. The "
            "sf agent deactivate / sf agent activate CLI commands "
            "wrap a proprietary REST endpoint; the Status field on "
            "BotVersion isn't directly REST-writable.",
            "Added two sortOrder=0 instructions to the Menopause "
            "Symptom Intake topic instead of rewriting the existing "
            "7 instructions. The new ones (instruction_0_dossier + "
            "instruction_0_personalize) tell the LLM what dossier "
            "values to expect and how to use them; the existing 7 "
            "remain intact as the fallback intake flow when the "
            "dossier is partial or absent. Safer to layer than to "
            "edit the proven intake script.",
        ],
        "built": [
            "Salesforce Metadata API artifacts (deployed via sf "
            "project deploy):",
            "  - 20 custom fields on MessagingSession (Pause_<Name>"
            "__c, Text or LongTextArea) holding each inbound dossier "
            "value once the Flow has run.",
            "  - Pause_Health_Intake_Prechat_Dossier permission set "
            "granting FLS read/edit on those 20 fields plus object-"
            "level read on MessagingSession and MessagingEndUser. "
            "Assignable to the integration Run-As user.",
            "  - Pause_Intake_Prechat_Router routing Flow "
            "(RoutingFlow, API v65.0, Status=Active) with 20 String "
            "input variables, a recordUpdates element writing each "
            "to MessagingSession.Pause_<Name>__c, and a "
            "actionCalls/routeWork transferring to the Pause_Health_"
            "Intake_Agent ExternalCopilot bot (Id 0XxHp0000014tiuKAA).",
            "  - Messaging_for_In_App_Web channel updated: 20 new "
            "customParameters (each maxLength=255, actionParameter"
            "Mappings pointing at the Flow's matching input variable), "
            "sessionHandlerType swapped from AgentforceServiceAgent "
            "to Flow, sessionHandlerFlow set to the new router.",
            "  - Pause_Health_Intake_Agent Bot updated: 14 new "
            "contextVariables mapping MessagingSession.Pause_<Name>"
            "__c -> $Context.Pause_<Name>, all with "
            "includeInPrompt=true so the LLM sees them on session "
            "start.",
            "  - Pause_Health_Intake_Agent GenAiPlannerBundle "
            "updated: two new sortOrder=0 instructions on the "
            "Menopause Symptom Intake topic (instruction_0_dossier "
            "enumerates every $Context.Pause_<Name> value as "
            "authoritative; instruction_0_personalize tells the LLM "
            "not to re-ask for anything already in the dossier).",
            "Frontend update: frontend/app/api/intake/prechat-context/"
            "route.ts now clamps every outbound field to <=255 chars "
            "via clampForChannel() and omits Patient_Context_JSON "
            "from the prechat payload (the full dossier remains in "
            "the API response object for out-of-band consumers). "
            "Doc-comment rewritten to describe the new 5-component "
            "Salesforce architecture so future readers don't repeat "
            "the discovery.",
            "Docs: PHASE_3_RUNBOOK.md 'Phase 18a follow-up' section "
            "completely rewritten with the final architecture "
            "diagram, the 5 architectural constraints we hit + how "
            "we resolved each, an updated field schema table that "
            "marks each field's reachability (Channel? Messaging"
            "Session? $Context?), and a 'Files / metadata artifacts' "
            "table pointing at the source XML.",
        ],
        "verified": [
            "Metadata API dry-runs caught every misstep along the "
            "way: 'Parameter mappings can only be created for channels "
            "with Flow session handlers' (forced the Flow), 'Max "
            "Length must be a value between 1 and 255' (forced the "
            "channel-side clamp + frontend clampForChannel), 'A parent "
            "bot can only have 20 conversation definition variables' "
            "(forced the priority sort on which dossier fields get "
            "surfaced as $Context), 'Cannot update record as Agent is "
            "Active' (forced the deactivate/activate cycle).",
            "Server-side spot-check via Tooling API after each "
            "deploy: 20 Pause_*__c CustomField records exist on "
            "MessagingSession; Pause_Intake_Prechat_Router exists as "
            "an Active RoutingFlow at API v65.0; Bot still parses; "
            "agent reactivates cleanly.",
            "Frontend /api/intake/prechat-context returns identity "
            "and grounding source 'real' for Anika Patel with a real "
            "Salesforce Contact.Id (003Hp00003b9bdqIAA). All 20 "
            "fields are <=255 chars; npm run lint clean; npm test "
            "73/73 pass.",
            "Browser end-to-end verification deferred to user — the "
            "Vercel redeploy needs to complete first, and the agent's "
            "behavior change is best confirmed visually by selecting "
            "each persona and asking 'who am I?' / 'what symptoms "
            "have I reported?' in the live chat.",
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
            "name": "Server-to-server OAuth Client Credentials as the default integration shape",
            "detail": (
                "Salesforce Health Cloud (Phase 12), Salesforce Data "
                "Cloud (Phase 14, scope-add only), and the recommended "
                "MuleSoft Anypoint integration (Phase 16) all use the "
                "same auth shape: server-side OAuth 2.0 Client "
                "Credentials Flow via a per-integration Connected/External "
                "Client App, cached token in process memory, in-flight "
                "request deduplication. lib/salesforce/auth.ts is the "
                "canonical template; the same ~120 lines will work for "
                "Anypoint by swapping the token URL and scope names. "
                "Avoid embedding-style integrations (browser widgets, "
                "iframe-based UIs) — those drag in CORS, CSP "
                "frame-ancestors, and Experience-site restrictions that "
                "cost a session each."
            ),
        },
        {
            "name": "Zscaler intercepts on Salesforce-edge hostnames",
            "detail": (
                "Corporate Zscaler proxy intercepted *.c360a.salesforce"
                ".com (Data Cloud) with a 504 Gateway Timeout during "
                "Phase 14 investigation. Pausing Zscaler resolved it. "
                "Anypoint Platform hostnames resolve through the SAME "
                "*.edge2.salesforce.com edge family (verified in Phase "
                "16) so the same Zscaler posture covers both. Risk "
                "documented: if Zscaler tightens *.salesforce.com later, "
                "Salesforce AND MuleSoft integrations break together — "
                "treat them as one dependency for security-posture "
                "conversations."
            ),
        },
        {
            "name": "Embedded widgets require deployment in the embedding org",
            "detail": (
                "Phase 15 invested a full session investigating why the "
                "SDO sample Agentforce deployment could not be embedded "
                "on pause-health.ai. Phase 18 confirmed the underlying "
                "constraint: embedded-widget integrations need a "
                "deployment authored in an org whose Experience site can "
                "be configured to include the embedding origin in BOTH "
                "(a) the SCRT2 endpoint's CORS allowlist (driven by "
                "Trusted URLs + CorsWhitelistEntry on the embedding org) "
                "AND (b) the site's frame-ancestors CSP (auto-derived "
                "from the Experience site's Trusted Domains, which is "
                "in turn populated from the Domain field set during "
                "EmbeddedServiceDeployment creation). The SDO sample "
                "had neither knob configured for pause-health.ai, and "
                "neither could be changed from outside the org. A "
                "Pause-Health-owned deployment in the same org (Phase "
                "18) trivially has both knobs because we control the "
                "Domain field during creation. Lesson: don't try to "
                "borrow a sample deployment for external embedding; "
                "stand up your own deployment, takes ~30 min once you "
                "know the path."
            ),
        },
        {
            "name": "EmbeddedServiceConfig.clientVersion defaults to WebV1",
            "detail": (
                "Phase 18 surfaced a non-obvious gotcha: even when "
                "DeploymentFeature is set to EmbeddedMessaging (the V2 "
                "Messaging for In-App and Web product), the underlying "
                "EmbeddedServiceConfig.Metadata.clientVersion field "
                "defaults to 'WebV1'. The SCRT2 runtime config endpoint "
                "reads this field verbatim and the SDK switches between "
                "V1 and V2 wire protocols based on its value. With "
                "clientVersion=WebV1 the launcher renders but the chat "
                "panel handshake fails with RPC connection timeout. "
                "Fix: PATCH Metadata.clientVersion='WebV2' via Tooling "
                "API v65 (older API versions do not expose the field at "
                "all), then republish the deployment. Document in any "
                "future runbook as a mandatory step."
            ),
        },
        {
            "name": "Agentforce Service Agents do not appear in Einstein Bots",
            "detail": (
                "Phase 18 surfaced this footgun: the legacy 'Einstein "
                "Bots' page in Salesforce Setup lists only classic "
                "bots, not Agentforce Service Agents. An Agentforce "
                "agent created via Agent Builder exists in BotDefinition "
                "(queryable via SOQL) but is invisible in the Einstein "
                "Bots UI. To manage Agentforce agents go to Setup -> "
                "Agentforce Agents (or the agent's detail page directly). "
                "Anyone porting from older Salesforce docs will look at "
                "the empty Einstein Bots page and assume their agent "
                "wasn't created — this is wrong."
            ),
        },
        {
            "name": "Bind Bot-to-Channel on the Channel, not on the Agent",
            "detail": (
                "The Agentforce agent's detail page has a 'Connections' "
                "tab. It looks like the place to bind the agent to a "
                "messaging channel. It is NOT — that tab only supports "
                "Type=API (external app integrations). The actual "
                "Bot-to-MessagingChannel binding lives on the channel: "
                "Setup -> Messaging Settings -> <channel> -> "
                "Omni-Channel Routing -> Routing Type = 'Agentforce "
                "Service Agent' -> pick the agent. Without this, "
                "incoming conversations route to the channel's "
                "FallbackQueue (typically an empty 'Messaging' queue) "
                "and the chat panel sits forever at RPC connection "
                "timeout."
            ),
        },
        {
            "name": "Investigate-only sessions with a runbook deliverable",
            "detail": (
                "Phases 14, 15, and 16 each ended with a deferred "
                "implementation and a deliverable runbook (PHASE_3_"
                "RUNBOOK.md, MULESOFT_RUNBOOK.md, or in-line notes in "
                ".env.example/.env.local for Phase 14). The pattern: "
                "ask up front for scope (investigate-only vs investigate"
                "+execute vs full session), do the discovery, write the "
                "runbook so the NEXT session is click-through only, "
                "commit the runbook (docs are cheap to roll back). "
                "Avoids the failure mode of starting an implementation, "
                "hitting a hard ceiling mid-session, and leaving the "
                "next agent or developer to rediscover the same "
                "blockers."
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
        "Marketing site, About page (with founder picture + LinkedIn), "
        "blog and press scaffolds, footer, legal pages, SEO surface "
        "(sitemap, robots, OG, Twitter, security.txt, Organization "
        "JSON-LD), canonical URLs on the pause-health.ai apex domain.",
        "Investor brief: 14 deep-dive pages plus the /proposal/full "
        "single-document narrative.",
        "Clickable prototype: /demo/intake (Agentforce real-or-scripted "
        "fallback), /demo/patient, /demo/routing (with live Care Router "
        "decision card), /demo/analytics, /demo/agent-fabric (live "
        "console with real-vs-mock source banners on every span).",
        "Real Code Repository nav link to the GitHub repo.",
        "Python wearable-ingest worker (pause_ingest/) — FLIRT-based, "
        "pytest-covered.",
        "MCP server (mcp/) — four real MCP tools wrapping the Experience "
        "APIs.",
        "Multi-agent control plane: real A2A handoff, real Agent Fabric "
        "trace store, real governance evaluation, real Anthropic path "
        "when configured.",
        "Salesforce Health Cloud grounding (Phase 12) — LIVE against a "
        "real connected Developer Edition org via OAuth client "
        "credentials. SOQL against Contact + CareProgramEnrollee + "
        "CarePlan + Case. Six seeded demo Contacts with menopause-"
        "specific care plans. Agent Fabric trace spans show _source: "
        "'real' on the federated-query span when env vars are set; "
        "fall back to mock when unset (zero-credential default).",
        "Salesforce Agentforce Embedded Messaging intake on "
        "/demo/intake (Phase 18, shipped 2026-06-02; Phase 18b "
        "completed 2026-06-03) — LIVE on pause-health.ai. "
        "Pause_Health_Intake_Agent (a real Agentforce Service Agent "
        "on Service Cloud, Active, with two subagents and nine "
        "instructions including red-flag escalation and two new "
        "Phase-18b dossier-aware instructions) responds to messages "
        "from the chat panel embedded in the Next.js app via the V2 "
        "Messaging-for-Web bootstrap. Routing: Omni-Channel -> "
        "Pause_Intake_Prechat_Router routing Flow -> Pause_Health_"
        "Intake_Agent. The 'View as <patient>' picker hands ~20 "
        "hidden-prechat fields to "
        "embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields() "
        "before the conversation starts; the channel routes them "
        "into the Flow, which writes each to a Pause_<Name>__c "
        "custom field on MessagingSession; the agent then references "
        "them as $Context.Pause_<Name> in its topic instructions and "
        "personalizes its first message accordingly. Every field is "
        "clamped to 255 chars per Salesforce's channel hard cap; the "
        "full multi-KB dossier remains available out-of-band via "
        "/api/intake/prechat-context for future custom Apex actions. "
        "Scripted Pause-branded fallback still runs for any "
        "deployment without the four NEXT_PUBLIC_AGENTFORCE_* env "
        "vars set (forks, previews without org credentials).",
        "lib/salesforce/auth.ts test suite: 17 vitest tests covering "
        "token acquisition, caching, in-flight dedup, expiry, error "
        "paths. Plus 6 tests for the warn-once dedup helper.",
        "GitHub Actions: frontend-check, codeql, dependabot, vercel-"
        "preview, lighthouse-nightly.",
        "Production deployment on Vercel at pause-health.ai.",
    ],
    "mocked": [
        "Salesforce Data Cloud unified-profile layer (Phase 14) — "
        "PROVISIONED but EMPTY. 31 unified DMOs exist; no Data Streams "
        "currently feed them. External Client App scopes are pre-"
        "configured (cdp_api, cdp_profile_api, cdp_ingest_api) so the "
        "OAuth side is ready. Activation is a 2-4 hour Setup UI exercise "
        "(Data Streams + DLO mappings + Identity Resolution + Calculated "
        "Insights) deferred to a dedicated session.",
        "MuleSoft Experience APIs (Phase 7) — fixture-backed Next.js "
        "routes. A real Anypoint Platform org is now available (Phase "
        "16) but no Mule app is deployed yet. Production swaps the base "
        "URL for the customer's Anypoint deployment without contract "
        "changes; the MCP server's PAUSE_MCP_BASE_URL already supports "
        "the swap. Next-session 3-5 hour playbook in "
        "docs/MULESOFT_RUNBOOK.md.",
        "MuleSoft Agent Fabric — in-memory registry, policy catalog, "
        "trace store. Production swaps for the real Anypoint Agent "
        "Fabric service.",
        "Salesforce Data 360 federated reads beyond Health Cloud — the "
        "in-memory federated patient store and four calculated insights "
        "from Phase 11 still serve any code path that asks for data the "
        "real Health Cloud org doesn't have (wearable HRV time series, "
        "cohort comparisons, population segments). Hybrid: Health Cloud "
        "live, everything else mocked, both surface together through "
        "the same GroundingContext type.",
        "Anthropic Claude — real when ANTHROPIC_API_KEY is set, "
        "deterministic policy engine fallback otherwise.",
        "JupyterHealth + DBDP — design documented and reference "
        "scaffolds present; live federation happens when a customer "
        "deployment wires the System APIs to their real JupyterHealth "
        "instance and DBDP feature warehouse.",
    ],
    "deferred_with_runbook": [
        "Phase 2 (Salesforce Data Cloud activation) — README.md status "
        "section + .env.example comments; estimated 2-4 hours UI work.",
        "MuleSoft Phase 1 (one live CloudHub 2.0 Experience API "
        "replacing /api/mulesoft/health) — docs/MULESOFT_RUNBOOK.md; "
        "estimated 3-5 hours combined UI + wiring.",
        "Move the Phase 18a/18b Salesforce metadata artifacts (20 "
        "MessagingSession custom fields, the Pause_Health_Intake_"
        "Prechat_Dossier permission set, the Pause_Intake_Prechat_"
        "Router routing Flow, the augmented Messaging_for_In_App_Web "
        "channel, and the Bot + GenAiPlannerBundle for Pause_Health_"
        "Intake_Agent) from /tmp scratch dirs into salesforce/ in "
        "this repo, add a deploy script, and CI-validate them. "
        "Today the Salesforce org IS the source of truth for these "
        "artifacts; the next session makes the repo authoritative "
        "instead. ~2 hours of scaffolding work.",
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
    add_h2(doc, "Deferred to a dedicated session, with a runbook checked in")
    add_bullets(doc, CURRENT_STATE["deferred_with_runbook"])

    add_h2(doc, "Closing note")
    add_paragraph(
        doc,
        "The prototype is intentionally honest about every mock. Every "
        "mocked API response carries a meta._note explaining what it is "
        "and what replaces it in production; every investor page includes "
        "a prototype-vs-production table; every Agent Fabric trace span "
        "shows _source: 'real' or 'mock' so the demo never lies about "
        "provenance even when one path is live. A reviewer can run the "
        "full intake -> A2A -> Care Router -> Data 360 grounding flow "
        "locally with no credentials and see the four-span trace in the "
        "live Agent Fabric console; the same reviewer with the three "
        "Salesforce env vars set sees the federated-query span flip to "
        "real Health Cloud data without any code change.",
    )
    add_paragraph(
        doc,
        "Three integrations are deferred to dedicated sessions with "
        "checked-in runbooks: Salesforce Data Cloud activation, "
        "Pause-owned Agentforce Embedded Messaging deployment, and the "
        "first live MuleSoft Anypoint Experience API. Each runbook was "
        "written immediately after an investigation session so the next "
        "session is click-through-only rather than re-investigation — "
        "the most expensive failure mode discovered during the build.",
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
