import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Claim Lifecycle / Status-Transition Guard agent — a claims /
 * payer-operations service on the payer & plan operations plane.
 *
 *   GET /api/agents/claim-lifecycle/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "claim-lifecycle-agent";

const CARD: A2AAgentCard = {
  name: "Claim Lifecycle / Status-Transition Guard Agent",
  description:
    "A claims / payer-operations service on the payer & plan operations plane — a DETERMINISTIC (no-Claude) agent that takes a claim's current status plus a requested next status and, against a claim-status state machine, decides whether the transition is a legal single step (transition-allowed), whether the requested status is reachable at all and by what shortest path (transition-illegal-but-reachable), or whether it can never follow the current status (transition-unreachable). UNLIKE the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING (which orders a DAG's nodes), the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the Drug–Drug Interaction agent's PAIRWISE KNOWLEDGE-BASE LOOKUP, the OIG Exclusion agent's EXACT identity MATCHING, or the Audit Log Integrity agent's HASH CHAIN — and UNLIKE the date-deadline agents (Timely Filing, Right of Access, Amendment) that add N days to a single date — the heart of this service is FINITE-STATE-MACHINE TRANSITION VALIDATION: a transition-table lookup plus a breadth-first search over the state graph for reachability + the shortest legal path. Time is data: the finding is a pure function of the statuses + machine (no clock, no randomness), so the same input always yields the same finding. Every state + edge is sourced from the machine (a fabricated state / invented transition is blocked — the sourced gate), the transition logic recomputes exactly (a wrong direct-edge / reachability flag, a wrong path length, or a bad disposition is blocked — the load-bearing correctness gate), and the claim is never advanced / paid / finalized (an autonomous advance is blocked). It COMPLEMENTS — it does not duplicate — the other claim agents: distinct from the Claims Adjudication Assistant (per-claim edits), the Coordination of Benefits agent (payer order), the Overpayment Recovery agent (post-payment clawback), the Timely Filing agent (was it filed in time), and the Subrogation agent (third-party liability) — this validates one narrow, purely structural question: is this status transition legal, and if not, is the target even reachable. It is PHI-bearing (the claim references a patient), so it is on the HIPAA-audit policy. The state machine is illustrative, clearly labeled — NOT a certified claims-processing system; real claim-status management uses the X12 277 claim-status category / status codes, the payer's adjudication system, and the plan's business rules. Enforces, via the Pause Agent Fabric, that every state + edge is sourced, the transition logic is exact, and no claim is advanced autonomously.",
  url: `${HOST}/api/agents/claim-lifecycle`,
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
      id: "validate-claim-transition",
      name: "Validate a claim status transition against a state machine",
      description:
        "Given a claim's current status and a requested next status, deterministically checks whether the transition is a legal single-step edge, runs a BFS for reachability + the shortest legal path, and derives the disposition (transition-allowed / transition-illegal-but-reachable / transition-unreachable). Every state + edge is sourced; the transition logic recomputes exactly; no claim is advanced autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "claims",
        "payer-operations",
        "state-machine",
        "finite-state-machine",
        "bfs-reachability",
        "claim-lifecycle",
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
