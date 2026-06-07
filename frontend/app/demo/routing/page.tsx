import { CareRoutingStage } from "../../../components/care-routing-stage";
import { DemoShell } from "../../../components/demo-shell";
import { LatestCareRouterDecision } from "../../../components/latest-care-router-decision";
import { PersonaJourneyFooter } from "../../../components/persona-journey-footer";
import {
  MSCP_DIRECTORY_LABELS,
  mscpDirectoryUrl
} from "../../../lib/menopause-society";
import { pageMetadata } from "../../../lib/page-metadata";

export const metadata = pageMetadata({
  title: "Prototype · Care Routing",
  description:
    "How Pause-Health.ai routes menopause cases. The Anthropic-backed Care Router emits one of six pathways; pick a demo persona to preview the heuristic suggestion, run the live router, and watch the multi-agent trace land in the Agent Fabric.",
  path: "/demo/routing",
  ogImage: "/brand/pause-health-og-prototype.png",
  ogImageAlt: "Pause-Health.ai prototype preview — care routing pathways."
});

export default function RoutingDemoPage() {
  return (
    <DemoShell
      title="Smart Care Pathway Routing"
      subtitle="Each decision is produced by the Anthropic-backed Care Router agent (or its deterministic fallback) and audited by the Pause Agent Fabric. Pick a demo persona below to preview the heuristic, run the live router end-to-end, and watch the resulting multi-agent trace appear."
    >
      <section style={{ marginBottom: "1.5rem" }}>
        <LatestCareRouterDecision />
      </section>

      <CareRoutingStage />

      <section style={{ marginTop: "1.5rem" }}>
        <article className="card">
          <p className="eyebrow">External specialist referral</p>
          <h3 style={{ marginTop: "0.4rem" }}>{MSCP_DIRECTORY_LABELS.title}</h3>
          <p>{MSCP_DIRECTORY_LABELS.subtitle}</p>
          <ul className="metric-list" style={{ marginTop: "0.5rem" }}>
            <li>
              <span>When Pause uses this</span>
              <strong style={{ fontWeight: 500 }}>
                When the recommended pathway is &quot;menopause specialist
                (virtual)&quot; or &quot;menopause specialist (in person)&quot;
                and the patient&apos;s plan / network doesn&apos;t already
                include an MSCP-credentialed clinician.
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

      <PersonaJourneyFooter stage="routing" />
    </DemoShell>
  );
}
