import { StubPage } from "../../components/stub-page";

export const metadata = { title: "Security & Compliance | Pause-Health.ai" };

export default function SecurityPage() {
  return (
    <StubPage
      eyebrow="Security & Compliance"
      title="Built for clinical trust from day one."
      intro="Pause-Health.ai is designed to meet the security, privacy, and regulatory expectations of provider organizations handling protected health information."
    >
      <ul className="metric-list">
        <li>
          <span>HIPAA</span>
          <strong>BAAs executed with all health system partners</strong>
        </li>
        <li>
          <span>SOC 2 Type II</span>
          <strong>In progress</strong>
        </li>
        <li>
          <span>Encryption</span>
          <strong>AES-256 at rest, TLS 1.3 in transit</strong>
        </li>
        <li>
          <span>Access controls</span>
          <strong>SSO, MFA, least privilege, full audit logs</strong>
        </li>
      </ul>
    </StubPage>
  );
}
