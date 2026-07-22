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
  type AdverseEventDecision,
  type AdverseEventRequest,
  DEMO_AE_MEDWATCH_DRUG,
  evaluateAdverseEvent,
  eventsTraceToCatalog,
  reporterIdentityVerified,
  submissionRequiresRegulatoryTeamCosign
} from "../../../../../lib/adverse-event-reporting";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "adverse-event-reporting-agent";

/**
 * Google A2A `tasks/send` endpoint for the Adverse Event Reporting Agent.
 * Deterministic classification of drug ADRs / vaccine reactions / device
 * malfunctions / medication errors / therapeutic failures into MedWatch
 * or VAERS drafts, with regulatory-team cosign for every FDA submission.
 *
 *   POST /api/agents/adverse-event-reporting/tasks
 *
 * Enforced-block policies:
 *   - policy.adverse-event.event-catalog-sourced (eventsTraceToCatalog)
 *   - policy.adverse-event.no-autonomous-submission (submissionRequiresRegulatoryTeamCosign)
 *   - policy.adverse-event.reporter-verified (reporterIdentityVerified)
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
  const taskId = params.id || newTaskId("ae");
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
      ? (data.request as AdverseEventRequest)
      : DEMO_AE_MEDWATCH_DRUG;

  const decision = evaluateAdverseEvent(request);

  const decisionForCheck =
    data.decisionOverride && typeof data.decisionOverride === "object"
      ? (data.decisionOverride as AdverseEventDecision)
      : decision;

  const catalogOk = eventsTraceToCatalog(decisionForCheck);
  const cosignOk = submissionRequiresRegulatoryTeamCosign(decisionForCheck);
  const reporterOk = reporterIdentityVerified(decisionForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      eventsTraceToCatalog: catalogOk,
      submissionRequiresRegulatoryTeamCosign: cosignOk,
      reporterIdentityVerified: reporterOk
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "adverse-event-reporting.evaluate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        patientRef: request.patientRef,
        eventTypeId: request.eventTypeId,
        eventsTraceToCatalog: catalogOk,
        submissionRequiresRegulatoryTeamCosign: cosignOk,
        reporterIdentityVerified: reporterOk,
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
          `Pause Agent Fabric blocked this adverse-event report: ${governance.blockingViolations
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
    operation: "adverse-event-reporting.evaluate-rules",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      patientRef: request.patientRef,
      eventTypeId: request.eventTypeId,
      seriousnessTierId: decision.seriousnessTierId,
      appliedRuleCount: decision.appliedRules.length,
      eventsTraceToCatalog: catalogOk,
      reporterIdentityVerified: reporterOk,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "adverse-event-reporting.decide",
    protocol: "a2a",
    attributes: {
      decision: decision.decision,
      primaryReasonCode: decision.primaryReasonCode,
      routedTo: decision.routedTo,
      requiresRegulatoryTeamCosign: decision.requiresRegulatoryTeamCosign,
      submissionRequiresRegulatoryTeamCosign: cosignOk,
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
        decision.decision === "draft-medwatch"
          ? `Adverse event ${decision.requestRef} · DRAFT-MEDWATCH · ${decision.eventTypeLabel} · seriousness ${decision.seriousnessTierLabel} · routed to regulatory-team queue for cosign.`
          : decision.decision === "draft-vaers"
          ? `Adverse event ${decision.requestRef} · DRAFT-VAERS · ${decision.eventTypeLabel} · seriousness ${decision.seriousnessTierLabel} · routed to regulatory-team queue for cosign.`
          : decision.decision === "blocked-non-catalog-event"
          ? `Adverse event ${decision.requestRef} · BLOCKED — non-catalog event type ${request.eventTypeId}.`
          : `Adverse event ${decision.requestRef} · BLOCKED — reporter identity unverified.`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "AdverseEventDecision",
        description:
          "Deterministically-produced adverse-event decision — draft-medwatch / draft-vaers / blocked-non-catalog-event / blocked-reporter-unverified with the applied catalog rules, 21-CFR-314.80 seriousness tier, primary reason code, routing target (regulatory-team MedWatch or VAERS queue / blocked-hold), and cosign flags (requiresRegulatoryTeamCosign:true / cosigned:false on every draft — the agent NEVER autonomously files to the FDA). The event-type catalog, seriousness tiers, rules, and reason codes are illustrative/synthetic, NOT FDA MedWatch, VAERS, EudraVigilance, or an actual sponsor's pharmacovigilance database.",
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
        eventTypeId: request.eventTypeId,
        seriousnessTierId: decision.seriousnessTierId,
        reporterType: request.reporterType,
        adverseEventDecision: decision.decision,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        appliedRuleCount: decision.appliedRules.length,
        requiresRegulatoryTeamCosign: decision.requiresRegulatoryTeamCosign,
        eventsTraceToCatalog: catalogOk,
        submissionRequiresRegulatoryTeamCosign: cosignOk,
        reporterIdentityVerified: reporterOk
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
