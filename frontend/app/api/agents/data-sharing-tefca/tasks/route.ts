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
  type DataSharingDecision,
  type DataSharingRequest,
  DEMO_DS_TPO_TREATMENT,
  evaluateDataSharing,
  participantIdentityVerified,
  purposesTraceToCatalog,
  releaseHonorsNonTpoConsent
} from "../../../../../lib/data-sharing-tefca";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "data-sharing-tefca-agent";

/**
 * Google A2A `tasks/send` endpoint for the Data-Sharing / TEFCA
 * Interoperability Agent. Deterministic classification of cross-org PHI
 * exchanges with participant-identity verification and consent-scope
 * gating for non-TPO purposes.
 *
 *   POST /api/agents/data-sharing-tefca/tasks
 *
 * Enforced-block policies:
 *   - policy.data-sharing.purpose-catalog-sourced (purposesTraceToCatalog)
 *   - policy.data-sharing.no-autonomous-non-tpo-release (releaseHonorsNonTpoConsent)
 *   - policy.data-sharing.participant-verified (participantIdentityVerified)
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
  const taskId = params.id || newTaskId("ds");
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
      ? (data.request as DataSharingRequest)
      : DEMO_DS_TPO_TREATMENT;

  const decision = evaluateDataSharing(request);

  const decisionForCheck =
    data.decisionOverride && typeof data.decisionOverride === "object"
      ? (data.decisionOverride as DataSharingDecision)
      : decision;

  const catalogOk = purposesTraceToCatalog(decisionForCheck);
  const consentOk = releaseHonorsNonTpoConsent(decisionForCheck);
  const participantOk = participantIdentityVerified(decisionForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      purposesTraceToCatalog: catalogOk,
      releaseHonorsNonTpoConsent: consentOk,
      participantIdentityVerified: participantOk
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "data-sharing-tefca.evaluate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        patientRef: request.patientRef,
        purposeId: request.purposeId,
        purposesTraceToCatalog: catalogOk,
        releaseHonorsNonTpoConsent: consentOk,
        participantIdentityVerified: participantOk,
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
          `Pause Agent Fabric blocked this data-sharing exchange: ${governance.blockingViolations
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
    operation: "data-sharing-tefca.evaluate-rules",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      patientRef: request.patientRef,
      networkId: request.networkId,
      purposeId: request.purposeId,
      appliedRuleCount: decision.appliedRules.length,
      purposesTraceToCatalog: catalogOk,
      participantIdentityVerified: participantOk,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "data-sharing-tefca.decide",
    protocol: "a2a",
    attributes: {
      decision: decision.decision,
      primaryReasonCode: decision.primaryReasonCode,
      routedTo: decision.routedTo,
      isTpo: decision.isTpo,
      requiresPrivacyOfficerCosign: decision.requiresPrivacyOfficerCosign,
      releaseHonorsNonTpoConsent: consentOk,
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
        decision.decision === "release-authorized"
          ? `Data-sharing ${decision.requestRef} · RELEASE-AUTHORIZED · ${decision.purposeLabel} over ${decision.networkLabel} · routed to auto-release.`
          : `Data-sharing ${decision.requestRef} · ${decision.decision} · ${decision.primaryReasonCode} · routed to ${decision.routedTo}. ` +
            (decision.decision === "blocked-consent-required-non-tpo"
              ? "BLOCKED — non-TPO release without consent (HIPAA §164.506)."
              : decision.decision === "blocked-non-catalog-purpose"
              ? "BLOCKED — off-catalog exchange purpose."
              : decision.decision === "blocked-participant-unverified"
              ? "BLOCKED — requester identity not attested (45 CFR 171 / TEFCA)."
              : "PENDING — privacy-officer review required."),
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "DataSharingDecision",
        description:
          "Deterministically-produced data-sharing / TEFCA decision — release-authorized / pend-purpose-verification / blocked-non-catalog-purpose / blocked-participant-unverified / blocked-consent-required-non-tpo with the applied catalog rules, HIPAA-§164.506 TPO flag, primary reason code, routing target (auto-release / privacy-officer-review / consent-capture / participant-registry-verification / blocked-hold), and cosign flags (requiresPrivacyOfficerCosign:true / cosigned:false on every non-release decision — the agent NEVER autonomously releases PHI for a non-TPO purpose without consent). The exchange-network catalog, exchange-purpose catalog, rules, and reason codes are illustrative/synthetic, NOT an actual TEFCA QHIN implementation, the Carequality Interoperability Framework, or a certified ONC data-sharing gateway.",
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
        requesterRef: request.requesterRef,
        networkId: request.networkId,
        purposeId: request.purposeId,
        dataSharingDecision: decision.decision,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        isTpo: decision.isTpo,
        appliedRuleCount: decision.appliedRules.length,
        requiresPrivacyOfficerCosign: decision.requiresPrivacyOfficerCosign,
        purposesTraceToCatalog: catalogOk,
        releaseHonorsNonTpoConsent: consentOk,
        participantIdentityVerified: participantOk
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
