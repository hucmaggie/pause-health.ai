import {
  StatusPill,
  type StatusPillStatus
} from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Full Proposal",
  description:
    "The complete Pause-Health.ai investor brief — market thesis, target outcomes, technology foundation, business model, 24-month objectives, and the architecture deep-dives. Phase 2 is shipped: 2,015-provider directory with distance ranking + state license-sanction filters + synthetic-shaped insurance, Salesforce Data Cloud Calculated Insights live in production, MuleSoft CloudHub 2.0 worker live through iteration 8 (Phase-2 contract DataWeave deployed), MCP server published on stdio + Streamable HTTP with the Care Router operating as MCP host, and the Headless 360 conformance plane (PKCE External Client App + Platform Event egress + Agentforce Voice seam) wired and dormant pending customer-org provisioning.",
  path: "/proposal/full",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Full investor proposal — Pause-Health.ai."
});

const heroMetrics: Array<{
  value: string;
  label: string;
  detail: string;
  tone: "research" | "target";
}> = [
  {
    value: "~50M",
    label: "U.S. women affected",
    detail: "Perimenopausal + postmenopausal population in the U.S.",
    tone: "research"
  },
  {
    value: "~67%",
    label: "Initially misdiagnosed",
    detail: "Of perimenopausal women, per peer-reviewed literature.",
    tone: "research"
  },
  {
    value: "~2.5 y",
    label: "Time to correct diagnosis",
    detail: "From first menopause-pattern symptom to accurate dx.",
    tone: "research"
  },
  {
    value: "~$1,685",
    label: "Avoidable spend / patient",
    detail:
      "Estimate of waste per patient from delayed dx + over-utilization, derived from menopause-care cost-of-care literature. Illustrative -- this is a published-research-derived figure, not a Pause-Health.ai measurement.",
    tone: "research"
  }
];

const targetOutcomes = [
  {
    value: "89%",
    label: "Diagnostic accuracy",
    detail:
      "Validation target vs. the ~67% national misdiagnosis baseline. Measurement plan documented in /proposal/insights."
  },
  {
    value: "< 30 d",
    label: "Time to first specialist contact",
    detail:
      "From a 2.5-year baseline to under a month — first MSCP-credentialed clinician contact."
  },
  {
    value: "+34%",
    label: "Patient satisfaction lift",
    detail:
      "Pilot target with design-partner provider organizations vs. care-as-usual baseline. (Design-partner program kicks off 2026 H2.)"
  },
  {
    value: "Time-to-MSCP",
    label: "Closed-loop metric per design partner",
    detail:
      "Replaces the previous '$1,685 avoidable spend recovered' metric. The cost-recovery number is literature-derived (see hero); the per-design-partner outcome we will actually measure is time-to-MSCP-visit and Care-Router pathway concordance vs. clinician adjudication."
  }
];

type Capability = {
  title: string;
  status: StatusPillStatus;
  detail: string;
  cta: { href: string; label: string };
};

