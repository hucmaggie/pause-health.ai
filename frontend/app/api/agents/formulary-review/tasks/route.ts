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
  type FormularyReviewDecision,
  type FormularyReviewRequest,
  DEMO_PREFERRED_REQUEST,
  exceptionRequiresClinicianCosign,
  reviewFormularyRequest,
  rulesTraceToCatalog,
  stepTherapyIsHonored
} from "../../../../../lib/formulary-review";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "formulary-review-agent";

/**
 * Google A2A `tasks/send` endpoint for the Formulary & Drug Utilization
 * Review Agent — deterministic first-pass formulary + DUR pipeline.
 *
 *   POST /api/agents/formulary-review/tasks
 *
 * Enforced-block policies checked before the decision is returned:
 *   - policy.formulary.catalog-sourced (signal rulesTraceToCatalog)
 *   - policy.formulary.step-therapy-honored (signal stepTherapyIsHonored)
 *   - policy.formulary.no-autonomous-override (signal
 *     exceptionRequiresClinicianCosign)
 *
 * Input (data part):
 *   { request?: FormularyReviewRequest,
 *     decisionOverride?: FormularyReviewDecision } — the request is reviewed
 *   deterministically by default; a decisionOverride demonstrates the three
 *   governance blocks.
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
  const taskId = params.id || newTaskId("formulary");
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
      ? (data.request as FormularyReviewRequest)
      : DEMO_PREFERRED_REQUEST;

  // Ground-truth deterministic review.
  const decision = reviewFormularyRequest(request);

  // Governance-signal target — a caller-asserted override lets the fabric
  // demonstrate each block without altering the core computation.
  const decisionForCheck =
    data.decisionOverride && typeof data.decisionOverride === "object"
      ? (data.decisionOverride as FormularyReviewDecision)
      : decision;

  const catalogOk = rulesTraceToCatalog(decisionForCheck);
  // Step-therapy is enforced only when the produced decision is preferred-
  // approved (i.e. the agent claimed step therapy was satisfied). If the
  // produced decision is pend-step-therapy, the guard is trivially satisfied
  // because the agent isn't claiming step therapy is satisfied. This lets
  // the honest signal reflect the actual claim being made.
  const stepOk =
    decisionForCheck.decision === "preferred-approved"
      ? stepTherapyIsHonored({
          proposedDrugId: decisionForCheck.proposedDrugId,
          priorTherapy: request.priorTherapy
        })
      : true;
  const cosignOk = exceptionRequiresClinicianCosign(decisionForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      rulesTraceToCatalog: catalogOk,
      stepTherapyIsHonored: stepOk,
      exceptionRequiresClinicianCosign: cosignOk
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "formulary.review.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        memberRef: request.memberRef,
        rulesTraceToCatalog: catalogOk,
        stepTherapyIsHonored: stepOk,
        exceptionRequiresClinicianCosign: cosignOk,
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
          `Pause Agent Fabric blocked this formulary review: ${governance.blockingViolations
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

  // Evaluate span.
  const evaluateSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "formulary.evaluate-rules",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      memberRef: request.memberRef,
      proposedDrugId: request.proposedDrugId,
      appliedRuleCount: decision.appliedRules.length,
      rulesTraceToCatalog: catalogOk,
      stepTherapyIsHonored: stepOk,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Decide span.
  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "formulary.decide",
    protocol: "a2a",
    attributes: {
      decision: decision.decision,
      tier: String(decision.tier),
      primaryReasonCode: decision.primaryReasonCode,
      routedTo: decision.routedTo,
      requiresClinicianCosign: decision.requiresClinicianCosign,
      exceptionRequiresClinicianCosign: cosignOk,
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
        decision.decision === "preferred-approved"
          ? `Formulary review ${decision.requestRef} · preferred-approved · ${decision.proposedDrugLabel} · Tier ${decision.tier}.`
          : `Formulary review ${decision.requestRef} · ${decision.decision} · ${decision.proposedDrugLabel} · Tier ${decision.tier} · ${decision.primaryReasonCode} · routed to ${decision.routedTo} · ${decision.appliedRules.length} rule${decision.appliedRules.length === 1 ? "" : "s"} hit. DRAFTED for clinician cosign — the agent NEVER autonomously overrides a formulary exception. Synthetic — illustrative catalog + refs, not certified DUR.`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "FormularyReviewDecision",
        description:
          "Deterministically-produced formulary + DUR review — preferred-approved / pend-step-therapy / pend-quantity-limit / pend-interaction-review / pend-non-formulary with the tier, sorted applied rules, primary reason code, routing target, and clinician-cosign flags (requiresClinicianCosign:true / cosigned:false on every non-preferred decision — the agent NEVER autonomously overrides a formulary exception). The drug + rule + reason-code catalogs, step-therapy chains, and interaction pairs are illustrative/synthetic, NOT Medi-Span, First Databank, RxNorm, an actual payer's formulary file, or a certified DUR engine.",
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
        proposedDrugId: request.proposedDrugId,
        formularyDecision: decision.decision,
        tier: String(decision.tier),
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        appliedRuleCount: decision.appliedRules.length,
        requiresClinicianCosign: decision.requiresClinicianCosign,
        rulesTraceToCatalog: catalogOk,
        stepTherapyIsHonored: stepOk,
        exceptionRequiresClinicianCosign: cosignOk
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
