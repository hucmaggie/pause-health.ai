import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";
import { ALLOWLISTED_INSTRUMENTS } from "../../../../../../lib/assessments";

/**
 * Google A2A Agent Card for the Agentforce Assessment agent (the
 * Salesforce "Agentforce for Health — Assessments" analog).
 *
 *   GET /api/agents/assessment/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric
 * registry (appliesTo) rather than hand-listed, so the discovery
 * document can't drift from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "assessment-agent";

const CARD: A2AAgentCard = {
  name: "Agentforce Assessment Agent",
  description: `Administers and deterministically scores validated menopause & mental-health instruments (${ALLOWLISTED_INSTRUMENTS.join(
    ", "
  )}) with real cutoff-based math (no LLM), producing per-instrument subscores, a total, a normalized severity band, and explicit red-flag detection. The scored severity feeds IntakeRecord.severity so the Care Router's decision is backed by a validated instrument. Enforces a validated-instrument allow-list, structured-only responses (no free-text PII), and a mandatory red-flag screen via the Pause Agent Fabric.`,
  url: `${HOST}/api/agents/assessment`,
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
      id: "score-validated-instrument",
      name: "Score a validated assessment instrument",
      description:
        "Given an instrument id (mrs | greene | phq-9 | isi) and its per-item Likert responses, returns a deterministically scored result: per-instrument subscores, total, normalized severity band, and any red flags — plus the intake-severity signal it produces.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["assessment", "clinical", "patient-facing", "validated-instrument"]
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
