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
  type MedicationRecord,
  type PatientOutreachPrefs,
  type RefillActionRequest,
  DEMO_MEDICATION_RECORDS,
  adherenceDropOffs,
  assessAllAdherence,
  draftAdherenceNudges,
  refillRequiresHumanApproval
} from "../../../../../lib/medication-adherence";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "medication-adherence-agent";

/**
 * Deterministic as-of date used when a caller doesn't supply one. This module
 * takes no clock — adherence + refill-timing detection is a pure function of an
 * explicit as-of date — so the default is a clearly-synthetic demo anchor (the
 * same anchor the other proactive agents use), not "today".
 */
const DEFAULT_AS_OF = "2026-02-02";

/**
 * Google A2A `tasks/send` endpoint for the Medication Adherence agent — the
 * Salesforce "Agentforce for Health" / Health Cloud MedicationRequest +
 * MedicationTherapyReview analog.
 *
 *   POST /api/agents/medication-adherence/tasks
 *
 * DETERMINISTICALLY assesses the patient's menopause medications (transdermal/
 * oral HRT + an SSRI/SNRI) against an explicit as-of date + per-medication
 * days-supply and last-fill, computes a good / at-risk / lapsed adherence
 * status and a refill-due call, drafts consent- and quiet-hours-aware
 * refill/adherence NUDGES for the ones due or off-track, flags adherence
 * drop-off to the care team, and hands the nudges to the Engagement Agent.
 *
 * CRITICAL: the agent can only NUDGE — it may draft a refill reminder but must
 * NEVER autonomously submit/order a refill. The medications + intervals are
 * illustrative/synthetic, NOT a certified pharmacy / e-prescribing system.
 *
 * Enforced-block policy checked before any nudge is acted on:
 *   - policy.medication.no-autonomous-refill (signal refillRequiresHumanApproval)
 *     — a caller-asserted autonomous refill (a submit-refill without human
 *     approval) trips the block; a nudge (or a human-approved submit) passes.
 * Plus the reused no-prescribing + outreach/consent policies (no autonomous
 * clinical action, contact consent, human approval before send, quiet-hours +
 * channel preference). A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { medications?: MedicationRecord[], asOf?, patientPrefs?,
 *     refillAction?: { kind: "nudge" | "submit-refill", humanApproved? } }
 * A bare data object is read as the input; absent `medications` falls back to a
 * representative synthetic demo panel.
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
  const taskId = params.id || newTaskId("medadh");
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
  const providedMeds = data.medications as MedicationRecord[] | undefined;
  const medications: MedicationRecord[] = Array.isArray(providedMeds)
    ? providedMeds
    : DEMO_MEDICATION_RECORDS;
  const patientPrefs = (data.patientPrefs ?? {}) as PatientOutreachPrefs;
  const asOf = typeof data.asOf === "string" ? (data.asOf as string) : DEFAULT_AS_OF;
  const refillAction = data.refillAction as RefillActionRequest | undefined;

  // Honest governance signals. The agent only ever NUDGES: outreach is never
  // auto-sent, always respects quiet-hours + channel, and a refill always
  // requires human approval. A caller-asserted autonomous refill flips
  // refillGated to false, which trips policy.medication.no-autonomous-refill
  // (and, honestly, no-prescribing — an autonomous refill is a clinical action
  // committed without a clinician).
  const refillGated = refillRequiresHumanApproval(refillAction);
  const hasContactConsent = patientPrefs.hasContactConsent !== false;
  const autonomousSend = false;
  const respectsQuietHoursAndChannel = true;

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      refillRequiresHumanApproval: refillGated,
      commitsClinicalActionWithoutClinician: !refillGated,
      hasContactConsent,
      autonomousSend,
      respectsQuietHoursAndChannel
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "medication.adherence.assess.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        medicationsConsidered: medications.length,
        refillRequiresHumanApproval: refillGated,
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
          `Pause Agent Fabric blocked this medication-adherence task: ${governance.blockingViolations
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

  // 1. Assess adherence + refill timing deterministically for every medication.
  const assessments = assessAllAdherence(medications, asOf);
  const dropOffs = adherenceDropOffs(assessments);

  const assessSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "medication.adherence.assess",
    protocol: "rest",
    attributes: {
      asOf,
      medicationsAssessed: assessments.length,
      medications: assessments.map((a) => a.drug),
      statuses: assessments.map((a) => a.status),
      refillsDue: assessments.filter((a) => a.refillDue).length,
      dropOffs: dropOffs.length,
      refillRequiresHumanApproval: refillGated,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // 2. Draft a consent- + quiet-hours-aware NUDGE for each medication due or
  //    off-track. Never auto-sent; always human-approval-gated and nudge-only.
  const nudges = draftAdherenceNudges(assessments, patientPrefs);
  for (const nudge of nudges) {
    const a = assessments.find((x) => x.drug === nudge.drug);
    recordInstantSpan({
      taskId,
      parentSpanId: assessSpan.id,
      agentId: FABRIC_AGENT_ID,
      operation: "medication.nudge.draft",
      protocol: "rest",
      attributes: {
        drug: nudge.drug,
        status: a?.status,
        refillDue: a?.refillDue,
        channel: nudge.channel,
        quietHoursRespected: nudge.quietHoursRespected,
        humanApprovalRequired: nudge.requiresHumanApproval,
        nudgeOnly: nudge.nudgeOnly,
        suppressedForNoConsent: nudge.suppressedForNoConsent,
        sent: nudge.sent,
        ...(personaId ? { personaId } : {})
      }
    });
  }

  // 3. Flag adherence drop-off (a lapsed medication) to the care team.
  if (dropOffs.length > 0) {
    recordInstantSpan({
      taskId,
      parentSpanId: assessSpan.id,
      agentId: FABRIC_AGENT_ID,
      operation: "medication.dropoff.flag",
      protocol: "rest",
      attributes: {
        dropOffs: dropOffs.length,
        medications: dropOffs.map((d) => d.drug),
        routedTo: "care-team",
        synthetic: true,
        ...(personaId ? { personaId } : {})
      }
    });
  }

  // 4. Hand the drafted nudges to the Engagement Agent for delivery — the nudges
  //    stay human-approval-gated, unsent, and nudge-only.
  const handoffSpan = recordInstantSpan({
    taskId,
    parentSpanId: assessSpan.id,
    agentId: "engagement-agent",
    operation: "engagement.outreach.handoff",
    protocol: "a2a",
    attributes: {
      nudgesHandedOff: nudges.length,
      channels: nudges.map((n) => n.channel),
      humanApprovalRequired: true,
      nudgeOnly: true,
      sent: false,
      ...(personaId ? { personaId } : {})
    }
  });

  const summary = assessments
    .map((a) => `${a.drugLabel} (${a.status}${a.refillDue ? ", refill due" : ""})`)
    .join("; ");

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Assessed ${assessments.length} medication${
          assessments.length === 1 ? "" : "s"
        }: ${summary}. Drafted ${nudges.length} consent-aware refill/adherence nudge${
          nudges.length === 1 ? "" : "s"
        } for human review (never auto-sent; nudge-only — the agent never orders a refill)${
          dropOffs.length > 0
            ? `, flagged ${dropOffs.length} adherence drop-off${
                dropOffs.length === 1 ? "" : "s"
              } to the care team`
            : ""
        }, and handed the nudges to the Engagement Agent (synthetic — illustrative medications, not a certified pharmacy system).`,
        { assessments, nudges }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "MedicationAdherence",
        description:
          "Deterministically-assessed menopause-medication adherence + refill timing — each medication's good/at-risk/lapsed status, refill-due call, and drop-off flag — plus a consent- and quiet-hours-aware refill/adherence nudge per medication due or off-track (human-approval-gated, never auto-sent, and EXPLICITLY nudge-only: the agent never autonomously submits/orders a refill) handed to the Engagement Agent, and adherence drop-off flagged to the care team. The medications + refill intervals are illustrative/synthetic, NOT a certified pharmacy / e-prescribing system.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { assessments, nudges } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: assessSpan.id,
        traceTaskId: taskId,
        medicationsAssessed: assessments.length,
        refillsDue: assessments.filter((a) => a.refillDue).length,
        dropOffs: dropOffs.length,
        // The honesty invariant: every refill action is human-approval-gated.
        refillRequiresHumanApproval: refillGated,
        handoffSpanId: handoffSpan.id,
        // Drafted nudges handed to the Engagement Agent for delivery.
        nextAgent: "engagement-agent"
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