// Each capability is pilled to reflect proto-vs-prod state. The
// rest of the site uses the same vocabulary so a reader who has
// internalized "prototype" / "partial" / "designed" elsewhere
// reads the same thing here.
const whatPauseProvides: Capability[] = [
  {
    title: "AI-assisted triage + risk scoring",
    status: "prototype",
    detail:
      "Deterministic risk-band scoring (lib/risk-band.ts) plus an Anthropic-backed Care Router policy surface intake-time triage. Wired and inspectable in the public prototype today.",
    cta: { href: "/demo/intake", label: "See live intake →" }
  },
  {
    title: "Persona-aware care pathway routing",
    status: "prototype",
    detail:
      "Six canonical pathways (self-care → ED referral) from a single source-of-truth enum (lib/care-router-pathways.ts). Policy-aware, traceable, designed to be overridable by clinicians once design-partner deployments are in force.",
    cta: { href: "/demo/routing", label: "See live routing →" }
  },
  {
    title: "Federated Data 360 grounding",
    status: "prototype",
    detail:
      "Phase 1 (Salesforce Health Cloud SOQL) and Phase 2 (Data Cloud Calculated Insights — HRV z-score, vasomotor burden, sleep disruption) are both live in production on the trailsignup org. The grounding endpoint reports 'Phase 2: SOQL (Health Cloud) + Data Cloud Calculated Insights' on every call; each insight falls back to its intake baseline independently if a DC call fails. Phase 2-bis swaps the demo-cohort seeded CIs for real JHE/DBDP wearable math; Phase 3 onboards the customer's EHR-of-record. Interface stays constant across phases.",
    cta: { href: "/proposal/data-360", label: "Architecture brief →" }
  },
  {
    title: "Defensible provider graph",
    status: "prototype",
    detail:
      "2,015 NPPES-derived providers behind a frozen Experience API contract. Census 2020 ZCTA distance ranking, six NPPES board-cert + multi-specialty signals, three state license-sanction filters dropping 1,720 sanctioned candidates at build (CA Medi-Cal + NY OPMC + TX TMB), real-shaped synthetic insurance acceptance. Browseable UI at /provider, per-NPI profiles at /provider/<npi>, MCP tool find_menopause_providers. The Care Router consumes the same query function so triage and the directory stay in lockstep. Closed-loop outcomes scoring (Phase 3) activates with referral volume.",
    cta: { href: "/proposal/provider-graph", label: "Provider-graph brief →" }
  },
  {
    title: "Outcomes telemetry baked in",
    status: "partial",
    detail:
      "Every Care Router decision emits OpenTelemetry-style spans (intake → identity → grounding → routing). The 'clinician's eventual action' attribute is designed (a real clinician needs to be on the other end first); spans are populated today by the prototype. Optional Salesforce Platform Event egress (sink wired 2026-06-24, dormant until customer-org Connected App + Pause_Agent_Trace__e are provisioned) ships every span into the customer's Shield + Event-Monitoring audit pipeline under the Connected App's integration user.",
    cta: { href: "/demo/agent-fabric", label: "See the trace plane →" }
  },
  {
    title: "MCP server + host (both directions)",
    status: "prototype",
    detail:
      "Pause-as-tool-source: the @pause-health/mcp server (stdio + Streamable HTTP at /api/mcp) exposes get_patient_timeline, get_patient_intake, find_menopause_providers, and experience_api_health to Claude Desktop, Cursor, and the Salesforce Agentforce 3.0 Registry. Pause-as-tool-consumer: the Care Router task endpoint now runs an MCP client per request — registers the loopback /api/mcp plus any external slots from PAUSE_MCP_HOST_REMOTES — and resolves provider recommendations via tool calls instead of direct HTTP. Verified end-to-end: host-on and host-off paths return byte-identical provider lists.",
    cta: { href: "/proposal/mcp", label: "MCP brief →" }
  }
];

type Substrate = {
  title: string;
  status: StatusPillStatus;
  detail: string;
  href: string;
  cta: string;
};

