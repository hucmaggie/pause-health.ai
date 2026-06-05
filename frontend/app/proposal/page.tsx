import { pageMetadata } from "../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief",
  description:
    "Pause-Health.ai investor brief — premium menopause intelligence for modern provider organizations. Two arcs: the investment thesis (strategy + market), and the architecture story (how Pause actually works), with per-card links into the live prototype.",
  path: "/proposal",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Pause-Health.ai investor brief — provider-first menopause AI."
});

/**
 * The investor-brief index hub.
 *
 * The page is organized around two distinct narrative arcs, each
 * with its own card grid. Arc A is the investment thesis (strategy,
 * market, customers, competition, evaluation). Arc B is the
 * architecture story (the substrates, agents, and policies that
 * make Pause-Health.ai actually work) -- this arc is also the
 * gold-standard half of the deck, with proto-vs-prod tables, live
 * API CTAs, and source-badged honesty across every page.
 *
 * Each Arc B card surfaces a "See the demo" link to the matching
 * /demo/* page where the corresponding capability is observable.
 *
 * The hub also surfaces three top-level CTAs (Open Full Proposal /
 * Experience Prototype / Back to Landing) so an investor can pivot
 * to whichever entry-point matches their reading style.
 */

const heroPoints = [
  {
    text:
      "Focus cohort: women ages 40-60 navigating perimenopause and menopause with nuanced, evolving symptom profiles.",
    badge: null
  },
  {
    text:
      "~67% are initially misdiagnosed; the average path to accurate diagnosis can extend to ~2.5 years.",
    badge: "Research"
  },
  {
    text:
      "89% AI-assisted triage accuracy with transparent, evidence-linked rationale.",
    badge: "Target"
  },
  {
    text:
      "FHIR-native data + wearable biomarkers create a real-time menopause intelligence layer.",
    badge: null
  },
  {
    text:
      "Provider-first B2B model delivering measurable ROI and durable ARR growth.",
    badge: "Plan"
  }
];

type SectionCard = {
  href: string;
  label: string;
  summary: string;
  /** Optional matching live-demo page. Surfaced as a second CTA on the card. */
  demoHref?: string;
  /** Optional matching live API surface. Surfaced as a second CTA on the card when no demo exists. */
  apiHref?: string;
};

const strategySections: SectionCard[] = [
  {
    href: "/proposal/customers",
    label: "Customer selection",
    summary:
      "Health system + value-based payer ICPs, buying committee personas, market sizing, and sequencing."
  },
  {
    href: "/proposal/insights",
    label: "Research-design plan",
    summary:
      "Provider + patient discovery plan: literature-derived hypotheses, methodology, and the interview program ahead. (Pause is pre-design-partner; this is the research we'll run, not research we've run.)"
  },
  {
    href: "/proposal/data",
    label: "Data inventory + strategy",
    summary:
      "Sources, integration order, moats, and the compliance posture (HIPAA today; HITRUST + SOC 2 Type II on the roadmap)."
  },
  {
    href: "/proposal/competition",
    label: "Competition",
    summary:
      "Six competitive categories, a capability matrix, and the differentiators that compound with deployment time."
  },
  {
    href: "/proposal/strategy",
    label: "Digital strategy",
    summary:
      "Five architectural pillars, GTM motion by year, the five moats, and operating principles. Every pillar tagged with current status (Shipped / Wired in prototype / Designed / Future)."
  },
  {
    href: "/proposal/technology",
    label: "Technology choices",
    summary:
      "Ten stack layers, six AI-approach axes, an evaluation framework, and a six-principle safety stance — each layer status-tagged and cross-linked to the architecture brief that owns it."
  }
];

const architectureSections: SectionCard[] = [
  {
    href: "/proposal/agent-fabric",
    label: "Agent Fabric",
    summary:
      "Multi-agent control plane: registry, policy catalog, trace plane. Anthropic Claude-backed Care Router runs here.",
    demoHref: "/demo/agent-fabric"
  },
  {
    href: "/proposal/data-360",
    label: "Salesforce Data 360",
    summary:
      "Unified patient memory: Identity Resolution + Calculated Insights + Segments, zero-copy federated over JupyterHealth + DBDP + EHR-of-record.",
    demoHref: "/demo/patient"
  },
  {
    href: "/proposal/agentforce",
    label: "Agentforce intake",
    summary:
      "Live patient intake on a real Salesforce Service Cloud org today. The substrate our health-system customers already operate.",
    demoHref: "/demo/intake"
  },
  {
    href: "/proposal/mulesoft",
    label: "MuleSoft integration",
    summary:
      "Three-tier API-Led Connectivity (System / Process / Experience) stitching JupyterHealth, DBDP, and wearable feeds into a single FHIR substrate.",
    apiHref: "/api/mulesoft/health"
  },
  {
    href: "/proposal/mcp",
    label: "MCP server",
    summary:
      "Pause as a tool surface for AI agents — four MCP tools, copy-pasteable configs for Claude Desktop, Cursor, and Agentforce.",
    apiHref: "/.well-known/mcp.json"
  },
  {
    href: "/proposal/integration",
    label: "JupyterHealth integration",
    summary:
      "Which JupyterHealth pieces we adopt, in what phase order, and what we contribute back."
  },
  {
    href: "/proposal/dbdp",
    label: "DBDP feature engineering",
    summary:
      "Wearable + biomarker features via the Digital Biomarker Discovery Pipeline. Phase 1 shipped: FLIRT-backed RMSSD with closed-form correctness tests."
  },
  {
    href: "/proposal/provider-graph",
    label: "Provider graph",
    summary:
      "A defensible menopause-clinician routing graph from CMS NPPES + state boards + taxonomy + outcomes. Closed-loop scoring that compounds with deployment."
  },
  {
    href: "/proposal/menopause-society",
    label: "Menopause Society partnership",
    summary:
      "Four paths to MSCP partnership with explicit guardrails on what we never claim. The advisory + credential moat.",
    demoHref: "/demo/routing"
  }
];

