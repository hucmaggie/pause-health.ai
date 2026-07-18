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
  type ReferralActionRequest,
  type ReferralTriageContext,
  DEMO_REFERRAL_CONTEXT,
  draftReferrals,
  referralHasClinicianCosign,
  referralsTraceToSpecialty,
  triageReferrals
} from "../../../../../lib/referrals";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "referral-management-agent";

/**
 * Google A2A `tasks/send` endpoint for the Referral Management agent — the
 * Salesforce "Agentforce for Health" Referrals ("Create Referral") analog.
 *
 *   POST /api/agents/referral-management/tasks
 *
 * DETERMINISTICALLY triages a patient's intake + Care Router routing context
 * (age / cycle / symptom / severity / red-flag signals + risk flags) into
 * recommended specialist referral(s) across the adjacent specialties menopause
 * commonly touches — cardiology / CVD risk, endocrinology, bone health,
 * pelvic-floor PT, and behavioral health — GENERALIZING the Care Router's
 * behavioral-health-handoff into a full outbound-referral node. It drafts a
 * cosign-gated referral request per recommendation and parks them on an
 * await-cosign marker.
 *
 * CRITICAL: the agent can only DRAFT — an outbound referral requires a
 * clinician's sign-off before it is "sent" (a human-in-the-loop clinical
 * action). The specialties + triage are illustrative/synthetic, NOT a certified
 * clinical referral engine.
 *
 * Enforced-block policies checked before any referral is acted on:
 *   - policy.referral.clinician-cosign (signal referralHasClinicianCosign)
 *     — a caller-asserted autonomous send (a send without a clinician cosign)
 *     trips the block; a draft (or a cosigned send) passes.
 *   - policy.clinical.rationale-required (signal hasRationaleField) — every
 *     recommended referral must carry a documented reason.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { context?: ReferralTriageContext,
 *     referralAction?: { kind: "draft" | "send", clinicianCosigned? } }
 * A bare data object is read as the input; absent `context` falls back to a
 * representative synthetic demo context.
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
  const taskId = params.id || newTaskId("referral");
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
  const providedContext = data.context as ReferralTriageContext | undefined;
  const context: ReferralTriageContext =
    providedContext && typeof providedContext === "object"
      ? providedContext
      : DEMO_REFERRAL_CONTEXT;
  const referralAction = data.referralAction as ReferralActionRequest | undefined;

  // 1. Triage deterministically (needed to evaluate the rationale signal).
  const recommendations = triageReferrals(context);

  // Honest governance signals. The agent only ever DRAFTS: an outbound referral
  // is always cosign-gated, and every referral carries a documented reason. A
  // caller-asserted autonomous send flips referralGated to false, which trips
  // policy.referral.clinician-cosign.
  const referralGated = referralHasClinicianCosign(referralAction);
  const hasRationaleField = referralsTraceToSpecialty(recommendations);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      referralHasClinicianCosign: referralGated,
      hasRationaleField
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "referral.triage.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        referralsConsidered: recommendations.length,
        referralHasClinicianCosign: referralGated,
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
          `Pause Agent Fabric blocked this referral-management task: ${governance.blockingViolations
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

  const triageSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "referral.triage",
    protocol: "rest",
    attributes: {
      referralsRecommended: recommendations.length,
      specialties: recommendations.map((r) => r.specialtyId),
      priorities: recommendations.map((r) => r.priority),
      referralsTraceToSpecialty: hasRationaleField,
      referralHasClinicianCosign: referralGated,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // 2. Draft a cosign-gated referral request per recommendation — always
  //    requiresClinicianCosign, status "drafted", never sent.
  const referrals = draftReferrals(recommendations);
  for (const referral of referrals) {
    recordInstantSpan({
      taskId,
      parentSpanId: triageSpan.id,
      agentId: FABRIC_AGENT_ID,
      operation: "referral.draft",
      protocol: "rest",
      attributes: {
        specialtyId: referral.specialtyId,
        priority: referral.priority,
        requiresClinicianCosign: referral.requiresClinicianCosign,
        status: referral.status,
        sent: referral.sent,
        ...(personaId ? { personaId } : {})
      }
    });
  }

  // 3. Park the drafts on an await-cosign marker — nothing is sent until a
  //    clinician signs off.
  const awaitSpan = recordInstantSpan({
    taskId,
    parentSpanId: triageSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "referral.await-cosign",
    protocol: "rest",
    attributes: {
      referralsAwaitingCosign: referrals.length,
      requiresClinicianCosign: true,
      sent: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const summary =
    recommendations.length > 0
      ? recommendations
          .map((r) => `${r.specialtyLabel} (${r.priority})`)
          .join("; ")
      : "no specialist referral indicated";

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Triaged ${recommendations.length} specialist referral${
          recommendations.length === 1 ? "" : "s"
        }: ${summary}. Drafted ${referrals.length} cosign-gated referral request${
          referrals.length === 1 ? "" : "s"
        } for clinician review (awaiting sign-off before send — the agent never sends an outbound referral itself; synthetic — illustrative specialties, not a certified referral engine).`,
        { recommendations, referrals }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "Referrals",
        description:
          "Deterministically-triaged specialist referral(s) across the adjacent specialties menopause commonly touches (cardiology / CVD risk, endocrinology, bone health, pelvic-floor PT, behavioral health) — each referencing a defined specialty-catalog id and a documented reason — plus a cosign-gated referral request per recommendation (every one marked requiresClinicianCosign:true, status:'drafted', sent:false: the agent never sends an outbound referral without a clinician's sign-off). Generalizes the Care Router's behavioral-health handoff into a full outbound-referral node. The specialties + triage are illustrative/synthetic, NOT a certified clinical referral engine.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { recommendations, referrals } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: triageSpan.id,
        traceTaskId: taskId,
        referralsRecommended: recommendations.length,
        // The honesty invariant: every outbound referral requires a clinician cosign.
        referralHasClinicianCosign: referralGated,
        awaitCosignSpanId: awaitSpan.id
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
