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
  type InterpreterAssignmentDetermination,
  type InterpreterAssignmentRequest,
  DEMO_INTERPRETER_ASSIGNMENT_REQUEST,
  assignmentOptimal,
  assignmentSourced,
  evaluateInterpreterAssignment,
  interpreterAssignmentSummary,
  noAutonomousDispatch
} from "../../../../../lib/interpreter-assignment";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "interpreter-assignment-agent";

/**
 * Google A2A `tasks/send` endpoint for the Interpreter Assignment / Optimal Assignment (Hungarian Algorithm)
 * agent — a care-coordination assignment service that, given qualified interpreters, concurrent appointments,
 * and a cost matrix, computes the minimum-total-cost one-to-one assignment.
 *
 *   POST /api/agents/interpreter-assignment/tasks
 *
 * Loads a request and DETERMINISTICALLY evaluates it via evaluateInterpreterAssignment: it solves the ASSIGNMENT
 * PROBLEM via the HUNGARIAN ALGORITHM (Kuhn–Munkres) to the provable minimum total cost. There is no Gale–Shapley
 * stable matching, no bin-packing, no max-flow, no minimum spanning tree, no linear partition, no knapsack, and
 * no Dijkstra path — it is the assignment problem, a pure function of the cost matrix. The assignment is sourced
 * + self-consistent, cost-optimal, and nothing is dispatched — a language-access coordinator confirms. It is
 * PHI-adjacent (phiAccessed:true — the appointments reference member encounters).
 *
 * An infeasible disposition is a LEGITIMATE FINDING (some appointment has no qualified interpreter), NOT a
 * governance block. Enforced-block policies checked before any assignment leaves the fabric:
 *   - policy.interpasg.assignment-sourced (signal interpAssignmentSourced).
 *   - policy.interpasg.cost-optimal (signal interpAssignmentOptimal).
 *   - policy.interpasg.no-autonomous-dispatch (signal interpNoAutonomousDispatch).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: InterpreterAssignmentRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if the assignment is sourced + self-consistent,
 *   cost-optimal, and not auto-dispatched) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("interpreter-assignment");
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
      ? (data.request as InterpreterAssignmentRequest)
      : DEMO_INTERPRETER_ASSIGNMENT_REQUEST;

  // Deterministic Hungarian optimal assignment.
  const determination = evaluateInterpreterAssignment(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as InterpreterAssignmentDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: assignment sourced + self-consistent, cost optimal, no autonomous dispatch.
  const sourced = assignmentSourced(determinationForCheck);
  const optimal = assignmentOptimal(determinationForCheck);
  const noAutonomous = noAutonomousDispatch(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      interpAssignmentSourced: sourced,
      interpAssignmentOptimal: optimal,
      interpNoAutonomousDispatch: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "interpasg.assign.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        rosterRef: request.rosterRef,
        interpAssignmentSourced: sourced,
        interpAssignmentOptimal: optimal,
        interpNoAutonomousDispatch: noAutonomous,
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
          `Pause Agent Fabric blocked this assignment: ${governance.blockingViolations
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

  const summary = interpreterAssignmentSummary(determination);

  // Receive-roster span — the fabric records the roster it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "interpasg.receive-roster",
    protocol: "a2a",
    attributes: {
      rosterRef: request.rosterRef,
      interpreterCount: determination.interpreterCount,
      appointmentCount: determination.appointmentCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Assign span — Hungarian optimal assignment, parented to the received roster.
  const assignSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "interpasg.assign",
    protocol: "a2a",
    attributes: {
      rosterRef: request.rosterRef,
      totalCost: determination.totalCost,
      assignedCount: determination.assignments.length,
      interpAssignmentSourced: sourced,
      interpAssignmentOptimal: optimal,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the assignment disposition, parented to the assign.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: assignSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "interpasg.classify-disposition",
    protocol: "a2a",
    attributes: {
      rosterRef: request.rosterRef,
      disposition: determination.disposition,
      unmatchedCount: determination.unmatched.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the assignment recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "interpasg.log-audit",
    protocol: "a2a",
    attributes: {
      rosterRef: request.rosterRef,
      disposition: determination.disposition,
      interpNoAutonomousDispatch: noAutonomous,
      requiresCoordinatorReview: determination.requiresCoordinatorReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, rosterRef: request.rosterRef };

  const completedMessage =
    determination.disposition === "assignable"
      ? `Assignment complete — all ${determination.appointmentCount} appointment(s) in ${request.rosterRef} matched to interpreters at minimum total cost ${determination.totalCost}; a recommendation for a language-access coordinator, nothing dispatched (synthetic — Hungarian assignment, NOT a certified scheduling system).`
      : `Assignment complete — roster ${request.rosterRef} is INFEASIBLE; ${determination.unmatched.length} appointment(s) have no qualified interpreter (${determination.unmatched.join(", ")}), ${determination.assignments.length} matched at cost ${determination.totalCost}; a recommendation for a language-access coordinator, nothing dispatched (synthetic — Hungarian assignment, NOT a certified scheduling system).`;

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
        name: "InterpreterAssignmentDetermination",
        description:
          "Deterministically-produced interpreter assignment. Given a set of qualified INTERPRETERS, a set of concurrent APPOINTMENTS, and a COST matrix (each interpreter↔appointment pairing carrying a cost — travel + wait + skill-mismatch, or an 'unavailable' sentinel when an interpreter can't cover an appointment), it computes the MINIMUM-TOTAL-COST one-to-one ASSIGNMENT via the HUNGARIAN ALGORITHM (Kuhn–Munkres): the O(n³) method that finds a minimum-cost perfect matching by maintaining dual potentials and augmenting along tight-edge alternating paths until every row is matched. If every appointment is covered with a finite-cost interpreter the disposition is assignable; otherwise infeasible (the honest finding that some appointment has no qualified interpreter — NOT an error). The minimum total assignment cost is the invariant. The assignment is sourced + self-consistent (a real one-to-one matching over the submitted sets — no interpreter or appointment used twice, no fabricated pairing, no unavailable cell, honest total), cost-optimal — re-running the Hungarian algorithm reproduces the minimum total cost — and nothing is booked or dispatched; a language-access coordinator confirms. CRUCIALLY this is EMPHATICALLY DISTINCT from the PCP Matching agent's GALE–SHAPLEY STABLE MATCHING (which produces a STABLE matching from two-sided PREFERENCE lists — no costs, no global optimum) and the Caseload Balancing agent's WORST-FIT-DECREASING BIN-PACKING (an unordered greedy capacity fill); it is also NOT the Referral Throughput agent's MAX-FLOW, NOT the Network Build-Out agent's MINIMUM SPANNING TREE, NOT the Batch Partition agent's LINEAR PARTITION, NOT the Outreach agent's 0/1 KNAPSACK, and NOT the Care Routing agent's DIJKSTRA'S SHORTEST PATH — it is the ASSIGNMENT PROBLEM, solved to the provable minimum, a pure function of the cost matrix. It is PHI-adjacent — the appointments reference member encounters, so a determination is on the HIPAA audit path. The costs are an illustrative synthetic, NOT a certified interpreter-scheduling / workforce system (real interpreter scheduling weighs certification & specialty, modality, union & labor rules, travel logistics, and member language preference — not a bare cost matrix).",
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
        rosterRef: request.rosterRef,
        disposition: determination.disposition,
        totalCost: determination.totalCost,
        feasible: determination.feasible,
        assignedCount: summary.assignedCount,
        unmatchedCount: summary.unmatchedCount,
        interpreterCount: summary.interpreterCount,
        appointmentCount: summary.appointmentCount,
        requiresCoordinatorReview: summary.requiresCoordinatorReview,
        interpAssignmentSourced: sourced,
        interpAssignmentOptimal: optimal,
        interpNoAutonomousDispatch: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
