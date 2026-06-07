import { AgentforceFallback } from "../../../components/agentforce-fallback";
import { DemoShell } from "../../../components/demo-shell";
import { IntakePatientStage } from "../../../components/intake-patient-stage";
import { PersonaJourneyFooter } from "../../../components/persona-journey-footer";
import { getAgentforceConfig } from "../../../lib/agentforce";
import { DEMO_COHORT } from "../../../lib/demo-cohort";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Prototype · Intake Dashboard",
  description:
    "See how Pause-Health.ai prioritizes incoming menopause-care signals from EHR and wearable sources, with an Agentforce Service Agent guiding patient intake.",
  path: "/demo/intake",
  ogImage: "/brand/pause-health-og-prototype.png",
  ogImageAlt: "Pause-Health.ai prototype preview — intake to analytics."
});

export default function IntakeDemoPage() {
  const agentforceConfig = getAgentforceConfig();

  return (
    <DemoShell
      title="Midlife Signal Intake"
      subtitle="Patients enter through an Agentforce-driven intake assistant. Structured signals are then prioritized for women 40-60 using symptom clusters, endocrine context, and safety-first clinical markers."
    >
      <section style={{ marginBottom: "1.5rem" }}>
        {agentforceConfig ? (
          <IntakePatientStage agentforceConfig={agentforceConfig} />
        ) : (
          <AgentforceFallback />
        )}
      </section>

      <section className="demo-grid">
        <article className="card">
          <h3>Live menopause care queue</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.2rem" }}>
            Six seeded personas in our Salesforce Health Cloud org. Picking
            one above pre-loads the live Agentforce Service Agent with
            that patient&apos;s Data 360 dossier.
          </p>
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
                {DEMO_COHORT.map((persona) => (
                  <tr key={persona.id}>
                    <td>
                      {persona.firstName} {persona.lastName}
                    </td>
                    <td>{persona.displaySymptoms}</td>
                    <td>{persona.displayRisk}</td>
                    <td>{persona.displayWait}</td>
                    <td>{persona.displaySource}</td>
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
              <span>Intake substrate</span>
              <strong>Agentforce Service Agent on Salesforce Service Cloud</strong>
            </li>
            <li>
              <span>Integration context</span>
              <strong>JupyterHealth EHR + dbdp wearable streams</strong>
            </li>
          </ul>
          {/*
           * The "Continue to Care Detail" affordance lives in the
           * shared <PersonaJourneyFooter> below so the next-stage
           * CTA is consistent across every /demo/* page.
           */}
        </article>
      </section>

      <PersonaJourneyFooter stage="intake" />
    </DemoShell>
  );
}
