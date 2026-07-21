import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "care-coordination-handoff-agent";

const CARD: A2AAgentCard = {
  name: "Care Coordination Handoff Agent",
  description:
    "Deterministic cross-setting care-coordination handoff pipeline: for each patient transition between care settings (hospital → SNF, SNF → home, home → hospice, ED → PCP, PCP → specialist, PCP → behavioral health), assembles a Joint-Commission-NPSG-2 SBAR (situation, background, assessment, recommendation), verifies the receiving clinician's credentialing status, and confirms transfer consent is on file for transitions that share PHI with a new setting. Classifies as handoff-accepted / pend-sbar-incomplete / blocked-clinician-not-credentialed / blocked-no-consent with a specific reason code. Distinct from Transitions of Care (post-discharge hospital→home + med reconciliation) and Referral Management (outbound specialist referral) — this is any cross-setting handoff. It NEVER autonomously accepts on behalf of the receiving clinician; every accepted handoff is DRAFTED for the receiving clinician's cosign. It NEVER routes to an expired / incomplete / sanctioned clinician. It NEVER shares PHI with a new setting without documented transfer consent. The care-setting catalog, transition-type catalog, SBAR rule set, and reason codes are illustrative/synthetic, NOT Epic Care Everywhere, Cerner CareAware, or a real health system's handoff protocol.",
  url: `${HOST}/api/agents/care-coordination-handoff`,
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
      id: "evaluate-cross-setting-handoff",
      name: "Evaluate a cross-setting patient handoff against SBAR, credentialing, and consent gates",
      description:
        "Given a handoff request (patientRef, transitionTypeId, receivingClinicianRef, credentialing status, transfer-consent flag, structured SBAR sections, ISO asOfDate), returns a deterministic decision — handoff-accepted / pend-sbar-incomplete / blocked-clinician-not-credentialed / blocked-no-consent — with applied catalog rules, missing-SBAR-sections list, primary reason code, routing target, and cosign flags (NEVER autonomously cosigned).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["care-coordination", "handoff", "sbar", "joint-commission-npsg-2", "menopause"]
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
