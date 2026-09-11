import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Member Contact Rate Limiting / Token-Bucket Throttle agent —
 * a care-coordination contact-governance service.
 *
 *   GET /api/agents/contact-rate-limit/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "contact-rate-limit-agent";

const CARD: A2AAgentCard = {
  name: "Member Contact Rate Limiting / Token-Bucket Throttle Agent",
  description:
    "A care-coordination contact-governance service — a DETERMINISTIC (no-Claude) agent that, given a CHRONOLOGICALLY-ORDERED sequence of outbound contact ATTEMPTS to a member (calls / texts / emails from the various agents) and a token-bucket CONFIG (a burst CAPACITY of tokens and a continuous REFILL rate per hour), replays the attempts through a TOKEN BUCKET to decide which contacts are PERMITTED and which are THROTTLED — so a member is never over-contacted past the configured frequency cap (disposition within-limits / throttled). The heart of this service is the TOKEN-BUCKET RATE-LIMITING algorithm: the bucket holds up to capacity tokens and refills continuously at refillPerHour tokens/hour (never above capacity); each attempt, in time order, first accrues the refill earned since the previous attempt, then — if at least one whole token is available — consumes one token and is permitted, otherwise is throttled. CRUCIALLY it is a genuinely NEW computation pattern for the fabric: NOT the Outreach Prioritization agent's 0/1 KNAPSACK (which selects WHICH members to contact under a capacity budget — this governs HOW OFTEN one member may be contacted over time), NOT the Access Anomaly agent's SLIDING-WINDOW COUNTING (a fixed-window event count with no continuous refill or token reservoir), NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, NOT the Referral Throughput agent's MAX-FLOW, NOT the Network Build-Out agent's MINIMUM SPANNING TREE, NOT the Care Routing agent's DIJKSTRA'S SHORTEST PATH, and NOT the Schedule Conflict agent's GREEDY INTERVAL SELECTION — it is token-bucket throttling, a continuously-refilling token reservoir with a burst cap (a pure function of the config + timestamps — no clock, no randomness — so the same request always yields the same plan). The replay is sourced + self-consistent (a fabricated attempt, a reordered replay, or a miscounted tally is blocked — the sourced + self-consistency gate), policy-exact (an over- or under-throttled decision is blocked — the load-bearing correctness gate), and nothing is sent or suppressed autonomously (an autonomous send is blocked). A throttled disposition is a LEGITIMATE FINDING (some attempts really exceed the cap), NOT a governance block. It COMPLEMENTS the Outreach Prioritization agent: that chooses whom to reach, this caps how often. It IS PHI-adjacent (the attempts reference member contacts) and so is on the HIPAA-audit policy. The attempts are illustrative, clearly labeled — NOT a certified communications-compliance system (real member-contact governance weighs TCPA / CAN-SPAM consent, quiet hours, channel-specific caps, member preferences, and campaign suppression lists — not a bare token bucket over illustrative timestamps). Enforces, via the Pause Agent Fabric, that every plan is a sourced + self-consistent replay, the throttle decision is policy-exact, and nothing is sent autonomously.",
  url: `${HOST}/api/agents/contact-rate-limit`,
  provider: {
    organization: "Salesforce (via Pause-Health.ai)",
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
      id: "throttle-member-contacts-token-bucket",
      name: "Decide which member-contact attempts are permitted vs throttled under a token-bucket frequency cap",
      description:
        "Given an ordered sequence of outbound contact attempts and a token-bucket config (burst capacity + refill per hour), deterministically replays the attempts through a token bucket to permit or throttle each, then reports the per-attempt decisions, the permitted/throttled tallies, and the final token level. The replay is sourced + self-consistent; the throttle decision is policy-exact (the bucket re-simulates); nothing is sent autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "contact-governance",
        "rate-limiting",
        "token-bucket",
        "frequency-cap",
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
