import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Customer Selection",
  description:
    "Deep dive into ideal customer profiles for Pause-Health.ai across integrated health systems and value-based payers.",
  path: "/proposal/customers",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Customer selection — Pause-Health.ai investor brief."
});

const segments = [
  {
    name: "Integrated Delivery Networks (IDNs)",
    size: "~120 systems in the US with 5+ hospitals and OB/GYN service lines",
    profile:
      "Multi-specialty providers serving 250k–2M attributed lives. Already invested in Epic or Cerner, with active ambulatory transformation programs.",
    pain:
      "Menopause patients ricochet across primary care, OB/GYN, behavioral health, and cardiology. Care plans are inconsistent and outcomes are not measured.",
    economic_buyer: "Chief Medical Officer / VP Ambulatory Services",
    champion: "Service line director for Women's Health",
    contract: "Annual SaaS, $250k–$1.2M ACV, gain-share on quality metrics",
    why_now:
      "CMS quality programs now include menopause-adjacent outcomes; women 40-60 are the highest-margin commercial cohort."
  },
  {
    name: "Value-Based Care Payers",
    size: "Top 25 commercial + Medicare Advantage plans (HEDIS-driven)",
    profile:
      "Plans with at-risk arrangements where avoidable utilization for midlife women materially impacts MLR.",
    pain:
      "Midlife women drive disproportionate ER visits for cardiac, mental health, and undifferentiated symptoms — many are unrecognized menopause presentations.",
    economic_buyer: "VP Clinical Programs / Chief Medical Officer",
    champion: "Director of Women's Health or Behavioral Health programs",
    contract: "PMPM ($1.50–$4.00 per attributed midlife woman) + outcomes incentive",
    why_now:
      "STAR ratings and HEDIS controlling-high-blood-pressure, depression screening, and care coordination measures all benefit."
  },
  {
    name: "Academic Medical Centers",
    size: "~80 AMCs with active menopause or midlife women's research programs",
    profile:
      "Tertiary providers with clinical research infrastructure, IRBs, and willingness to co-author evidence.",
    pain:
      "Have the expertise but lack tooling to operationalize specialty guidelines across general OB/GYN and primary care.",
    economic_buyer: "Department Chair (OB/GYN or Internal Medicine)",
    champion: "Director of a midlife/menopause specialty clinic",
    contract: "Research + clinical SaaS hybrid, $150k–$500k ACV",
    why_now:
      "Funding for women's health research is at a 20-year high; AMCs need partners to translate guidelines into workflow."
  }
];

const personas = [
  {
    role: "Service Line Director, Women's Health",
    org: "IDN / health system",
    drivers: [
      "Reduce variation in menopause care across affiliated clinics",
      "Hit quality and patient-experience targets",
      "Demonstrate ROI to operating leadership"
    ]
  },
  {
    role: "Chief Medical Officer",
    org: "IDN or payer",
    drivers: [
      "Reduce avoidable utilization for midlife women",
      "Show measurable improvements in HEDIS / patient outcomes",
      "Find a defensible AI strategy with clinical guardrails"
    ]
  },
  {
    role: "Medical Director, Women's Health programs",
    org: "Payer",
    drivers: [
      "Build at-risk products that win employer business",
      "Reduce mental-health and cardiometabolic spend in the 40-60 cohort",
      "Operationalize menopause clinical guidelines at population scale"
    ]
  },
  {
    role: "Director of Clinical Informatics",
    org: "IDN / AMC",
    drivers: [
      "Approve FHIR-native, SMART-on-FHIR-capable apps",
      "Ensure audit-ready, explainable AI decisions",
      "Avoid yet another EHR side-system"
    ]
  }
];

const sizing = [
  { label: "US women ages 40-60", value: "~50M" },
  { label: "Annual US menopause-adjacent visits", value: "~120M" },
  { label: "Estimated total annual spend on midlife women's care", value: "$28B+" },
  { label: "Serviceable obtainable market (Year 5)", value: "$420M ARR" }
];

export default function CustomersPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="Customer Selection: who Pause-Health.ai sells to and why now"
      subtitle="A focused B2B motion targeting integrated health systems and value-based payers — the two buyer archetypes that own the menopause care problem and have budget to fix it."
    >
      <section className="card-grid">
        {segments.map((s) => (
          <article key={s.name} className="card">
            <h3>{s.name}</h3>
            <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
              {s.size}
            </p>
            <p>{s.profile}</p>
            <ul className="metric-list">
              <li>
                <span>Acute pain</span>
                <strong style={{ fontWeight: 500 }}>{s.pain}</strong>
              </li>
              <li>
                <span>Economic buyer</span>
                <strong>{s.economic_buyer}</strong>
              </li>
              <li>
                <span>Internal champion</span>
                <strong>{s.champion}</strong>
              </li>
              <li>
                <span>Contract shape</span>
                <strong>{s.contract}</strong>
              </li>
              <li>
                <span>Why now</span>
                <strong style={{ fontWeight: 500 }}>{s.why_now}</strong>
              </li>
            </ul>
          </article>
        ))}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Buying committee personas</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {personas.map((p) => (
            <article key={p.role} className="card">
              <h3>{p.role}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {p.org}
              </p>
              <ul className="metric-list">
                {p.drivers.map((d) => (
                  <li key={d}>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Market sizing</p>
        <ul className="metric-list">
          {sizing.map((m) => (
            <li key={m.label}>
              <span>{m.label}</span>
              <strong>{m.value}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Sequencing</p>
        <p>
          Land with 3–5 forward-leaning IDNs and 1–2 value-based payers in Year 1 to anchor outcomes
          evidence. Expand into peer systems via clinical advisory referrals and into employer-paid
          carve-outs through payer relationships. Academic medical centers serve as evidence
          partners, not initial ARR.
        </p>
      </section>
    </ProposalShell>
  );
}
