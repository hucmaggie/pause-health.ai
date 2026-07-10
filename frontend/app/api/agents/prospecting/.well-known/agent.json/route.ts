import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Agentforce Prospecting & Nurture agent
 * (prototype stand-in).
 *
 *   GET /api/agents/prospecting/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric
 * registry (appliesTo) rather than hand-listed.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "prospecting-agent";

const CARD: A2AAgentCard = {
  name: "Agentforce Prospecting & Nurture",
  description:
    "Warms qualified-but-not-yet-ready leads across a multi-touch nurture cadence. Drafts consent-aware outreach (email / SMS) for human review — never sends autonomously — and drops anyone who converts or opts out. Enforces contact-consent and human-approval-before-send policies via the Pause Agent Fabric.",
  url: `${HOST}/api/agents/prospecting`,
  provider: {
    organization: "Salesforce Agentforce (via Pause-Health.ai)",
    url: "https://pause-health.ai"
  },
  version: "1.1.0",
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true
  },
  defaultInputModes: ["text", "data"],
  defaultOutputModes: ["text", "data"],
  skills: [
    {
      id: "advance-nurture",
      name: "Advance a nurture touch",
      description:
        "Given a warming lead + qualification decision, drafts the next consent-aware nurture touch for human approval.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["nurture", "prospecting", "patient-acquisition"]
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
