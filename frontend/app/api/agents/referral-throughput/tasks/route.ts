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
  type ReferralNetworkRequest,
  type ReferralThroughputDetermination,
  DEMO_REFERRAL_THROUGHPUT_REQUEST,
  evaluateReferralThroughput,
  flowSourced,
  noAutonomousRoute,
  referralThroughputSummary,
  throughputOptimal
} from "../../../../../lib/referral-throughput";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "referral-throughput-agent";

/**
 * Google A2A `tasks/send` endpoint for the Referral Throughput / Maximum-Flow Network Capacity (Edmonds–Karp)
 * agent — a care-coordination network-capacity service that, given a referral-routing network (a source feeding
 * intake pools through capacity-limited specialty channels to a sink of appointment slots), computes the maximum
 * number of referrals routable end-to-end and identifies the min-cut bottleneck.
 *
 *   POST /api/agents/referral-throughput/tasks
 *
 * Loads a network request and DETERMINISTICALLY evaluates it via evaluateReferralThroughput: it runs EDMONDS–KARP
 * (BFS-augmenting-path Ford–Fulkerson) to compute the maximum flow, reconstructs a feasible per-edge flow, and
 * reads the minimum cut off the final residual graph (max-flow = min-cut). If throughput meets the source's
 * outbound demand the disposition is unconstrained; otherwise bottlenecked. There is no minimum spanning tree, no
 * Dijkstra shortest path, no stable matching, no linear partition, no knapsack, no bin-packing, no union-find, no
 * EDF schedule, and no k-way merge — it is max-flow / min-cut, a pure function of the network. The flow is
 * sourced + conservation-consistent, throughput-optimal, and nothing is routed — a referral coordinator confirms.
 * It is PHI-adjacent (phiAccessed:true — the node labels reference intake pools / specialties / slots).
 *
 * A bottlenecked disposition is a LEGITIMATE FINDING (a min-cut really caps throughput below demand), NOT a
 * governance block. Enforced-block policies checked before any plan leaves the fabric:
 *   - policy.referralflow.flow-sourced (signal referralFlowSourced).
 *   - policy.referralflow.throughput-optimal (signal referralThroughputOptimal).
 *   - policy.referralflow.no-autonomous-route (signal referralNoAutonomousRoute).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: ReferralNetworkRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the flow is sourced + conservation-consistent, throughput-optimal, and
 *   not auto-routed) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("referral-throughput");
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
      ? (data.request as ReferralNetworkRequest)
      : DEMO_REFERRAL_THROUGHPUT_REQUEST;

  // Deterministic maximum flow.
  const determination = evaluateReferralThroughput(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as ReferralThroughputDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: flow sourced + conservation-consistent, throughput optimal, no autonomous route.
  const sourced = flowSourced(determinationForCheck);
  const optimal = throughputOptimal(determinationForCheck);
  const noAutonomous = noAutonomousRoute(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      referralFlowSourced: sourced,
      referralThroughputOptimal: optimal,
      referralNoAutonomousRoute: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "referralflow.plan.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        networkRef: request.networkRef,
        referralFlowSourced: sourced,
        referralThroughputOptimal: optimal,
        referralNoAutonomousRoute: noAutonomous,
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
          `Pause Agent Fabric blocked this throughput plan: ${governance.blockingViolations
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

  const summary = referralThroughputSummary(determination);

  // Receive-network span — the fabric records the network it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "referralflow.receive-network",
    protocol: "a2a",
    attributes: {
      networkRef: request.networkRef,
      nodeCount: determination.nodeCount,
      edgeCount: determination.edgeCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Solve span — Edmonds–Karp maximum flow, parented to the received network.
  const solveSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "referralflow.solve-maxflow",
    protocol: "a2a",
    attributes: {
      networkRef: request.networkRef,
      maxFlow: determination.maxFlow,
      minCutCapacity: determination.minCutCapacity,
      referralFlowSourced: sourced,
      referralThroughputOptimal: optimal,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the throughput disposition, parented to the solve.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: solveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "referralflow.classify-disposition",
    protocol: "a2a",
    attributes: {
      networkRef: request.networkRef,
      disposition: determination.disposition,
      totalDemand: determination.totalDemand,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the throughput plan recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "referralflow.log-audit",
    protocol: "a2a",
    attributes: {
      networkRef: request.networkRef,
      disposition: determination.disposition,
      referralNoAutonomousRoute: noAutonomous,
      requiresCoordinatorReview: determination.requiresCoordinatorReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, networkRef: request.networkRef };

  const completedMessage =
    determination.disposition === "unconstrained"
      ? `Throughput plan complete — network ${request.networkRef} can route all ${determination.totalDemand} referral(s) of demand end-to-end (maximum throughput ${determination.maxFlow}); a recommendation for a referral coordinator, nothing routed (synthetic — max-flow, NOT a certified capacity-planning system).`
      : `Throughput plan complete — network ${request.networkRef} is BOTTLENECKED at maximum throughput ${determination.maxFlow} of ${determination.totalDemand} referral(s) demanded; the min-cut (capacity ${determination.minCutCapacity}) across ${determination.minCutEdges.length} edge(s) caps it; a recommendation for a referral coordinator to add capacity, nothing routed (synthetic — max-flow / min-cut, NOT a certified capacity-planning system).`;

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
        name: "ReferralThroughputDetermination",
        description:
          "Deterministically-produced referral-throughput plan. Given a referral-routing NETWORK (a source feeding intake pools through capacity-limited specialty CHANNELS to a sink of appointment slots, each edge carrying a CAPACITY), it runs EDMONDS–KARP (the BFS-augmenting-path refinement of FORD–FULKERSON): repeatedly find a shortest augmenting path from source to sink in the residual graph, push its bottleneck residual capacity, and update residual capacities (including back-edges) until no augmenting path remains. The total pushed is the MAXIMUM FLOW (the most referrals routable end-to-end); the source-reachable side of the final residual graph induces the MINIMUM CUT (the saturated bottleneck edges). By the max-flow min-cut theorem the maximum flow EQUALS the minimum cut capacity — the invariant. If throughput meets the source's outbound demand the disposition is unconstrained; otherwise bottlenecked (the honest finding that a min-cut caps throughput below demand — NOT an error). The flow is sourced + conservation-consistent (every edge flow within its submitted capacity, flow conserved at every non-source/sink node, the reported maxFlow the net out of source = net into sink), throughput-optimal — re-running Edmonds–Karp reproduces the maxFlow and the min-cut equals it — and nothing is booked or routed; a referral coordinator confirms. It is DIFFERENT from every other fabric pattern: NOT the Network Build-Out agent's MINIMUM SPANNING TREE (Kruskal's — connect all nodes at least cost; this pushes maximum flow through capacities), NOT the Care Routing agent's DIJKSTRA'S SHORTEST PATH (one cheapest path; this saturates the whole network), NOT the PCP Matching agent's GALE–SHAPLEY STABLE MATCHING, NOT the Batch Partition agent's LINEAR PARTITION, NOT the Outreach agent's 0/1 KNAPSACK, NOT the Caseload Balancing agent's BIN-PACKING, NOT the Household Composition agent's UNION-FIND, NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, and NOT the Timeline Merge agent's K-WAY MERGE — it is max-flow / min-cut, a pure function of the network. It is PHI-adjacent — the node labels reference intake pools / specialties / slots, so a determination is on the HIPAA audit path. The capacities are an illustrative synthetic, NOT a certified capacity-planning / scheduling system (real referral capacity planning weighs clinical urgency, specialty match, geography, payer networks, and provider preference — not a bare max-flow over illustrative capacities).",
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
        maxFlow: determination.maxFlow,
        totalDemand: determination.totalDemand,
        minCutCapacity: determination.minCutCapacity,
        nodeCount: summary.nodeCount,
        edgeCount: summary.edgeCount,
        requiresCoordinatorReview: summary.requiresCoordinatorReview,
        referralFlowSourced: sourced,
        referralThroughputOptimal: optimal,
        referralNoAutonomousRoute: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
