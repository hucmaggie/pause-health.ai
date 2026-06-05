import { ProposalShell } from "../../../components/proposal-shell";
import { StatusPill } from "../../../components/status-pill";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Customer Selection",
  description:
    "Deep dive into ideal customer profiles for Pause-Health.ai across integrated health systems, value-based payers, and academic medical centers. Market sizing labeled as estimates; design-partner status surfaced explicitly.",
  path: "/proposal/customers",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Customer selection — Pause-Health.ai investor brief."
});

/**
 * Customer-selection brief — Arc A polish pass.
 *
 * Three things changed from the prior version:
 *
 *   1. Market-sizing numbers were stated declaratively
 *      ("~120 IDNs", "Top 25 plans", "$28B+ spend", "$420M Year 5
 *      SOM"). They now carry "Estimate" pills so a reader can't
 *      mistake industry-analyst rollups for first-party measurement.
 *   2. A "Design-partner status" block is added at the top so the
 *      page is honest about where Pause is in its GTM motion
 *      (pre-design-partner). The investor doesn't have to scroll
 *      /proposal/strategy to find this out.
 *   3. A "Read deeper" cross-link footer connects the ICPs to the
 *      provider-graph, menopause-society, and strategy briefs that
 *      operationalize them.
 */

const designPartnerStatus = [
  {
    label: "Stage",
    value: "Pre-design-partner",
    detail:
      "The investor brief + working prototype are the artifacts of this stage. First design-partner conversations are the next milestone."
  },
  {
    label: "Signed customers",
    value: "0",
    detail: "Pause-Health.ai is pre-revenue."
  },
  {
    label: "First-target cohort",
    value: "3–5 IDNs + 1 value-based payer",
    detail:
      "Free or deeply discounted Year-0 design partners with mutual goals of ship-quality clinical evidence and case studies."
  },
  {
    label: "Where this is detailed",
    value: "→ /proposal/strategy",
    detail:
      "Year 0–3 GTM motion, each stage status-tagged so reading plan vs reality is one click away.",
    href: "/proposal/strategy"
  }
];

const segments = [
  {
    name: "Integrated Delivery Networks (IDNs)",
    sizeValue: "~120 systems",
    sizeDetail: "in the US with 5+ hospitals and OB/GYN service lines",
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
    sizeValue: "Top 25 commercial + MA plans",
    sizeDetail: "with HEDIS-driven incentive structures",
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
    sizeValue: "~80 AMCs",
    sizeDetail: "with active menopause or midlife women's research programs",
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

const sizing: Array<{ label: string; value: string; detail: string }> = [
  {
    label: "US women ages 40-60",
    value: "~50M",
    detail: "U.S. Census + research-derived estimate."
  },
  {
    label: "Annual US menopause-adjacent visits",
    value: "~120M",
    detail: "Industry-analyst estimate; ambulatory + ER + specialty combined."
  },
  {
    label: "Estimated annual spend, midlife women's care",
    value: "$28B+",
    detail: "Industry-analyst rollup of direct + avoidable utilization."
  },
  {
    label: "Serviceable obtainable market (Year 5)",
    value: "$420M ARR",
    detail: "Pause-internal model: IDN + payer + AMC channels combined, conservative attach."
  }
];

export default function CustomersPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="Customer Selection: who Pause-Health.ai sells to and why now"
      subtitle="A focused B2B motion targeting integrated health systems, value-based payers, and academic medical centers — the three buyer archetypes that own the menopause care problem and have budget to fix it. Market sizing carries Estimate pills; design-partner status is surfaced explicitly at the top so plan-vs-reality is one read."
    >
      <section
        className="card"
        style={{
          marginBottom: "1.5rem",
          borderLeft: "3px solid var(--brand)",
          background: "rgba(25, 11, 22, 0.45)"
        }}
      >
        <p className="eyebrow" style={{ marginBottom: "0.4rem" }}>
          Design-partner status · today
        </p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          Where Pause is on the GTM curve
        </h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {designPartnerStatus.map((row) => (
            <li key={row.label}>
              <span>{row.label}</span>
              <strong>
                {row.href ? (
                  <a href={row.href} style={{ color: "var(--brand)" }}>
                    {row.value}
                  </a>
                ) : (
                  row.value
                )}
                <span
                  style={{
                    display: "block",
                    fontWeight: 400,
                    color: "var(--muted)",
                    fontSize: "0.85rem",
                    marginTop: "0.15rem",
                    lineHeight: 1.5
                  }}
                >
                  {row.detail}
                </span>
              </strong>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <p className="eyebrow">Target segments</p>
        <h2 className="proposal-section-title">Three ICPs — sized + sequenced</h2>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {segments.map((s) => (
            <article key={s.name} className="card">
              <h3>{s.name}</h3>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", margin: "0.2rem 0 0.6rem" }}>
                <StatusPill status="estimate" />
                <span style={{ color: "var(--brand)", fontWeight: 600 }}>
                  {s.sizeValue}
                </span>
                <span style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
                  {s.sizeDetail}
                </span>
              </div>
              <p style={{ margin: "0 0 0.6rem", color: "var(--text)" }}>{s.profile}</p>
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
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Buying committee personas</p>
        <h2 className="proposal-section-title">The four people in the room</h2>
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
        <p className="eyebrow">Market sizing · estimates</p>
        <h2 className="proposal-section-title" style={{ marginTop: 0 }}>
          The numbers behind the motion
        </h2>
        <p
          style={{
            color: "var(--muted)",
            margin: "0 0 0.8rem",
            fontSize: "0.92rem"
          }}
        >
          Every number below is an estimate — industry-analyst rollups,
          census-derived counts, or Pause-internal SOM modeling — and is
          tagged as such. None are first-party Pause measurements.
        </p>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          {sizing.map((m) => (
            <li key={m.label}>
              <span>{m.label}</span>
              <strong>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <StatusPill status="estimate" />
                  <span>{m.value}</span>
                </span>
                <span
                  style={{
                    display: "block",
                    fontWeight: 400,
                    color: "var(--muted)",
                    fontSize: "0.85rem",
                    marginTop: "0.15rem",
                    lineHeight: 1.5
                  }}
                >
                  {m.detail}
                </span>
              </strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Sequencing</p>
        <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.6 }}>
          Land with 3–5 forward-leaning IDNs and 1–2 value-based payers in
          Year 1 to anchor outcomes evidence. Expand into peer systems via
          clinical advisory referrals and into employer-paid carve-outs
          through payer relationships. Academic medical centers serve as
          evidence partners, not initial ARR.
        </p>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Read deeper</p>
        <h2 className="proposal-section-title">How the ICPs connect to the rest of the deck</h2>
        <ul className="metric-list metric-list-stacked" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>
              <a href="/proposal/strategy">Digital strategy</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The Year 0–3 GTM motion that operationalizes these ICPs —
              with status pills per stage.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/provider-graph">Provider graph</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              How we route patients to the right clinicians inside each
              ICP&apos;s network.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/menopause-society">Menopause Society partnership</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The MSCP-credential overlay that strengthens the clinical
              champion narrative for IDN + AMC buyers.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/insights">Research-design plan</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              The interview program that will be recruited from these
              ICP segments during design-partner stage.
            </strong>
          </li>
          <li>
            <span>
              <a href="/proposal/competition">Competition</a>
            </span>
            <strong style={{ fontWeight: 500 }}>
              Why these ICPs are not already served by DTC, employer-benefits,
              or generalist-LLM offerings.
            </strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
