import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Pause Care Router agent.
 *
 * Served at:
 *   GET /api/agents/care-router/.well-known/agent.json
 *
 * Any A2A-compliant client (Agentforce, Vertex AI Agent Builder, an
 * OpenAI Responses-API harness, or a custom orchestrator) can discover
 * the Care Router by fetching this card, then issue A2A `tasks/send`
 * calls to the declared URL.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const MODEL =
  process.env.PAUSE_CARE_ROUTER_MODEL ?? "claude-sonnet-4-5-20250929";

// The fabric agent id this card describes. Its advertised governance policies
// are derived from the Agent Fabric registry (see below) rather than
// hand-listed, so the public discovery document can't overclaim or omit a
// policy relative to what the /tasks handler actually enforces.
const FABRIC_AGENT_ID = "care-router-claude";

const CARD: A2AAgentCard = {
  name: "Pause Care Router",
  description:
    "Decides the appropriate menopause care pathway for a structured intake record. Backed by Anthropic Claude when ANTHROPIC_API_KEY is configured; falls back to the deterministic Pause policy engine otherwise. Honors mandatory red-flag screening, model allow-listing, and clinical-decision policies enforced by the Pause Agent Fabric (a MuleSoft Agent Fabric mock).",
  url: `${HOST}/api/agents/care-router`,
  provider: {
    organization: "Pause-Health.ai",
    url: "https://pause-health.ai"
  },
  version: "0.1.0",
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true
  },
  defaultInputModes: ["text", "data"],
  defaultOutputModes: ["text", "data"],
  skills: [
    {
      id: "route-care-pathway",
      name: "Route menopause care pathway",
      description:
        "Given a structured intake record (symptom cluster, severity, cycle status, red-flag screen) returns one of six pathways with rationale and provenance.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["menopause", "triage", "clinical-decision"]
    }
  ],
  pauseGovernance: {
    fabricRegisteredAs: FABRIC_AGENT_ID,
    // Single source of truth: the Agent Fabric policy catalog (appliesTo).
    policies: getPoliciesForAgent(FABRIC_AGENT_ID).map((p) => p.id)
  }
};

export async function GET() {
  return NextResponse.json(
    { ...CARD, _model: MODEL },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
      }
    }
  );
}
