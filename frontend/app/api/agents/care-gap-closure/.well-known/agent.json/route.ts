import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Care Gap Closure agent — the Salesforce
 * "Agentforce for Health" / Health Cloud care-gap-closure analog.
 *
 *   GET /api/agents/care-gap-closure/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "care-gap-closure-agent";

const CARD: A2AAgentCard = {
  name: "Care Gap Closure Agent",
  description:
    "Proactively detects menopause-relevant preventive-care gaps (bone-density/DEXA for osteoporosis risk, lipid panel, screening mammogram, and overdue HRT follow-up) from a patient's Data 360 grounding context + age/cycle/symptom signals, and drafts consent- and quiet-hours-aware outreach it hands to the Engagement Agent for delivery — the Salesforce 'Agentforce for Health' / Health Cloud care-gap-closure analog. Detection is DETERMINISTIC (a pure function of an explicit as-of date + per-measure history; no randomness, no clock), and every detected gap references a defined clinical-measure catalog id — never a fabricated one. The clinical measures + intervals are illustrative/synthetic, clearly labeled — NOT a certified clinical guideline engine. Enforces, via the Pause Agent Fabric, that every care gap acted on derives from a defined clinical measure, that outreach requires contact consent, is drafted for human approval (never auto-sent), and honors quiet-hours + channel preference, and that grounding requires an ai-decision-support consent.",
  url: `${HOST}/api/agents/care-gap-closure`,
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
      id: "detect-care-gaps",
      name: "Detect preventive-care gaps + draft outreach",
      description:
        "Given a patient's Data 360 grounding context + age/cycle/symptom signals and an as-of date, returns the deterministically-detected menopause-relevant preventive-care gaps — each referencing a defined clinical-measure catalog id (bone-density/DEXA, lipid panel, mammogram, HRT follow-up) with open/overdue status, dueSince/lastDone, and priority — plus a consent- and quiet-hours-aware outreach draft per gap, human-approval-gated and never auto-sent, handed to the Engagement Agent.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["care-gap", "preventive-care", "menopause", "proactive", "data-360", "outreach"]
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
