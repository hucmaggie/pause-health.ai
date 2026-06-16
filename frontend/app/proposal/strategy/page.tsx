import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

const pillSpacing: React.CSSProperties = { marginBottom: "0.5rem" };

export const metadata = pageMetadata({
  title: "Investor Brief · Digital Strategy",
  description:
    "Architectural strategy, go-to-market motion, and the competitive moats that make Pause-Health.ai defensible. Each pillar tagged with current status (Designed / Wired in prototype / Shipped / Future) so investors can see plan-vs-reality at a glance.",
  path: "/proposal/strategy",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Digital strategy — Pause-Health.ai investor brief."
});

/**
 * Each card carries a status tag so the strategy page reads as
 * "plan vs status", not "everything is already happening". Tags:
 *
 *   - "Shipped"             -- demonstrable in the live prototype today
 *   - "Wired in prototype"  -- proves the path; not yet customer-deployed
 *   - "Designed"            -- architecture is decided, build is ahead
 *   - "Future"              -- earned through traction we don't yet have
 *
 * Each card may also link out to one of the architecture briefs
 * (Arc B) or demo pages that backs the claim.
 */
/**
 * Strategy pages use a 4-key subset of the canonical StatusPill
 * vocabulary (components/status-pill.tsx): shipped / prototype /
 * designed / future. Kept as a type alias so the table data refuses
 * unsupported statuses at compile time.
 */
type Status = "shipped" | "prototype" | "designed" | "future";

const pillars: Array<{
  pillar: string;
  intent: string;
  today: string;
  status: Status;
  link?: { href: string; label: string };
}> = [
  {
    pillar: "EHR-native, never sidecar",
    intent:
      "Pause is delivered as a SMART-on-FHIR app inside Epic and Cerner workflows. The clinician never leaves their chart. This single architectural choice is the difference between adopted product and shelfware.",
    today:
      "JupyterHealth FHIR R5 substrate is wired; the MuleSoft Process API is deployed on CloudHub 2.0 today, fronting the Phase-2 contract DataWeave with the same shape every fabric consumer (UI, agent, MCP) reads; Salesforce Agentforce is the current intake surface for the live demo. SMART-on-FHIR install package itself is on the build plan, not shipped.",
    status: "prototype",
    link: { href: "/proposal/integration", label: "JupyterHealth integration brief →" }
  },
  {
    pillar: "Patient-side data capture",
    intent:
      "PRO and wearable data are collected via a mobile experience the patient already uses (HealthKit / Health Connect bridge), then surfaced as a structured 'pre-read' inside the EHR — not a separate inbox.",
    today:
      "DBDP Phase 1 (FLIRT-backed RMSSD) is shipped with closed-form correctness tests. Salesforce Data Cloud Calculated Insights (Pause_HRV_RMSSD_30d, Pause_Vasomotor_Burden_30d, Pause_Sleep_Disruption_7d) are LIVE on the trailsignup tenant, surfaced in every Care Router grounding payload alongside the Phase-1 SOQL signals. JupyterHealth FHIR observations land in the federated grounding payload. The native HealthKit / Health Connect bridge + real-wearable JHE/DBDP math behind the CIs (Phase 2-bis) are still ahead.",
    status: "prototype",
    link: { href: "/proposal/dbdp", label: "DBDP feature engineering brief →" }
  },
  {
    pillar: "Recommendation, not autopilot",
    intent:
      "Pause never takes a clinical action. It surfaces a ranked, explainable recommendation set with cited evidence and an editable narrative. The clinician remains the decision maker.",
    today:
      "Enforced by the Agent Fabric policy catalog today. The Anthropic-backed Care Router emits a recommendation (not an order); the no-clinical-autonomy policy is one of the four enforced policies on every span. Trace plane records the clinician's eventual action when it lands.",
    status: "shipped",
    link: { href: "/demo/agent-fabric", label: "See the policy catalog live →" }
  },
  {
    pillar: "Outcomes-anchored contracting",
    intent:
      "Every customer contract includes a measurement plan: diagnostic time, symptom resolution, HT adherence, avoidable utilization, satisfaction. We are paid in part on what we deliver.",
    today:
      "No signed customer contracts yet. The measurement plan template is drafted; PMPM + diagnostic-yield + avoidable-spend metrics are the levers on the table. Outcomes telemetry pipeline exists on the trace plane.",
    status: "future"
  },
  {
    pillar: "Build the registry, own the evidence",
    intent:
      "The de-identified outcomes registry is published, contributing to the menopause evidence base, and circling back to product as the strongest competitive moat we have.",
    today:
      "Data 360 segments + cohort comparison are the prototype substrate; Phase 2 Data Cloud Calculated Insights (HRV z-score, vasomotor burden, sleep disruption) are LIVE on the trailsignup tenant and grounding every routing call today. Registry-as-product (de-identified outcomes feed back to advisory + community) is gated on the first ~12 months of customer deployment, not yet earned.",
    status: "prototype",
    link: { href: "/proposal/data-360", label: "Data 360 architecture brief →" }
  }
];