// Substrate cards pilled per their actual integration state, with
// links into the architecture briefs for the proto-vs-prod detail.
const techFoundation: Substrate[] = [
  {
    title: "JupyterHealth Exchange",
    status: "prototype",
    detail:
      "Consented FHIR R5 data exchange substrate. The interop plane for wearable, EHR, and intake records. Real JHE Django + Postgres stack stood up on the maintainer's box (2026-06-16); pause_ingest round-trips both a raw Oura heart-rate sample (mapped handler) and a derived HRV-time-domain feature (auxiliary handler, with derivedFrom provenance) end-to-end. Followed up 2026-06-23 with an opt-in PAUSE_USE_REAL_JHE=1 pytest marker — same seven contract assertions now run against the live JHE instance, not just the wire-level mock. Federation across customer-org JHE deployments is the Phase-2 target.",
    href: "/proposal/integration",
    cta: "JupyterHealth integration brief →"
  },
  {
    title: "DBDP feature engineering",
    status: "prototype",
    detail:
      "Duke's Digital Biomarker Discovery Pipeline — sleep, HRV, activity, skin temperature features. FLIRT-backed RMSSD math is integrated in pause_ingest today with 20 passing unit tests including a closed-form correctness check; FHIR persistence is Phase 2.",
    href: "/proposal/dbdp",
    cta: "DBDP brief →"
  },
  {
    title: "Salesforce Data 360",
    status: "prototype",
    detail:
      "Identity Resolution + grounding wired against Salesforce Health Cloud via OAuth Client Credentials (Phase 1, live). Three Data Cloud Calculated Insights (Pause_HRV_RMSSD_30d, Pause_Vasomotor_Burden_30d, Pause_Sleep_Disruption_7d) authored over ssot__Individual__dlm and activated on the trailsignup tenant (Phase 2, live; auth flows through the mandatory a360 token exchange — see PHASE_2_ACTIVATION_CHECKLIST.md for the five gotchas). Segments + federated query against JHE/DBDP wearable math is Phase 2-bis. The Care Router interface doesn't change across phases.",
    href: "/proposal/data-360",
    cta: "Data 360 brief →"
  },
  {
    title: "MuleSoft + Agent Fabric",
    status: "partial",
    detail:
      "MuleSoft CloudHub 2.0 worker live (iterations 1–8 shipped: Flex Gateway runtime enforcement, Auth0 RS256 JWT validation, plain Rate Limiting, OAS 3.0 spec in Exchange, and the Phase-2 contract DataWeave deployed as v1.0.4 on 2026-06-16 with the mock's full shape — distance, signals, sanctions, insurance, dataset provenance — live behind Auth0-JWT). Production /api/mulesoft/providers reports meta._source: 'live-mulesoft' end-to-end. Iteration 9 (persistent VM hosting for the Flex Gateway, moving off the local-ngrok rig) is the remaining piece. The Agent Fabric multi-agent control plane (agent registry, policy catalog, trace plane) is the designed production home for the Anthropic-backed Care Router; the underlying MuleSoft surface is more than 'designed' — it's running.",
    href: "/proposal/agent-fabric",
    cta: "Agent Fabric brief →"
  },
  {
    title: "Salesforce Headless 360 conformance",
    status: "partial",
    detail:
      "Salesforce's TDX 2026 architecture umbrella — 'every Salesforce surface is an API, MCP tool, or CLI command, and agents can use all of it.' Pause covers most of it incidentally: REST (mulesoft + data 360 + agent.json), MCP (the /api/mcp server + the Care Router host), A2A (the care-router/tasks endpoint with an Agent Card). The /proposal/headless-360 audit page names the four explicit gaps; two are now wired dormant — the PKCE External Client App OAuth flow (gap #1) with six routes under /api/salesforce/headless-360/* and 25 unit tests pinning S256 + signed-cookie invariants, and the Salesforce Platform Event egress sink (gap #3) emitting every Agent Fabric span as a Pause_Agent_Trace__e record once the customer-org Connected App is provisioned. Activation runbooks ship alongside the code so the operator-side hand-off is one document.",
    href: "/proposal/headless-360",
    cta: "Headless 360 audit →"
  },
  {
    title: "Agentforce Voice",
    status: "designed",
    detail:
      "Salesforce announced Agentforce Voice GA on 2025-10-13 and shipped Agentforce Contact Center on 2026-03-10. The partner-web developer surface is sales-gated as of 2026-06-24 (no public LWC, no Agent API voice endpoint), and the audio round-trip requires Contact Center licensing + a CCaaS partner contract (Amazon Connect / Five9 / NiCE / Vonage). Shipped honestly: a 4-env-var seam (PROVIDER + BASE_URL + DEPLOYMENT_REF + AGENT_DEPLOYMENT) plus a public-safe /api/agentforce/voice/config probe and a launch button that renders one of three affordances driven by provisioning state. The button click currently surfaces a 'verification pending' toast — the CCaaS handshake lands on activation day. The page deliberately does NOT claim a Web Speech API browser wrapper is 'Agentforce Voice'; that's a different product.",
    href: "/proposal/agentforce-voice",
    cta: "Agentforce Voice brief →"
  }
];

