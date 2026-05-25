import { StubPage } from "../../components/stub-page";

export const metadata = { title: "Privacy | Pause-Health.ai" };

export default function PrivacyPage() {
  return (
    <StubPage
      eyebrow="Privacy"
      title="Your data, treated with the care it deserves."
      intro="This page summarizes how Pause-Health.ai collects, processes, and protects information. A full Privacy Policy will be published prior to general availability. For questions in the meantime, contact privacy@pause-health.ai."
    >
      <ul className="metric-list">
        <li>
          <span>Data minimization</span>
          <strong>We collect only what's needed for care</strong>
        </li>
        <li>
          <span>De-identification</span>
          <strong>Applied for analytics and model training</strong>
        </li>
        <li>
          <span>Patient rights</span>
          <strong>Access, correction, and deletion supported</strong>
        </li>
      </ul>
    </StubPage>
  );
}
