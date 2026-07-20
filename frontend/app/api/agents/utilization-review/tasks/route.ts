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
  type UtilizationReviewDecision,
  type UtilizationReviewRequest,
  DEMO_UR_APPROVE,
  criteriaTraceToCatalog,
  denialRequiresClinicianCosign,
  reviewUtilization,
  slaTracesToCatalog
} from "../../../../../lib/utilization-review";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "utilization-review-agent";

/**
 * Google A2A `tasks/send` endpoint for the Utilization Review Agent.
 * Deterministic pre-service medical-necessity screen with clinician cosign
 * for every non-approved decision and catalog-sourced SLA deadlines.
 *
 *   POST /api/agents/utilization-review/tasks
 *
 * Enforced-block policies:
 *   - policy.ur.criteria-catalog-sourced (criteriaTraceToCatalog)
 *   - policy.ur.no-autonomous-denial (denialRequiresClinicianCosign)
 *   - policy.ur.sla-integrity (slaTracesToCatalog)
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
  const taskId = params.id || newTaskId("ur");
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
      ? (data.request as UtilizationReviewRequest)
      : DEMO_UR_APPROVE;

  const decision = reviewUtilization(request);

  const decisionForCheck =
    data.decisionOverride && typeof data.decisionOverride === "object"
      ? (data.decisionOverride as UtilizationReviewDecision)
      : decision;

  const catalogOk = criteriaTraceToCatalog(decisionForCheck);
  const cosignOk = denialRequiresClinicianCosign(decisionForCheck);
  const slaOk = slaTracesToCatalog(decisionForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      criteriaTraceToCatalog: catalogOk,
      denialRequiresClinicianCosign: cosignOk,
      slaTracesToCatalog: slaOk
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "utilization-review.evaluate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        memberRef: request.memberRef,
        criteriaTraceToCatalog: catalogOk,
        denialRequiresClinicianCosign: cosignOk,
        slaTracesToCatalog: slaOk,
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
          `Pause Agent Fabric blocked this utilization-review case: ${governance.blockingViolations
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

  const evaluateSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "utilization-review.evaluate-criteria",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      memberRef: request.memberRef,
      serviceTypeId: request.serviceTypeId,
      appliedRuleCount: decision.appliedRules.length,
      criteriaMissingCount: decision.criteriaMissing.length,
      criteriaTraceToCatalog: catalogOk,
      slaTracesToCatalog: slaOk,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "utilization-review.decide",
    protocol: "a2a",
    attributes: {
      decision: decision.decision,
      primaryReasonCode: decision.primaryReasonCode,
      routedTo: decision.routedTo,
      slaWindowHours: decision.slaWindowHours,
      requiresClinicianCosign: decision.requiresClinicianCosign,
      denialRequiresClinicianCosign: cosignOk,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { decision };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        decision.decision === "approves-meets-criteria"
          ? `UR case ${decision.requestRef} · APPROVES-MEETS-CRITERIA · all required criteria met for ${decision.serviceTypeLabel}.`
          : `UR case ${decision.requestRef} · ${decision.decision} · ${decision.primaryReasonCode} · routed to ${decision.routedTo} · SLA ${decision.slaWindowHours}h · ${decision.appliedRules.length} rule${decision.appliedRules.length === 1 ? "" : "s"} hit. ` +
            (decision.decision === "blocked-non-covered"
              ? "BLOCKED — non-covered service; appeal via Grievance & Appeals."
              : "DRAFTED for clinician cosign — the agent NEVER autonomously denies a UR case. Synthetic — illustrative criteria catalog, not certified UR."),
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "UtilizationReviewDecision",
        description:
          "Deterministically-produced utilization-review decision — approves-meets-criteria / pend-for-clinical-review / require-peer-to-peer / blocked-non-covered with the applied catalog rules, per-criterion met/missing lists, primary reason code, routing target (auto-approve / clinical-reviewer-queue / peer-to-peer-scheduling / blocked-non-covered-appeal), catalog-sourced SLA deadline (standard 72h / urgent 24h / concurrent-review 24h), and cosign flags (requiresClinicianCosign:true / cosigned:false on every non-approved decision — the agent NEVER autonomously denies). The service-type catalog, criteria sets, rules, reason codes, and SLA windows are illustrative/synthetic, NOT MCG (Milliman Care Guidelines / Indicia), InterQual, or a real payer's UR rule set.",
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
        traceSpanId: decideSpan.id,
        traceTaskId: taskId,
        requestRef: request.requestRef,
        memberRef: request.memberRef,
        serviceTypeId: request.serviceTypeId,
        urgency: request.urgency,
        urDecision: decision.decision,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        slaWindowHours: decision.slaWindowHours,
        slaDeadline: decision.slaDeadline,
        appliedRuleCount: decision.appliedRules.length,
        criteriaMetCount: decision.criteriaMet.length,
        criteriaMissingCount: decision.criteriaMissing.length,
        requiresClinicianCosign: decision.requiresClinicianCosign,
        criteriaTraceToCatalog: catalogOk,
        denialRequiresClinicianCosign: cosignOk,
        slaTracesToCatalog: slaOk
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