const businessChannels = [
  {
    channel: "Health systems",
    motion: "IDN + AMC enterprise sales",
    acv: "$25K – $75K",
    detail: "Annual contract; bundled with EHR-native install."
  },
  {
    channel: "Payers",
    motion: "Value-based payer partnerships",
    acv: "$0.50 – $2.00 PMPM",
    detail: "Eligible perimenopausal + postmenopausal populations."
  },
  {
    channel: "Medical practices",
    motion: "MSCP-credentialed independent practices",
    acv: "$2K – $8K",
    detail: "Annual subscription; lighter Agentforce-only install."
  }
];

const arrTargets = [
  { label: "24-month ARR target", value: "$8M", detail: "Across IDN + payer channels." },
  { label: "Year-4 ARR trajectory", value: "$50M+", detail: "Through multi-site IDN expansion + payer scale." }
];

const marketTiming = [
  {
    title: "Market size",
    detail:
      "U.S. menopause-care market estimated at ~$15.4B, growing ~5.7% annually (literature-derived sizing across pharma, devices, services, and digital health; the precise figure varies meaningfully across analyst sources)."
  },
  {
    title: "Payer + IDN pressure",
    detail: "Both sides under measurable pressure to improve outcomes and reduce avoidable spend."
  },
  {
    title: "AI readiness",
    detail: "LLMs are now practical enough for real-time, point-of-care decision support — at acceptable latency and cost."
  },
  {
    title: "Interop floor rising",
    detail: "FHIR R5 + SMART-on-FHIR + wearable feature tooling shorten time to clinical validation."
  }
];

const problems = [
  {
    title: "1. Misdiagnosis and delays",
    bullets: [
      "Symptoms misattributed to depression, anxiety, thyroid, or 'normal aging'.",
      "Correct diagnosis frequently takes years.",
      "Delays erode trust and prolong patient suffering."
    ]
  },
  {
    title: "2. Cost burden",
    bullets: [
      "Excess referrals + avoidable utilization inflate cost.",
      "Payers + providers each absorb the inefficiency.",
      "Workforce productivity losses extend the impact beyond healthcare."
    ]
  },
  {
    title: "3. Inconsistent treatment",
    bullets: [
      "No universal protocol across systems.",
      "Recommendations vary widely between providers.",
      "Outcome feedback loops are frequently missing entirely."
    ]
  },
  {
    title: "4. Provider workflow burden",
    bullets: [
      "Menopause care crosses specialties — hard to manage in a 12-minute visit.",
      "Research evolves faster than busy clinicians can track.",
      "Existing tools are usually not integrated into daily EHR workflows."
    ]
  }
];

const strategicObjectives = [
  {
    title: "Clinical validation",
    detail: "Validate performance against real cohorts and publish peer-reviewed evidence."
  },
  {
    title: "Health system adoption",
    detail: "Win anchor IDN customers and prove operational ROI in pilot."
  },
  {
    title: "Payer scale",
    detail: "Sign regional payer partnerships and demonstrate PMPM savings."
  },
  {
    title: "Revenue validation",
    detail: "Build durable ARR with expansion (NRR) and pipeline health metrics."
  },
  {
    title: "Product excellence",
    detail:
      "Robust EHR integration, performance, uptime, and the planned regulatory progression (HIPAA controls in force at design-partner kickoff, HITRUST CSF then SOC 2 Type II as Year-2 milestones)."
  }
];

const successCriteria = [
  { label: "Diagnostic accuracy", value: "89%+", detail: "in validation programs by month 24" },
  { label: "Time-to-diagnosis", value: "50%+ reduction", detail: "from the 2.5-year baseline" },
  { label: "ARR", value: "$8M+", detail: "with credible path to $50M+" },
  { label: "Health system customers", value: "20+", detail: "live IDN deployments" },
  { label: "Payer partnerships", value: "2+", detail: "regional value-based deals" },
  { label: "Trust posture", value: "HIPAA + roadmap HITRUST", detail: "with strong provider NPS" }
];

