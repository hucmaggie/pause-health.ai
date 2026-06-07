import {
  StatusPill,
  type StatusPillStatus
} from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Full Proposal",
  description:
    "The complete Pause-Health.ai investor brief — market thesis, target outcomes, technology foundation, business model, 24-month objectives, and the full architecture deep-dives.",
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
    status: "partial",
    detail:
      "Live grounding path federates against Salesforce Health Cloud today (Phase 1, OAuth Client Credentials). Phase 2 swaps the target for the Data Cloud Federated Query API against JupyterHealth FHIR + DBDP; Phase 3 onboards the customer's EHR-of-record. Interface stays constant across phases.",
    cta: { href: "/proposal/data-360", label: "Architecture brief →" }
  },
  {
    title: "Outcomes telemetry baked in",
    status: "partial",
    detail:
      "Every Care Router decision emits OpenTelemetry-style spans (intake → identity → grounding → routing). The 'clinician's eventual action' attribute is designed (a real clinician needs to be on the other end first); spans are populated today by the prototype.",
    cta: { href: "/demo/agent-fabric", label: "See the trace plane →" }
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
    status: "designed",
    detail:
      "Consented FHIR R5 data exchange substrate. The interop plane for wearable, EHR, and intake records. Federation target for Phase 2; not the live grounding path today.",
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
    status: "partial",
    detail:
      "Identity Resolution + grounding wired against Salesforce Health Cloud today via OAuth Client Credentials. The full Data 360 surface (Calculated Insights + Segments + federated query) is Phase 2 — the Care Router interface doesn't change across phases.",
    href: "/proposal/data-360",
    cta: "Data 360 brief →"
  },
  {
    title: "MuleSoft Agent Fabric",
    status: "designed",
    detail:
      "Multi-agent control plane: agent registry, policy catalog, trace plane. The Anthropic-backed Care Router runs against a Pause-internal A2A endpoint today; the MuleSoft Agent Fabric is the designed production home for it.",
    href: "/proposal/agent-fabric",
    cta: "Agent Fabric brief →"
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
    title: "MCP server",
    summary: "Pause's MCP tools (copy-pasteable Claude Desktop + Cursor configs).",
    demoHref: null
  },
  {
    href: "/proposal/agentforce",
    title: "Agentforce intake",
    summary: "Why Salesforce Agentforce for intake, and what's live today vs. what's customer-deployment shape.",
    demoHref: "/demo/intake"
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
    summary: "Phase 1 shipped: FLIRT-backed RMSSD with closed-form correctness tests.",
    demoHref: null
  },
  {
    href: "/proposal/provider-graph",
    title: "Provider graph",
    summary: "How we build the menopause-clinician routing graph (NPPES + boards + outcomes).",
    demoHref: null
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
          live and open-source today; provider organizations onboard in 2026 H2.
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
        <h2 className="proposal-section-title">Four capabilities, each verifiable in the live prototype</h2>
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
          Pause-Health.ai composes four substrates the customer&apos;s data
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
          The architecture story (nine briefs)
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
