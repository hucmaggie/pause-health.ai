import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Agentforce Qualification agent
 * (prototype stand-in).
 *
 *   GET /api/agents/qualification/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric
 * registry (appliesTo) rather than hand-listed.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "qualification-agent";

const CARD: A2AAgentCard = {
  name: "Agentforce Qualification",
  description:
    "Applies a consistent qualification rubric (menopause-care fit + eligibility + readiness) to inbound and outbound leads, producing a qualified/disqualified decision with human-readable rationale on every lead. Routes qualified-and-ready leads to Patient Intake and qualified-but-warming leads into the Prospecting & Nurture cadence. Excludes protected-class attributes from criteria; disqualifications are logged for human review.",
  url: `${HOST}/api/agents/qualification`,
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
  defaultInputModes: ["text", "data"],
  defaultOutputModes: ["text", "data"],
  skills: [
    {
      id: "qualify-lead",
      name: "Qualify a lead",
      description:
        "Given a captured lead (+ ICP screen), returns qualified/disqualified with rationale and a route (intake | nurture | none).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["qualification", "lead-scoring", "lead-qualification"]
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
