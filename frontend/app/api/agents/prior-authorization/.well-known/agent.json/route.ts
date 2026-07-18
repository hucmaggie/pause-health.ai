import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Prior Authorization agent — the Salesforce
 * "Agentforce for Health" / Health Cloud CareRequest + Utilization Management
 * analog.
 *
 *   GET /api/agents/prior-authorization/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "prior-authorization-agent";

const CARD: A2AAgentCard = {
  name: "Prior Authorization Agent",
  description:
    "Assembles a prior authorization for a PA-requiring menopause item — systemic HRT / compounded estradiol, a bone-density DEXA scan, or a specialized hormone lab panel — the Salesforce 'Agentforce for Health' / Health Cloud CareRequest + Utilization Management analog. It pulls the (synthetic) clinical context, DETERMINISTICALLY matches the payer's medical-necessity criteria, assembles the required supporting-documentation checklist (present vs missing), and returns a clinician-gated PA package with a synthetic Health Cloud CareRequest / authorization id and a status (draft / ready-for-clinician / submitted). This is the HEAVIEST agent and the LEAST demo-honest of the set: real prior authorization is a genuinely multi-system EDI/278 (or FHIR PAS) workflow against a payer's utilization-management system — this is a clearly-labeled MOCK, NOT a real X12 278 / FHIR PAS EDI transaction or payer PA portal submission, and the payer criteria + document checklists are illustrative synthetics, NOT a certified utilization-management engine. TWO CRITICAL HONESTY PROPERTIES, both governance-enforced: (1) the agent must NOT autonomously submit a PA — a clinician must approve before submission (policy.pa.no-autonomous-submission; the agent only ever assembles a clinician-gated draft, requiresClinicianApproval:true, submitted:false); and (2) a PA submission must include the required supporting documentation (policy.pa.documentation-integrity; a submission missing a required document is blocked). It also reuses the no-prescribing, consent-before-grounding, and HIPAA-audit policies.",
  url: `${HOST}/api/agents/prior-authorization`,
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
      id: "assemble-prior-authorization",
      name: "Assemble a clinician-gated, documentation-complete prior authorization",
      description:
        "Given a PA request (a PA-requiring item id + member/plan + clinical context + attached documentation), returns a deterministically-assembled PA package: the payer medical-necessity criteria matched against the clinical context (each referencing a defined catalog id), the required supporting-documentation checklist (present vs missing), a synthetic CareRequest / authorization id, and a status. Never autonomously submits — a clinician must approve first — and a submission must include the required supporting documentation.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "prior-authorization",
        "utilization-management",
        "care-request",
        "payer-criteria",
        "documentation",
        "clinician-gated",
        "menopause",
        "hrt",
        "dexa"
      ]
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
