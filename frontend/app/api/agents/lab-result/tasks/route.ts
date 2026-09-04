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
  type LabResultDetermination,
  type LabResultRequest,
  DEMO_LAB_RESULT_REQUEST,
  evaluateLabResult,
  labClinicianReviewed,
  labCriticalValueNotified,
  labRangeCited,
  labResultSummary
} from "../../../../../lib/lab-result";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "lab-result-agent";

/**
 * Google A2A `tasks/send` endpoint for the Lab Result & Critical-Value Notification
 * agent — the clinical-decision service that classifies a discrete diagnostic lab result
 * against a reference-range + critical-threshold catalog and, for a critical (panic)
 * value, requires mandatory clinician notification.
 *
 *   POST /api/agents/lab-result/tasks
 *
 * Loads a lab-result request and DETERMINISTICALLY evaluates it via evaluateLabResult: it
 * resolves the analyte, classifies the value (critical thresholds first, then the
 * reference range) as normal / abnormal-high / abnormal-low / critical-high /
 * critical-low, flags whether the result requires mandatory clinician notification (a
 * critical value) and whether it requires clinician review (any abnormal result). The
 * classification is a pure function of the value + the analyte's catalog range (no
 * randomness, no clock). It NEVER autonomously acts on a result (no order, prescription,
 * treatment, or care-plan change — an abnormal / critical result is escalated to a
 * clinician) and a CRITICAL value can NEVER be suppressed or auto-closed. The analyte
 * catalog + ranges are illustrative / synthetic; real critical-value policies are
 * CLIA-validated and set by the laboratory's medical director.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.lab.critical-value-notified (signal labCriticalValueNotified) — a critical
 *     value must trigger mandatory clinician notification; never suppressed / auto-closed.
 *   - policy.lab.reference-range-sourced (signal labRangeCited) — every classification
 *     must cite a recorded analyte reference range.
 *   - policy.lab.no-autonomous-clinical-action (signal labClinicianReviewed) — the agent
 *     never autonomously acts on a result; a non-normal result is clinician-review-gated.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: LabResultRequest, determination?: object } — the request is classified; a
 *   caller-asserted `determination` (admissible only if a critical value requires
 *   notification, it cites a recorded reference range, and a non-normal result is
 *   clinician-review-gated) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("lab");
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
      ? (data.request as LabResultRequest)
      : DEMO_LAB_RESULT_REQUEST;

  // Deterministic lab-result determination.
  const determination = evaluateLabResult(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced classification.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as LabResultDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals. A determination must notify a critical value, cite a
  // recorded reference range, and clinician-review-gate any non-normal result.
  const criticalNotified = labCriticalValueNotified(determinationForCheck);
  const rangeCited = labRangeCited(determinationForCheck);
  const clinicianReviewed = labClinicianReviewed(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      labCriticalValueNotified: criticalNotified,
      labRangeCited: rangeCited,
      labClinicianReviewed: clinicianReviewed
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "lab.classify.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: request.patientRef,
        labCriticalValueNotified: criticalNotified,
        labRangeCited: rangeCited,
        labClinicianReviewed: clinicianReviewed,
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
          `Pause Agent Fabric blocked this lab-result run: ${governance.blockingViolations
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

  const summary = labResultSummary(determination);

  // Receive-result span — the fabric records the lab result it received, parented under
  // the caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "lab.receive-result",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      analyteId: determination.analyteId,
      value: determination.value,
      labRangeCited: rangeCited,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify span — the deterministic reference-range + critical-threshold
  // classification, parented to the received result.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "lab.classify",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      analyteId: determination.analyteId,
      classification: determination.classification,
      isCritical: determination.isCritical,
      labCriticalValueNotified: criticalNotified,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Recommend span — the notification / review recommendation (never an autonomous
  // clinical action), parented to the classification.
  const recommendSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "lab.recommend",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      classification: determination.classification,
      requiresProviderNotification: determination.requiresProviderNotification,
      requiresClinicianReview: determination.requiresClinicianReview,
      labClinicianReviewed: clinicianReviewed,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the
  // recommendation. Every lab-result decision is logged.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: recommendSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "lab.log-audit",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      analyteId: determination.analyteId,
      classification: determination.classification,
      requiresProviderNotification: determination.requiresProviderNotification,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, patientRef: request.patientRef };

  const completedMessage = determination.isCritical
    ? `Lab result for ${request.patientRef}: ${determination.analyteLabel} = ${determination.value} ${determination.unit} → ${determination.classification.toUpperCase()} — a CRITICAL (panic) value requiring MANDATORY clinician notification; it is never suppressed (synthetic — illustrative reference ranges; real critical-value policy is CLIA-validated).`
    : determination.requiresClinicianReview
      ? `Lab result for ${request.patientRef}: ${determination.analyteLabel} = ${determination.value} ${determination.unit} → ${determination.classification} — an abnormal result requiring clinician review; the agent never autonomously acts (synthetic — NOT a certified laboratory information system).`
      : `Lab result for ${request.patientRef}: ${determination.analyteLabel} = ${determination.value} ${determination.unit} → NORMAL (within the reference range). No notification or review required (synthetic — illustrative reference ranges set under CLIA / 42 CFR 493 by the laboratory's medical director).`;

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
        name: "LabResultDetermination",
        description:
          "Deterministically-produced discrete lab-result classification. It resolves the analyte from the reference-range catalog, classifies the value (critical thresholds first, then the reference range) as normal / abnormal-high / abnormal-low / critical-high / critical-low, flags whether the result requires MANDATORY clinician notification (a CRITICAL / panic value — CLIA §493.1291(g)) and whether it requires clinician review (any abnormal result). A critical value may NEVER be suppressed or auto-closed, and the agent NEVER autonomously acts on a result (no order, prescription, treatment, or care-plan change — a non-normal result is escalated for clinician review). The classification is a pure function of the value + the analyte's catalog range (no randomness, no clock). The analyte catalog, reference ranges, units, and critical thresholds are illustrative/synthetic, NOT a certified laboratory information system or a CLIA-validated critical-value policy — real ranges are method-/instrument-/population-specific and set by each laboratory's medical director under CLIA (42 CFR 493) + CAP accreditation.",
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
        analyteId: summary.analyteId,
        value: determination.value,
        classification: determination.classification,
        isCritical: determination.isCritical,
        requiresProviderNotification: determination.requiresProviderNotification,
        requiresClinicianReview: determination.requiresClinicianReview,
        labCriticalValueNotified: criticalNotified,
        labRangeCited: rangeCited,
        labClinicianReviewed: clinicianReviewed
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
