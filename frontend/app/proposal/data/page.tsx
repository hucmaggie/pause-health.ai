import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Data Inventory & Strategy",
  description:
    "Available menopause datasets, our data strategy, and the proprietary data moats Pause-Health.ai will accrue over time.",
  path: "/proposal/data",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Data inventory and strategy — Pause-Health.ai investor brief."
});

const inventory = [
  {
    source: "EHR clinical data",
    type: "FHIR R4 via SMART-on-FHIR",
    volume: "Structured + unstructured visit notes for ~250M US patients across Epic, Cerner",
    examples: "Vitals, problem list, medications, lab panels (FSH, estradiol, TSH), encounter notes",
    why_it_matters:
      "The longitudinal clinical truth set. Where we measure outcomes and where guidelines are applied."
  },
  {
    source: "Claims data",
    type: "X12 837/835, plus partner data lakes",
    volume: "Visit, procedure, prescription, and ER utilization across commercial + MA plans",
    examples: "ICD-10 N95.x, CPT for endometrial biopsy / DEXA, RX fills for HT/SSRIs/SNRIs",
    why_it_matters:
      "Quantifies avoidable utilization and the economic case for the payer-side product."
  },
  {
    source: "Patient-generated wearables",
    type: "HealthKit / Health Connect, Oura, Whoop, Garmin",
    volume: "Continuous HRV, sleep, heart rate, skin temperature, cycle data",
    examples: "Sleep fragmentation, resting HR drift, nocturnal heat events, HRV decline patterns",
    why_it_matters:
      "Earliest and most sensitive signal for perimenopause onset — usually invisible to clinicians."
  },
  {
    source: "Patient-reported outcomes (PROs)",
    type: "Validated instruments + adaptive intake",
    volume: "MRS (Menopause Rating Scale), GCS, PHQ-9, GAD-7, plus structured symptom diaries",
    examples: "Vasomotor severity, sleep quality, mood, cognition, sexual function, urogenital",
    why_it_matters:
      "Captures the symptoms that drive lived experience but rarely make it into the EHR."
  },
  {
    source: "Public research corpora",
    type: "Open / licensed",
    volume: "SWAN, UK Biobank menopause cohort, NHS, PubMed, ClinicalTrials.gov",
    examples: "Trajectory data, hormone-therapy outcomes, cardiovascular risk modeling",
    why_it_matters: "Pretraining and clinical evaluation; provides population-level priors."
  },
  {
    source: "Specialty guideline corpus",
    type: "Structured + retrievable",
    volume: "NAMS, ACOG, IMS, AACE position statements; menopause hormone-therapy guidance",
    examples: "Evidence levels, contraindications, dosing, monitoring intervals",
    why_it_matters:
      "Grounding source for every recommendation — explainability requires it."
  }
];

const dataStrategy = [
  {
    pillar: "FHIR-native by default",
    description:
      "All ingestion conforms to FHIR R4 resources. No bespoke data formats. SMART-on-FHIR auth means we plug into Epic and Cerner without bespoke integration projects."
  },
  {
    pillar: "Patient-side first, EHR-side second",
    description:
      "We begin collection on the patient side (wearables + PROs) before the visit, then merge in EHR context. This produces a fuller picture than starting from the EHR alone."
  },
  {
    pillar: "De-identified product telemetry",
    description:
      "Every AI recommendation is logged with inputs, outputs, clinician acceptance, and downstream outcome. This dataset compounds in value monthly."
  },
  {
    pillar: "Outcomes registry",
    description:
      "With each design-partner contract, we co-build a clinical outcomes registry — diagnostic time, symptom resolution, utilization deltas, HT adoption and adherence."
  },
  {
    pillar: "Federated where required",
    description:
      "For health systems unwilling to move data, our inference layer runs federated against an in-VPC deployment. Model weights leave; PHI does not."
  }
];

const moats = [
  {
    moat: "Acceptance + outcomes telemetry",
    detail:
      "Every recommendation accepted, edited, or rejected by a clinician — paired with the eventual outcome — becomes training signal. Competitors without deployments can't replicate this."
  },
  {
    moat: "Multi-modal patient timeline",
    detail:
      "Wearable + PRO + EHR merged on a per-patient timeline is rare and expensive to assemble. The longer a patient is on Pause, the more valuable this representation becomes."
  },
  {
    moat: "Specialty guideline grounding library",
    detail:
      "A curated, regularly updated, retrievable corpus of menopause clinical guidelines mapped to structured concepts. Hard to build, harder to keep current."
  },
  {
    moat: "Provider relationships and EHR install base",
    detail:
      "Each Epic / Cerner deployment takes time and trust. The N-th install is dramatically faster than the first, while remaining a meaningful barrier for newcomers."
  }
];

export default function DataPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="Data Inventory & Insights: building the menopause data substrate"
      subtitle="Menopause care has rich, fragmented data. The opportunity isn't to collect more — it's to assemble what already exists into a clinically usable, longitudinal patient picture, and compound a proprietary outcomes layer on top."
    >
      <section>
        <p className="eyebrow">Data inventory</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {inventory.map((d) => (
            <article key={d.source} className="card">
              <h3>{d.source}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {d.type}
              </p>
              <ul className="metric-list">
                <li>
                  <span>Volume / coverage</span>
                  <strong style={{ fontWeight: 500 }}>{d.volume}</strong>
                </li>
                <li>
                  <span>Representative signals</span>
                  <strong style={{ fontWeight: 500 }}>{d.examples}</strong>
                </li>
                <li>
                  <span>Why it matters</span>
                  <strong style={{ fontWeight: 500 }}>{d.why_it_matters}</strong>
                </li>
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Data strategy</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {dataStrategy.map((s) => (
            <article key={s.pillar} className="card">
              <h3>{s.pillar}</h3>
              <p>{s.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Data moats</p>
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
        <p className="eyebrow">Governance and trust</p>
        <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Compliance posture</span>
            <strong>HIPAA + HITRUST CSF on the implementation roadmap; SOC 2 Type II in Year 2</strong>
          </li>
          <li>
            <span>Data residency</span>
            <strong>US-only by default; per-customer VPC available for federated deployments</strong>
          </li>
          <li>
            <span>Patient consent</span>
            <strong>Granular, withdrawable, separated per data domain (clinical, wearable, PRO)</strong>
          </li>
          <li>
            <span>AI auditability</span>
            <strong>Every recommendation reproducible: inputs, model version, retrieval set, output</strong>
          </li>
        </ul>
      </section>
    </ProposalShell>
  );
}
