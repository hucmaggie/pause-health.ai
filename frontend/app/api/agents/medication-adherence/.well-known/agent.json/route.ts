import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Medication Adherence agent — the Salesforce
 * "Agentforce for Health" / Health Cloud MedicationRequest +
 * MedicationTherapyReview analog.
 *
 *   GET /api/agents/medication-adherence/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "medication-adherence-agent";

const CARD: A2AAgentCard = {
  name: "Medication Adherence Agent",
  description:
    "Tracks menopause-medication adherence + refill timing (transdermal/oral HRT — estradiol, oral progesterone — and an SSRI/SNRI for vasomotor symptoms or mood — paroxetine, venlafaxine), drafts consent- and quiet-hours-aware refill/adherence nudges it hands to the Engagement Agent for delivery, and flags adherence drop-off to the care team — the Salesforce 'Agentforce for Health' / Health Cloud MedicationRequest + MedicationTherapyReview analog. Detection is DETERMINISTIC (a pure function of an explicit as-of date + per-medication days-supply and last-fill; no randomness, no clock), producing a good / at-risk / lapsed adherence status and a refill-due call. CRITICAL HONESTY PROPERTY: the agent can only NUDGE — it may draft a refill/adherence reminder but must NEVER autonomously submit or order a refill; a refill requires a human-in-the-loop. The medications + days-supply/refill intervals are illustrative/synthetic, clearly labeled — NOT a certified pharmacy / e-prescribing system. Enforces, via the Pause Agent Fabric, that no refill is committed without human approval (policy.medication.no-autonomous-refill), that the agent commits no autonomous clinical action, that outreach requires contact consent, is drafted for human approval (never auto-sent), and honors quiet-hours + channel preference.",
  url: `${HOST}/api/agents/medication-adherence`,
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
      id: "assess-medication-adherence",
      name: "Assess adherence + draft refill/adherence nudges",
      description:
        "Given the patient's menopause medications (which drug, when last filled, days-supply) and an as-of date, returns the deterministically-assessed adherence status (good / at-risk / lapsed) and refill-due call per medication, plus a consent- and quiet-hours-aware refill/adherence nudge per medication due or off-track — human-approval-gated, never auto-sent, and EXPLICITLY nudge-only (the agent never autonomously orders a refill) — handed to the Engagement Agent, with adherence drop-off flagged to the care team.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "medication-adherence",
        "refill",
        "hrt",
        "ssri",
        "menopause",
        "proactive",
        "nudge-only",
        "outreach"
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
