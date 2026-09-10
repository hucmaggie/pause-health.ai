import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Eligibility & Enrollment (834) Reconciliation agent — a claims /
 * payer-operations service on the payer & plan operations plane.
 *
 *   GET /api/agents/enrollment-reconciliation/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "enrollment-reconciliation-agent";

const CARD: A2AAgentCard = {
  name: "Eligibility & Enrollment (834) Reconciliation Agent",
  description:
    "A claims / payer-operations service on the payer & plan operations plane — a DETERMINISTIC (no-Claude) agent that compares a group's source-of-truth enrollment roster (the employer / HR feed) against the carrier's current roster and produces the reconciliation actions (enroll / terminate / update / no-change) that bring the carrier into agreement. UNLIKE the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the OIG Exclusion agent's identity MATCHING, the Drug Interaction agent's pairwise LOOKUP, or the MLR Rebate agent's RATIO + apportionment, the heart of this service is a KEYED SET-DIFFERENCE + a FIELD-LEVEL COMPARISON: it keys both rosters by member id, walks the union, and classifies each member — in source only → enroll; in carrier only → terminate; in both with a differing compared field → update (with the field deltas); in both and identical → no-change. The determination is a pure function of the two rosters (no randomness, no clock), so the same two rosters always yield the same actions. Every member present in either roster is accounted for exactly once (a reconciliation that drops, duplicates, or miscounts a member is blocked — the load-bearing correctness gate), every action is sourced (every update carries a genuinely-differing field, so a fabricated discrepancy is blocked), and no enrollment change is ever applied to the system of record (an autonomous apply is blocked). It COMPLEMENTS — it does not duplicate — the other payer-operations agents: distinct from the Claims Adjudication agent (the allowed amount), the Member Cost-Share agent (splitting a claim into member vs. plan), the Coordination of Benefits agent (the order of coverages), the MLR Rebate agent (a plan-year rebate), and the OIG Exclusion agent (screening a party against the sanctions list) — this reconciles WHO is enrolled, the membership roster itself, between the employer and the carrier. It is PHI-bearing (the rosters reference members and their coverage), so it is on the HIPAA-audit policy. The rosters + compared fields are illustrative, clearly labeled — NOT a certified 834 / enrollment system; real reconciliation uses the full X12 834 transaction set, effective-dating / retroactivity rules, dependent / COBRA / qualifying-event handling, and the carrier's eligibility system. Enforces, via the Pause Agent Fabric, that the reconciliation is complete, every action is sourced, and no enrollment change is applied autonomously.",
  url: `${HOST}/api/agents/enrollment-reconciliation`,
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
      id: "reconcile-enrollment",
      name: "Reconcile a group's employer roster against the carrier roster",
      description:
        "Given a group's source-of-truth roster and the carrier's current roster, deterministically produces the reconciliation actions (enroll / terminate / update / no-change) that bring the carrier into agreement, via a keyed set-difference + a field-level comparison. Every member is accounted for exactly once; every action is sourced; no enrollment change is applied autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "enrollment",
        "eligibility",
        "834",
        "reconciliation",
        "payer-operations",
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
