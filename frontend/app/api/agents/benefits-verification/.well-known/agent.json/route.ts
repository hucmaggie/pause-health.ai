import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";
import { KNOWN_PAYERS } from "../../../../../../lib/benefits";

/**
 * Google A2A Agent Card for the Agentforce Benefits & Coverage
 * Verification (EBV) agent — the Salesforce "Agentforce for Health —
 * Eligibility & Benefit Verification" analog.
 *
 *   GET /api/agents/benefits-verification/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric
 * registry (appliesTo) rather than hand-listed, so the discovery
 * document can't drift from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "benefits-verification-agent";

const CARD: A2AAgentCard = {
  name: "Agentforce Benefits & Coverage Verification Agent",
  description: `Verifies a patient's insurance eligibility & benefits for a menopause specialist (MSCP) visit and returns a structured coverage result — plan status (active/inactive), in/out-of-network, deductible + amount met, coinsurance/copay, and an estimated visit cost + patient out-of-pocket — with the (mock) payer/clearinghouse EBV source the result traces to. Recognizes common payers (${Object.values(
    KNOWN_PAYERS
  ).join(
    ", "
  )}). The verification is a DETERMINISTIC synthetic EBV round-trip — clearly labeled synthetic, NOT a real 270/271 EDI transaction or FHIR CoverageEligibilityResponse. Enforces, via the Pause Agent Fabric, that a returned coverage result must trace to a payer/clearinghouse EBV response (the agent may not fabricate coverage without a source) and that coverage verification is consent-gated.`,
  url: `${HOST}/api/agents/benefits-verification`,
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
      id: "verify-coverage",
      name: "Verify insurance eligibility & benefits (EBV)",
      description:
        "Given a coverage query (payer + member/plan + service context), returns a deterministic synthetic eligibility & benefit result: plan status, in/out-of-network, deductible + amount met, coinsurance/copay, an estimated visit cost + patient responsibility, and the mock payer/clearinghouse EBV source it traces to.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["benefits", "eligibility", "coverage", "ebv", "patient-access"]
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