const gtmMotion: Array<{
  stage: string;
  intent: string;
  today: string;
  status: Status;
}> = [
  {
    stage: "Year 0 — design partners",
    intent:
      "3-5 forward-leaning IDNs and 1 value-based payer. Free or deeply discounted. Mutual goal: ship-quality clinical evidence and case studies. Co-author publications and conference talks.",
    today:
      "Pre-design-partner stage. Investor brief + working prototype exist; first design-partner conversations are the next milestone.",
    status: "future"
  },
  {
    stage: "Year 1 — paid pilots into ARR",
    intent:
      "Convert design partners to paid contracts. Land 3-5 new IDNs at $250-500k ACV. Begin payer pilots with PMPM structure. ARR target: $2-4M.",
    today: "Gated on Year 0 design-partner traction.",
    status: "future"
  },
  {
    stage: "Year 2 — peer expansion",
    intent:
      "Lean on customer references and clinical advisory network. Expand within multi-system IDNs (single hospital → enterprise). Launch employer-paid carve-out via payer partners. ARR target: $10-15M.",
    today: "Gated on Year 1 paid-pilot conversion.",
    status: "future"
  },
  {
    stage: "Year 3 — platform extensions",
    intent:
      "Adjacent vertical: bone health, cardiometabolic risk, sexual / pelvic health for midlife women. Continue compounding outcomes data. ARR target: $30-45M.",
    today: "Gated on Year 2 expansion footprint + outcomes registry density.",
    status: "future"
  }
];

const moats: Array<{
  moat: string;
  intent: string;
  today: string;
  status: Status;
  link?: { href: string; label: string };
}> = [
  {
    moat: "Workflow integration depth",
    intent:
      "Each Epic/Cerner deployment takes 60-120 days and meaningful clinician trust. Once installed, switching cost is high. Eventually, Pause becomes 'the way menopause care is done here.'",
    today:
      "Estimate based on industry deployment timelines for SMART-on-FHIR + Epic/Cerner App Orchard installs. No live deployment time observed yet.",
    status: "designed",
    link: { href: "/proposal/integration", label: "JupyterHealth integration brief →" }
  },
  {
    moat: "Outcomes registry",
    intent:
      "Continuous accumulation of structured outcomes data tied to specific recommendations. After 18 months of customer deployment, the registry is unreplicable by a new entrant.",
    today:
      "Trace plane records inputs/outputs/model per recommendation today. Registry as a customer-facing product is gated on customer-deployment time.",
    status: "prototype",
    link: { href: "/proposal/agent-fabric", label: "Agent Fabric brief →" }
  },
  {
    moat: "Clinical advisory network",
    intent:
      "A who's-who of MSCP-credentialed and NAMS-affiliated clinicians and researchers as advisors and design partners. Each adds credibility and slows competitive entry.",
    today:
      "Advisory network at pre-recruit stage. MSCP-credentialed routing graph design is documented; the partnership-with-The-Menopause-Society path is explicit.",
    status: "designed",
    link: { href: "/proposal/menopause-society", label: "Menopause Society brief →" }
  },
  {
    moat: "Guideline grounding library",
    intent:
      "A curated, structured, retrievable corpus of menopause guidelines maintained as evidence evolves. The work of building and maintaining it is more durable than the AI models themselves.",
    today:
      "Live in the prototype: NAMS / Menopause Society + ACOG + IMS + AACE position statements are wired into the federated grounding store, and every Care Router decision cites the corpus (verifiable on /demo/intake and /demo/agent-fabric). Continuous-update pipeline as evidence evolves is Phase 2 work.",
    status: "prototype",
    link: { href: "/proposal/data", label: "Data inventory brief →" }
  },
  {
    moat: "Sanction-filtered, menopause-scored provider graph",
    intent:
      "Vendor provider graphs (Definitive Healthcare, IQVIA OneKey, etc.) are excellent for general healthcare but don't score for menopause and don't run a build-time sanction filter against state license registries. Pause's directory unions CMS NPPES + The Menopause Society MSCP overlay + multi-state license-sanction overlays + Census ZCTA centroids for distance ranking. Each refresh recompounds the moat without requiring a paid feed.",
    today:
      "Live today (see /provider). 2,015 menopause-relevant providers across all 50 states + DC / 930 ZIP-3 prefixes (a coverage-aware selection spreads the non-certified budget across prefixes; non-US/garbage postals are gated out). Three state license-sanction overlays at build time (CA Medi-Cal, NY OPMC, TX TMB) — 1,720 sanctioned candidates dropped in the June 2026 build, verifiable per response under provenance.dataset.sanctionedFilteredBySource. The Care Router consumes the same query function the agent and /provider use, so triage and the directory stay in lockstep. National coverage via a paid multi-state license-status feed (Verisys, ProviderTrust) is the Phase-3 hardening path.",
    status: "prototype",
    link: { href: "/proposal/provider-graph", label: "Provider graph brief →" }
  },
  {
    moat: "Brand and category leadership",
    intent:
      "Owning 'menopause AI for providers' as a category. First in market, loudest voice in clinical conferences, deepest evidence base.",
    today:
      "Pre-market. The investor brief, the demo, and the architecture-honesty posture (LIVE / MOCKED tagging across the deck) are the early proof points.",
    status: "future"
  }
];

