import { StubPage } from "../../components/stub-page";

export const metadata = { title: "Press | Pause-Health.ai" };

export default function PressPage() {
  return (
    <StubPage
      eyebrow="Press"
      title="Press inquiries and brand assets."
      intro="For interviews, partnership announcements, or media coverage, please reach out to our communications team. A brand kit with logos, palette, and tone-of-voice guidelines is available on request."
    >
      <ul className="metric-list">
        <li>
          <span>Media contact</span>
          <strong>press@pause-health.ai</strong>
        </li>
        <li>
          <span>Brand assets</span>
          <strong>Available on request</strong>
        </li>
      </ul>
    </StubPage>
  );
}
