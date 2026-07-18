import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Referral Management agent — the Salesforce
 * "Agentforce for Health" Referrals ("Create Referral") analog.
 *
 *   GET /api/agents/referral-management/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "referral-management-agent";

const CARD: A2AAgentCard = {
  name: "Referral Management Agent",
  description:
    "Triages and routes referrals to the adjacent specialists menopause commonly touches — cardiology / CVD risk, endocrinology, bone health, pelvic-floor PT, and behavioral health — from intake + Care Router routing signals, and drafts a referral request per recommended specialty — the Salesforce 'Agentforce for Health' Referrals ('Create Referral') analog. It GENERALIZES the Care Router's behavioral-health-handoff into a full outbound-referral node. Triage is DETERMINISTIC (a pure function of the age/cycle/symptom/severity/red-flag context + risk flags; no randomness, no clock), and every recommended referral references a defined specialty-catalog id AND carries a documented reason. CRITICAL HONESTY PROPERTY: the agent can only DRAFT — it may triage and draft an outbound referral but must NEVER send it without a clinician's sign-off; an outbound referral is a clinical action that requires a human-in-the-loop. The specialties + triage rules are illustrative/synthetic, clearly labeled — NOT a certified clinical referral engine. Enforces, via the Pause Agent Fabric, that no outbound referral is sent without a clinician cosign (policy.referral.clinician-cosign), that every referral carries a documented reason (policy.clinical.rationale-required), and that every turn is HIPAA-audited.",
  url: `${HOST}/api/agents/referral-management`,
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
      id: "triage-specialist-referrals",
      name: "Triage + draft cosign-gated specialist referrals",
      description:
        "Given a patient's intake + Care Router routing context (age / cycle / symptom / severity / red-flag signals + risk flags), returns the deterministically-triaged specialist referral(s) — each referencing a defined specialty-catalog id and a documented reason — plus a cosign-gated referral request per recommendation (requiresClinicianCosign:true, status:'drafted', sent:false; the agent never sends an outbound referral without a clinician's sign-off). Generalizes the Care Router's behavioral-health handoff into a full outbound-referral node.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "referral",
        "specialist",
        "cardiology",
        "endocrinology",
        "bone-health",
        "pelvic-floor-pt",
        "behavioral-health",
        "menopause",
        "clinician-cosign"
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
