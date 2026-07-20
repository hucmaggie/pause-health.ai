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
  type TrialPaymentDecision,
  type TrialPaymentRequest,
  DEMO_STANDARD_PAYMENT,
  deviationRequiresCoordinatorCosign,
  evaluatePayment,
  paymentHasParticipantConsent,
  paymentsTraceToCatalog
} from "../../../../../lib/trial-payments";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "trial-payments-agent";

/**
 * Google A2A `tasks/send` endpoint for the Clinical Trial Payments &
 * Stipends Agent. Deterministic payment computation with study-coordinator
 * cosign for any non-standard payment.
 *
 *   POST /api/agents/trial-payments/tasks
 *
 * Enforced-block policies:
 *   - policy.trial-payments.schedule-catalog-sourced (paymentsTraceToCatalog)
 *   - policy.trial-payments.no-autonomous-irb-deviation (deviationRequiresCoordinatorCosign)
 *   - policy.trial-payments.participant-consented (paymentHasParticipantConsent)
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
  const taskId = params.id || newTaskId("tp");
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
      ? (data.request as TrialPaymentRequest)
      : DEMO_STANDARD_PAYMENT;

  const decision = evaluatePayment(request);

  const decisionForCheck =
    data.decisionOverride && typeof data.decisionOverride === "object"
      ? (data.decisionOverride as TrialPaymentDecision)
      : decision;

  const catalogOk = paymentsTraceToCatalog(decisionForCheck);
  const cosignOk = deviationRequiresCoordinatorCosign(decisionForCheck);
  const consentOk = paymentHasParticipantConsent({
    decision: decisionForCheck.decision,
    hasResearchPaymentConsent: request.hasResearchPaymentConsent
  });

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      paymentsTraceToCatalog: catalogOk,
      deviationRequiresCoordinatorCosign: cosignOk,
      paymentHasParticipantConsent: consentOk
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "trial-payments.evaluate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        participantRef: request.participantRef,
        paymentsTraceToCatalog: catalogOk,
        deviationRequiresCoordinatorCosign: cosignOk,
        paymentHasParticipantConsent: consentOk,
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
          `Pause Agent Fabric blocked this trial-payment: ${governance.blockingViolations
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
    operation: "trial-payments.evaluate-rules",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      participantRef: request.participantRef,
      trialId: request.trialId,
      appliedRuleCount: decision.appliedRules.length,
      paymentsTraceToCatalog: catalogOk,
      paymentHasParticipantConsent: consentOk,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "trial-payments.decide",
    protocol: "a2a",
    attributes: {
      decision: decision.decision,
      stipendAmountCents: decision.stipendAmountCents,
      travelReimbursementCents: decision.travelReimbursementCents,
      primaryReasonCode: decision.primaryReasonCode,
      routedTo: decision.routedTo,
      requiresCoordinatorCosign: decision.requiresCoordinatorCosign,
      deviationRequiresCoordinatorCosign: cosignOk,
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
        decision.decision === "schedule-approved"
          ? `Trial payment ${decision.requestRef} · SCHEDULE-APPROVED · $${(decision.stipendAmountCents / 100).toFixed(2)} stipend + $${(decision.travelReimbursementCents / 100).toFixed(2)} travel.`
          : `Trial payment ${decision.requestRef} · ${decision.decision} · ${decision.primaryReasonCode} · routed to ${decision.routedTo} · ${decision.appliedRules.length} rule${decision.appliedRules.length === 1 ? "" : "s"} hit. ` +
            (decision.decision === "blocked-no-consent"
              ? "BLOCKED — no participant consent (45 CFR 46)."
              : "DRAFTED for study-coordinator cosign — the agent NEVER autonomously deviates from IRB. Synthetic — illustrative catalog + refs, not certified trial payments."),
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "TrialPaymentDecision",
        description:
          "Deterministically-produced trial-payment decision — schedule-approved / pend-coordinator-review / blocked-no-consent with computed stipend + travel amounts, sorted applied catalog rules, primary reason code, routing target (schedule-auto-pay / study-coordinator-review / blocked-hold), and cosign flags (requiresCoordinatorCosign:true / cosigned:false on every non-schedule-approved decision — the agent NEVER autonomously deviates from an IRB-approved schedule). The trial schedule catalog, visit types, rules, and reason codes are illustrative/synthetic, NOT IRBNet / WCG IRB / Advarra IRB or an actual sponsor's payment protocol.",
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
        participantRef: request.participantRef,
        trialId: request.trialId,
        visitTypeId: request.visitTypeId,
        trialPaymentDecision: decision.decision,
        stipendAmountCents: decision.stipendAmountCents,
        travelReimbursementCents: decision.travelReimbursementCents,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        appliedRuleCount: decision.appliedRules.length,
        requiresCoordinatorCosign: decision.requiresCoordinatorCosign,
        paymentsTraceToCatalog: catalogOk,
        deviationRequiresCoordinatorCosign: cosignOk,
        paymentHasParticipantConsent: consentOk
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