const operatingPrinciples = [
  "Vertical depth beats horizontal breadth.",
  "Clinicians are the user; patients are the beneficiary.",
  "Explain everything. If we can't explain it, we don't ship it.",
  "Evidence is a deliverable, not a marketing artifact.",
  "Default to the EHR. Side-systems die.",
  "Tag plan vs status everywhere. Aspiration is fine; aspiration disguised as fact is corrosive."
];

// StatusPill lives in components/status-pill.tsx so the vocabulary
// stays consistent across the deck (Arc A + Arc B + demo pages).

export default function StrategyPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="Digital Strategy: architecture, motion, and moats"
      subtitle="Pause is a category-creation strategy as much as a product strategy. Each pillar, stage, and moat below is tagged with current status (Shipped / Wired in prototype / Designed / Future) so investors can read plan-vs-reality at a glance. Architecture briefs link out from cards whose claims they back."
    >
      <section>
        <p className="eyebrow">Architectural pillars</p>
        <h2 className="proposal-section-title">
          Five pillars — each one verifiable today, or honestly labeled as ahead
        </h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {pillars.map((p) => (
            <article key={p.pillar} className="card">
              <StatusPill status={p.status} style={pillSpacing} />
              <h3>{p.pillar}</h3>
              <p
                style={{
                  margin: "0 0 0.6rem",
                  color: "var(--text)"
                }}
              >
                {p.intent}
              </p>
              <p
                style={{
                  margin: "0 0 0.6rem",
                  color: "var(--muted)",
                  fontSize: "0.88rem",
                  lineHeight: 1.55,
                  borderLeft: "2px solid var(--line)",
                  paddingLeft: "0.6rem"
                }}
              >
                <strong style={{ color: "var(--text)" }}>Today: </strong>
                {p.today}
              </p>
              {p.link && (
                <a
                  href={p.link.href}
                  className="btn btn-secondary"
                  style={{ fontSize: "0.85rem", padding: "0.4rem 0.7rem" }}
                >
                  {p.link.label}
                </a>
              )}
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Go-to-market motion</p>
        <h2 className="proposal-section-title">Four stages — current stage made explicit</h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.95rem"
          }}
        >
          We are pre-design-partner. The investor brief and the working
          prototype are the artifacts of the Year-0-minus-one stage; first
          design-partner conversations are the immediate next milestone.
        </p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {gtmMotion.map((s) => (
            <article key={s.stage} className="card">
              <StatusPill status={s.status} style={pillSpacing} />
              <h3>{s.stage}</h3>
              <p
                style={{
                  margin: "0 0 0.6rem",
                  color: "var(--text)"
                }}
              >
                {s.intent}
              </p>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontSize: "0.88rem",
                  lineHeight: 1.55,
                  borderLeft: "2px solid var(--line)",
                  paddingLeft: "0.6rem"
                }}
              >
                <strong style={{ color: "var(--text)" }}>Today: </strong>
                {s.today}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Competitive moats</p>
        <h2 className="proposal-section-title">Six moats — each compounding over deployment time</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {moats.map((m) => (
            <article key={m.moat} className="card">
              <StatusPill status={m.status} style={pillSpacing} />
              <h3>{m.moat}</h3>
              <p
                style={{
                  margin: "0 0 0.6rem",
                  color: "var(--text)"
                }}
              >
                {m.intent}
              </p>
              <p
                style={{
                  margin: "0 0 0.6rem",
                  color: "var(--muted)",
                  fontSize: "0.88rem",
                  lineHeight: 1.55,
                  borderLeft: "2px solid var(--line)",
                  paddingLeft: "0.6rem"
                }}
              >
                <strong style={{ color: "var(--text)" }}>Today: </strong>
                {m.today}
              </p>
              {m.link && (
                <a
                  href={m.link.href}
                  className="btn btn-secondary"
                  style={{ fontSize: "0.85rem", padding: "0.4rem 0.7rem" }}
                >
                  {m.link.label}
                </a>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Operating principles</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          {operatingPrinciples.map((p) => (
            <li key={p}>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">Where each pillar comes from in the architecture</h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/integration">JupyterHealth integration</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The EHR-native substrate behind Pillar 1.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/dbdp">DBDP feature engineering</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The wearable + PRO data pipeline behind Pillar 2.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/agent-fabric">Agent Fabric</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The policy catalog that enforces &quot;recommendation, not
              autopilot&quot; in Pillar 3 — verifiable live.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/data-360">Salesforce Data 360</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The segment + cohort substrate behind the outcomes registry
              moat in Pillar 5.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/menopause-society">Menopause Society partnership</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The advisory + credential network behind the clinical-advisory
              moat.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/customers">Customer selection</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The ICP segmentation that drives the Year 0–3 GTM stages.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