const strategicPriorities = [
  {
    title: "Lead with clinical evidence",
    detail: "Publication-grade validation precedes sales pressure. Earned credibility scales."
  },
  {
    title: "Build around provider workflow realities",
    detail: "EHR-native, SMART-on-FHIR. Never a sidecar app the clinician has to remember to open."
  },
  {
    title: "Align value metrics with payer economics",
    detail: "PMPM, diagnostic-yield, and avoidable-spend metrics — the ones the payer's actuarial team already tracks."
  },
  {
    title: "Continuously improve from real outcome data",
    detail: "Closed-loop scoring: every routed pathway, every clinician override, every patient outcome flows back into training + evaluation."
  },
  {
    title: "Trust + compliance as long-term differentiation",
    detail:
      "The trust posture compounds: HIPAA controls designed-for-production today, HITRUST CSF + SOC 2 Type II as planned Year-2 milestones, and ToS-respecting integrations (e.g. The Menopause Society directory deep-link rather than scraping) wired in the prototype. See /security for the per-control proto-vs-prod view."
  }
];

const archDeepDives = [
  {
    href: "/proposal/agent-fabric",
    title: "Agent Fabric",
    summary: "The multi-agent control plane — registry, policy catalog, trace plane.",
    demoHref: "/demo/agent-fabric"
  },
  {
    href: "/proposal/data-360",
    title: "Salesforce Data 360",
    summary: "Zero-copy federation + Identity Resolution + Calculated Insights as routing inputs.",
    demoHref: "/demo/patient"
  },
  {
    href: "/proposal/mulesoft",
    title: "MuleSoft integration",
    summary: "API-Led Connectivity tiers (System / Process / Experience), and where each lives in prod.",
    demoHref: null
  },
  {
    href: "/proposal/mcp",
    title: "MCP server + host",
    summary:
      "Pause's MCP tools (copy-pasteable Claude Desktop + Cursor configs) on stdio AND Streamable HTTP at /api/mcp for the Agentforce 3.0 Registry. The Care Router now also acts as an MCP HOST — calls external MCP servers as tools via PAUSE_MCP_HOST_REMOTES.",
    demoHref: null
  },
  {
    href: "/proposal/agentforce",
    title: "Agentforce intake",
    summary: "Why Salesforce Agentforce for intake, and what's live today vs. what's customer-deployment shape.",
    demoHref: "/demo/intake"
  },
  {
    href: "/proposal/agentforce-voice",
    title: "Agentforce Voice",
    summary:
      "Salesforce Agentforce Voice (GA 2025-10-13) — partner-web seam is wired and env-driven; audio round-trip gates on Agentforce Contact Center licensing + a CCaaS partner. Honest 'designed' pill until activation.",
    demoHref: null
  },
  {
    href: "/proposal/headless-360",
    title: "Headless 360 conformance audit",
    summary:
      "Maps every Pause surface (Agentforce chat, Data 360, MCP server+host, A2A Care Router, Agentforce Voice, Platform Event sink) onto Salesforce's TDX 2026 three-pattern architecture. Names the four explicit conformance gaps with status pills; gaps #1 (PKCE) and #3 (Platform Event sink) are wired dormant.",
    demoHref: null
  },
  {
    href: "/proposal/integration",
    title: "JupyterHealth integration",
    summary: "Which JupyterHealth pieces we adopt, in what order, and what we contribute back.",
    demoHref: null
  },
  {
    href: "/proposal/dbdp",
    title: "DBDP feature engineering",
    summary:
      "FLIRT-backed RMSSD shipped in pause_ingest with 20 passing unit tests + closed-form correctness check; FHIR persistence is Phase 2.",
    demoHref: null
  },
  {
    href: "/proposal/provider-graph",
    title: "Provider graph",
    summary:
      "Phase 1+2 shipped: 2,015 NPPES-derived providers, distance ranking from Census ZCTA centroids, six NPPES board-cert + multi-specialty signals, three state license-sanction filters dropping 1,720 candidates at build, synthetic-but-real-shaped insurance, /provider browseable UI.",
    demoHref: "/provider"
  },
  {
    href: "/proposal/menopause-society",
    title: "Menopause Society partnership",
    summary: "4 paths to MSCP partnership, with explicit guardrails on what we never claim.",
    demoHref: "/demo/routing"
  }
];

