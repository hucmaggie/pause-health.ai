import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Competition",
  description:
    "Competitive landscape across DTC menopause brands, employer benefits, and clinical AI — and where Pause-Health.ai differentiates.",
  path: "/proposal/competition",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Competition — Pause-Health.ai investor brief."
});

const landscape = [
  {
    category: "DTC menopause brands",
    examples: "Midi Health, Evernow, Alloy, Winona, Versalie",
    audience: "Patients directly (subscription telehealth + RX)",
    strength:
      "Brand recognition and patient demand. Beautiful consumer UX. Have de-stigmatized menopause conversations.",
    weakness:
      "Cash-pay or limited insurance; capture only the ~10% of women willing to pay out-of-pocket. No integration with the patient's actual longitudinal record.",
    overlap_with_pause: "Low — different buyer, different funding source"
  },
  {
    category: "Employer-benefits platforms",
    examples: "Maven Clinic, Carrot, Progyny, Kindbody",
    audience: "Self-insured employers, increasingly carrying menopause",
    strength:
      "Strong distribution into Fortune 500. Comprehensive women's health benefits across fertility, maternity, menopause.",
    weakness:
      "Menopause is one of many lines; not the focus. Most rely on a network of contracted clinicians rather than augmenting the patient's existing provider.",
    overlap_with_pause:
      "Medium — we could plug INTO these platforms as the clinical decision layer rather than competing on benefits brand"
  },
  {
    category: "Specialty menopause clinics",
    examples: "Independent NAMS-certified practices, hospital midlife clinics",
    audience: "Patients with means and motivation to seek out a specialist",
    strength:
      "Deep expertise. Trusted relationships. Often early adopters of new tooling.",
    weakness:
      "Capacity-limited; thousands exist, but cannot scale to the ~50M women who need this care.",
    overlap_with_pause:
      "Low — they are buyers, not competitors. Pause amplifies their reach into general OB/GYN and primary care."
  },
  {
    category: "EHR-embedded clinical AI",
    examples: "Abridge, Suki, DeepScribe, Nuance DAX",
    audience: "Health systems, broadly",
    strength:
      "Strong EHR integration story. Documented productivity wins.",
    weakness:
      "Horizontal: scribes and notes, not condition-specific clinical reasoning. Not a menopause product.",
    overlap_with_pause:
      "Adjacent — coexists. We integrate into the same EHRs but solve a different problem (clinical reasoning, not transcription)."
  },
  {
    category: "Disease-specific clinical AI",
    examples: "Cleerly (cardiology), K Health (primary care), Aidoc (radiology)",
    audience: "Health systems and specialty service lines",
    strength:
      "Proves the model: vertical AI products that win because they go deep into one condition.",
    weakness: "None are focused on menopause — the category leader is open.",
    overlap_with_pause:
      "Validating precedent — establishes the buying motion for condition-specific provider AI."
  },
  {
    category: "Generalist LLM offerings",
    examples: "Foundation-model providers selling 'healthcare' SKUs",
    audience: "Health systems experimenting",
    strength: "Powerful base models. Cheap experimentation surface.",
    weakness:
      "No menopause-specific grounding, no clinical workflow, no evidence base, no integration. Pilots stall.",
    overlap_with_pause:
      "Low — they're a substrate, not a competitor. We build on top of best-in-class foundation models."
  }
];

const positioning = [
  {
    capability: "Menopause clinical depth",
    pause: "Yes — purpose-built",
    dtc: "Limited — visit-level",
    employer: "Partial — multi-line",
    ehrAi: "No",
    generalist: "No"
  },
  {
    capability: "EHR-integrated (FHIR / SMART)",
    pause: "Yes",
    dtc: "No",
    employer: "No",
    ehrAi: "Yes",
    generalist: "No"
  },
  {
    capability: "Wearable + PRO integration",
    pause: "Yes",
    dtc: "Partial",
    employer: "Partial",
    ehrAi: "No",
    generalist: "No"
  },
  {
    capability: "Explainable, evidence-grounded recommendations",
    pause: "Yes — guideline retrieval",
    dtc: "No",
    employer: "No",
    ehrAi: "Partial",
    generalist: "No"
  },
  {
    capability: "Sold to providers + payers (not patients)",
    pause: "Yes",
    dtc: "No",
    employer: "Employer-paid",
    ehrAi: "Yes",
    generalist: "Variable"
  },
  {
    capability: "Outcomes telemetry / continuous learning",
    pause: "Yes",
    dtc: "Limited",
    employer: "Limited",
    ehrAi: "Limited",
    generalist: "No"
  }
];

const differentiators = [
  "Vertical depth in menopause that horizontal scribes and generalist LLMs cannot reach.",
  "B2B provider + payer go-to-market — durable contracts vs. churn-prone DTC subscriptions.",
  "Patient timeline that merges wearable, PRO, and EHR data into a single clinical picture.",
  "Explainability by construction — every recommendation cites the guideline and the data point.",
  "Outcomes registry built into every deployment — compounding evidence advantage."
];

export default function CompetitionPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="Competition: the landscape and where we win"
      subtitle="The menopause space is crowded on the patient side and empty on the provider side. Pause-Health.ai claims the provider/payer category before incumbents can pivot in."
    >
      <section>
        <p className="eyebrow">Landscape</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {landscape.map((c) => (
            <article key={c.category} className="card">
              <h3>{c.category}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {c.examples}
              </p>
              <ul className="metric-list">
                <li>
                  <span>Primary audience</span>
                  <strong style={{ fontWeight: 500 }}>{c.audience}</strong>
                </li>
                <li>
                  <span>Strength</span>
                  <strong style={{ fontWeight: 500 }}>{c.strength}</strong>
                </li>
                <li>
                  <span>Weakness</span>
                  <strong style={{ fontWeight: 500 }}>{c.weakness}</strong>
                </li>
                <li>
                  <span>Overlap with Pause</span>
                  <strong style={{ fontWeight: 500 }}>{c.overlap_with_pause}</strong>
                </li>
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Capability matrix</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Capability</th>
                <th>Pause-Health.ai</th>
                <th>DTC menopause</th>
                <th>Employer benefits</th>
                <th>EHR clinical AI</th>
                <th>Generalist LLM</th>
              </tr>
            </thead>
            <tbody>
              {positioning.map((row) => (
                <tr key={row.capability}>
                  <td>{row.capability}</td>
                  <td>{row.pause}</td>
                  <td>{row.dtc}</td>
                  <td>{row.employer}</td>
                  <td>{row.ehrAi}</td>
                  <td>{row.generalist}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Why we win</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          {differentiators.map((line) => (
            <li key={line}>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>
    </ProposalShell>
  );
}
