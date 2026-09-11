import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Provider Network Build-Out / Minimum Spanning Tree (Kruskal's Algorithm) agent —
 * a care-coordination network-planning service.
 *
 *   GET /api/agents/network-buildout/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "network-buildout-agent";

const CARD: A2AAgentCard = {
  name: "Provider Network Build-Out / Minimum Spanning Tree (Kruskal's Algorithm) Agent",
  description:
    "A care-coordination network-planning service — a DETERMINISTIC (no-Claude) agent that, given a set of care SITES (clinics / facilities / exchange endpoints) and candidate LINKS between them (each carrying a build COST — data-exchange setup cost, referral-corridor distance, integration effort), selects the MINIMUM-TOTAL-COST set of links that connects every site into ONE network (a minimum spanning tree), or reports that the candidate links cannot connect everything (a spanning forest — disposition connected / partitioned). The heart of this service is MINIMUM SPANNING TREE construction via KRUSKAL'S ALGORITHM: sort the candidate links by ascending cost, then walk them cheapest-first, adding a link iff it JOINS TWO DISTINCT COMPONENTS (a union-find cycle check rejects a link whose endpoints are already connected). CRUCIALLY, union-find here is a SUBROUTINE — the cycle test inside the greedy edge selection — NOT the computation itself: this is emphatically NOT the Household Composition agent's UNION-FIND CONNECTED-COMPONENT LABELING (which groups records into families by transitively merging match edges — no edge weights, no minimum-cost subset, reports components not a tree). It is also DIFFERENT from every other fabric pattern — NOT the Care Routing agent's DIJKSTRA'S SHORTEST PATH (which minimizes the cost of ONE path between TWO nodes; MST minimizes the total cost to connect ALL nodes), NOT the Batch Partition agent's LINEAR PARTITION, NOT the Care Pathway agent's TOPOLOGICAL ORDERING, NOT the Outreach agent's 0/1 KNAPSACK, NOT the PCP Matching agent's GALE–SHAPLEY STABLE MATCHING, NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, NOT the Huffman agent's OPTIMAL PREFIX CODING, NOT the List Reconciliation agent's LONGEST COMMON SUBSEQUENCE, NOT the Timeline Merge agent's K-WAY MERGE, and NOT the Peak-Window agent's KADANE MAXIMUM-SUBARRAY. Kruskal's tree is provably optimal — no spanning tree of the candidate links has a smaller total cost — and the minimum total build cost is the invariant this service reports and defends (a pure function of the sites + links — no clock, no randomness — so the same request always yields the same plan). The tree is sourced + self-consistent (a fabricated link, an altered cost, or a cycle is blocked — the sourced + self-consistency gate), cost-optimal (a sub-optimal tree that wastes build budget is blocked — the load-bearing correctness gate), and nothing is provisioned, activated, or ordered autonomously (an autonomous provisioning is blocked). A partitioned disposition is a LEGITIMATE FINDING (the candidate links really can't connect every site), NOT a governance block. It IS PHI-adjacent (the site labels reference clinics / facilities) and so is on the HIPAA-audit policy. The costs are illustrative, clearly labeled — NOT a certified network-design system (real provider-network design weighs adequacy standards, contracted rates, capacity, redundancy, and regulatory requirements — not a bare minimum spanning tree over illustrative costs). Enforces, via the Pause Agent Fabric, that every build plan is sourced + self-consistent, the tree is the cost-optimal minimum spanning tree (or the honest partitioned finding), and nothing is provisioned autonomously.",
  url: `${HOST}/api/agents/network-buildout`,
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
      id: "build-network-minimum-spanning-tree",
      name: "Connect a set of care sites into one network at minimum total build cost via minimum spanning tree",
      description:
        "Given a set of care sites and candidate links each carrying a build cost, deterministically runs Kruskal's algorithm to select the minimum-total-cost set of links that connects every site into one network, or reports that the candidate links cannot connect everything. The tree is sourced + self-consistent; the tree is the cost-optimal minimum spanning tree; nothing is provisioned autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "network-planning",
        "minimum-spanning-tree",
        "kruskals-algorithm",
        "cost-optimization",
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
