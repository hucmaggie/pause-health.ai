import { DemoShell } from "../../../components/demo-shell";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Prototype · Intake Dashboard",
  description:
    "See how Pause-Health.ai prioritizes incoming menopause-care signals from EHR and wearable sources.",
  path: "/demo/intake",
  ogImage: "/brand/pause-health-og-prototype.png",
  ogImageAlt: "Pause-Health.ai prototype preview — intake to analytics."
});

const queueRows = [
  {
    patient: "K. Johnson",
    symptoms: "Hot flashes, night sweats, sleep disruption",
    risk: "Moderate",
    wait: "12m",
    source: "JupyterHealth EHR + wearable sync"
  },
  {
    patient: "T. Ramirez",
    symptoms: "Irregular bleeding after 12 months amenorrhea",
    risk: "High",
    wait: "6m",
    source: "JupyterHealth EHR"
  },
  {
    patient: "N. Chen",
    symptoms: "Palpitations, anxiety spikes, insomnia",
    risk: "Moderate",
    wait: "17m",
    source: "dbdp wearable ingestion"
  },
  {
    patient: "A. Green",
    symptoms: "Severe mood changes, passive self-harm thoughts",
    risk: "Critical",
    wait: "2m",
    source: "JupyterHealth EHR + call transcript"
  }
];

export default function IntakeDemoPage() {
  return (
    <DemoShell
      title="Midlife Signal Intake"
      subtitle="Cases are elegantly prioritized for women 40-60 using symptom clusters, endocrine context, and safety-first clinical markers."
    >
      <section className="demo-grid">
        <article className="card">
          <h3>Live menopause care queue</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Reported symptoms</th>
                  <th>Risk tier</th>
                  <th>Wait</th>
                  <th>Data source</th>
                </tr>
              </thead>
              <tbody>
                {queueRows.map((row) => (
                  <tr key={row.patient}>
                    <td>{row.patient}</td>
                    <td>{row.symptoms}</td>
                    <td>{row.risk}</td>
                    <td>{row.wait}</td>
                    <td>{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="card">
          <h3>Clinical triage highlights</h3>
          <ul className="metric-list">
            <li>
              <span>Postmenopausal bleeding rule</span>
              <strong>Auto-escalate high risk</strong>
            </li>
            <li>
              <span>Mental health safety signal</span>
              <strong>Immediate same-day intervention</strong>
            </li>
            <li>
              <span>Vasomotor symptom burden</span>
              <strong>Route to menopause specialist pathway</strong>
            </li>
            <li>
              <span>Integration context</span>
              <strong>JupyterHealth EHR + dbdp wearable streams</strong>
            </li>
          </ul>
          <a href="/demo/patient" className="btn btn-primary">
            Open Care Detail
          </a>
        </article>
      </section>
    </DemoShell>
  );
}
