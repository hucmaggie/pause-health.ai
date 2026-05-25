import { pageMetadata } from "../../lib/page-metadata";
import { proposalSections } from "../../components/proposal-shell";

export const metadata = pageMetadata({
  title: "Investor Brief",
  description:
    "Premium menopause intelligence for modern provider organizations — investor-facing summary with market, model, and traction.",
  path: "/proposal",
  ogImage: "/brand/pause-health-og-proposal.png",
  ogImageAlt: "Pause-Health.ai investor brief — provider-first menopause AI."
});

const points = [
  "Focus cohort: women ages 40-60 navigating perimenopause and menopause with nuanced, evolving symptom profiles.",
  "67% are initially misdiagnosed; the average path to accurate diagnosis can extend to 2.5 years.",
  "Pause target: 89% AI-assisted triage accuracy with transparent, evidence-linked rationale.",
  "FHIR-native data and wearable biomarkers create a real-time menopause intelligence layer.",
  "Commercial strategy: provider-first B2B model delivering measurable ROI and durable ARR growth."
];

const partTwoSummaries: Record<string, string> = {
  "/proposal/customers":
    "Health system and value-based payer ICPs, buying committee, and market sizing.",
  "/proposal/insights":
    "Themes from 32 provider and 47 patient interviews — what they said, in their words.",
  "/proposal/data":
    "Available menopause datasets, our data strategy, and the moats we accrue over time.",
  "/proposal/competition":
    "DTC, employer benefits, EHR AI, generalist LLMs — landscape and where Pause wins.",
  "/proposal/strategy":
    "Architectural pillars, go-to-market motion, and defensibility flywheel.",
  "/proposal/technology":
    "Stack, AI approach, evaluation framework, and safety stance.",
  "/proposal/integration":
    "How Pause composes with JupyterHealth — open FHIR substrate and customer-controlled deployment.",
  "/proposal/dbdp":
    "Wearable feature engineering via the Digital Biomarker Discovery Pipeline (Duke) — production-grade HRV, EDA, and accelerometer signals.",
  "/proposal/menopause-society":
    "How Pause composes with The Menopause Society and the MSCP credential — referral, partnership, and earned trust.",
  "/proposal/provider-graph":
    "A defensible menopause provider graph from CMS NPPES and state board data — ToS-clean, closed-loop, compounding.",
  "/proposal/agentforce":
    "Patient intake on Salesforce Agentforce Service Agent — runs on the substrate our health-system customers already operate.",
  "/proposal/mulesoft":
    "Integration plane on MuleSoft Anypoint — three-tier API-Led Connectivity stitching JupyterHealth, DBDP, and wearables into a single FHIR substrate."
};

export default function ProposalPage() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">Investor summary</p>
        <h1>Premium menopause intelligence for modern provider organizations</h1>
        <p className="hero-copy">
          Pause-Health.ai transforms fragmented menopause care into an elegant, measurable, and
          clinically explainable workflow built for provider excellence.
        </p>
        <ul className="metric-list">
          {points.map((point) => (
            <li key={point}>
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <div className="hero-actions">
          <a href="/proposal/full" className="btn btn-secondary">
            Open Full Investor Proposal
          </a>
          <a href="/demo/intake" className="btn btn-primary">
            Experience Clickable Prototype
          </a>
          <a href="/" className="btn btn-secondary">
            Back to Landing
          </a>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="eyebrow">Part 2 · Deep dives</p>
        <div className="card-grid" style={{ marginTop: "0.6rem" }}>
          {proposalSections.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className="card"
              style={{ textDecoration: "none", display: "block" }}
            >
              <h3>{section.label}</h3>
              <p>{partTwoSummaries[section.href]}</p>
              <p style={{ color: "var(--brand)", fontWeight: 600, marginTop: "0.6rem" }}>
                Read section →
              </p>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
