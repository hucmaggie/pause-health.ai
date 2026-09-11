import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Referral Throughput / Maximum-Flow Network Capacity (Edmonds–Karp) agent —
 * a care-coordination network-capacity service.
 *
 *   GET /api/agents/referral-throughput/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "referral-throughput-agent";

const CARD: A2AAgentCard = {
  name: "Referral Throughput / Maximum-Flow Network Capacity (Edmonds–Karp) Agent",
  description:
    "A care-coordination network-capacity service — a DETERMINISTIC (no-Claude) agent that, given a referral-routing NETWORK (a source feeding intake pools through capacity-limited specialty CHANNELS to a sink of appointment slots, each edge carrying a CAPACITY), computes the MAXIMUM number of referrals routable end-to-end (the maximum flow) and identifies the BOTTLENECK (the minimum cut: the saturated edges whose total capacity caps throughput) — disposition unconstrained / bottlenecked. The heart of this service is the MAXIMUM-FLOW / MINIMUM-CUT computation via EDMONDS–KARP (the BFS-augmenting-path refinement of FORD–FULKERSON): repeatedly find a shortest augmenting path from source to sink in the residual graph, push the path's bottleneck residual capacity, and update residual capacities (including back-edges) until no augmenting path remains; the total pushed is the maximum flow, and the source-reachable side of the final residual graph induces the minimum cut. By the max-flow min-cut theorem the maximum flow EQUALS the minimum cut capacity — that equality is the invariant this service reports and defends (a pure function of the network — no clock, no randomness, augmenting paths chosen by a deterministic BFS — so the same request always yields the same plan). CRUCIALLY it is DIFFERENT from every other fabric pattern: NOT the Network Build-Out agent's MINIMUM SPANNING TREE (Kruskal's — connect all nodes at least cost; this pushes as much flow as possible through capacities), NOT the Care Routing agent's DIJKSTRA'S SHORTEST PATH (one cheapest path between two nodes; this saturates the whole network), NOT the PCP Matching agent's GALE–SHAPLEY STABLE MATCHING, NOT the Batch Partition agent's LINEAR PARTITION, NOT the Outreach agent's 0/1 KNAPSACK, NOT the Caseload Balancing agent's BIN-PACKING, NOT the Household Composition agent's UNION-FIND, NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, and NOT the Timeline Merge agent's K-WAY MERGE — it is max-flow / min-cut. The flow is sourced + conservation-consistent (a fabricated edge, an over-capacity flow, or a conservation violation is blocked — the sourced + self-consistency gate), throughput-optimal (a sub-maximal or overstated throughput is blocked — the load-bearing correctness gate), and nothing is booked, dispatched, or routed autonomously (an autonomous routing is blocked). A bottlenecked disposition is a LEGITIMATE FINDING (a min-cut really caps throughput below demand), NOT a governance block. It IS PHI-adjacent (the node labels reference intake pools / specialties / slots) and so is on the HIPAA-audit policy. The capacities are illustrative, clearly labeled — NOT a certified capacity-planning / scheduling system (real referral capacity planning weighs clinical urgency, specialty match, geography, payer networks, and provider preference — not a bare max-flow over illustrative capacities). Enforces, via the Pause Agent Fabric, that every plan is a sourced + conservation-consistent feasible flow, the throughput is the optimal maximum flow (with the min-cut equal to it), and nothing is routed autonomously.",
  url: `${HOST}/api/agents/referral-throughput`,
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
      id: "maximize-referral-throughput-maxflow",
      name: "Compute the maximum referral throughput through a capacity network and identify the min-cut bottleneck",
      description:
        "Given a referral-routing network with per-edge capacities, deterministically runs Edmonds–Karp to compute the maximum flow (referrals routable end-to-end) and the minimum cut (the saturated bottleneck edges), then reports the per-edge flows, the max-flow value, the total demand, and the cut. The flow is sourced + conservation-consistent; the throughput is the optimal maximum flow (max-flow = min-cut); nothing is routed autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "network-capacity",
        "maximum-flow",
        "min-cut",
        "edmonds-karp",
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
