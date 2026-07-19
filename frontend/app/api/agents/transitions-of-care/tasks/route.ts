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
  type PatientTransitionContext,
  type ReconciliationChangeProposal,
  DEMO_TOC_PATIENT,
  assembleTransitionOfCare,
  followUpScheduledNotRecommended,
  medicationsTraceToApprovedSource,
  proposeMedicationChange,
  reconciliationChangeRequiresClinician
} from "../../../../../lib/transitions-of-care";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "transitions-of-care-agent";

/**
 * Google A2A `tasks/send` endpoint for the Discharge & Transitions of Care
 * agent — a care-coordination agent that closes the loop back to primary
 * care after a hospitalization / ED visit.
 *
 *   POST /api/agents/transitions-of-care/tasks
 *
 * DETERMINISTICALLY reconciles the discharge medication list against the
 * pre-admit list, books (or drafts an appointment-request for) the follow-up,
 * pulls encounter-specific red-flag warning signs, emits the teach-back
 * checklist, and assembles the PCP handoff summary. It NEVER autonomously
 * commits a medication change; every follow-up is a scheduled slot (or an
 * explicit awaiting-schedule handoff to the Appointment Scheduling agent) —
 * never a text recommendation.
 *
 * Enforced-block policies checked before any package is returned:
 *   - policy.toc.reconciliation-source-integrity (signal
 *     medicationsTraceToApprovedSource) — every reconciliation medication
 *     must cite an approved source.
 *   - policy.toc.no-autonomous-medication-change (signal
 *     reconciliationChangeRequiresClinician) — every medication change
 *     requires clinician sign-off.
 *   - policy.toc.follow-up-scheduled-not-recommended (signal
 *     followUpScheduledNotRecommended) — a follow-up must be a real slot or
 *     explicitly awaiting-schedule; never a text recommendation.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { patient?: PatientTransitionContext, proposals?: ReconciliationChangeProposal[],
 *     followUpPlan?: object } — the patient is assembled by default; a
 *   caller-asserted `proposals` set (admissible only if every proposal is
 *   clinician-signoff gated) demonstrates the no-autonomous-medication-change
 *   block, and a caller-asserted `followUpPlan` (admissible only if
 *   scheduled-with-slot or awaiting-schedule) demonstrates the follow-up
 *   scheduled-not-recommended block. An off-source medication in the
 *   patient's pre/discharge lists demonstrates the source-integrity block.
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
  const taskId = params.id || newTaskId("toc");
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
  const patient =
    data.patient && typeof data.patient === "object"
      ? (data.patient as PatientTransitionContext)
      : DEMO_TOC_PATIENT;

  // Deterministic TOC package assembly.
  const packageOut = assembleTransitionOfCare(patient);

  // The medication lists the source-integrity gate checks — the caller-
  // asserted patient's lists (which is what the assembly used for legitimate
  // entries).
  const preAdmit = patient.preAdmitMedications ?? [];
  const discharge = patient.dischargeMedications ?? [];

  // The proposals the no-autonomous-medication-change gate checks — the
  // caller-asserted set (to demonstrate the block) or an empty set (the
  // agent's default posture — no autonomous proposals, only the reconciliation
  // draft in the package).
  const proposalsForCheck = Array.isArray(data.proposals)
    ? (data.proposals as ReconciliationChangeProposal[])
    : [];

  // The follow-up plan the scheduled-not-recommended gate checks — the
  // caller-asserted plan (to demonstrate the block) or the produced followUp.
  const assertedFollowUpPlan =
    data.followUpPlan && typeof data.followUpPlan === "object"
      ? (data.followUpPlan as Record<string, unknown>)
      : undefined;
  const followUpForCheck = assertedFollowUpPlan ?? packageOut.followUp;

  // Honest governance signals.
  const medsSource = medicationsTraceToApprovedSource({ preAdmit, discharge });
  const changeSignoff = reconciliationChangeRequiresClinician(proposalsForCheck);
  const followUpOk = followUpScheduledNotRecommended(followUpForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      medicationsTraceToApprovedSource: medsSource,
      reconciliationChangeRequiresClinician: changeSignoff,
      followUpScheduledNotRecommended: followUpOk
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "toc.assemble.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: patient.patientRef,
        medicationsTraceToApprovedSource: medsSource,
        reconciliationChangeRequiresClinician: changeSignoff,
        followUpScheduledNotRecommended: followUpOk,
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
          `Pause Agent Fabric blocked this transitions-of-care run: ${governance.blockingViolations
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

  // Reconcile span — records the medication reconciliation, parented under
  // the caller's span if any.
  const reconcileSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "toc.reconcile",
    protocol: "a2a",
    attributes: {
      patientRef: patient.patientRef,
      dischargeDate: patient.dischargeDate,
      reconciliationLines: packageOut.reconciliation.lines.length,
      reconciliationChanges: packageOut.reconciliation.changes,
      medicationsTraceToApprovedSource: medsSource,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Assemble-package span — records the composed TOC package.
  const assembleSpan = recordInstantSpan({
    taskId,
    parentSpanId: reconcileSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "toc.assemble-package",
    protocol: "a2a",
    attributes: {
      encounterKind: packageOut.encounterKind,
      encounterReasonCategory: packageOut.encounterReasonCategory,
      redFlagCount: packageOut.redFlagWarnings.length,
      teachBackCount: packageOut.teachBackChecklist.length,
      packageState: packageOut.state,
      followUpScheduled: packageOut.followUp.scheduled,
      followUpAwaitingSchedule: packageOut.followUp.awaitingSchedule,
      followUpScheduledNotRecommended: followUpOk,
      reconciliationChangeRequiresClinician: changeSignoff,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // A default illustrative proposal — the first dose-changed / added medication.
  const firstChange = packageOut.reconciliation.lines.find(
    (l) => l.changeKind === "dose-changed" || l.changeKind === "added"
  );
  const defaultProposal = firstChange
    ? proposeMedicationChange({
        medicationId: firstChange.medicationId,
        changeKind: firstChange.changeKind,
        rationale: `discharge reconciliation · ${firstChange.changeKind}`
      })
    : null;

  const result = { package: packageOut, proposal: defaultProposal };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Assembled a transitions-of-care package for ${packageOut.patientRef} (${packageOut.encounterKind}, ${packageOut.encounterReasonCategory}, discharge ${packageOut.dischargeDate}): ${packageOut.reconciliation.lines.length} medications on the reconciliation (${packageOut.reconciliation.changes} change${
          packageOut.reconciliation.changes === 1 ? "" : "s"
        }, all clinician-signoff gated); ${
          packageOut.followUp.scheduled
            ? `follow-up scheduled with ${packageOut.followUp.providerLabel} at ${packageOut.followUp.slotStart} (${packageOut.followUp.daysFromDischarge}d)`
            : "follow-up AWAITING-SCHEDULE — handoff to the Appointment Scheduling agent (never a text recommendation)"
        }; ${packageOut.redFlagWarnings.length} red-flag warning${
          packageOut.redFlagWarnings.length === 1 ? "" : "s"
        } taught; ${packageOut.teachBackChecklist.length} teach-back items. Every medication traces to an approved source; every medication change requires clinician sign-off (the agent NEVER autonomously commits a change); the follow-up is a scheduled slot or an explicit awaiting-schedule handoff. Synthetic — illustrative catalog, sources, and timing, not a certified TOC system.`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "TransitionOfCarePackage",
        description:
          "Deterministically-produced transitions-of-care package for a menopause/midlife patient after a hospitalization / ED / observation encounter — a medication reconciliation (added / removed / dose-changed / unchanged, each tracing to an approved source; the reconciliation is ALWAYS clinician-signoff gated), a follow-up appointment (a real scheduled slot or an explicit awaiting-schedule handoff to the Appointment Scheduling agent — NEVER a text recommendation), encounter-reason red-flag warning signs (catalog-sourced), a universal teach-back checklist, and a PCP handoff summary. The encounter categories, red-flag catalog, follow-up window, approved-source labels, and teach-back items are illustrative/synthetic, NOT a certified TOC schema.",
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
        traceSpanId: assembleSpan.id,
        traceTaskId: taskId,
        patientRef: patient.patientRef,
        dischargeDate: patient.dischargeDate,
        encounterKind: packageOut.encounterKind,
        encounterReasonCategory: packageOut.encounterReasonCategory,
        packageState: packageOut.state,
        reconciliationLines: packageOut.reconciliation.lines.length,
        reconciliationChanges: packageOut.reconciliation.changes,
        followUpScheduled: packageOut.followUp.scheduled,
        followUpAwaitingSchedule: packageOut.followUp.awaitingSchedule,
        medicationsTraceToApprovedSource: medsSource,
        reconciliationChangeRequiresClinician: changeSignoff,
        followUpScheduledNotRecommended: followUpOk
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
