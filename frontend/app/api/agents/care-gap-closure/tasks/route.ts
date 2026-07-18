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
  DEMO_DATA360_PATIENT_ID,
  getGroundingContext
} from "../../../../../lib/data-360";
import {
  type CareGap,
  type PatientOutreachPrefs,
  detectCareGaps,
  draftAllGapOutreach,
  gapsTraceToClinicalMeasure,
  groundingToCareGapContext
} from "../../../../../lib/care-gaps";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "care-gap-closure-agent";

/**
 * Deterministic as-of date used when a caller doesn't supply one. This module
 * takes no clock — care-gap detection is a pure function of an explicit as-of
 * date — so the default is a clearly-synthetic demo anchor (the same anchor the
 * scheduling calendar uses), not "today".
 */
const DEFAULT_AS_OF = "2026-02-02";

/**
 * Google A2A `tasks/send` endpoint for the Care Gap Closure agent — the
 * Salesforce "Agentforce for Health" / Health Cloud care-gap-closure analog.
 *
 *   POST /api/agents/care-gap-closure/tasks
 *
 * Grounds on the patient's Data 360 context, detects menopause-relevant
 * preventive-care gaps (bone-density/DEXA, lipid panel, mammogram, HRT
 * follow-up) DETERMINISTICALLY against an explicit as-of date + age/cycle/
 * symptom signals, drafts consent- and quiet-hours-aware outreach for each gap,
 * and hands the drafts to the Engagement Agent. Every gap references a defined
 * clinical-measure catalog id — never a fabricated one. The clinical measures +
 * intervals are illustrative/synthetic, NOT a certified guideline engine.
 *
 * Enforced-block policy checked before any gap is acted on:
 *   - policy.caregap.clinical-measure-sourced (signal gapsTraceToClinicalMeasure)
 *     — every acted-on gap must derive from a defined clinical measure; a
 *     caller-asserted off-catalog gap trips the block.
 * Plus the reused outreach/consent/grounding-consent policies (contact consent,
 * human approval before send, quiet-hours + channel preference, and
 * consent-before-grounding). A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part), either:
 *   { detectionContext?: {asOf, ageBand, cycleStatus, primarySymptom, onHrt,
 *       riskFlags, measureHistory}, patientPrefs?, patientId?,
 *       hasAiDecisionSupportConsent? } — the agent grounds + detects
 *   { gaps: CareGap[] } — caller-asserted gaps, admissible only if every gap
 *       references a catalog measure (else blocked)
 * A bare data object is read as the detectionContext.
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
  const taskId = params.id || newTaskId("caregap");
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
  const asserted = data.gaps as CareGap[] | undefined;
  const usingAsserted = Array.isArray(asserted);
  const detectionInput = (data.detectionContext ?? data) as {
    asOf?: string;
    ageBand?: string;
    cycleStatus?: string;
    primarySymptom?: string;
    onHrt?: boolean;
    riskFlags?: { osteoporosisRisk?: boolean; cardiovascularRisk?: boolean };
    measureHistory?: Record<string, string | null>;
  };
  const patientPrefs = (data.patientPrefs ?? {}) as PatientOutreachPrefs;
  const patientId =
    typeof data.patientId === "string" ? (data.patientId as string) : DEMO_DATA360_PATIENT_ID;
  const asOf = detectionInput.asOf || DEFAULT_AS_OF;

  // Honest consent + outreach signals for the governance gate. The agent never
  // sends autonomously; outreach drafts always respect quiet-hours + channel;
  // grounding + contact consent default to present and can be toggled off.
  const hasContactConsent = patientPrefs.hasContactConsent !== false;
  const hasAiDecisionSupportConsent = data.hasAiDecisionSupportConsent !== false;
  const autonomousSend = false;
  const respectsQuietHoursAndChannel = true;

  // 1. Ground on Data 360 (recorded below once we know we're proceeding).
  const grounding = getGroundingContext({
    patientId,
    hint: {
      ageBand: detectionInput.ageBand,
      primarySymptom: detectionInput.primarySymptom,
      cycleStatus: detectionInput.cycleStatus
    }
  });

  // 2. Detect gaps deterministically (or take the caller-asserted set). Every
  //    detected gap references a catalog measure by construction; a
  //    caller-asserted set may not, which is what the integrity gate catches.
  const detected = detectCareGaps(
    groundingToCareGapContext(grounding, {
      asOf,
      ageBand: detectionInput.ageBand,
      cycleStatus: detectionInput.cycleStatus,
      primarySymptom: detectionInput.primarySymptom,
      onHrt: detectionInput.onHrt,
      riskFlags: detectionInput.riskFlags,
      measureHistory: detectionInput.measureHistory
    })
  );
  const gaps: CareGap[] = usingAsserted ? (asserted as CareGap[]) : detected;

  // The honest integrity signal: do ALL acted-on gaps trace to a catalog
  // clinical measure? True for detector output; a fabricated off-catalog gap
  // trips policy.caregap.clinical-measure-sourced.
  const gapsTrace = gapsTraceToClinicalMeasure(gaps);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      gapsTraceToClinicalMeasure: gapsTrace,
      hasContactConsent,
      autonomousSend,
      respectsQuietHoursAndChannel,
      hasAiDecisionSupportConsent
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "caregap.detect.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientId,
        gapsConsidered: gaps.length,
        gapsTraceToClinicalMeasure: gapsTrace,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
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
          `Pause Agent Fabric blocked this care-gap closure: ${governance.blockingViolations
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

  // Grounding span — the fabric records that the agent grounded on Data 360
  // before deciding, parented under the caller's span if any.
  const groundingSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: "salesforce-data-360",
    operation: "data360.grounding",
    protocol: "rest",
    attributes: {
      unifiedPatientId: grounding.unifiedPatientId,
      computedInsightsCount: grounding.groundingProvenance.computedInsightsCount,
      daysSinceClinicalContact: grounding.lastClinicianContact.daysAgo,
      cohort: grounding.cohortComparison.cohortName,
      ...(personaId ? { personaId } : {})
    }
  });

  // Detection span — parented to the grounding it read from.
  const detectSpan = recordInstantSpan({
    taskId,
    parentSpanId: groundingSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "caregap.detect",
    protocol: "rest",
    attributes: {
      asOf,
      gapsDetected: gaps.length,
      measures: gaps.map((g) => g.measureId),
      priorities: gaps.map((g) => g.priority),
      gapsTraceToClinicalMeasure: gapsTrace,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Draft consent- + quiet-hours-aware outreach for each gap. Never auto-sent.
  const drafts = draftAllGapOutreach(gaps, patientPrefs);
  for (const draft of drafts) {
    recordInstantSpan({
      taskId,
      parentSpanId: detectSpan.id,
      agentId: FABRIC_AGENT_ID,
      operation: "caregap.outreach.draft",
      protocol: "rest",
      attributes: {
        measureId: draft.measureId,
        channel: draft.channel,
        quietHoursRespected: draft.quietHoursRespected,
        humanApprovalRequired: draft.requiresHumanApproval,
        suppressedForNoConsent: draft.suppressedForNoConsent,
        sent: draft.sent,
        ...(personaId ? { personaId } : {})
      }
    });
  }

  // Hand the drafted outreach to the Engagement Agent for delivery — the drafts
  // stay human-approval-gated and unsent, mirroring engagement's own governance.
  const handoffSpan = recordInstantSpan({
    taskId,
    parentSpanId: detectSpan.id,
    agentId: "engagement-agent",
    operation: "engagement.outreach.handoff",
    protocol: "a2a",
    attributes: {
      gapsHandedOff: drafts.length,
      channels: drafts.map((d) => d.channel),
      humanApprovalRequired: true,
      sent: false,
      ...(personaId ? { personaId } : {})
    }
  });

  const gapSummary = gaps
    .map((g) => `${g.measureLabel} (${g.status}, ${g.priority})`)
    .join("; ");

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        gaps.length > 0
          ? `Detected ${gaps.length} preventive-care gap${
              gaps.length === 1 ? "" : "s"
            } grounded on Data 360, each sourced to a clinical measure: ${gapSummary}. Drafted consent-aware outreach for human review and handed it to the Engagement Agent (synthetic — illustrative measures, not a certified guideline engine).`
          : "No open preventive-care gaps detected for this patient at the as-of date.",
        { gaps, drafts }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "CareGapClosure",
        description:
          "Deterministically-detected menopause-relevant preventive-care gaps grounded on the patient's Data 360 context — each referencing a defined clinical-measure catalog id (never fabricated) with open/overdue status, dueSince/lastDone, and priority — plus a consent- and quiet-hours-aware outreach draft per gap (human-approval-gated, never auto-sent) handed to the Engagement Agent. The clinical measures + intervals are illustrative/synthetic, NOT a certified guideline engine.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { gaps, drafts } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: detectSpan.id,
        traceTaskId: taskId,
        gapsDetected: gaps.length,
        gapsTraceToClinicalMeasure: gapsTrace,
        handoffSpanId: handoffSpan.id,
        // Drafted outreach handed to the Engagement Agent for delivery.
        nextAgent: "engagement-agent"
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
