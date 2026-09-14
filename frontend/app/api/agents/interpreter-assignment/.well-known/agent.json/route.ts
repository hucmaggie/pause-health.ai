import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Interpreter Assignment / Optimal Assignment (Hungarian Algorithm) agent —
 * a care-coordination assignment service.
 *
 *   GET /api/agents/interpreter-assignment/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "interpreter-assignment-agent";

const CARD: A2AAgentCard = {
  name: "Interpreter Assignment / Optimal Assignment (Hungarian Algorithm) Agent",
  description:
    "A care-coordination assignment service — a DETERMINISTIC (no-Claude) agent that, given a set of qualified INTERPRETERS, a set of concurrent APPOINTMENTS, and a COST matrix (each interpreter↔appointment pairing carrying a cost — travel + wait + skill-mismatch, or an 'unavailable' sentinel when an interpreter can't cover an appointment), computes the MINIMUM-TOTAL-COST one-to-one ASSIGNMENT — the provably optimal perfect matching (disposition assignable / infeasible). The heart of this service is the HUNGARIAN ALGORITHM (Kuhn–Munkres): the O(n³) combinatorial method that finds a minimum-cost perfect matching in a bipartite graph by maintaining dual potentials and augmenting along tight-edge alternating paths until every row is matched. CRUCIALLY it is a genuinely NEW computation pattern for the fabric and EMPHATICALLY DISTINCT from the two matching agents it sits near: NOT the PCP Matching agent's GALE–SHAPLEY STABLE MATCHING (which produces a STABLE matching from two-sided PREFERENCE lists — no costs, no global optimum, and stability, not minimum total cost, is its property) and NOT the Caseload Balancing agent's WORST-FIT-DECREASING BIN-PACKING (an unordered greedy capacity fill, not a one-to-one optimal matching). It is also NOT the Referral Throughput agent's MAX-FLOW, NOT the Network Build-Out agent's MINIMUM SPANNING TREE, NOT the Batch Partition agent's LINEAR PARTITION, NOT the Outreach agent's 0/1 KNAPSACK, and NOT the Care Routing agent's DIJKSTRA'S SHORTEST PATH — it is the ASSIGNMENT PROBLEM, solved to the provable minimum (a pure function of the cost matrix — no clock, no randomness — so the same request always yields the same assignment). The minimum total assignment cost is the invariant this service reports and defends. The assignment is sourced + self-consistent (a fabricated pairing, a reused interpreter, or an overstated cost is blocked — the sourced + self-consistency gate), cost-optimal (a sub-optimal assignment that wastes interpreter time is blocked — the load-bearing correctness gate), and nothing is booked, dispatched, or notified autonomously (an autonomous dispatch is blocked). An infeasible disposition is a LEGITIMATE FINDING (some appointment has no qualified interpreter — a coverage gap), NOT a governance block. It COMPLEMENTS the PCP Matching agent (stable member↔PCP matching) and the Caseload Balancing agent (panel capacity fill): this is the optimal one-to-one assignment. It IS PHI-adjacent (the appointments reference member encounters) and so is on the HIPAA-audit policy. The costs are illustrative, clearly labeled — NOT a certified interpreter-scheduling / workforce system (real interpreter scheduling weighs certification & specialty, modality, union & labor rules, travel logistics, and member language preference — not a bare cost matrix). Enforces, via the Pause Agent Fabric, that every assignment is a sourced + self-consistent one-to-one matching, the assignment is the cost-optimal minimum, and nothing is dispatched autonomously.",
  url: `${HOST}/api/agents/interpreter-assignment`,
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
      id: "assign-interpreters-hungarian",
      name: "Assign interpreters to concurrent appointments at minimum total cost via the Hungarian algorithm",
      description:
        "Given qualified interpreters, concurrent appointments, and a cost matrix, deterministically runs the Hungarian algorithm to compute the minimum-total-cost one-to-one assignment, then reports the pairings, the total cost, and any uncoverable appointments. The assignment is sourced + self-consistent; the assignment is the cost-optimal minimum; nothing is dispatched autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "language-access",
        "assignment-problem",
        "hungarian-algorithm",
        "optimal-matching",
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
