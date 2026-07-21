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
  type HandoffDecision,
  type HandoffRequest,
  DEMO_HANDOFF_ACCEPTED,
  evaluateHandoff,
  handoffHasConsent,
  receivingClinicianIsCredentialed,
  sbarIsComplete
} from "../../../../../lib/care-coordination-handoff";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "care-coordination-handoff-agent";

/**
 * Google A2A `tasks/send` endpoint for the Care Coordination Handoff Agent.
 * Deterministic SBAR assembly + receiving-clinician credentialing check +
 * transfer-consent gate for any cross-setting patient transition.
 *
 *   POST /api/agents/care-coordination-handoff/tasks
 *
 * Enforced-block policies:
 *   - policy.handoff.sbar-completeness (sbarIsComplete)
 *   - policy.handoff.receiving-clinician-credentialed (receivingClinicianIsCredentialed)
 *   - policy.handoff.consent-on-file (handoffHasConsent)
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
  const taskId = params.id || newTaskId("ho");
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
      ? (data.request as HandoffRequest)
      : DEMO_HANDOFF_ACCEPTED;

  const decision = evaluateHandoff(request);

  const decisionForCheck =
    data.decisionOverride && typeof data.decisionOverride === "object"
      ? (data.decisionOverride as HandoffDecision)
      : decision;

  const sbarOk = sbarIsComplete(decisionForCheck);
  const credentialedOk = receivingClinicianIsCredentialed(decisionForCheck);
  const consentOk = handoffHasConsent(decisionForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      sbarIsComplete: sbarOk,
      receivingClinicianIsCredentialed: credentialedOk,
      handoffHasConsent: consentOk
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "care-coordination-handoff.evaluate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        patientRef: request.patientRef,
        transitionTypeId: request.transitionTypeId,
        sbarIsComplete: sbarOk,
        receivingClinicianIsCredentialed: credentialedOk,
        handoffHasConsent: consentOk,
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
          `Pause Agent Fabric blocked this handoff: ${governance.blockingViolations
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
    operation: "care-coordination-handoff.evaluate-rules",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      patientRef: request.patientRef,
      transitionTypeId: request.transitionTypeId,
      appliedRuleCount: decision.appliedRules.length,
      missingSbarCount: decision.missingSbarSections.length,
      sbarIsComplete: sbarOk,
      receivingClinicianIsCredentialed: credentialedOk,
      handoffHasConsent: consentOk,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "care-coordination-handoff.decide",
    protocol: "a2a",
    attributes: {
      decision: decision.decision,
      primaryReasonCode: decision.primaryReasonCode,
      routedTo: decision.routedTo,
      requiresReceivingClinicianCosign: decision.requiresReceivingClinicianCosign,
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
        decision.decision === "handoff-accepted"
          ? `Handoff ${decision.requestRef} · ACCEPTED · ${decision.transitionTypeLabel} · routed to receiving-clinician-inbox for cosign.`
          : `Handoff ${decision.requestRef} · ${decision.decision} · ${decision.primaryReasonCode} · routed to ${decision.routedTo}. ` +
            (decision.decision === "blocked-no-consent"
              ? "BLOCKED — transfer consent missing (HIPAA)."
              : decision.decision === "blocked-clinician-not-credentialed"
              ? "BLOCKED — receiving clinician not credentialed (Section 1557 / ghost-network guard)."
              : "PENDING — SBAR completion required (Joint Commission NPSG-2)."),
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "HandoffDecision",
        description:
          "Deterministically-produced cross-setting handoff decision — handoff-accepted / pend-sbar-incomplete / blocked-clinician-not-credentialed / blocked-no-consent with the applied catalog rules, missing-SBAR-sections list, primary reason code, routing target (receiving-clinician-inbox / sending-clinician-completion / credentialing-remediation / consent-capture), and cosign flags (requiresReceivingClinicianCosign:true / cosigned:false on every accepted handoff — the agent NEVER autonomously accepts on behalf of the receiving clinician). The care-setting catalog, transition-type catalog, SBAR rule set, and reason codes are illustrative/synthetic, NOT Epic Care Everywhere, Cerner CareAware, or a real health system's handoff protocol.",
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
        patientRef: request.patientRef,
        transitionTypeId: request.transitionTypeId,
        receivingClinicianRef: request.receivingClinicianRef,
        handoffDecision: decision.decision,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        missingSbarCount: decision.missingSbarSections.length,
        appliedRuleCount: decision.appliedRules.length,
        requiresReceivingClinicianCosign: decision.requiresReceivingClinicianCosign,
        sbarIsComplete: sbarOk,
        receivingClinicianIsCredentialed: credentialedOk,
        handoffHasConsent: consentOk
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
