import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Chart Review Batch Partitioning / Linear Partition
 * (Binary-Search-on-Answer) agent — a care-coordination workload-partitioning service.
 *
 *   GET /api/agents/batch-partition/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "batch-partition-agent";

const CARD: A2AAgentCard = {
  name: "Chart Review Batch Partitioning / Linear Partition (Binary-Search-on-Answer) Agent",
  description:
    "A care-coordination workload-partitioning service — a DETERMINISTIC (no-Claude) agent that, given a CHRONOLOGICALLY / PRIORITY-ORDERED clinical review worklist — each item carrying an effort WEIGHT (estimated review minutes / complexity points) — and a reviewer count k, splits the worklist into k CONTIGUOUS batches (order preserved) that MINIMIZE the busiest reviewer's load (the maximum batch weight), so a chart-review backlog can be balanced across reviewers as evenly as possible (disposition divisible / item-bound). CRUCIALLY, this is NOT the Caseload Balancing agent's WORST-FIT-DECREASING BIN-PACKING (which reorders members by descending acuity and greedily drops each into the emptiest bin — an UNORDERED heuristic assignment) and NOT the Peak-Window agent's KADANE MAXIMUM-SUBARRAY (which finds one best contiguous window, not a k-way split). It is also UNLIKE the Huffman agent's OPTIMAL PREFIX CODING, the List Reconciliation agent's LONGEST COMMON SUBSEQUENCE, the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, the Care Routing agent's DIJKSTRA'S SHORTEST PATH, the Outreach agent's 0/1 KNAPSACK, the PCP Matching agent's GALE–SHAPLEY STABLE MATCHING, the Scheduling agent's INTERVAL SELECTION, or the Household Composition agent's UNION-FIND — the heart of this service is the LINEAR PARTITION PROBLEM solved by BINARY SEARCH ON THE ANSWER: the minimal feasible peak load lies between the single heaviest item and the total weight; a greedy feasibility test (how many contiguous batches does a candidate cap require?) is monotonic in the cap, so binary search converges on the exact minimal maximum, and an order-preserving DP reconstructs the split. Order matters — the split is CONTIGUOUS — which is exactly what unordered bin-packing throws away. The linear partition minimum is provably optimal — no contiguous k-way split achieves a smaller maximum — and the minimal peak load is the invariant this service reports and defends (a pure function of the weights + reviewer count — no clock, no randomness — so the same request always yields the same partition). The partition is sourced + self-consistent (a fabricated batch, a reordered cover, or an overstated load is blocked — the sourced + self-consistency gate), optimal (a sub-optimal split that overloads one reviewer is blocked — the load-bearing correctness gate), and nothing is assigned to a named reviewer or dispatched autonomously (an autonomous assignment is blocked). It COMPLEMENTS — it does not duplicate — the Caseload Balancing agent (which greedily bin-packs unordered members into capacity-bounded panels): this splits an ORDERED worklist into contiguous batches, provably minimizing the peak. It IS PHI-adjacent (the item labels reference charts / encounters) and so is on the HIPAA-audit policy. The weights are illustrative, clearly labeled — NOT a certified staffing / workforce-management system (real reviewer scheduling weighs skills, certifications, shift rules, breaks, and fatigue — not a bare contiguous split by an effort number). Enforces, via the Pause Agent Fabric, that every partition is sourced + self-consistent, the partition is the optimal minimal-peak-load split, and no reviewer is assigned autonomously.",
  url: `${HOST}/api/agents/batch-partition`,
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
      id: "partition-worklist-linear-partition",
      name: "Split an ordered review worklist into k contiguous batches minimizing the busiest reviewer's load",
      description:
        "Given an ordered clinical review worklist each item carrying an effort weight, and a reviewer count k, deterministically solves the linear partition problem by binary search on the answer to split the worklist into k contiguous batches that minimize the maximum batch load, then reports the batch boundaries, each batch load, and the minimal achievable peak load. The partition is sourced + self-consistent; the partition is the optimal minimal-peak-load split; no reviewer is assigned autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "workload-partitioning",
        "linear-partition",
        "binary-search-on-answer",
        "load-balancing",
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
