import { DemoShell } from "../../../components/demo-shell";
import { OutcomeAnalyticsStage } from "../../../components/outcome-analytics-stage";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Prototype · Outcome Analytics",
  description:
    "Outcome metrics for the Pause-Health.ai prototype. Live operational metrics from the Pause Agent Fabric, Data 360 segment activation, Care Router pathway distribution, and clearly-labeled program targets.",
  path: "/demo/analytics",
  ogImage: "/brand/pause-health-og-prototype.png",
  ogImageAlt: "Pause-Health.ai prototype preview — outcome analytics."
});

export default function AnalyticsDemoPage() {
  return (
    <DemoShell
      title="Menopause Intelligence Analytics"
      subtitle="Live operational metrics from the Pause Agent Fabric and Data 360 (top), the pathway distribution emitted by the Care Router (middle), the active segment catalog (table), and clearly-labeled program targets (bottom)."
    >
      <OutcomeAnalyticsStage />
    </DemoShell>
  );
}
