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
  type CaseloadBalancingDetermination,
  type CaseloadBalancingRequest,
  DEMO_CASELOAD_BALANCING_REQUEST,
  caseloadAssignmentComplete,
  caseloadBalancingSummary,
  caseloadCapacityRespected,
  caseloadNoAutonomousAssignment,
  evaluateCaseloadBalancing
} from "../../../../../lib/caseload-balancing";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "caseload-balancing-agent";

/**
 * Google A2A `tasks/send` endpoint for the Caseload Balancing (Care-Manager Panel Assignment) agent — a
 * care-coordination service on the patient / clinical plane that allocates a panel of members across the
 * care managers' finite capacity.
 *
 *   POST /api/agents/caseload-balancing/tasks
 *
 * Loads a caseload-balancing request and DETERMINISTICALLY evaluates it via evaluateCaseloadBalancing:
 * it runs a worst-fit-decreasing greedy bin-packing that places each member (in descending acuity) into
 * the manager with the greatest remaining capacity that can fit it, waitlisting the overflow. There is
 * no sliding-window count, no interval merge, no topological sort, no set-difference, no dollar
 * waterfall, no identity match, and no hash chain — it is greedy allocation under a capacity constraint,
 * a pure function of the members + managers. Every member is accounted for exactly once, no manager is
 * over capacity, and no assignment is committed — a care-management lead confirms every allocation. This
 * is a PHI-bearing agent (phiAccessed:true throughout). The panel is illustrative; real panel assignment
 * uses validated acuity instruments and care-manager fit.
 *
 * Enforced-block policies checked before any allocation leaves the fabric:
 *   - policy.caseload.assignment-complete (signal caseloadAssignmentComplete).
 *   - policy.caseload.capacity-respected (signal caseloadCapacityRespected).
 *   - policy.caseload.no-autonomous-assignment (signal caseloadNoAutonomousAssignment).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: CaseloadBalancingRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if every member is accounted for once, capacity is
 *   respected, and it is not auto-committed) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("caseload-balancing");
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
      ? (data.request as CaseloadBalancingRequest)
      : DEMO_CASELOAD_BALANCING_REQUEST;

  // Deterministic caseload-balancing allocation.
  const determination = evaluateCaseloadBalancing(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as CaseloadBalancingDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: assignment-complete + capacity-respected + no autonomous assignment.
  const assignmentComplete = caseloadAssignmentComplete(determinationForCheck);
  const capacityRespected = caseloadCapacityRespected(determinationForCheck);
  const noAutonomous = caseloadNoAutonomousAssignment(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      caseloadAssignmentComplete: assignmentComplete,
      caseloadCapacityRespected: capacityRespected,
      caseloadNoAutonomousAssignment: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "caseload.allocate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        caseloadAssignmentComplete: assignmentComplete,
        caseloadCapacityRespected: capacityRespected,
        caseloadNoAutonomousAssignment: noAutonomous,
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
          `Pause Agent Fabric blocked this caseload-balancing run: ${governance.blockingViolations
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

  const summary = caseloadBalancingSummary(determination);

  // Receive-panel span — the fabric records the panel it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "caseload.receive-panel",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      panelRef: request.panelRef,
      memberCount: determination.totalMembers,
      managerCount: summary.managerCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Allocate span — the greedy allocation, parented to the received panel.
  const allocateSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "caseload.allocate",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      assignedCount: determination.assignedCount,
      waitlistedCount: determination.waitlistedCount,
      caseloadAssignmentComplete: assignmentComplete,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Check-capacity span — the capacity check + disposition, parented to the allocation.
  const capacitySpan = recordInstantSpan({
    taskId,
    parentSpanId: allocateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "caseload.check-capacity",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      totalAssignedAcuity: determination.totalAssignedAcuity,
      totalCapacity: determination.totalCapacity,
      caseloadCapacityRespected: capacityRespected,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the allocation recorded to the audit trail, parented to the capacity check.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: capacitySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "caseload.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      caseloadNoAutonomousAssignment: noAutonomous,
      requiresCareLeadReview: determination.requiresCareLeadReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage =
    determination.disposition === "partially-assigned-waitlist"
      ? `Panel ${request.panelRef}: ${summary.assignedCount} of ${determination.totalMembers} member(s) assigned across ${summary.managerCount} manager(s); ${summary.waitlistedCount} waitlisted (panel acuity exceeds capacity) — a recommendation for a care-management lead, no assignment committed autonomously (synthetic — illustrative panel, NOT a certified caseload system).`
      : `Panel ${request.panelRef}: all ${determination.totalMembers} member(s) balanced across ${summary.managerCount} manager(s) within capacity (assigned acuity ${determination.totalAssignedAcuity} of ${determination.totalCapacity}) — a recommendation for a care-management lead, no assignment committed autonomously (synthetic — illustrative panel, NOT a certified caseload system).`;

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
        name: "CaseloadBalancingDetermination",
        description:
          "Deterministically-produced care-manager panel assignment. It runs a worst-fit-decreasing greedy bin-packing — processing the panel's members in descending acuity and placing each into the care manager with the greatest remaining capacity that can still fit it (tie-broken by id), waitlisting any member that does not fit within capacity. Every member is accounted for exactly once (the assigned set and the waitlisted set are disjoint and cover every member — no drop, no double-assignment), no manager is over capacity (each manager's assigned acuity equals the sum of their members' acuities and stays within capacity, and every waitlist is justified — the member's acuity exceeds every manager's final remaining capacity), and no assignment is ever committed — a care-management lead confirms every allocation. There is no sliding-window count, no interval merge, no topological sort, no set-difference, no dollar waterfall, no identity match, and no hash chain — it is greedy allocation under a capacity constraint, a pure function of the members + managers. This is a PHI-bearing agent — the members reference the patients on the panel. The members + managers + acuity + capacity are illustrative, NOT a certified caseload / staffing system — real panel assignment uses validated acuity instruments, care-manager licensure / specialty / language fit, and continuity of an existing relationship.",
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
        requestRef: request.requestRef,
        panelRef: determination.panelRef,
        disposition: determination.disposition,
        managerCount: summary.managerCount,
        assignedCount: determination.assignedCount,
        waitlistedCount: determination.waitlistedCount,
        totalAssignedAcuity: determination.totalAssignedAcuity,
        totalCapacity: determination.totalCapacity,
        requiresCareLeadReview: determination.requiresCareLeadReview,
        caseloadAssignmentComplete: assignmentComplete,
        caseloadCapacityRespected: capacityRespected,
        caseloadNoAutonomousAssignment: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
