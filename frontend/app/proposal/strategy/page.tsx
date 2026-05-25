import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Digital Strategy",
  description:
    "Architectural strategy, go-to-market motion, and the competitive moats that make Pause-Health.ai defensible.",
  path: "/proposal/strategy",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Digital strategy — Pause-Health.ai investor brief."
});

const pillars = [
  {
    pillar: "EHR-native, never sidecar",
    description:
      "Pause is delivered as a SMART-on-FHIR app inside Epic and Cerner workflows. The clinician never leaves their chart. This single architectural choice is the difference between adopted product and shelfware."
  },
  {
    pillar: "Patient-side data capture",
    description:
      "PRO and wearable data are collected via a mobile experience the patient already uses (HealthKit / Health Connect bridge), then surfaced as a structured 'pre-read' inside the EHR — not a separate inbox."
  },
  {
    pillar: "Recommendation, not autopilot",
    description:
      "Pause never takes a clinical action. It surfaces a ranked, explainable recommendation set with cited evidence and an editable narrative. The clinician remains the decision maker."
  },
  {
    pillar: "Outcomes-anchored contracting",
    description:
      "Every customer contract includes a measurement plan: diagnostic time, symptom resolution, HT adherence, avoidable utilization, satisfaction. We are paid in part on what we deliver."
  },
  {
    pillar: "Build the registry, own the evidence",
    description:
      "The de-identified outcomes registry is published, contributing to the menopause evidence base, and circling back to product as the strongest competitive moat we have."
  }
];

const gtmMotion = [
  {
    stage: "Year 0 — design partners",
    detail:
      "3-5 forward-leaning IDNs and 1 value-based payer. Free or deeply discounted. Mutual goal: ship-quality clinical evidence and case studies. Co-author publications and conference talks."
  },
  {
    stage: "Year 1 — paid pilots into ARR",
    detail:
      "Convert design partners to paid contracts. Land 3-5 new IDNs at $250-500k ACV. Begin payer pilots with PMPM structure. ARR target: $2-4M."
  },
  {
    stage: "Year 2 — peer expansion",
    detail:
      "Lean on customer references and clinical advisory network. Expand within multi-system IDNs (single hospital → enterprise). Launch employer-paid carve-out via payer partners. ARR target: $10-15M."
  },
  {
    stage: "Year 3 — platform extensions",
    detail:
      "Adjacent vertical: bone health, cardiometabolic risk, sexual / pelvic health for midlife women. Continue compounding outcomes data. ARR target: $30-45M."
  }
];

const moats = [
  {
    moat: "Workflow integration depth",
    detail:
      "Each Epic/Cerner deployment takes 60-120 days and meaningful clinician trust. Once installed, switching cost is high. Eventually, Pause becomes 'the way menopause care is done here.'"
  },
  {
    moat: "Outcomes registry",
    detail:
      "Continuous accumulation of structured outcomes data tied to specific recommendations. After 18 months of customer deployment, the registry is unreplicable by a new entrant."
  },
  {
    moat: "Clinical advisory network",
    detail:
      "A who's-who of NAMS-affiliated clinicians and researchers as advisors and design partners. Each adds credibility and slows competitive entry."
  },
  {
    moat: "Guideline grounding library",
    detail:
      "A curated, structured, retrievable corpus of menopause guidelines maintained as evidence evolves. The work of building and maintaining it is more durable than the AI models themselves."
  },
  {
    moat: "Brand and category leadership",
    detail:
      "Owning 'menopause AI for providers' as a category. First in market, loudest voice in clinical conferences, deepest evidence base."
  }
];

const operatingPrinciples = [
  "Vertical depth beats horizontal breadth.",
  "Clinicians are the user; patients are the beneficiary.",
  "Explain everything. If we can't explain it, we don't ship it.",
  "Evidence is a deliverable, not a marketing artifact.",
  "Default to the EHR. Side-systems die."
];

export default function StrategyPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="Digital Strategy: architecture, motion, and moats"
      subtitle="Pause is not just a product strategy — it's a category-creation strategy. The architecture and go-to-market are designed to compound defensibility from day one."
    >
      <section>
        <p className="eyebrow">Architectural pillars</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {pillars.map((p) => (
            <article key={p.pillar} className="card">
              <h3>{p.pillar}</h3>
              <p>{p.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Go-to-market motion</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {gtmMotion.map((s) => (
            <article key={s.stage} className="card">
              <h3>{s.stage}</h3>
              <p>{s.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Competitive moats</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {moats.map((m) => (
            <article key={m.moat} className="card">
              <h3>{m.moat}</h3>
              <p>{m.detail}</p>
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
    </ProposalShell>
  );
}
