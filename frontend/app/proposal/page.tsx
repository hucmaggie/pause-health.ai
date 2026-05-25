import { pageMetadata } from "../../lib/page-metadata";

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
          <a
            href="/docs/menopause-clinical-decision-support-proposal.html"
            className="btn btn-secondary"
          >
            Open Full Investor Proposal
          </a>
          <a href="/demo/intake" className="btn btn-primary">
            Experience Clickable Prototype
          </a>
          <a href="/" className="btn btn-secondary">
            Back to Landing
          </a>
        </div>
        <section style={{ marginTop: "1.5rem" }} className="card">
          <h3>Part 2 planned scope</h3>
          <ul className="metric-list">
            <li>
              <span>Customer selection and segmentation deep dive</span>
            </li>
            <li>
              <span>Provider and patient interview insights</span>
            </li>
            <li>
              <span>Data inventory and modeling strategy</span>
            </li>
            <li>
              <span>Competitive positioning and digital strategy</span>
            </li>
            <li>
              <span>Detailed technology architecture and AI choices</span>
            </li>
          </ul>
        </section>
      </section>
    </main>
  );
}
