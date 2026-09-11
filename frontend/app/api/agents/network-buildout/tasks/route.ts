import { NextResponse } from "next/server";
import {
  type A2ATask,
  agentMessage,
  findDataPart,
  newTaskId,
  nowIso,
  parseTasksSendEnvelope
} from "../../../../../lib/a2a";
import {
  evaluateGovernance,
  recordInstantSpan
} from "../../../../../lib/agent-fabric";
import {
  type NetworkBuildoutDetermination,
  type NetworkBuildoutRequest,
  DEMO_NETWORK_BUILDOUT_REQUEST,
  evaluateNetworkBuildout,
  networkBuildoutSummary,
  noAutonomousProvision,
  treeOptimal,
  treeSourced
} from "../../../../../lib/network-buildout";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "network-buildout-agent";

/**
 * Google A2A `tasks/send` endpoint for the Provider Network Build-Out / Minimum Spanning Tree (Kruskal's
 * Algorithm) agent — a care-coordination network-planning service that, given a set of care sites and candidate
 * links (each with a build cost), selects the minimum-total-cost set of links that connects every site into one
 * network, or reports that the candidate links cannot connect everything (a spanning forest).
 *
 *   POST /api/agents/network-buildout/tasks
 *
 * Loads a build request and DETERMINISTICALLY evaluates it via evaluateNetworkBuildout: it runs KRUSKAL'S
 * ALGORITHM (sort candidate links by ascending cost, walk them cheapest-first, add each link iff it joins two
 * distinct components — a union-find cycle check). If the chosen links connect every site the disposition is
 * connected; otherwise partitioned. Union-find is a SUBROUTINE (the cycle test), not the computation — this is
 * minimum-spanning-tree construction, not connected-component labeling. There is no Dijkstra shortest path, no
 * linear partition, no topological sort, no knapsack, no stable matching, no EDF schedule, no Huffman code, no
 * LCS diff, no k-way merge, and no Kadane max-subarray — it is Kruskal's MST, a pure function of the sites +
 * links. The tree is sourced + self-consistent, cost-optimal, and nothing is provisioned — a network architect
 * confirms. It is PHI-adjacent (phiAccessed:true — the site labels reference clinics / facilities).
 *
 * A partitioned disposition is a LEGITIMATE FINDING (the candidate links really can't connect every site), NOT a
 * governance block. Enforced-block policies checked before any plan leaves the fabric:
 *   - policy.netbuildout.tree-sourced (signal networkTreeSourced).
 *   - policy.netbuildout.cost-optimal (signal networkTreeCostOptimal).
 *   - policy.netbuildout.no-autonomous-provision (signal networkNoAutonomousProvision).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: NetworkBuildoutRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the tree is sourced + self-consistent, cost-optimal, and not
 *   auto-provisioned) demonstrates the three governance blocks.
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  const parsed = parseTasksSendEnvelope(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: parsed.id, error: { code: parsed.code, message: parsed.message } },
      { status: 400 }
    );
  }

  const params = parsed.params;
  const taskId = params.id || newTaskId("network-buildout");
  const sessionId = params.sessionId;
  const parentSpanId =
    typeof params.metadata?.parentSpanId === "string"
      ? (params.metadata.parentSpanId as string)
      : undefined;
  const personaId =
    typeof params.metadata?.personaId === "string"
      ? (params.metadata.personaId as string)
      : undefined;

  const data = findDataPart(params.message?.parts) ?? {};
  const request =
    data.request && typeof data.request === "object"
      ? (data.request as NetworkBuildoutRequest)
      : DEMO_NETWORK_BUILDOUT_REQUEST;

  // Deterministic minimum spanning tree.
  const determination = evaluateNetworkBuildout(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as NetworkBuildoutDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: tree sourced + self-consistent, cost optimal, no autonomous provision.
  const sourced = treeSourced(determinationForCheck);
  const optimal = treeOptimal(determinationForCheck);
  const noAutonomous = noAutonomousProvision(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      networkTreeSourced: sourced,
      networkTreeCostOptimal: optimal,
      networkNoAutonomousProvision: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "netbuildout.build.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        networkRef: request.networkRef,
        networkTreeSourced: sourced,
        networkTreeCostOptimal: optimal,
        networkNoAutonomousProvision: noAutonomous,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        phiAccessed: true,
        ...(personaId ? { personaId } : {})
      }
    });
    const failed: A2ATask = {
      id: taskId,
      sessionId,
      status: {
        state: "failed",
        timestamp: nowIso(),
        message: agentMessage(
          `Pause Agent Fabric blocked this build plan: ${governance.blockingViolations
            .map((v) => `${v.policyId} (${v.reason})`)
            .join("; ")}`,
          { blockingViolations: governance.blockingViolations }
        )
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
          violations: governance.blockingViolations
        }
      }
    };
    return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: failed });
  }

  const summary = networkBuildoutSummary(determination);

  // Receive-network span — the fabric records the network it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "netbuildout.receive-network",
    protocol: "a2a",
    attributes: {
      networkRef: request.networkRef,
      siteCount: determination.siteCount,
      linkCount: determination.linkCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Build span — Kruskal's minimum spanning tree, parented to the received network.
  const buildSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "netbuildout.build",
    protocol: "a2a",
    attributes: {
      networkRef: request.networkRef,
      totalCost: determination.totalCost,
      chosenLinkCount: determination.chosenLinks.length,
      networkTreeSourced: sourced,
      networkTreeCostOptimal: optimal,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the build disposition, parented to the build.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: buildSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "netbuildout.classify-disposition",
    protocol: "a2a",
    attributes: {
      networkRef: request.networkRef,
      disposition: determination.disposition,
      componentCount: determination.componentCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the build plan recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "netbuildout.log-audit",
    protocol: "a2a",
    attributes: {
      networkRef: request.networkRef,
      disposition: determination.disposition,
      networkNoAutonomousProvision: noAutonomous,
      requiresArchitectReview: determination.requiresArchitectReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, networkRef: request.networkRef };

  const completedMessage =
    determination.disposition === "connected"
      ? `Build plan complete — ${determination.siteCount} site(s) of ${request.networkRef} connected into one network by ${determination.chosenLinks.length} link(s) at minimum total build cost ${determination.totalCost}; a recommendation for a network architect, nothing provisioned (synthetic — minimum spanning tree, NOT a certified network-design system).`
      : `Build plan complete — ${request.networkRef} is PARTITIONED; the candidate links connect the ${determination.siteCount} site(s) into only ${determination.componentCount} component(s) (${determination.chosenLinks.length} link(s), cost ${determination.totalCost}); a recommendation for a network architect to add links, nothing provisioned (synthetic — minimum spanning tree, NOT a certified network-design system).`;

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(completedMessage, { result })
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "NetworkBuildoutDetermination",
        description:
          "Deterministically-produced provider-network build plan. Given a set of care SITES (clinics / facilities / exchange endpoints) and a set of candidate LINKS between them — each carrying a build COST — it runs KRUSKAL'S ALGORITHM: sort the candidate links by ascending cost, then walk them cheapest-first, adding a link to the tree iff it JOINS TWO DISTINCT COMPONENTS (a union-find cycle check rejects a link whose endpoints are already connected). If the chosen links connect every site the disposition is connected; otherwise partitioned (the honest finding that the candidate links cannot connect every site — a spanning FOREST, NOT an error). Union-find here is a SUBROUTINE — the cycle test inside the greedy edge selection — NOT the computation: this is minimum-spanning-tree construction, emphatically NOT the Household Composition agent's UNION-FIND CONNECTED-COMPONENT LABELING (which groups records into families with no edge weights and no minimum-cost subset). Kruskal's tree is provably optimal — no spanning tree of the candidate links has a smaller total cost — and the minimum total build cost is the invariant. The tree is sourced + self-consistent (each chosen link a submitted candidate with the same endpoints + cost, the chosen links forming a forest — no cycle — the totalCost and componentCount honest), cost-optimal — re-running Kruskal's algorithm reproduces the minimum total cost — and nothing is provisioned or activated; a network architect confirms. It is DIFFERENT from every other fabric pattern: NOT the Care Routing agent's DIJKSTRA'S SHORTEST PATH (which minimizes the cost of ONE path between TWO nodes; MST minimizes the total cost to connect ALL nodes), NOT the Batch Partition agent's LINEAR PARTITION, NOT the Care Pathway agent's TOPOLOGICAL ORDERING, NOT the Outreach agent's 0/1 KNAPSACK, NOT the PCP Matching agent's GALE–SHAPLEY STABLE MATCHING, NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, NOT the Huffman agent's OPTIMAL PREFIX CODING, NOT the List Reconciliation agent's LONGEST COMMON SUBSEQUENCE, NOT the Timeline Merge agent's K-WAY MERGE, and NOT the Peak-Window agent's KADANE MAXIMUM-SUBARRAY — it is Kruskal's MST, a pure function of the sites + links. It is PHI-adjacent — the site labels reference clinics / facilities, so a determination is on the HIPAA audit path. The costs are an illustrative synthetic, NOT a certified network-design system (real provider-network design weighs adequacy standards, contracted rates, capacity, redundancy, and regulatory requirements — not a bare minimum spanning tree over illustrative costs).",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: auditSpan.id,
        traceTaskId: taskId,
        networkRef: request.networkRef,
        disposition: determination.disposition,
        totalCost: determination.totalCost,
        componentCount: determination.componentCount,
        siteCount: summary.siteCount,
        linkCount: summary.linkCount,
        chosenLinkCount: summary.chosenLinkCount,
        requiresArchitectReview: summary.requiresArchitectReview,
        networkTreeSourced: sourced,
        networkTreeCostOptimal: optimal,
        networkNoAutonomousProvision: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
