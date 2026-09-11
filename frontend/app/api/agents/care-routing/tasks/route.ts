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
  type CareRouteDetermination,
  type CareRouteRequest,
  DEMO_CARE_ROUTE_REQUEST,
  careRouteSummary,
  evaluateCareRoute,
  noAutonomousRouting,
  pathSourced,
  routeOptimal
} from "../../../../../lib/care-routing";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "care-routing-agent";

/**
 * Google A2A `tasks/send` endpoint for the Care-Transition Routing / Least-Burden Path agent — a
 * care-coordination / transition-planning service on the patient & clinical plane that, given a patient's
 * current care setting, a goal setting, and a directed graph of permitted weighted transitions, finds the
 * minimum-total-burden path via DIJKSTRA'S WEIGHTED SHORTEST PATH.
 *
 *   POST /api/agents/care-routing/tasks
 *
 * Loads a routing request and DETERMINISTICALLY evaluates it via evaluateCareRoute: it runs Dijkstra over
 * the edges, reconstructs the least-burden path, and derives route-found / no-route. There is no regression,
 * no knapsack, no CUSUM, no k-way merge, no recursive boolean tree, no stable matching, no geospatial
 * distance, no checksum, no union-find, no percentile, no largest-remainder apportionment, no edit distance,
 * no interval selection, no set-difference, no hash chain, no topological sort, and no unweighted BFS
 * hop-count — it is Dijkstra's weighted shortest path, a pure function of the graph. The reported path is
 * sourced, the route is optimal, and nothing is routed — a care lead confirms. This is a PHI-bearing agent
 * (phiAccessed:true throughout). The settings + transitions are illustrative; real transition planning weighs
 * clinical appropriateness, bed availability, and payer authorization.
 *
 * Enforced-block policies checked before any route leaves the fabric:
 *   - policy.route.path-sourced (signal routePathSourced).
 *   - policy.route.route-optimal (signal routeOptimal).
 *   - policy.route.no-autonomous-routing (signal routeNoAutonomousRouting).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: CareRouteRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the path is sourced, the route is optimal, and it is not
 *   auto-routed) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("care-routing");
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
      ? (data.request as CareRouteRequest)
      : DEMO_CARE_ROUTE_REQUEST;

  // Deterministic Dijkstra least-burden routing.
  const determination = evaluateCareRoute(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as CareRouteDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: path-sourced + route-optimal + no autonomous routing.
  const sourced = pathSourced(determinationForCheck);
  const optimal = routeOptimal(determinationForCheck);
  const noAutonomous = noAutonomousRouting(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      routePathSourced: sourced,
      routeOptimal: optimal,
      routeNoAutonomousRouting: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "route.compute-path.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        routeRef: request.routeRef,
        routePathSourced: sourced,
        routeOptimal: optimal,
        routeNoAutonomousRouting: noAutonomous,
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
          `Pause Agent Fabric blocked this care route: ${governance.blockingViolations
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

  const summary = careRouteSummary(determination);

  // Receive-graph span — the fabric records the transition graph it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "route.receive-graph",
    protocol: "a2a",
    attributes: {
      routeRef: request.routeRef,
      start: determination.start,
      goal: determination.goal,
      edgeCount: determination.edges.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-path span — Dijkstra's shortest path, parented to the received graph.
  const computeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "route.compute-path",
    protocol: "a2a",
    attributes: {
      routeRef: request.routeRef,
      totalCost: determination.totalCost,
      hops: determination.hops,
      routePathSourced: sourced,
      routeOptimal: optimal,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the disposition, parented to the computation.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: computeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "route.classify-disposition",
    protocol: "a2a",
    attributes: {
      routeRef: request.routeRef,
      disposition: determination.disposition,
      reachable: determination.reachable,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the route recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "route.log-audit",
    protocol: "a2a",
    attributes: {
      routeRef: request.routeRef,
      disposition: determination.disposition,
      routeNoAutonomousRouting: noAutonomous,
      requiresCareLeadReview: determination.requiresCareLeadReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, routeRef: request.routeRef };

  const completedMessage = determination.reachable
    ? `Care-transition routing complete — least-burden route ${determination.path.join(" \u2192 ")} (total burden ${determination.totalCost} over ${determination.hops} transition(s)); a recommendation for a care lead, nothing routed (synthetic — Dijkstra's weighted shortest path, NOT a certified care-transition / discharge-planning system).`
    : `Care-transition routing complete — NO ROUTE from ${determination.start} to ${determination.goal} across the submitted transitions; a recommendation for a care lead, nothing routed (synthetic — Dijkstra's weighted shortest path, NOT a certified care-transition / discharge-planning system).`;

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
        name: "CareRouteDetermination",
        description:
          "Deterministically-produced care-transition routing finding. Given a patient's current care setting, a goal setting, and a directed graph of permitted transitions each carrying a non-negative burden weight, it runs DIJKSTRA'S WEIGHTED SHORTEST PATH — the single-source shortest-path over non-negative edge weights, settling the nearest unsettled node and relaxing its out-edges (dist[v] = min(dist[v], dist[u] + w(u,v))) then reconstructing the minimum-total-weight path — reporting the least-burden path, the total burden, the hop count, and the disposition: route-found or no-route (the goal is unreachable). The reported path is a real walk of the submitted graph (every consecutive pair is a submitted edge; no fabricated transition), the route is optimal — recomputing Dijkstra reproduces the minimum total burden — and no transition is initiated, no setting booked, and no patient moved; a care lead confirms. There is no regression, no knapsack, no CUSUM, no k-way merge, no recursive boolean tree, no stable matching, no geospatial distance, no checksum, no union-find, no percentile, no largest-remainder apportionment, no edit distance, no interval selection, no set-difference, no hash chain, no topological sort, and no unweighted BFS hop-count — it is Dijkstra's weighted shortest path, a pure function of the graph. This is a PHI-bearing agent — the route is a patient's care plan. It is DISTINCT from the Care Pathway agent (which topologically orders one protocol's steps into a dependency order), the Claim Lifecycle agent (which BFS-checks reachability across an unweighted state machine), and the Transitions of Care agent (medication reconciliation); this finds the least-burden path through a weighted graph of care settings. The settings + transitions are illustrative synthetics, NOT a certified care-transition / discharge-planning system (real transition planning weighs clinical appropriateness, bed availability, payer authorization, patient preference, and caregiver capacity — not a single scalar burden per edge).",
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
        routeRef: request.routeRef,
        disposition: determination.disposition,
        start: determination.start,
        goal: determination.goal,
        totalCost: determination.totalCost,
        hops: summary.hops,
        reachable: determination.reachable,
        edgeCount: summary.edgeCount,
        requiresCareLeadReview: summary.requiresCareLeadReview,
        routePathSourced: sourced,
        routeOptimal: optimal,
        routeNoAutonomousRouting: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
