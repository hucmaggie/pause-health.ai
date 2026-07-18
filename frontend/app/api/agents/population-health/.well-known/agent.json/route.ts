import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Population Health & Risk Stratification agent —
 * the Salesforce "Agentforce for Health" / Health Cloud population-health /
 * risk-stratification analog.
 *
 *   GET /api/agents/population-health/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "population-health-agent";

const CARD: A2AAgentCard = {
  name: "Population Health & Risk Stratification Agent",
  description:
    "Ingests a PANEL (cohort) of already-produced per-patient signals for a menopause/midlife population (intake severity, validated-assessment band, open care gaps, positive SDOH domains, medication-adherence status, monitored-symptom trend) and DETERMINISTICALLY stratifies each patient into a risk tier (low / rising / high) with a TRANSPARENT additive/weighted risk model, then emits a prioritized outreach worklist for a human care manager — the Salesforce 'Agentforce for Health' / Health Cloud population-health / risk-stratification analog. Unlike the single-patient agents, it reasons over a whole panel at once. Scoring is a pure function of the per-patient signals (no randomness, no clock), so the same panel always yields the same tiers + worklist ordering (with a stable, documented tie-break). Every patient's tier is explainable by its contributing risk factors. The factors + weights + cutoffs + patientRefs are illustrative/synthetic, clearly labeled — NOT a certified risk-stratification model. Enforces, via the Pause Agent Fabric, that every tier traces to the documented risk-factor spec (no opaque score), that the model scores on NO protected-class attribute (fairness / responsible-AI), and that a tier never triggers an autonomous care decision (every tier→action requires human / care-manager review).",
  url: `${HOST}/api/agents/population-health`,
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
      id: "stratify-panel",
      name: "Stratify a patient panel into risk tiers + build a prioritized worklist",
      description:
        "Given a panel of per-patient signals (intake severity, validated-assessment band, open care gaps, positive SDOH domains, medication-adherence status, monitored-symptom trend), returns a deterministic risk score per patient (each explainable by its contributing risk factors), a risk tier (low / rising / high) by fixed cutoffs, tier counts, and a prioritized outreach worklist ordered highest-risk-first for a human care manager — the risk model scores on no protected-class attribute, and a tier never triggers an autonomous care action.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["population-health", "risk-stratification", "cohort", "care-management", "menopause", "responsible-ai"]
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