function SectionCardRender({ card }: { card: SectionCard }) {
  const secondaryHref = card.demoHref ?? card.apiHref;
  const secondaryLabel = card.demoHref
    ? "See the demo →"
    : card.apiHref
    ? "Live API →"
    : null;
  return (
    <article className="card proposal-hub-card">
      <h3 style={{ marginBottom: "0.45rem" }}>{card.label}</h3>
      <p
        style={{
          margin: "0 0 0.85rem",
          color: "var(--text)",
          lineHeight: 1.55,
          fontSize: "0.94rem"
        }}
      >
        {card.summary}
      </p>
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        <a
          href={card.href}
          className="btn btn-secondary"
          style={{ fontSize: "0.85rem", padding: "0.4rem 0.7rem" }}
        >
          Read brief →
        </a>
        {secondaryHref && secondaryLabel && (
          <a
            href={secondaryHref}
            className="btn btn-secondary"
            style={{ fontSize: "0.85rem", padding: "0.4rem 0.7rem" }}
            {...(card.apiHref
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            {secondaryLabel}
          </a>
        )}
      </div>
    </article>
  );
}

export default function ProposalPage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Investor brief · Pause-Health.ai</p>
        <h1>Premium menopause intelligence for modern provider organizations</h1>
        <p className="hero-copy">
          Pause-Health.ai transforms fragmented menopause care into an
          elegant, measurable, and clinically explainable workflow built
          for provider excellence — EHR-native, never a sidecar.
        </p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          {heroPoints.map((point) => (
            <li
              key={point.text}
              style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}
            >
              {point.badge && (
                <span
                  className={`pre-brief-source-badge ${
                    point.badge === "Target" || point.badge === "Plan"
                      ? "pre-brief-source-badge--mock"
                      : "pre-brief-source-badge--mock"
                  }`}
                  style={{ flexShrink: 0, marginTop: "0.15rem" }}
                >
                  {point.badge}
                </span>
              )}
              <span>{point.text}</span>
            </li>
          ))}
        </ul>
        <div className="hero-actions">
          <a href="/proposal/full" className="btn btn-primary">
            Open Full Investor Proposal
          </a>
          <a href="/demo/intake" className="btn btn-secondary">
            Experience Clickable Prototype
          </a>
          <a href="/" className="btn btn-secondary">
            Back to Landing
          </a>
        </div>
      </section>

      <section style={{ marginTop: "1.75rem" }}>
        <p className="eyebrow">Arc A · Investment thesis</p>
        <h2 className="proposal-section-title">
          The strategy + market briefs (six)
        </h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.95rem",
            maxWidth: "65ch"
          }}
        >
          Why Pause-Health.ai, why now, who buys, what the competitive
          landscape looks like, and how we will evaluate ourselves —
          each brief plan-vs-status-tagged so an investor can read
          intent and current reality side by side.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {strategySections.map((card) => (
            <SectionCardRender key={card.href} card={card} />
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.75rem" }}>
        <p className="eyebrow">Arc B · Architecture + implementation</p>
        <h2 className="proposal-section-title">
          How Pause actually works (nine briefs)
        </h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.95rem",
            maxWidth: "65ch"
          }}
        >
          Each architecture brief has a proto-vs-prod table, a phased
          plan, and a &ldquo;Touch the architecture&rdquo; section linking
          out to live mocked APIs and (where they exist) live demo
          pages. The five cards with a &ldquo;See the demo&rdquo; or
          &ldquo;Live API&rdquo; link below are observable today.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {architectureSections.map((card) => (
            <SectionCardRender key={card.href} card={card} />
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.75rem", marginBottom: "1.5rem" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.6rem",
            alignItems: "center"
          }}
        >
          <a href="/proposal/full" className="btn btn-primary">
            Open Full Investor Proposal →
          </a>
          <a href="/demo/intake" className="btn btn-secondary">
            Experience the live prototype →
          </a>
          <a href="/" className="btn btn-secondary">
            ← Back to Landing
          </a>
        </div>
      </section>
    </main>
  );
}
