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
  type ClaimLifecycleDetermination,
  type ClaimLifecycleRequest,
  DEMO_CLAIM_LIFECYCLE_REQUEST,
  claimLifecycleSummary,
  claimNoAutonomousAdvance,
  claimStatesSourced,
  claimTransitionConsistent,
  evaluateClaimLifecycle
} from "../../../../../lib/claim-lifecycle";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "claim-lifecycle-agent";

/**
 * Google A2A `tasks/send` endpoint for the Claim Lifecycle / Status-Transition Guard agent — a claims /
 * payer-operations service on the payer & plan operations plane that validates a claim-status transition
 * against a state machine using an FSM transition-table lookup + BFS reachability.
 *
 *   POST /api/agents/claim-lifecycle/tasks
 *
 * Loads a claim-lifecycle request and DETERMINISTICALLY evaluates it via evaluateClaimLifecycle: it looks
 * up whether current → requested is a legal single-step edge, runs a BFS for reachability + the shortest
 * legal path, and derives the disposition (transition-allowed / transition-illegal-but-reachable /
 * transition-unreachable). There is no edit distance, no interval selection, no bin-packing, no
 * sliding-window count, no interval merge, no topological sort, no set-difference, no dollar waterfall, no
 * pairwise KB lookup, no exact identity match, and no hash chain — it is finite-state-machine transition
 * validation, a pure function of the statuses + machine. Every state + edge is sourced, the logic
 * recomputes exactly, and nothing is advanced — an adjuster confirms every transition. This is a
 * PHI-bearing agent (phiAccessed:true throughout). The state machine is illustrative; real claim-status
 * management uses the X12 277 codes + the payer's adjudication system.
 *
 * Enforced-block policies checked before any finding leaves the fabric:
 *   - policy.claim.states-sourced (signal claimStatesSourced).
 *   - policy.claim.transition-consistent (signal claimTransitionConsistent).
 *   - policy.claim.no-autonomous-advance (signal claimNoAutonomousAdvance).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: ClaimLifecycleRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if every state / edge is sourced, the transition
 *   logic recomputes exactly, and it is not auto-advanced) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("claim-lifecycle");
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
      ? (data.request as ClaimLifecycleRequest)
      : DEMO_CLAIM_LIFECYCLE_REQUEST;

  // Deterministic claim-lifecycle finding.
  const determination = evaluateClaimLifecycle(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as ClaimLifecycleDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: states-sourced + transition-consistent + no autonomous advance.
  const statesSourced = claimStatesSourced(determinationForCheck);
  const transitionConsistent = claimTransitionConsistent(determinationForCheck);
  const noAutonomous = claimNoAutonomousAdvance(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      claimStatesSourced: statesSourced,
      claimTransitionConsistent: transitionConsistent,
      claimNoAutonomousAdvance: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "claim.check-transition.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        claimRef: request.claimRef,
        claimStatesSourced: statesSourced,
        claimTransitionConsistent: transitionConsistent,
        claimNoAutonomousAdvance: noAutonomous,
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
          `Pause Agent Fabric blocked this claim-lifecycle run: ${governance.blockingViolations
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

  const summary = claimLifecycleSummary(determination);

  // Receive-transition span — the fabric records the transition it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "claim.receive-transition",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      currentStatus: determination.currentStatus,
      requestedStatus: determination.requestedStatus,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Check-transition span — the transition-table lookup, parented to the received transition.
  const checkSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "claim.check-transition",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      directEdge: determination.directEdge,
      allowedCount: summary.allowedCount,
      claimStatesSourced: statesSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-reachability span — the BFS, parented to the transition-table check.
  const reachSpan = recordInstantSpan({
    taskId,
    parentSpanId: checkSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "claim.compute-reachability",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      disposition: determination.disposition,
      reachable: determination.reachable,
      pathLength: determination.pathLength,
      claimTransitionConsistent: transitionConsistent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the finding recorded to the audit trail, parented to the reachability computation.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: reachSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "claim.log-audit",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      disposition: determination.disposition,
      claimNoAutonomousAdvance: noAutonomous,
      requiresAdjusterReview: determination.requiresAdjusterReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, claimRef: request.claimRef };

  const completedMessage =
    determination.disposition === "transition-allowed"
      ? `"${determination.currentStatus}" → "${determination.requestedStatus}" is a legal single-step transition — a recommendation for an adjuster to confirm, no advance made (synthetic — illustrative state machine, NOT a certified claims-processing system).`
      : determination.disposition === "transition-illegal-but-reachable"
        ? `"${determination.currentStatus}" → "${determination.requestedStatus}" is not a legal single step (reachable in ${determination.pathLength} steps via ${determination.shortestPath.join(" → ")}) — a recommendation for an adjuster, no advance made (synthetic — illustrative state machine, NOT a certified claims-processing system).`
        : `"${determination.currentStatus}" → "${determination.requestedStatus}" is unreachable — the transition can never occur; a recommendation for an adjuster, no advance made (synthetic — illustrative state machine, NOT a certified claims-processing system).`;

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
        name: "ClaimLifecycleDetermination",
        description:
          "Deterministically-produced claim-status transition finding. It looks up whether current → requested is a legal single-step edge in the state machine, runs a breadth-first search for reachability + the shortest legal path, and derives the disposition: transition-allowed (a legal single step), transition-illegal-but-reachable (not a single step, but a valid future state — the path shows the required intermediate steps), or transition-unreachable (the target can never follow the current status). Every status named — in the allowed-next set and in the shortest path — traces to a defined state of the machine, and every path step is a real transition; the transition logic recomputes exactly from the machine; and the claim is never advanced, paid, or finalized — an adjuster confirms the transition. There is no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, no dollar waterfall, no pairwise KB lookup, no exact identity match, and no hash chain — it is finite-state-machine transition validation, a pure function of the statuses + machine. This is a PHI-bearing agent — the claim references a patient. The state machine is illustrative, NOT a certified claims-processing system — real claim-status management uses the X12 277 claim-status category / status codes, the payer's adjudication system, and the plan's business rules.",
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
        claimRef: request.claimRef,
        patientRef: determination.patientRef,
        currentStatus: determination.currentStatus,
        requestedStatus: determination.requestedStatus,
        disposition: determination.disposition,
        directEdge: determination.directEdge,
        reachable: determination.reachable,
        pathLength: determination.pathLength,
        requiresAdjusterReview: determination.requiresAdjusterReview,
        claimStatesSourced: statesSourced,
        claimTransitionConsistent: transitionConsistent,
        claimNoAutonomousAdvance: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
