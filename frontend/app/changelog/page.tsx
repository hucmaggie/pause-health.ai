import { pageMetadata } from "../../lib/page-metadata";
import { StatusPill, type StatusPillStatus } from "../../components/status-pill";

export const metadata = pageMetadata({
  title: "Changelog",
  description:
    "What's shipped at Pause-Health.ai. Grouped by week, with links to the underlying GitHub commits. Updated after every polish pass — the git log is part of the artifact.",
  path: "/changelog",
  ogImage: "/brand/pause-health-og-about.png",
  ogImageAlt: "Pause-Health.ai changelog — what's shipped, week by week."
});

const GITHUB_REPO = "https://github.com/hucmaggie/pause-health.ai";

type ChangelogEntry = {
  title: string;
  summary: string;
  commits: Array<{ sha: string; label: string }>;
  status: StatusPillStatus;
};

type ChangelogWeek = {
  range: string;
  headline: string;
  intro: string;
  entries: ChangelogEntry[];
};

const weeks: ChangelogWeek[] = [
  {
    range: "Week of June 7, 2026",
    headline: "MuleSoft iteration 2: /providers live + API Manager policy runbook",
    intro:
      "MuleSoft iteration 2 shipped. A second Experience API (/providers) is now live on the same CloudHub 2.0 worker alongside /health. lib/mulesoft/providers.ts adds the prefer-real / degrade-to-mock / warn-once client pattern; /api/mulesoft/providers was wired to the live path; 23 new unit tests (providers.test.ts) bring the MuleSoft lib total to 45/45. API Manager policy runbook (docs/MULESOFT_API_MANAGER_RUNBOOK.md) documents the Client ID Enforcement + Rate Limiting SLA steps that are next on the Anypoint UI side. Earlier same week: MuleSoft runtime 4.11.2 upgrade, health-flow.xml fixes, and Data 360 Phase 2 code layer.",
    entries: [
      {
        title: "MuleSoft iteration 2: /providers Experience API live + 23 new tests",
        summary:
          "GET /providers?zip=&menopause=&limit= is now live on the deployed CloudHub 2.0 worker (pause-mulesoft-health-v1). The Mule flow (health-flow.xml providers-flow) returns a DataWeave-built provider directory ranked by graphScore with zip-prefix + menopause-certified filters. lib/mulesoft/providers.ts implements the same prefer-real / degrade-to-mock / warn-once pattern as health.ts: activated by MULESOFT_PROVIDERS_BASE_URL, falls back to queryProviderDirectory() on any failure. /api/mulesoft/providers route upgraded from mock-only to live/mock/fallback with _source metadata. 23 new unit tests (providers.test.ts) cover isMulesoftProvidersLive, fetchLiveProviders success/failure paths, and getProvidersPreferReal degradation. Total MuleSoft lib test count: 45/45. docs/MULESOFT_API_MANAGER_RUNBOOK.md documents the next Anypoint UI steps: API Manager registration, Client ID Enforcement policy, Rate Limiting SLA with Demo/Production tiers, Exchange asset registration, and credential injection into the Next.js proxy.",
        commits: [
          { sha: "TBD", label: "mulesoft: iteration 2 — /providers live + API Manager runbook" }
        ],
        status: "partial"
      },
      {
        title: "MuleSoft: runtime 4.11.2, Java 17, health-flow.xml fixes",
        summary:
          "mule-artifact.json bumped to minMuleVersion 4.11.0 with javaSpecificationVersions: [\"17\"]. pom.xml bumped to app.runtime 4.11.2, mule-maven-plugin 4.7.0. health-flow.xml had two XML errors that prevented Code Builder from rendering the canvas: (1) <http:headers> used as a standalone flow processor — moved it into <http:response> nested inside <http:listener> where Mule 4 expects it; (2) double-hyphen (--) inside an XML comment — illegal in XML, replaced with single hyphen. Code Builder .vscode/launch.json and .vscode/settings.json scaffolding committed.",
        commits: [
          { sha: "3662130", label: "mulesoft: bump runtime + fix health-flow.xml" }
        ],
        status: "partial"
      },
      {
        title: "Data 360 Phase 2: Data Cloud Calculated Insights layer",
        summary:
          "New lib/salesforce/data-cloud.ts implements the Data Cloud Query API and Calculated Insights API client, mirroring the same warn-once / prefer-real / degrade-to-null pattern as the Phase 1 SOQL path. Activated by SF_DC_TENANT_URL env var. lib/salesforce/grounding.ts updated to call getWearableInsights() in parallel with the four SOQL queries; each of the three wearable insights (Pause_HRV_RMSSD_30d, Pause_Vasomotor_Burden_30d, Pause_Sleep_Disruption_7d) falls back to its intake baseline independently. groundingProvenance.federatedQuery reflects which path served the request. frontend/.env.example documents the new vars with derivation notes. Full org setup walkthrough — DMO authoring, CI SQL, mock CI path, env var wiring, verification curls — in new docs/MULESOFT_PHASE_2_DATA_CLOUD.md. Probe result: trailsignup org has the permission sets but no provisioned DC tenant; code is ready and waiting.",
        commits: [
          { sha: "8a2e55f", label: "data-360: Phase 2 Data Cloud Calculated Insights layer" }
        ],
        status: "partial"
      }
    ]
  },
  {
    range: "Week of June 1, 2026",
    headline: "Honesty-pilling marathon",
    intro:
      "Thirty-plus commits across every public page on the site. The single theme: replace any present-tense claim that isn't yet true with a StatusPill-flagged 'today vs. designed' framing. The Apache-2.0 license + OSS-hygiene trio (CONTRIBUTING / CODE_OF_CONDUCT / SECURITY) landed mid-week, the polish marathon wrapped with a reproducible end-to-end smoke test (132 / 132 pass), the JupyterHealth integration jumped from designed-on-paper to wire-level prototype (27 / 27 against an in-process JHE mock), the Care Router business logic got its first test safety net (100 new tests covering ~1,100 lines of previously-untested risk-band + pathway + A2A code), and the MuleSoft Phase 1 deploy artifact got pre-staged (deployable Mule app, live/mock proxy with graceful degradation, 31 new unit tests, env-gated investor badge) so the Anypoint clickthrough is the only remaining work on the user's plate.",
    entries: [
      {
        title: "MuleSoft Anypoint Phase 1: deployable artifact + live/mock proxy",
        summary:
          "Phase 1 shipped 2026-06-07. A real Mule 4.11.2 app is running on CloudHub 2.0 (Cloudhub-US-West-1, Sandbox) at https://pause-mulesoft-health-v1-zkeniz.scqos5-1.usa-w1.cloudhub.io. MULESOFT_HEALTH_BASE_URL is set in Vercel production; /api/mulesoft/health reports meta._source: 'live-mulesoft' and meta._liveUrl matches the worker. Degradation path verified: stopping the Mule app surfaces meta._source: 'mock-fallback' with _liveAttempted: true — the prototype never goes hard-down. /proposal/mulesoft shows the green LIVE badge. Build fixes required along the way: mule-http-connector dependency missing from pom.xml, property placeholder ${http.listener.port:8081} replaced with hardcoded 8081, DataWeave (idx, _) two-arg lambda syntax replaced with $ / $$ implicit vars, config.yaml added for configuration-properties. Repo-side: lib/mulesoft/health.ts prefer-real / degrade-to-mock / warn-once client, 31 unit tests, env-gated investor badge.",
        commits: [
          { sha: "55e1b6d", label: "MuleSoft Phase 1 repo prep" },
          { sha: "3662130", label: "bump runtime 4.11.2, fix health-flow.xml" },
          { sha: "a4635f2", label: "add mule-http-connector dependency" },
          { sha: "a4b75fc", label: "add config.yaml + configuration-properties" },
          { sha: "bc6172b", label: "hardcode port 8081" },
          { sha: "38f4a24", label: "fix DataWeave lambda syntax" },
          { sha: "6a3c4ed", label: "set MULESOFT_HEALTH_BASE_URL in Vercel production" }
        ],
        status: "partial"
      },
      {
        title: "Care Router business logic: +100 unit tests, drift caught",
        summary:
          "Five new test files cover the highest-leverage business logic on the site: lib/risk-band.test.ts (30 tests pinning the deterministic intake → band → pathway decision tree against every persona in the demo cohort), lib/care-router-pathways.test.ts (11 tests pinning the canonical six-pathway enum), lib/care-router.test.ts (25 tests covering scriptedRoute's red-flag / severity / cycleStatus / ageBand / Data 360 grounding branches plus the claudeRoute no-API-key fallback), lib/agent-fabric.test.ts (20 tests covering evaluateGovernance, the trace ring buffer, and listRecentTaskIds), and app/api/agents/care-router/tasks/route.test.ts (14 tests covering JSON-RPC envelope validation, governance block path, success path with RoutingDecision artifacts, and metadata.parentSpanId / personaId passthrough into recorded trace spans). The risk-band suite surfaced a real drift: Brianna Okafor's displayRisk on the public /demo/intake queue table was labeled 'Moderate' but her sleepScore=8 trips the single-axis-promotion rule and computeRisk returns 'High'. Fixed the data, the tests now pin both surfaces. Total frontend test count: 73 → 173. Smoke test still 132 / 132.",
        commits: [
          { sha: "79bb9b0", label: "Care Router test suite" }
        ],
        status: "prototype"
      },
      {
        title: "pause_ingest → JHE: wire-level contract test (27 / 27 pass)",
        summary:
          "New in-process JHE mock server (tests/jhe_mock_server.py) implements the OAuth2 + FHIR endpoints pause_ingest actually hits. Seven integration tests (tests/test_exchange_integration.py) exercise the production exchange.upload_observation, hrv_features_to_fhir_observation, and read_recent_observations code paths end-to-end — including a full-pipeline test that uploads 6 raw heart-rate observations, computes time-domain HRV features, uploads the derived observation with derivedFrom provenance, and reads everything back. The contract test surfaced a real bug in read_recent_observations (the JupyterHealthClient 0.2.0 API doesn't accept client_id/client_secret) that lenient unit-test doubles missed. Added hrv_features_to_fhir_observation helper. New runbook at docs/JHE_SETUP_RUNBOOK.md captures the path to swap the mock for real JHE in an afternoon (~1 afternoon, gated on Docker). Flipped the JupyterHealth pill on /roadmap from designed to prototype.",
        commits: [
          { sha: "e1e43aa", label: "pause_ingest → JHE contract test" }
        ],
        status: "prototype"
      },
      {
        title: "End-to-end smoke test — 132 / 132 pass",
        summary:
          "New reproducible smoke-test harness at frontend/scripts/smoke-test.mjs. Hits all 35 public routes, follows 77 unique internal links discovered by parsing rendered HTML, and POSTs realistic fixtures to 16 API endpoints (including the A2A JSON-RPC tasks/send envelope to /api/agents/care-router/tasks). Results land in SMOKE_TEST_RESULTS.md committed at the repo root. Caught one false-positive in the link extractor (query-string handling) on the first run; no real regressions on the polished surface. Wired into package.json as `npm run smoke`.",
        commits: [
          { sha: "1fa3a19", label: "smoke test + 132/132 results" }
        ],
        status: "shipped"
      },
      {
        title: "/changelog + /roadmap pages",
        summary:
          "Built /changelog as a hand-curated weekly narrative with real commit SHAs linking to GitHub, and /roadmap as a Now / Next / Later horizon view drawn from the 30+ designed / planned / future items already pilled across the site. Home page got a 'momentum strip' (63 commits since May 24, 2026) with cross-links to both pages.",
        commits: [{ sha: "cd1ea17", label: "changelog + roadmap pages" }],
        status: "shipped"
      },
      {
        title: "Apache-2.0 license + OSS-hygiene trio",
        summary:
          "Released the source under the Apache License, Version 2.0 — the patent grant matters more than MIT's brevity in healthcare AI. Added the standard CONTRIBUTING.md / CODE_OF_CONDUCT.md / SECURITY.md set at the repo root, taking GitHub's Community Standards checklist to 100%. NOTICE file lists upstream attributions (JupyterHealth, DBDP, FLIRT, Salesforce, MCP, Anthropic, Menopause Society directory).",
        commits: [
          { sha: "83db016", label: "docs: OSS-hygiene trio" },
          { sha: "4090e33", label: "license: Apache-2.0" }
        ],
        status: "shipped"
      },
      {
        title: "/proposal/full — long-form investor brief polished",
        summary:
          "Nine high/medium-priority honesty fixes on the 4,000-line full proposal page. Hero copy softened from present-tense to 'designed to help clinicians…'. The $1,685 avoidable-spend metric deduplicated and pinned to its literature source. Anchor-provider claims softened to 'design-partner provider organizations'. whatPauseProvides and techFoundation cards each get per-card StatusPills. businessChannels ACV/PMPM table re-framed as Target ACV ranges with caveats. HIPAA/HITRUST/SOC 2 claims reconciled with the /security page.",
        commits: [{ sha: "91ee6ee", label: "proposal/full: pills + dedupe + sync" }],
        status: "shipped"
      },
      {
        title: "Seven supporting pages reconciled with reality",
        summary:
          "/careers, /security, /hipaa, /research, /privacy, /blog, /terms — each replaced false present-tense claims with explicit 'Today vs. Designed' tables. /security: removed 'BAAs executed' and 'SOC 2 Type II in progress' claims. /hipaa: stated outright 'Pause-Health.ai is NOT a Business Associate today.' /research: removed 'bias monitoring quarterly with clinician review' (no such program exists yet). /careers: reconciled the three founding roles (CMO, Head of AI, Head of Clinical Design) to match /about, all pilled 'future'.",
        commits: [
          { sha: "b60385b", label: "careers/security/hipaa/research/privacy/blog/terms: honesty pilling" }
        ],
        status: "shipped"
      },
      {
        title: "/about, /press, /contact — credibility polish",
        summary:
          "/about: hero updated to 'Pre-design-partner; prototype in the open'. Milestones split into Done vs. Planned with explicit pills. /press: replaced one-line stub with a real press kit — approved boilerplate, founder bio + headshot, brand-asset downloads, milestones, media contact with response-time SLA. /contact: each email alias now lists audience, what-to-include, response-time expectations. 'Self-route' section deflects to /careers, /press, /security, GitHub issues.",
        commits: [{ sha: "82a95db", label: "about/press/contact: honesty pilling + real press kit" }],
        status: "shipped"
      },
      {
        title: "Home page rebuilt with honest hero",
        summary:
          "New 'What's live today' strip with four prototype-pilled cards linking directly to /demo/intake, /demo/patient, /demo/routing, /demo/agent-fabric. Two-arc CTA section splits 'investors + partners' from 'builders + clinicians' with distinct calls-to-action. Founder credibility line links to /about and Maggie's LinkedIn. The $1,685 figure was removed from the hero (kept only in /proposal/full with proper research citation).",
        commits: [{ sha: "c3b71d3", label: "home: honest hero + What's live today + two-arc CTAs" }],
        status: "shipped"
      },
      {
        title: "Persona-aware navigation across all five /demo/* pages",
        summary:
          "DemoShell top nav now preserves the selected persona across pages (clicking 'Care Router' from /demo/intake?personaId=anika-patel keeps Anika selected). PreBriefPanel grew a compact switch-persona chip row, journey shortcuts ('Open Care Detail for Anika →'), and a risk-band + suggested-pathway verdict. /demo/analytics filters its cohort-comparison view by persona. /demo/agent-fabric grew a 'View all Anika's traces' link. A new PersonaJourneyFooter renders consistently across all five demo pages.",
        commits: [
          { sha: "a063a8d", label: "demo: PreBriefPanel persona-aware polish" },
          { sha: "1307ac2", label: "demo: persona-filterable agent-fabric + cross-links" },
          { sha: "45344bd", label: "demo: shared PersonaJourneyFooter" },
          { sha: "db057af", label: "demo: persona-preserving shell nav + analytics filter" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of May 25, 2026 — late",
    headline: "Investor-brief polish, Arc A + Arc B",
    intro:
      "Eight architecture pages and four go-to-market pages each got a per-card StatusPill retrofit. The shared <StatusPill> component was extracted and the vocabulary canonicalized so 'Designed' means the same thing on /proposal/strategy as it does on /proposal/agentforce.",
    entries: [
      {
        title: "Arc B — eight architecture deep-dives polished",
        summary:
          "/proposal/agentforce, /proposal/mulesoft, /proposal/mcp, /proposal/dbdp, /proposal/integration, /proposal/provider-graph, /proposal/menopause-society, /proposal/data-360. Each rewritten with per-card pills, env-variable tables where relevant, and explicit 'today contract vs. designed pipeline' framing. /proposal/menopause-society: stale ~2,500 MSCP count updated to ~4,100 with a Research-pilled source citation.",
        commits: [
          { sha: "94e514b", label: "proposal/data-360: per-card pills + IR CTA" },
          { sha: "95e1fb2", label: "proposal/menopause-society: fix stale count" },
          { sha: "7f7dc6b", label: "proposal/provider-graph: prototype vs designed" },
          { sha: "c55eae5", label: "proposal/dbdp: per-row status pills" },
          { sha: "1630708", label: "proposal/integration: Phase 0 + pills" },
          { sha: "0805a32", label: "proposal/mulesoft: tense + pills" },
          { sha: "96db851", label: "proposal/mcp: gate npx behind Phase 1" },
          { sha: "0748050", label: "proposal/agentforce: honesty + env-table" }
        ],
        status: "shipped"
      },
      {
        title: "Arc A — go-to-market pages and shared <StatusPill>",
        summary:
          "/proposal/customers, /proposal/competition, /proposal/data, and the /proposal hub page each got the status-pill retrofit. The pill component itself was extracted from inline copies and canonicalized — three tones (real / mock / info) to distinguish 'this code ships today', 'this code is designed', and 'this is a research-derived number, not a capability'. Subsequent commits retrofit eight already-polished pages onto the shared component.",
        commits: [
          { sha: "3b67edc", label: "proposal: extract shared <StatusPill>, retrofit 8 pages" },
          { sha: "ced0fc0", label: "Arc A pages: customers / competition / data" },
          { sha: "189e565", label: "proposal hub: Arc A / Arc B grouping + demo links" }
        ],
        status: "shipped"
      },
      {
        title: "Strategy + technology + insights rebuilt for honesty",
        summary:
          "/proposal/strategy and /proposal/full rebuilt with plan-vs-status honesty. /proposal/technology reconciled with /proposal/insights so the customer-research summaries agree across pages. /proposal/insights re-framed as a 'Research-design plan' rather than asserting completed interviews.",
        commits: [
          { sha: "7c57191", label: "/proposal/technology + /proposal/insights" },
          { sha: "08e6be7", label: "/proposal/full + /proposal/strategy rebuild" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of May 25, 2026 — early",
    headline: "Demo surface rebuild, persona-aware",
    intro:
      "The five /demo/* pages were each rebuilt around the canonical DEMO_COHORT personas. /demo/patient grew a Care Detail layout with risk gauge + axis flags + HRT suitability. /demo/routing demonstrates the Care Router decision live. /demo/analytics replaced static placeholder charts with operational metrics computed from real API trace data. /demo/agent-fabric joined the shared DemoShell nav.",
    entries: [
      {
        title: "Five /demo/* pages rebuilt around personas",
        summary:
          "Each demo page now accepts ?personaId=anika-patel (or any of the six seeded personas) and renders persona-aware content end-to-end. /demo/patient: Care Detail layout with risk gauge, axis flags, HRT suitability. /demo/routing: live Care Router decision with persona-specific intake hints. /demo/analytics: operational metrics + pathway-mix chart computed from real API traces.",
        commits: [
          { sha: "045aa04", label: "/demo/agent-fabric into shared DemoShell" },
          { sha: "2afb917", label: "/demo/analytics: live ops metrics + chart" },
          { sha: "81b48e3", label: "/demo/routing: persona-aware routing demo" },
          { sha: "a984061", label: "/demo/patient: persona-aware Care Detail" }
        ],
        status: "shipped"
      },
      {
        title: "Pre-Brief Panel ships — Embedded Messaging context layer",
        summary:
          "After discovering Salesforce's prechatAPI is a no-op Proxy in Embedded Messaging V2, pivoted from hidden pre-chat fields to a visible Pre-Brief Panel on /demo/intake. The panel surfaces the patient's Data 360 dossier (real Salesforce when SF_* env vars are set, deterministic mock otherwise) so the agent walks in pre-grounded.",
        commits: [
          { sha: "692f0a2", label: "Pre-Brief Panel: stack long Cohort_Name row" },
          { sha: "26fb582", label: "Pre-Brief Panel ships + V2 prechatAPI dead-end documented" },
          { sha: "2bb4e15", label: "Phase 18b: full agent-side wiring" }
        ],
        status: "shipped"
      }
    ]
  },
  {
    range: "Week of May 24, 2026 — initial build",
    headline: "Prototype-in-the-open lands",
    intro:
      "The first week of Pause-Health.ai work. Eleven commits stood up the marketing site, investor brief, demo surface, MuleSoft integration plane, MCP server, multi-agent control plane, Salesforce Agentforce intake, and the Data 360 grounding layer — all built on top of the legacy Northstar Shipping API repo that already had CI/CD wiring.",
    entries: [
      {
        title: "Multi-agent control plane",
        summary:
          "Four agents (Agentforce intake, Anthropic Claude Care Router, Pause MCP server, MuleSoft Process API) wired through Google A2A + MCP, orchestrated by a MuleSoft Agent Fabric mock. Live console at /demo/agent-fabric.",
        commits: [
          { sha: "ded1e63", label: "multi-agent control plane" }
        ],
        status: "shipped"
      },
      {
        title: "Salesforce Data 360 grounding layer",
        summary:
          "Care Router grounds on real Salesforce Health Cloud objects (Contact + CareProgramEnrollee + CarePlan + Case) when SF_INSTANCE_URL/CLIENT_ID/SECRET are set; deterministic mock when unset. Agent Fabric console shows LIVE badge on every span served by a real org.",
        commits: [{ sha: "57dbdfd", label: "Data 360 grounding" }],
        status: "shipped"
      },
      {
        title: "MuleSoft + MCP + JupyterHealth + DBDP integration planes",
        summary:
          "Three-tier MuleSoft architecture reference artifacts. MCP server wraps the mocked Experience APIs as four tools for Claude Desktop, Cursor, Agentforce. JupyterHealth Exchange integration design + pause_ingest Python worker for wearable ingest. DBDP feature-engineering layer.",
        commits: [
          { sha: "d0942b6", label: "MCP server" },
          { sha: "1e35ef8", label: "MuleSoft integration plane" },
          { sha: "4a653c9", label: "JupyterHealth + ingest worker" },
          { sha: "13bd429", label: "DBDP wearable features" }
        ],
        status: "shipped"
      },
      {
        title: "Agentforce intake + Menopause Society referral path",
        summary:
          "Salesforce Agentforce Service Agent intake wired into the prototype with Pause-branded fallback. /proposal/menopause-society lays out the MSCP referral path with explicit ToS guardrails (deep-link to The Menopause Society's directory rather than scraping).",
        commits: [
          { sha: "1334296", label: "Agentforce intake" },
          { sha: "cc09923", label: "Menopause Society referral path" }
        ],
        status: "shipped"
      },
      {
        title: "Marketing site, investor brief, mobile nav, CI/CD",
        summary:
          "Initial Next.js frontend on top of the legacy Northstar repo. Full investor brief as a routed page. Mobile-friendly hamburger nav. Part 2 deep-dives. Vercel deploy + GitHub Actions for typecheck + Lighthouse nightly + CodeQL.",
        commits: [
          { sha: "597fd63", label: "Pause-Health.ai frontend + CI/CD" },
          { sha: "6501659", label: "Part 2 deep-dives + Next routing" },
          { sha: "479837e", label: "mobile hamburger nav" }
        ],
        status: "shipped"
      }
    ]
  }
];

function commitUrl(sha: string) {
  return `${GITHUB_REPO}/commit/${sha}`;
}

export default function ChangelogPage() {
  const allEntries = weeks.flatMap((w) => w.entries);

  return (
    <main className="container" style={{ paddingTop: "2.4rem", paddingBottom: "3rem", maxWidth: "60rem" }}>
      <header style={{ marginBottom: "1.8rem" }}>
        <p className="eyebrow">Changelog</p>
        <h1 style={{ fontSize: "clamp(1.7rem, 3.2vw, 2.4rem)", margin: "0.25rem 0 0.6rem" }}>
          What's shipped, week by week
        </h1>
        <p style={{ color: "var(--muted)", maxWidth: "44rem", margin: 0, lineHeight: 1.55 }}>
          Pause-Health.ai is built in the open. The git log at{" "}
          <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
            github.com/hucmaggie/pause-health.ai
          </a>{" "}
          is the source of truth — this page is a hand-curated narrative
          view of the marquee weeks. Roadmap items (what's <em>coming</em>) live
          at <a href="/roadmap" style={{ color: "var(--brand)" }}>/roadmap</a>.
        </p>

        <div
          style={{
            marginTop: "1.1rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            alignItems: "center"
          }}
        >
          <span
            style={{
              fontSize: "0.78rem",
              padding: "0.25rem 0.55rem",
              borderRadius: "999px",
              background: "var(--surface-2)",
              color: "var(--muted)",
              fontWeight: 600
            }}
          >
            {allEntries.length} marquee entries across {weeks.length} weeks
          </span>
          <span
            style={{
              fontSize: "0.78rem",
              padding: "0.25rem 0.55rem",
              borderRadius: "999px",
              background: "var(--surface-2)",
              color: "var(--muted)",
              fontWeight: 600
            }}
          >
            63 total commits since May 24, 2026
          </span>
          <a
            href={GITHUB_REPO + "/commits/main"}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: "0.82rem", padding: "0.4rem 0.75rem" }}
          >
            See all commits on GitHub →
          </a>
        </div>
      </header>

      {weeks.map((week) => (
        <section
          key={week.range}
          aria-label={week.range}
          style={{
            marginBottom: "2.2rem",
            paddingBottom: "1.6rem",
            borderBottom: "1px solid var(--surface-3)"
          }}
        >
          <header style={{ marginBottom: "1.1rem" }}>
            <p
              className="eyebrow"
              style={{ marginBottom: "0.15rem" }}
            >
              {week.range}
            </p>
            <h2
              style={{
                fontSize: "1.4rem",
                margin: "0.05rem 0 0.5rem",
                color: "var(--text)"
              }}
            >
              {week.headline}
            </h2>
            <p
              style={{
                color: "var(--muted)",
                margin: 0,
                lineHeight: 1.55,
                fontSize: "0.95rem"
              }}
            >
              {week.intro}
            </p>
          </header>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {week.entries.map((entry) => (
              <article
                key={entry.title}
                className="card"
                style={{ padding: "1.1rem 1.2rem" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "0.8rem",
                    flexWrap: "wrap",
                    marginBottom: "0.4rem"
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.35 }}>
                    {entry.title}
                  </h3>
                  <StatusPill status={entry.status} />
                </div>
                <p
                  style={{
                    margin: "0.3rem 0 0.75rem",
                    color: "var(--muted)",
                    lineHeight: 1.55,
                    fontSize: "0.92rem"
                  }}
                >
                  {entry.summary}
                </p>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.4rem",
                    fontSize: "0.78rem"
                  }}
                >
                  {entry.commits.map((c) => (
                    <a
                      key={c.sha + c.label}
                      href={commitUrl(c.sha)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: "0.25rem 0.55rem",
                        borderRadius: "6px",
                        background: "var(--surface-2)",
                        color: "var(--muted)",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        textDecoration: "none",
                        border: "1px solid var(--surface-3)"
                      }}
                    >
                      <span style={{ color: "var(--brand)" }}>{c.sha}</span>{" "}
                      <span>{c.label}</span>
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      <section
        aria-label="Where to go next"
        style={{ marginTop: "1rem" }}
      >
        <div
          className="card-grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))" }}
        >
          <article className="card">
            <p className="eyebrow">Forward-looking</p>
            <h3 style={{ margin: "0.15rem 0 0.5rem", fontSize: "1.1rem" }}>
              What's coming next
            </h3>
            <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.92rem", lineHeight: 1.55 }}>
              The roadmap groups the 31+ designed / planned / future items
              already pilled across the site into Now / Next / Later
              horizons. Each item links back to the page that describes it
              in detail.
            </p>
            <div style={{ marginTop: "0.9rem" }}>
              <a href="/roadmap" className="btn btn-primary">
                Open the roadmap →
              </a>
            </div>
          </article>

          <article className="card">
            <p className="eyebrow">Watch the build</p>
            <h3 style={{ margin: "0.15rem 0 0.5rem", fontSize: "1.1rem" }}>
              Subscribe to commits
            </h3>
            <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.92rem", lineHeight: 1.55 }}>
              The repo is public. Watch it on GitHub to get notified of new
              commits, or subscribe to the planned essays at <a href="/blog" style={{ color: "var(--brand)" }}>/blog</a> for
              the editorial version.
            </p>
            <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <a
                href={GITHUB_REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                GitHub →
              </a>
              <a href="/blog" className="btn btn-secondary">
                Editorial →
              </a>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
