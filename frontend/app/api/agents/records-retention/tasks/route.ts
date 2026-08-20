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
  type RetentionDisposition,
  type RetentionRequest,
  DEMO_RETENTION_REQUEST,
  evaluateRetention,
  purgeHumanApproved,
  retentionRespectsLegalHold,
  retentionRuleCited,
  retentionSummary
} from "../../../../../lib/records-retention";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "records-retention-agent";

/**
 * Google A2A `tasks/send` endpoint for the Data Retention & Records Lifecycle
 * Management agent — the MuleSoft control-plane / data-substrate
 * records-management service, the records-disposition layer of the data substrate.
 *
 *   POST /api/agents/records-retention/tasks
 *
 * Loads the RECORD (type/category, patient, created/last-touched dates, patient
 * DOB, jurisdiction, and any active legal hold), DETERMINISTICALLY produces a
 * disposition recommendation via evaluateRetention (retain / eligible-for-purge /
 * hold), citing the governing retention rule + computed retention expiry. The
 * disposition is a pure function of the record's dates + the request's own atTime
 * (no randomness, no clock). It NEVER autonomously purges: an eligible-for-purge is
 * a RECOMMENDATION requiring human approval, and an active LEGAL HOLD ALWAYS
 * overrides a purge (a held record is `hold`, never eligible-for-purge). An
 * eligible-for-purge RECOMMENDATION is a SAFE, completed answer — NOT a block. The
 * retention schedules + periods + rule ids are illustrative/synthetic; real
 * retention is jurisdiction-specific and legally reviewed.
 *
 * Enforced-block policies checked before any disposition is acted on:
 *   - policy.retention.legal-hold-overrides-purge (signal retentionRespectsLegalHold)
 *     — never mark a record on active legal hold eligible-for-purge.
 *   - policy.retention.schedule-sourced (signal retentionRuleCited) — every
 *     disposition must cite a recorded retention rule.
 *   - policy.retention.no-autonomous-purge (signal purgeHumanApproved) — a purge is
 *     never autonomous; an eligible-for-purge is human-approval-gated.
 * A block returns HTTP 200 with a `failed` task. An eligible-for-purge
 * RECOMMENDATION (requiresHumanApproval:true) is NOT a block — it is a safe
 * completed answer.
 *
 * Input (data part):
 *   { record?: RetentionRequest, disposition?: object } — the record is evaluated;
 *   a caller-asserted `disposition` (admissible only if it respects an active legal
 *   hold, cites a recorded retention rule, and gates any purge on human approval)
 *   demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("retention");
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
    data.record && typeof data.record === "object"
      ? (data.record as RetentionRequest)
      : DEMO_RETENTION_REQUEST;

  // Deterministic records-disposition recommendation.
  const disposition = evaluateRetention(request);

  // The disposition the governance gates check: the caller-asserted disposition
  // (to demonstrate the blocks) or the produced recommendation.
  const assertedDisposition =
    data.disposition && typeof data.disposition === "object"
      ? (data.disposition as RetentionDisposition)
      : undefined;
  const dispositionForCheck = assertedDisposition ?? disposition;

  // Honest governance signals. A disposition must respect an active legal hold,
  // cite a recorded retention rule, and gate any purge on human approval.
  const respectsLegalHold = retentionRespectsLegalHold(dispositionForCheck);
  const ruleCited = retentionRuleCited(dispositionForCheck);
  const humanApprovedPurge = purgeHumanApproved(dispositionForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      retentionRespectsLegalHold: respectsLegalHold,
      retentionRuleCited: ruleCited,
      purgeHumanApproved: humanApprovedPurge
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "retention.evaluate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        recordId: request.recordId,
        patientRef: request.patientRef,
        retentionRespectsLegalHold: respectsLegalHold,
        retentionRuleCited: ruleCited,
        purgeHumanApproved: humanApprovedPurge,
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
          `Pause Agent Fabric blocked this records-disposition run: ${governance.blockingViolations
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

  const summary = retentionSummary(disposition);

  // Receive-record span — the fabric records the record it received for
  // disposition, parented under the caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "retention.receive-record",
    protocol: "a2a",
    attributes: {
      recordId: request.recordId,
      patientRef: request.patientRef,
      recordType: request.recordType,
      underLegalHold: disposition.underLegalHold,
      retentionRuleCited: ruleCited,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Evaluate span — the deterministic disposition against the retention schedule +
  // legal hold, parented to the received record.
  const evaluateSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "retention.evaluate",
    protocol: "a2a",
    attributes: {
      recommendation: disposition.recommendation,
      retentionRuleId: disposition.retentionRuleId,
      retentionExpiresAt: disposition.retentionExpiresAt,
      retentionRespectsLegalHold: respectsLegalHold,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Recommend span — the disposition recommendation (a purge is only ever a
  // recommendation requiring human approval), parented to the evaluation.
  const recommendSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "retention.recommend",
    protocol: "a2a",
    attributes: {
      recommendation: disposition.recommendation,
      requiresHumanApproval: disposition.requiresHumanApproval,
      purgeHumanApproved: humanApprovedPurge,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the disposition recorded to the audit trail, parented to the
  // recommendation. Every records-lifecycle decision is logged.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: recommendSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "retention.log-audit",
    protocol: "a2a",
    attributes: {
      recordId: request.recordId,
      recommendation: disposition.recommendation,
      retentionRuleId: disposition.retentionRuleId,
      underLegalHold: disposition.underLegalHold,
      requiresHumanApproval: disposition.requiresHumanApproval,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { disposition, recordId: request.recordId };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        disposition.recommendation === "eligible-for-purge"
          ? `Records disposition for ${request.recordId} (${request.recordType}): ELIGIBLE FOR PURGE under ${disposition.retentionRuleLabel} (retention expiry ${disposition.retentionExpiresAt}), with no active legal hold. This is a RECOMMENDATION requiring human approval — the agent never autonomously purges a record (synthetic — illustrative retention schedules, periods, and rule ids; real retention is jurisdiction-specific and legally reviewed).`
          : disposition.recommendation === "hold"
            ? `Records disposition for ${request.recordId} (${request.recordType}): HOLD under an active legal hold${
                request.legalHold?.holdId ? ` (${request.legalHold.holdId})` : ""
              } — a legal hold always overrides a purge, so the record is retained and never marked eligible-for-purge (cited rule ${disposition.retentionRuleLabel}, retention expiry ${disposition.retentionExpiresAt}) (synthetic — NOT a certified records-management system).`
            : `Records disposition for ${request.recordId} (${request.recordType}): RETAIN under ${disposition.retentionRuleLabel}${
                disposition.retentionExpiresAt
                  ? ` (retention expiry ${disposition.retentionExpiresAt})`
                  : ""
              } — within its retention period (synthetic — illustrative retention schedules; real retention is jurisdiction-specific and legally reviewed).`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "RetentionDisposition",
        description:
          "Deterministically-produced records-disposition recommendation for a record + patient. The recommendation is retain / eligible-for-purge / hold, citing the governing retention rule and the computed retention expiry. A purge is NEVER autonomous — an eligible-for-purge is a RECOMMENDATION requiring human approval (requiresHumanApproval:true) — and an active LEGAL HOLD ALWAYS overrides a purge (a held record is `hold`, never eligible-for-purge). An eligible-for-purge recommendation is a safe, completed answer (not a block, and never a deletion). The disposition is a pure function of the record's dates + the request's own atTime (no randomness, no clock). The retention schedules + periods + rule ids are illustrative/synthetic, NOT a certified records-management system — real retention is jurisdiction-specific and legally reviewed.",
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
        recordId: request.recordId,
        patientRef: request.patientRef,
        recordType: request.recordType,
        recommendation: disposition.recommendation,
        retentionRuleId: summary.retentionRuleId,
        retentionExpiresAt: summary.retentionExpiresAt,
        underLegalHold: disposition.underLegalHold,
        requiresHumanApproval: disposition.requiresHumanApproval,
        retentionRespectsLegalHold: respectsLegalHold,
        retentionRuleCited: ruleCited,
        purgeHumanApproved: humanApprovedPurge
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
