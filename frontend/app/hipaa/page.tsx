import { StubPage } from "../../components/stub-page";

export const metadata = { title: "HIPAA Notice | Pause-Health.ai" };

export default function HipaaPage() {
  return (
    <StubPage
      eyebrow="HIPAA Notice"
      title="HIPAA practices and notice."
      intro="Pause-Health.ai operates as a Business Associate to provider organizations under HIPAA. We execute Business Associate Agreements (BAAs) prior to any access to protected health information (PHI) and maintain administrative, physical, and technical safeguards required under the Security Rule."
    >
      <ul className="metric-list">
        <li>
          <span>Role under HIPAA</span>
          <strong>Business Associate</strong>
        </li>
        <li>
          <span>BAA</span>
          <strong>Executed with each provider partner</strong>
        </li>
        <li>
          <span>Privacy Officer contact</span>
          <strong>privacy@pause-health.ai</strong>
        </li>
      </ul>
    </StubPage>
  );
}
