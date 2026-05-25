import { ProposalShell } from "../../../components/proposal-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Investor Brief · Technology Choices",
  description:
    "Technical architecture, AI approach, evaluation framework, and safety stance powering Pause-Health.ai.",
  path: "/proposal/technology",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Technology choices — Pause-Health.ai investor brief."
});

const stack = [
  {
    layer: "Integration / ingestion",
    choices:
      "FHIR R4, SMART-on-FHIR, HL7v2 fallback, HealthKit / Health Connect bridges, X12 claims",
    rationale:
      "Standards-based. Avoids per-EHR custom work. Lets us land in any Epic / Cerner site within weeks instead of quarters."
  },
  {
    layer: "Data platform",
    choices: "Snowflake / Databricks (per-customer choice), dbt for transforms, OMOP CDM alignment",
    rationale:
      "OMOP gives us research-grade interoperability with academic partners and lets us reuse open methods."
  },
  {
    layer: "Inference and orchestration",
    choices:
      "LangGraph-style stateful agents, retrieval-augmented generation over the guideline corpus, structured tool-calling",
    rationale:
      "Modular, testable, and explainable. Every step of a recommendation can be replayed deterministically."
  },
  {
    layer: "Foundation models",
    choices:
      "Frontier providers (Anthropic, OpenAI, Google) plus open-weight options (Llama, Mistral) for federated deployments",
    rationale:
      "Best-in-class quality where allowed; on-prem option for security-sensitive customers without rebuilding the product."
  },
  {
    layer: "Specialty models",
    choices:
      "Fine-tuned classifiers for symptom-cluster scoring, risk stratification, and PRO interpretation",
    rationale:
      "Small, fast, evaluable models for the repetitive structured work; LLMs only where reasoning is required."
  },
  {
    layer: "Application",
    choices: "Next.js (SMART-on-FHIR launch), React Native (patient mobile), TypeScript throughout",
    rationale:
      "Same engineers can move between web, EHR-embedded, and mobile surfaces. Reduces silos."
  },
  {
    layer: "Infrastructure",
    choices: "AWS (HIPAA-eligible), single-tenant VPC per enterprise customer, GitHub Actions CI",
    rationale:
      "Health-IT-ready posture from day one. Customer-controlled blast radius."
  },
  {
    layer: "Observability",
    choices: "Per-recommendation traces (inputs, retrieval, model version, output, clinician action)",
    rationale:
      "Audit-grade trail. Required for clinical trust and for the training-feedback loop."
  }
];

const aiApproach = [
  {
    aspect: "Recommendation generation",
    approach:
      "RAG over a curated menopause guideline corpus + patient timeline. Outputs are structured, ranked, and accompanied by retrieved evidence."
  },
  {
    aspect: "Symptom clustering",
    approach:
      "Domain-specific embedding model trained on PRO + EHR free text. Identifies multi-system menopause presentations that single-symptom checklists miss."
  },
  {
    aspect: "Risk stratification",
    approach:
      "Gradient-boosted classifier on structured features (vitals, labs, history, wearable signals). Outputs are calibrated probabilities, not opaque scores."
  },
  {
    aspect: "Conversational interface",
    approach:
      "Constrained, role-aware agent. Provider mode: clinical pre-read and decision support. Patient mode: symptom logging and education."
  },
  {
    aspect: "Continuous improvement",
    approach:
      "Active learning loop: clinician edits and rejections feed back into preference-tuning datasets. Outcomes registry validates long-term accuracy."
  }
];

const evals = [
  {
    name: "Clinician acceptance rate",
    target: ">= 70% accept-or-edit; <10% reject outright",
    why: "Operationally meaningful adoption signal; precedes outcomes data."
  },
  {
    name: "Recommendation accuracy vs. specialist panel",
    target: ">= 85% concordance on top-1; >= 95% on top-3",
    why: "Validates that the system suggests what an expert clinician would suggest."
  },
  {
    name: "Diagnostic time reduction",
    target: "From 2.5 years (industry average) to <90 days for newly-onset cases",
    why: "Direct patient outcome and a compelling marketing claim — only credible if measured."
  },
  {
    name: "Avoidable utilization reduction",
    target: "10-20% reduction in ER + specialist visits for the cohort over 12 months",
    why: "Anchors the payer ROI conversation."
  },
  {
    name: "Hallucination rate on guideline questions",
    target: "<1% on a held-out evaluation set; 0% on contraindication questions",
    why: "Safety floor. Contraindications and dosing must be deterministic."
  }
];

const safety = [
  {
    principle: "Bounded scope",
    detail:
      "The system addresses menopause-related decisions only. Outside-scope questions are deflected with explicit handoff."
  },
  {
    principle: "Human-in-the-loop by design",
    detail:
      "No autonomous prescribing. No autonomous patient messaging without clinician review. Recommendations only."
  },
  {
    principle: "Explainability is a feature, not a setting",
    detail:
      "Every recommendation links to its evidence and inputs. If we can't show the work, we don't show the recommendation."
  },
  {
    principle: "Bias monitoring",
    detail:
      "Sub-group performance tracking by age band, race, ethnicity, geography, and clinical setting. Reported quarterly to the clinical advisory board."
  },
  {
    principle: "Red-teaming and adversarial evaluation",
    detail:
      "Quarterly red-team exercises by external clinical evaluators. Findings published internally and acted on before each major release."
  },
  {
    principle: "Privacy posture",
    detail:
      "HIPAA-ready architecture. HITRUST CSF on the roadmap. PHI never leaves customer-controlled VPC in federated deployments."
  }
];

export default function TechnologyPage() {
  return (
    <ProposalShell
      eyebrow="Investor Brief · Part 2"
      title="Technology Choices: architecture, AI approach, and safety"
      subtitle="A pragmatic stack that earns clinician trust on day one and gets faster, sharper, and safer with every deployment."
    >
      <section>
        <p className="eyebrow">Stack overview</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {stack.map((s) => (
            <article key={s.layer} className="card">
              <h3>{s.layer}</h3>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginBottom: "0.5rem" }}>
                {s.choices}
              </p>
              <p>{s.rationale}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">AI approach</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {aiApproach.map((a) => (
            <article key={a.aspect} className="card">
              <h3>{a.aspect}</h3>
              <p>{a.approach}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Evaluation framework</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Target</th>
                <th>Why it matters</th>
              </tr>
            </thead>
            <tbody>
              {evals.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.target}</td>
                  <td>{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Safety and trust</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {safety.map((s) => (
            <article key={s.principle} className="card">
              <h3>{s.principle}</h3>
              <p>{s.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </ProposalShell>
  );
}
