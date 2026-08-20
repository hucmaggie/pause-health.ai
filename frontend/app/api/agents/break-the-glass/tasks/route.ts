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
  type EmergencyAccessDecision,
  type EmergencyAccessRequest,
  DEMO_EMERGENCY_ACCESS_REQUEST,
  accessHasJustification,
  accessIsMinimumNecessaryTimeBoxed,
  accessLoggedForReview,
  emergencyAccessSummary,
  evaluateEmergencyAccess
} from "../../../../../lib/break-the-glass";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "break-the-glass-agent";

/**
 * Google A2A `tasks/send` endpoint for the Break-the-Glass / Emergency Access
 * Governance agent — the MuleSoft control-plane / data-substrate security service,
 * the emergency-access governance layer of the data substrate.
 *
 *   POST /api/agents/break-the-glass/tasks
 *
 * Loads the emergency-access REQUEST (requester role, target patient, stated
 * purpose, emergency flag, free-text clinical justification), DETERMINISTICALLY
 * decides whether to grant emergency access via evaluateEmergencyAccess, and if so
 * returns a TIME-BOXED, MINIMUM-NECESSARY grant (a scoped field set + a derived
 * expiry), ALWAYS emitting a mandatory audit event and flagging the grant for
 * post-access review. The decision is a pure function of the request + its own
 * atTime (no randomness, no clock). It NEVER grants standing / broad / full-record
 * access and never grants without a recorded justification. A DENY (no emergency,
 * no justification, or an off-catalog purpose) is a SAFE, completed answer — NOT a
 * block. The purpose catalog + scopes + durations + audit ids are
 * illustrative/synthetic, NOT a certified break-the-glass system.
 *
 * Enforced-block policies checked before any grant is acted on:
 *   - policy.btg.justification-required (signal accessHasJustification) — no
 *     emergency access is granted without a recorded, non-empty justification.
 *   - policy.btg.minimum-necessary-time-boxed (signal
 *     accessIsMinimumNecessaryTimeBoxed) — a grant must be minimum-necessary AND
 *     time-boxed (never standing / full-record / non-expiring).
 *   - policy.btg.mandatory-audit-review (signal accessLoggedForReview) — every
 *     emergency access must be logged AND flagged for post-access review.
 * A block returns HTTP 200 with a `failed` task. A DENY (granted:false) is NOT a
 * block — it is a safe completed answer.
 *
 * Input (data part):
 *   { request?: EmergencyAccessRequest, grant?: object } — the request is
 *   evaluated; a caller-asserted `grant` (admissible only if it carries a
 *   justification, is minimum-necessary + time-boxed, and is logged for review)
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
  const taskId = params.id || newTaskId("btg");
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
      ? (data.request as EmergencyAccessRequest)
      : DEMO_EMERGENCY_ACCESS_REQUEST;

  // Deterministic emergency-access decision.
  const decision = evaluateEmergencyAccess(request);

  // The decision the governance gates check: the caller-asserted grant (to
  // demonstrate the blocks) or the produced decision.
  const assertedGrant =
    data.grant && typeof data.grant === "object"
      ? (data.grant as EmergencyAccessDecision)
      : undefined;
  const decisionForCheck = assertedGrant ?? decision;

  // Honest governance signals. A grant must carry a recorded justification, be
  // minimum-necessary + time-boxed, and be logged for post-access review.
  const hasJustification = accessHasJustification(decisionForCheck);
  const minimumNecessaryTimeBoxed = accessIsMinimumNecessaryTimeBoxed(decisionForCheck);
  const loggedForReview = accessLoggedForReview(decisionForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      accessHasJustification: hasJustification,
      accessIsMinimumNecessaryTimeBoxed: minimumNecessaryTimeBoxed,
      accessLoggedForReview: loggedForReview
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "btg.evaluate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: request.patientRef,
        accessHasJustification: hasJustification,
        accessIsMinimumNecessaryTimeBoxed: minimumNecessaryTimeBoxed,
        accessLoggedForReview: loggedForReview,
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
          `Pause Agent Fabric blocked this emergency-access run: ${governance.blockingViolations
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

  const summary = emergencyAccessSummary(decision);

  // Receive-request span — the fabric records the emergency-access request it
  // received, parented under the caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "btg.receive-request",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      requesterRole: request.requesterRole,
      purpose: request.purpose,
      emergency: request.emergency === true,
      accessHasJustification: hasJustification,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Evaluate span — the deterministic grant/deny decision, parented to the request.
  const evaluateSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "btg.evaluate",
    protocol: "a2a",
    attributes: {
      granted: decision.granted,
      accessIsMinimumNecessaryTimeBoxed: minimumNecessaryTimeBoxed,
      accessHasJustification: hasJustification,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Grant-scoped span — the minimum-necessary, time-boxed scope, parented to the
  // decision it follows from. A grant is never standing / full-record.
  const grantSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "btg.grant-scoped",
    protocol: "a2a",
    attributes: {
      granted: decision.granted,
      grantedFieldCount: summary.grantedFieldCount,
      durationMinutes: summary.durationMinutes,
      expiresAt: summary.expiresAt,
      accessIsMinimumNecessaryTimeBoxed: minimumNecessaryTimeBoxed,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the mandatory audit event flagged for post-access review,
  // parented to the grant. Every access (grant OR deny) is logged.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: grantSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "btg.log-audit",
    protocol: "a2a",
    attributes: {
      auditEventId: summary.auditEventId,
      requiresPostAccessReview: decision.requiresPostAccessReview,
      accessLoggedForReview: loggedForReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { decision, patientRef: request.patientRef };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        decision.granted
          ? `Break-the-glass emergency access for ${request.patientRef} by ${request.requesterRole} GRANTED (${request.purpose}): a minimum-necessary grant scoped to ${decision.grantedScope.length} field${
              decision.grantedScope.length === 1 ? "" : "s"
            } (${decision.grantedScope.join(", ")}), time-boxed to ${decision.durationMinutes} minutes (expires ${decision.expiresAt}), logged (audit ${decision.auditEventId}) and flagged for mandatory post-access review. It is never a standing / broad / full-record grant, and never granted without a recorded justification (synthetic — illustrative purpose catalog, scopes, durations, and audit ids, NOT a certified break-the-glass system).`
          : `Break-the-glass emergency access for ${request.patientRef} by ${request.requesterRole} DENIED (${request.purpose}): ${decision.reason}. The attempt is logged (audit ${decision.auditEventId}). A deny is a safe answer, not a block (synthetic — NOT a certified break-the-glass system).`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "EmergencyAccessDecision",
        description:
          "Deterministically-produced emergency break-the-glass access decision for a requester + patient + purpose. A grant is ALWAYS a TIME-BOXED, MINIMUM-NECESSARY access (a scoped field set — never the full chart — plus a derived expiry), carries a recorded clinical justification, emits a mandatory audit event, and is flagged for mandatory post-access review; there is never a standing / broad / full-record grant. A DENY (no emergency, no recorded justification, or an off-catalog purpose) is a safe, completed answer (not a block). The decision is a pure function of the request + its own atTime (no randomness, no clock). The purpose catalog + minimum-necessary scopes + access durations + audit ids are illustrative/synthetic, NOT a certified break-the-glass / emergency-access system.",
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
        patientRef: request.patientRef,
        granted: decision.granted,
        purpose: request.purpose,
        grantedFieldCount: summary.grantedFieldCount,
        durationMinutes: summary.durationMinutes,
        expiresAt: summary.expiresAt,
        auditEventId: summary.auditEventId,
        requiresPostAccessReview: decision.requiresPostAccessReview,
        accessHasJustification: hasJustification,
        accessIsMinimumNecessaryTimeBoxed: minimumNecessaryTimeBoxed,
        accessLoggedForReview: loggedForReview
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
