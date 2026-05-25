import { DemoShell } from "../../../components/demo-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Prototype · Patient Detail",
  description:
    "Inside the Pause-Health.ai care detail view — symptom patterns, contraindications, and clinician-ready guidance.",
  path: "/demo/patient",
  ogImage: "/brand/pause-health-og-prototype.png",
  ogImageAlt: "Pause-Health.ai prototype preview — patient detail view."
});

export default function PatientDemoPage() {
  return (
    <DemoShell
      title="Care Detail: Menopause AI Copilot"
      subtitle="Risk scoring blends symptom patterns, lifecycle stage, contraindications, and safety markers into clinician-ready guidance."
    >
      <section className="demo-grid">
        <article className="card">
          <h3>Case profile: T. Ramirez</h3>
          <ul className="metric-list metric-list-stacked">
            <li>
              <span>Age / menopause stage</span>
              <strong>55 / postmenopausal</strong>
            </li>
            <li>
              <span>Primary concern</span>
              <strong>New bleeding after 14 months amenorrhea</strong>
            </li>
            <li>
              <span>Associated symptoms</span>
              <strong>Pelvic discomfort, fatigue</strong>
            </li>
            <li>
              <span>History flags</span>
              <strong>BMI 32, family history endometrial cancer</strong>
            </li>
            <li>
              <span>Integrated data sources</span>
              <strong>JupyterHealth EHR history + dbdp wearable trends</strong>
            </li>
          </ul>
        </article>
        <article className="card">
          <h3>Explainable rationale and recommended action</h3>
          <ul className="metric-list metric-list-stacked">
            <li>
              <span>Risk score</span>
              <strong>0.91 (High)</strong>
            </li>
            <li>
              <span>Primary logic path</span>
              <strong>Postmenopausal bleeding + gynecologic risk profile</strong>
            </li>
            <li>
              <span>Suggested next step</span>
              <strong>Urgent gyn assessment within 24 hours</strong>
            </li>
            <li>
              <span>HRT suitability</span>
              <strong>Defer pending diagnostic workup</strong>
            </li>
          </ul>
          <a href="/demo/routing" className="btn btn-primary">
            Continue to Routing
          </a>
        </article>
      </section>
    </DemoShell>
  );
}
