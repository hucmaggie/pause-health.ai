import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Care Plan Agent — the Salesforce "Agentforce
 * for Health" / Health Cloud CarePlan + care-plan-summarization analog.
 *
 *   GET /api/agents/care-plan/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "care-plan-agent";

const CARD: A2AAgentCard = {
  name: "Care Plan Agent",
  description:
    "Post-visit, instantiates a menopause care plan (goals, interventions, follow-up cadence) DETERMINISTICALLY from a defined CarePlanTemplate — selected by the Care Router's pathway/severity + intake — and generates a concise patient/clinician progress SUMMARY with live Anthropic Claude, falling back to a DETERMINISTIC scripted summary (with a recorded fallbackReason) when ANTHROPIC_API_KEY is unset or the API call fails. The Salesforce 'Agentforce for Health' / Health Cloud CarePlan analog, a clinical-plane sibling of the Care Router and the SECOND live-Claude agent on Pause's Agent Fabric. Plan instantiation is a pure function of the pathway/severity + intake (no randomness, no clock), and every instantiated plan references a defined template id — never a fabricated one. Summaries are NON-PRESCRIPTIVE (they never add or change a medication, dose, order, or prescription). The care-plan templates + their goals/interventions/cadences are illustrative/synthetic, clearly labeled — NOT a certified clinical care-plan engine. Enforces, via the Pause Agent Fabric, that every instantiated plan derives from a defined template, that the serving model is on the approved allow-list (Claude Sonnet / Opus), that no clinical action is committed without a clinician, that a rationale is present, and that grounding requires an ai-decision-support consent.",
  url: `${HOST}/api/agents/care-plan`,
  provider: {
    organization: "Anthropic (via Pause-Health.ai)",
    url: "https://pause-health.ai"
  },
  version: "0.1.0",
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true
  },
  defaultInputModes: ["data"],
  defaultOutputModes: ["text", "data"],
  skills: [
    {
      id: "instantiate-and-summarize-care-plan",
      name: "Instantiate a care plan + summarize progress",
      description:
        "Given the Care Router's pathway/severity + the intake, returns a menopause care plan instantiated DETERMINISTICALLY from a defined template — each referencing a defined template id (HRT-management, vasomotor/lifestyle, bone-health, mood/behavioral) with structured goals, interventions, and a follow-up cadence — plus a patient/clinician progress summary generated with live Anthropic Claude and a deterministic scripted fallback (via + fallbackReason recorded). Summaries are non-prescriptive.",
      inputModes: ["data"],
      outputModes: ["text", "data"],
      tags: ["care-plan", "menopause", "clinical", "claude", "summarization", "health-cloud"]
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
