import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Agentforce Inbound Lead Generation
 * agent (prototype stand-in).
 *
 *   GET /api/agents/inbound-lead/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric
 * registry (appliesTo) rather than hand-listed, so the discovery
 * document can't drift from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "inbound-lead-agent";

const CARD: A2AAgentCard = {
  name: "Agentforce Inbound Lead Generation",
  description:
    "Captures inbound interest (site, chat, symptom-check forms), runs a first-pass ICP screen, resolves identity against Salesforce Data 360, and hands the opt-in-consented lead to the Qualification agent over A2A. Enforces explicit-opt-in + acquisition-source and identity-resolution-before-create policies via the Pause Agent Fabric.",
  url: `${HOST}/api/agents/inbound-lead`,
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
      id: "capture-inbound-lead",
      name: "Capture and screen an inbound lead",
      description:
        "Given a captured lead (source, age band, symptom signal, consent), runs the ICP screen + readiness score, resolves identity, and routes to qualification.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["acquisition", "lead-generation", "patient-acquisition"]
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
