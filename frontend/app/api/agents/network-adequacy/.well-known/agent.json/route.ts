import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Network Adequacy / Time-and-Distance agent — a claims / payer-operations
 * service on the payer & plan operations plane.
 *
 *   GET /api/agents/network-adequacy/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "network-adequacy-agent";

const CARD: A2AAgentCard = {
  name: "Network Adequacy / Time-and-Distance Agent",
  description:
    "A claims / payer-operations service on the payer & plan operations plane — a DETERMINISTIC (no-Claude) agent that takes a MEMBER's location plus the plan's IN-NETWORK PROVIDERS and decides whether the network meets the applicable TIME-AND-DISTANCE adequacy standard for a required specialty: it computes the GREAT-CIRCLE (haversine) distance from the member to each in-network provider of that specialty, finds the NEAREST, and flags an adequacy GAP when the nearest exceeds the standard — reporting the evaluated providers with distances, the nearest, the matching-provider count, and the disposition (adequacy-met / adequacy-gap). UNLIKE the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM (the NPI Luhn check digit), the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the Master-Patient-Index agent's WEIGHTED identity MATCHING, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity agent's HASH CHAIN — the heart of this service is GEOSPATIAL GREAT-CIRCLE DISTANCE: the haversine formula that converts two (latitude, longitude) pairs into a distance in miles, plus a NEAREST-NEIGHBOR scan and a THRESHOLD comparison against the regulatory standard. A member with no in-network specialist within the standard distance has a network-adequacy GAP — a compliance failure (CMS 42 CFR 422.116 / state QHP time-and-distance standards) and an access-to-care failure; a wrong distance understates the gap, so the agent measures the distances DETERMINISTICALLY (a pure function of the coordinates + standard — no clock, no randomness — so the same request always yields the same result) and hands a gap to a human. Every evaluated provider is a submitted in-network provider of the required specialty (a phantom provider fabricating coverage is blocked — the sourced + completeness gate), the distances recompute exactly from the coordinates (a mis-measured distance understating a gap into false adequacy is blocked — the load-bearing correctness gate), and the network is never certified, no gap closed, and no provider added or removed autonomously (an autonomous certification is blocked). It COMPLEMENTS — it does not duplicate — the other provider / network agents: distinct from the Provider Credentialing agent (whether a provider is QUALIFIED and in the directory), the Referral Management agent (routing a specific referral), and the Provider Benchmarking agent (a provider's cost / quality percentile) — this measures whether the network is geographically ADEQUATE. It is PHI-bearing (the member's location + the specialty they need is health information), so it is on the HIPAA-audit policy. It computes STRAIGHT-LINE great-circle distance only — NOT drive time / road distance, and NOT the full CMS / state ratio, county-designation, provider-capacity, or telehealth rules; the member + providers + coordinates are illustrative, clearly labeled — NOT a certified network-adequacy engine. Enforces, via the Pause Agent Fabric, that every provider is sourced, the distances recompute, and the network is never certified autonomously.",
  url: `${HOST}/api/agents/network-adequacy`,
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
      id: "assess-network-adequacy",
      name: "Assess time-and-distance network adequacy via great-circle distance",
      description:
        "Given a member's location and the plan's in-network providers, deterministically computes the great-circle (haversine) distance to each provider of the required specialty, finds the nearest, and derives the disposition (adequacy-met / adequacy-gap) against the time-and-distance standard. Every provider is sourced; the distances recompute exactly; the network is never certified autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "payer-operations",
        "network-adequacy",
        "time-and-distance",
        "haversine",
        "great-circle-distance",
        "governance"
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
