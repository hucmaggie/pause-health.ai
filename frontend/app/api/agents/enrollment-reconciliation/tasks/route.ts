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
  type EnrollmentReconciliationDetermination,
  type EnrollmentReconciliationRequest,
  DEMO_ENROLLMENT_RECONCILIATION_REQUEST,
  enrollmentReconciliationSummary,
  evaluateEnrollmentReconciliation,
  reconciliationActionsSourced,
  reconciliationComplete,
  reconciliationNoAutonomousChange
} from "../../../../../lib/enrollment-reconciliation";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "enrollment-reconciliation-agent";

/**
 * Google A2A `tasks/send` endpoint for the Eligibility & Enrollment (834) Reconciliation agent — a
 * claims / payer-operations service on the payer & plan operations plane that reconciles a group's
 * source-of-truth roster against the carrier's current roster.
 *
 *   POST /api/agents/enrollment-reconciliation/tasks
 *
 * Loads a reconciliation request and DETERMINISTICALLY evaluates it via
 * evaluateEnrollmentReconciliation: it keys both rosters by member id, walks the union, and classifies
 * each member (enroll / terminate / update / no-change). There is no dollar waterfall, no identity
 * match, and no ratio — it is a keyed set-difference + a field-level comparison, a pure function of the
 * two rosters. Every member is accounted for exactly once, every action is sourced (no fabricated
 * discrepancy), and no enrollment change is applied — a benefits administrator posts every action.
 * This is a PHI-bearing agent (phiAccessed:true throughout). The rosters are illustrative; real
 * reconciliation uses the full X12 834 transaction set and the carrier's eligibility system.
 *
 * Enforced-block policies checked before any determination leaves the fabric:
 *   - policy.enrollment.reconciliation-complete (signal reconciliationComplete).
 *   - policy.enrollment.actions-sourced (signal reconciliationActionsSourced).
 *   - policy.enrollment.no-autonomous-change (signal reconciliationNoAutonomousChange).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: EnrollmentReconciliationRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if it is complete, its actions are sourced, and
 *   it is not auto-applied) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("enrollment-reconciliation");
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
      ? (data.request as EnrollmentReconciliationRequest)
      : DEMO_ENROLLMENT_RECONCILIATION_REQUEST;

  // Deterministic reconciliation.
  const determination = evaluateEnrollmentReconciliation(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as EnrollmentReconciliationDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: complete + actions-sourced + no autonomous change.
  const complete = reconciliationComplete(determinationForCheck);
  const actionsSourced = reconciliationActionsSourced(determinationForCheck);
  const noAutonomous = reconciliationNoAutonomousChange(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      reconciliationComplete: complete,
      reconciliationActionsSourced: actionsSourced,
      reconciliationNoAutonomousChange: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "enrollment.diff-rosters.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        reconciliationComplete: complete,
        reconciliationActionsSourced: actionsSourced,
        reconciliationNoAutonomousChange: noAutonomous,
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
          `Pause Agent Fabric blocked this enrollment-reconciliation run: ${governance.blockingViolations
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

  const summary = enrollmentReconciliationSummary(determination);

  // Receive-rosters span — the fabric records the reconciliation request it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "enrollment.receive-rosters",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      groupRef: request.groupRef,
      totalMembers: determination.totalMembers,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Diff-rosters span — the per-kind counts, parented to the received rosters.
  const diffSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "enrollment.diff-rosters",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      enroll: determination.counts.enroll,
      terminate: determination.counts.terminate,
      update: determination.counts.update,
      noChange: determination.counts.noChange,
      reconciliationComplete: complete,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-actions span — the sourced actions, parented to the diff.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: diffSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "enrollment.classify-actions",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      reconciliationActionsSourced: actionsSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the classification.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "enrollment.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      totalMembers: determination.totalMembers,
      reconciliationNoAutonomousChange: noAutonomous,
      requiresBenefitsAdminReview: determination.requiresBenefitsAdminReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const c = determination.counts;
  const completedMessage = `Reconciliation ${request.requestRef} for ${request.groupRef}: ${determination.totalMembers} member(s) — ${c.enroll} enroll, ${c.terminate} terminate, ${c.update} update, ${c.noChange} no-change — a recommendation for a benefits administrator, no enrollment change applied autonomously (synthetic — illustrative rosters, NOT a certified 834 / enrollment system).`;

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
        name: "EnrollmentReconciliationDetermination",
        description:
          "Deterministically-produced eligibility & enrollment (834) reconciliation. It keys the group's source-of-truth roster (the employer / HR feed) and the carrier's current roster by member id, walks the union, and classifies each member — enroll (in source only), terminate (in carrier only), update (in both with a differing compared field, listing the field deltas), no-change (identical). Every member present in either roster is accounted for exactly once (no member dropped, duplicated, or miscounted), every action is sourced (every update carries a genuinely-differing field, no fabricated discrepancy), and no enrollment change is ever applied to the system of record — a benefits administrator confirms and posts every action. There is no dollar waterfall, no identity match, and no ratio — it is a keyed set-difference + a field-level comparison, a pure function of the two rosters. This is a PHI-bearing agent — the rosters reference members and their coverage. The rosters + compared fields are illustrative, NOT a certified 834 / enrollment system — real reconciliation uses the full X12 834 transaction set, effective-dating / retroactivity rules, dependent / COBRA / qualifying-event handling, and the carrier's eligibility system.",
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
        groupRef: determination.groupRef,
        totalMembers: determination.totalMembers,
        enroll: c.enroll,
        terminate: c.terminate,
        update: c.update,
        noChange: c.noChange,
        requiresBenefitsAdminReview: determination.requiresBenefitsAdminReview,
        reconciliationComplete: complete,
        reconciliationActionsSourced: actionsSourced,
        reconciliationNoAutonomousChange: noAutonomous,
        summaryTotal: summary.totalMembers
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
