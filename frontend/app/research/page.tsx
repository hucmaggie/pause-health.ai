import { StubPage } from "../../components/stub-page";

export const metadata = { title: "Clinical Research | Pause-Health.ai" };

export default function ResearchPage() {
  return (
    <StubPage
      eyebrow="Clinical Research"
      title="Evidence-grounded menopause intelligence."
      intro="Our models are built on peer-reviewed menopause clinical guidance, validated symptom inventories, and de-identified longitudinal cohorts. We publish our methodology, validation results, and bias monitoring as the platform matures."
    >
      <ul className="metric-list">
        <li>
          <span>Guidelines referenced</span>
          <strong>NAMS, ACOG, IMS, Endocrine Society</strong>
        </li>
        <li>
          <span>Validation cohort target</span>
          <strong>10k+ women across 5 health systems</strong>
        </li>
        <li>
          <span>Bias monitoring</span>
          <strong>Quarterly with clinician review</strong>
        </li>
      </ul>
    </StubPage>
  );
}
