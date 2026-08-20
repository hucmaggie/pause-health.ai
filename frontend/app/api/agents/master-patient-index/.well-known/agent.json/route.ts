import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Master Patient Index / Identity Resolution agent
 * — the MuleSoft control-plane / data-substrate identity service, the
 * identity/dedup layer of the data substrate.
 *
 *   GET /api/agents/master-patient-index/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "master-patient-index-agent";

const CARD: A2AAgentCard = {
  name: "Master Patient Index / Identity Resolution Agent",
  description:
    "The identity/dedup layer of the Pause data substrate — the MuleSoft control-plane / data-substrate identity service. Given an INCOMING patient record plus a set of CANDIDATE records, it DETERMINISTICALLY scores each candidate against a TRANSPARENT weighted demographic feature set (name, DOB, administrative sex, address, phone, member/MRN identifiers — each with a documented weight), classifies each candidate as match / possible-match / no-match by FIXED thresholds, and recommends a resolution action (link / merge / manual-review / no-action) for the best match, citing the features that matched. The resolution is a pure function of the records (no randomness, no clock), so the same incoming + candidates always yield the same scores + classifications + recommendation (with a stable, documented candidateId tie-break). It is a RECOMMENDER + integrity gate: a high-confidence match at/above the auto-match threshold surfaces a link/merge recommendation, but a merge below that threshold is a manual-review recommendation carrying requiresHumanReview:true — there is never an 'auto-merged' state, and it NEVER autonomously merges a low-confidence pair. It COMPLEMENTS — it does not duplicate — the other platform agents (Salesforce Data 360 grounding, Consent & Preferences Management, MuleSoft ingest): this is the identity/dedup layer. It is a control-plane / data-substrate service (platform plane), NOT a live-Claude agent. The match features + weights + thresholds + patient records are illustrative/synthetic, clearly labeled — NOT a certified enterprise master-patient-index (EMPI) algorithm. Enforces, via the Pause Agent Fabric, that every match decision traces to the defined match-feature spec (no opaque / black-box matching), that a merge below the auto-match threshold is never performed autonomously (it requires a human steward), and that matching never uses a protected-class attribute (race, ethnicity, religion, etc.) as a feature.",
  url: `${HOST}/api/agents/master-patient-index`,
  provider: {
    organization: "MuleSoft Anypoint (via Pause-Health.ai)",
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
      id: "resolve-identity",
      name: "Resolve a patient's identity against candidate records",
      description:
        "Given an incoming patient record and a set of candidate records, deterministically scores each candidate against a transparent weighted demographic feature set (name, DOB, administrative sex, address, phone, member/MRN identifiers), classifies each as match / possible-match / no-match by fixed thresholds, and recommends a resolution action (link / merge / manual-review / no-action) for the best match — citing the features that matched. A merge below the auto-match threshold requires a human steward (manual-review, requiresHumanReview:true); a low-confidence pair is never merged autonomously; and protected-class attributes are never used as matching features.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["identity-resolution", "master-patient-index", "empi", "deduplication", "governance", "control-plane", "data-substrate"]
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
