import { DemoShell } from "../../../components/demo-shell";
import {
  MSCP_DIRECTORY_LABELS,
  mscpDirectoryUrl
} from "../../../lib/menopause-society";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Prototype · Care Routing",
  description:
    "How Pause-Health.ai routes menopause cases to the right pathway — urgent gynecology, specialist consult, or guided self-management.",
  path: "/demo/routing",
  ogImage: "/brand/pause-health-og-prototype.png",
  ogImageAlt: "Pause-Health.ai prototype preview — care routing pathways."
});

const pathways = [
  {
    pathway: "Urgent gynecology review",
    trigger: "Postmenopausal bleeding or concerning pelvic symptoms",
    target: "< 24h"
  },
  {
    pathway: "Menopause specialist consult",
    trigger: "Moderate-severe vasomotor symptoms affecting daily function",
    target: "< 7 days"
  },
  {
    pathway: "Behavioral health handoff",
    trigger: "Mood instability, anxiety, or depressive safety indicators",
    target: "Same day"
  },
  {
    pathway: "Primary care optimization",
    trigger: "Low-risk symptoms with no red flags",
    target: "< 14 days"
  }
];

export default function RoutingDemoPage() {
  return (
    <DemoShell
      title="Smart Care Pathway Routing"
      subtitle="Recommendations translate into polished, policy-aware menopause care pathways with clear response targets."
    >
      <section className="demo-grid">
        <article className="card">
          <h3>Care routing matrix</h3>
          <div className="table-wrap">
            <table className="routing-table">
              <thead>
                <tr>
                  <th>Care pathway</th>
                  <th>Triage trigger</th>
                  <th>Target response</th>
                </tr>
              </thead>
              <tbody>
                {pathways.map((item) => (
                  <tr key={item.pathway}>
                    <td>{item.pathway}</td>
                    <td>{item.trigger}</td>
                    <td>{item.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="card">
          <h3>Applied decision profile</h3>
          <ul className="metric-list metric-list-stacked">
            <li>
              <span>Selected pathway</span>
              <strong>Urgent gynecology review</strong>
            </li>
            <li>
              <span>Fallback protocol</span>
              <strong>ED escalation if heavy bleeding or instability</strong>
            </li>
            <li>
              <span>Patient communication</span>
              <strong>High-priority outreach sent with safety instructions</strong>
            </li>
            <li>
              <span>Interop handoff</span>
              <strong>Decision written to JupyterHealth; wearable watchlist via dbdp</strong>
            </li>
          </ul>
          <a href="/demo/analytics" className="btn btn-primary">
            View Analytics
          </a>
        </article>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <article className="card">
          <p className="eyebrow">External specialist referral</p>
          <h3 style={{ marginTop: "0.4rem" }}>{MSCP_DIRECTORY_LABELS.title}</h3>
          <p>{MSCP_DIRECTORY_LABELS.subtitle}</p>
          <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
            <li>
              <span>When Pause uses this</span>
              <strong style={{ fontWeight: 500 }}>
                When the recommended pathway is &quot;menopause specialist consult&quot; and the
                patient&apos;s plan / network doesn&apos;t already include an MSCP-credentialed
                clinician.
              </strong>
            </li>
            <li>
              <span>How we link</span>
              <strong style={{ fontWeight: 500 }}>
                Patients are sent to The Menopause Society&apos;s own directory with the
                appropriate search mode selected — we do not republish, embed, or scrape
                the directory.
              </strong>
            </li>
            <li>
              <span>Why MSCP</span>
              <strong style={{ fontWeight: 500 }}>
                MSCPs hold the only credential that specifically tests menopause knowledge.
                Routing to an MSCP is the highest-confidence handoff Pause can make outside
                its host health system.
              </strong>
            </li>
          </ul>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
            <a
              href={mscpDirectoryUrl({ zip: "92602" })}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
            >
              {MSCP_DIRECTORY_LABELS.ctaByZip}
            </a>
            <a
              href={mscpDirectoryUrl({ state: "CA" })}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              {MSCP_DIRECTORY_LABELS.ctaByState}
            </a>
            <a
              href={mscpDirectoryUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              {MSCP_DIRECTORY_LABELS.ctaGeneric}
            </a>
          </div>
          <p style={{ marginTop: "0.8rem", fontSize: "0.85rem", color: "var(--muted)" }}>
            {MSCP_DIRECTORY_LABELS.attribution}
          </p>
        </article>
      </section>
    </DemoShell>
  );
}