const strategyDeepDives = [
  {
    href: "/proposal/customers",
    title: "Customer selection",
    summary: "ICPs by segment: IDNs, value-based payers, AMCs. Buying-committee personas + sequencing."
  },
  {
    href: "/proposal/insights",
    title: "Research-design plan",
    summary:
      "Provider + patient discovery plan: literature-derived hypotheses, methodology, and the interview program ahead. Pause is pre-design-partner; this is the research we'll run, not research we've run."
  },
  {
    href: "/proposal/data",
    title: "Data inventory + strategy",
    summary: "Sources, integration order, moats, compliance posture."
  },
  {
    href: "/proposal/competition",
    title: "Competition",
    summary: "Six competitive categories + a capability matrix + what we don't claim."
  },
  {
    href: "/proposal/strategy",
    title: "Digital strategy",
    summary: "Architecture pillars, GTM motion by year, the five moats, operating principles."
  },
  {
    href: "/proposal/technology",
    title: "Technology choices",
    summary: "Stack, AI approach, evaluation framework, safety stance."
  }
];

export default function FullProposalPage() {
  return (
    <main className="container">
      <section className="hero">
        <a href="/proposal" className="btn btn-secondary">
          Back to Investor Brief
        </a>
        <p className="eyebrow">Full investor proposal · Pause-Health.ai</p>
        <h1>Menopause Clinical Decision Support</h1>
        <p className="hero-copy">
          Pause-Health.ai is designed to help clinicians diagnose and treat
          menopause-related symptoms faster and more accurately by combining
          patient history, wearable signals, and AI guidance inside normal
          clinical workflows — EHR-native, never a sidecar. The prototype is
          live and open-source today: a 2,015-provider directory with distance
          ranking + state license-sanction filters, Salesforce Data Cloud
          Calculated Insights grounding live in production, and a MuleSoft
          Experience API contract verifiable from any{" "}
          <code>curl</code> against <a href="/api/mulesoft/providers">/api/mulesoft/providers</a>.
          Provider organizations onboard in 2026 H2.
        </p>
      </section>

      <section style={{ marginTop: "1.25rem" }}>
        <div className="proposal-stat-block">
          {heroMetrics.map((m) => (
            <article key={m.label} className="proposal-stat-card">
              <StatusPill status={m.tone} />
              <p className="proposal-stat-value">{m.value}</p>
              <p className="proposal-stat-label">{m.label}</p>
              <p className="proposal-stat-detail">{m.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <p className="eyebrow">Executive summary</p>
        <h2 className="proposal-section-title">
          Close the menopause-care gap by meeting clinicians where they already work
        </h2>
        <p className="proposal-lede">
          Many women in perimenopause and menopause wait too long for correct
          diagnosis and treatment. Symptoms are often misattributed, care is
          inconsistent, and providers do not always have enough menopause-specific
          training or decision support.
        </p>
        <p className="proposal-lede">
          Pause-Health.ai is designed to close that gap. The product supports
          providers at the point of care with clear risk scoring, treatment
          suggestions, and workflow-ready guidance. The goal is better outcomes
          for patients and measurable operational value for health systems and
          payers.
        </p>

        <div className="card-grid" style={{ marginTop: "1rem" }}>
          {targetOutcomes.map((t) => (
            <article key={t.label} className="card proposal-outcome-card">
              <div className="proposal-outcome-head">
                <StatusPill status="target" />
              </div>
              <p className="proposal-stat-value">{t.value}</p>
              <p className="proposal-stat-label">{t.label}</p>
              <p className="proposal-stat-detail">{t.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <p className="eyebrow">What Pause-Health.ai provides</p>
        <h2 className="proposal-section-title">Six capabilities, each verifiable in the live prototype</h2>
        <div className="card-grid" style={{ marginTop: "0.8rem" }}>
          {whatPauseProvides.map((c) => (
            <article key={c.title} className="card">
              <StatusPill
                status={c.status}
                style={{ marginBottom: "0.5rem" }}
              />
              <h3 style={{ marginBottom: "0.4rem" }}>{c.title}</h3>
              <p style={{ margin: "0 0 0.7rem", color: "var(--text)" }}>{c.detail}</p>
              <a
                href={c.cta.href}
                className="btn btn-secondary"
                style={{ fontSize: "0.85rem", padding: "0.4rem 0.7rem" }}
              >
                {c.cta.label}
              </a>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <p className="eyebrow">Technology foundation</p>
        <h2 className="proposal-section-title">Built on open + best-of-breed substrates</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.95rem"
          }}
        >
          Pause-Health.ai composes six substrates the customer&apos;s data
          team already trusts. Architecture briefs link out to each.
        </p>
        <div className="card-grid">
          {techFoundation.map((t) => (
            <article key={t.title} className="card">
              <StatusPill
                status={t.status}
                style={{ marginBottom: "0.5rem" }}
              />
              <h3 style={{ marginBottom: "0.4rem" }}>{t.title}</h3>
              <p style={{ margin: "0 0 0.7rem", color: "var(--text)" }}>{t.detail}</p>
              <a
                href={t.href}
                className="btn btn-secondary"
                style={{ fontSize: "0.85rem", padding: "0.4rem 0.7rem" }}
              >
                {t.cta}
              </a>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "0.6rem",
            flexWrap: "wrap"
          }}
        >
          <p className="eyebrow" style={{ margin: 0 }}>
            Business model
          </p>
          <StatusPill status="target" label="Target ACV ranges · pre-design-partner" />
        </header>
        <h2 className="proposal-section-title">B2B healthcare SaaS — three channels</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.6rem",
            fontSize: "0.92rem",
            maxWidth: "70ch"
          }}
        >
          The ACV / PMPM ranges below are target ranges derived from
          comparable provider-vendor pricing benchmarks, not booked
          revenue. Pause-Health.ai is pre-design-partner; final
          pricing lands with the first executed MSAs.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
          <table className="routing-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Motion</th>
                <th>ACV / PMPM</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {businessChannels.map((row) => (
                <tr key={row.channel}>
                  <td>
                    <strong>{row.channel}</strong>
                  </td>
                  <td>{row.motion}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <strong>{row.acv}</strong>
                  </td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card-grid" style={{ marginTop: "1rem" }}>
          {arrTargets.map((t) => (
            <article key={t.label} className="card proposal-outcome-card">
              <div className="proposal-outcome-head">
                <StatusPill status="target" />
              </div>
              <p className="proposal-stat-value">{t.value}</p>
              <p className="proposal-stat-label">{t.label}</p>
              <p className="proposal-stat-detail">{t.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "0.6rem",
            flexWrap: "wrap"
          }}
        >
          <p className="eyebrow" style={{ margin: 0 }}>
            Market + strategic timing
          </p>
          <StatusPill status="research" label="Literature-derived sizing" />
        </header>
        <h2 className="proposal-section-title">A large, under-served market in a tractable moment</h2>
        <div className="card-grid">
          {marketTiming.map((m) => (
            <article key={m.title} className="card">
              <h3 style={{ marginBottom: "0.4rem" }}>{m.title}</h3>
              <p style={{ margin: 0, color: "var(--text)" }}>{m.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <p className="eyebrow">Core problems to solve</p>
        <h2 className="proposal-section-title">Where current care breaks down</h2>
        <div className="card-grid">
          {problems.map((p) => (
            <article key={p.title} className="card">
              <h3 style={{ marginBottom: "0.55rem" }}>{p.title}</h3>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: "1.1rem",
                  color: "var(--text)",
                  lineHeight: 1.55,
                  fontSize: "0.94rem"
                }}
              >
                {p.bullets.map((b) => (
                  <li key={b} style={{ marginBottom: "0.25rem" }}>
                    {b}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <p className="eyebrow">24-month objectives</p>
        <h2 className="proposal-section-title">Primary objective</h2>
        <article className="card proposal-primary-objective">
          <StatusPill
            status="target"
            label="Month-24 target · pre-design-partner"
            style={{ marginBottom: "0.5rem" }}
          />
          <p style={{ margin: 0, fontSize: "1.05rem", color: "var(--text)" }}>
            Deploy Pause AI decision support across <strong>25 health systems</strong>,
            improve diagnostic accuracy by <strong>30%</strong> over baseline,
            cut time-to-diagnosis by <strong>50%+</strong>, and reach{" "}
            <strong>$8M ARR</strong> with a clear path to $50M+.
          </p>
        </article>

        <h3 className="proposal-section-subtitle">Strategic objectives</h3>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {strategicObjectives.map((o, i) => (
            <article key={o.title} className="card">
              <p
                className="eyebrow"
                style={{ marginBottom: "0.25rem", color: "var(--brand)" }}
              >
                Objective {i + 1}
              </p>
              <h3 style={{ margin: "0 0 0.4rem" }}>{o.title}</h3>
              <p style={{ margin: 0, color: "var(--text)" }}>{o.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "0.6rem",
            flexWrap: "wrap"
          }}
        >
          <p className="eyebrow" style={{ margin: 0 }}>
            Success criteria · month 24
          </p>
          <StatusPill status="target" label="All targets · not measured yet" />
        </header>
        <h2 className="proposal-section-title">What &ldquo;done&rdquo; looks like</h2>
        <ul className="metric-list metric-list-stacked proposal-success-list">
          {successCriteria.map((s) => (
            <li key={s.label}>
              <span>{s.label}</span>
              <strong>
                {s.value}
                <span
                  style={{
                    display: "block",
                    fontWeight: 400,
                    color: "var(--muted)",
                    fontSize: "0.85rem",
                    marginTop: "0.15rem"
                  }}
                >
                  {s.detail}
                </span>
              </strong>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <p className="eyebrow">Strategic priorities</p>
        <h2 className="proposal-section-title">How we execute</h2>
        <div className="card-grid">
          {strategicPriorities.map((p) => (
            <article key={p.title} className="card">
              <h3 style={{ marginBottom: "0.4rem" }}>{p.title}</h3>
              <p style={{ margin: 0, color: "var(--text)" }}>{p.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2.5rem" }}>
        <p className="eyebrow">Read deeper · architecture + implementation</p>
        <h2 className="proposal-section-title">
          The architecture story (eleven briefs)
        </h2>
        <p style={{ color: "var(--muted)", margin: "0 0 0.8rem", fontSize: "0.95rem" }}>
          Each architecture brief covers one substrate or agent in depth, with a
          proto-vs-prod table and links to the corresponding live demo or
          mocked API surface.
        </p>
        <div className="card-grid">
          {archDeepDives.map((d) => (
            <article key={d.href} className="card">
              <h3 style={{ marginBottom: "0.4rem" }}>{d.title}</h3>
              <p style={{ margin: "0 0 0.7rem", color: "var(--text)" }}>{d.summary}</p>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <a
                  href={d.href}
                  className="btn btn-secondary"
                  style={{ fontSize: "0.85rem", padding: "0.4rem 0.7rem" }}
                >
                  Brief →
                </a>
                {d.demoHref && (
                  <a
                    href={d.demoHref}
                    className="btn btn-secondary"
                    style={{ fontSize: "0.85rem", padding: "0.4rem 0.7rem" }}
                  >
                    Live demo →
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <p className="eyebrow">Read deeper · strategy + market</p>
        <h2 className="proposal-section-title">
          The investment-thesis briefs (six)
        </h2>
        <div className="card-grid">
          {strategyDeepDives.map((d) => (
            <article key={d.href} className="card">
              <h3 style={{ marginBottom: "0.4rem" }}>{d.title}</h3>
              <p style={{ margin: "0 0 0.7rem", color: "var(--text)" }}>{d.summary}</p>
              <a
                href={d.href}
                className="btn btn-secondary"
                style={{ fontSize: "0.85rem", padding: "0.4rem 0.7rem" }}
              >
                Brief →
              </a>
            </article>
          ))}
        </div>
      </section>

      <section style={{ margin: "2.5rem 0 2rem" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.6rem",
            alignItems: "center"
          }}
        >
          <a href="/proposal" className="btn btn-secondary">
            ← Back to Investor Brief hub
          </a>
          <a href="/demo/intake" className="btn btn-primary">
            Experience the live prototype →
          </a>
        </div>
      </section>
    </main>
  );
}
