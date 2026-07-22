import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "adverse-event-reporting-agent";

const CARD: A2AAgentCard = {
  name: "Adverse Event Reporting Agent",
  description:
    "Deterministic pharmacovigilance / device-safety reporting pipeline (FDA MedWatch / VAERS analog): for each reported adverse event (drug ADR, vaccine reaction, device malfunction, medication error, therapeutic failure), classifies the event type and computes the 21-CFR-314.80 seriousness tier (non-serious / serious / life-threatening / death) from caller-provided outcome flags, verifies reporter identity attestation, and classifies as draft-medwatch (3500 / 3500A) / draft-vaers / blocked-non-catalog-event / blocked-reporter-unverified. All drafts route to a regulatory-team queue for cosign. It NEVER autonomously files to the FDA — every draft is DRAFTED for regulatory-team cosign (21 CFR 314.80 mandatory reporting has sponsor / manufacturer / clinician liability). It NEVER drafts on an unverified reporter (FDA reporting requires an attested reporter). The event-type catalog, seriousness tiers, rules, and reason codes are illustrative/synthetic, NOT FDA MedWatch, VAERS, EudraVigilance, or an actual sponsor's pharmacovigilance database.",
  url: `${HOST}/api/agents/adverse-event-reporting`,
  provider: {
    organization: "Salesforce Agentforce (via Pause-Health.ai)",
    url: "https://pause-health.ai"
  },
  version: "1.0.0",
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true
  },
  defaultInputModes: ["data"],
  defaultOutputModes: ["text", "data"],
  skills: [
    {
      id: "evaluate-adverse-event",
      name: "Evaluate an adverse event against the pharmacovigilance catalog and channel the report to MedWatch or VAERS",
      description:
        "Given an adverse-event request (patientRef, eventTypeId, onsetDate, reportedDate, reporterType, reporterIdentityVerified flag, outcome flags for seriousness computation, optional suspectProduct), returns a deterministic decision — draft-medwatch / draft-vaers / blocked-non-catalog-event / blocked-reporter-unverified — with applied catalog rules, 21-CFR-314.80 seriousness tier, primary reason code, routing target, and cosign flags (NEVER autonomously cosigned).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["pharmacovigilance", "medwatch", "vaers", "21-cfr-314-80", "menopause"]
    }
  ],
  pauseGovernance: {
    fabricRegisteredAs: FABRIC_AGENT_ID,
    policies: getPoliciesForAgent(FABRIC_AGENT_ID).map((p) => p.id)
  }
};

export async function GET() {
  return NextResponse.json(CARD, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
    }
  });
}
