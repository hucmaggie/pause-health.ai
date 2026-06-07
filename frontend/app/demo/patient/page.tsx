import { CareDetailStage } from "../../../components/care-detail-stage";
import { DemoShell } from "../../../components/demo-shell";
import { PersonaJourneyFooter } from "../../../components/persona-journey-footer";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Prototype · Patient Detail",
  description:
    "Inside the Pause-Health.ai care detail view — Data 360 federated grounding, deterministic risk band, suggested Care Router pathway, and HRT suitability heuristic, for each demo persona.",
  path: "/demo/patient",
  ogImage: "/brand/pause-health-og-prototype.png",
  ogImageAlt: "Pause-Health.ai prototype preview — patient detail view."
});

export default function PatientDemoPage() {
  return (
    <DemoShell
      title="Care Detail: Menopause AI Copilot"
      subtitle="Per-patient view: the same Data 360 dossier the agent sees, the federated grounding signals the Care Router uses, a deterministic risk band, suggested pathway, and an HRT suitability heuristic — all six demo personas, all live."
    >
      <CareDetailStage />
      <PersonaJourneyFooter stage="patient" />
    </DemoShell>
  );
}
