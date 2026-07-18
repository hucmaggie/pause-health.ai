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
import type { IntakeRecord } from "../../../../../lib/care-router";
import {
  buildEducationCurriculum,
  coachEducation,
  coachingStaysWithinEducationScope,
  curriculumTracesToEvidenceSource,
  educationContextFromIntake,
  type EducationCurriculum
} from "../../../../../lib/patient-education";

// coachEducation dynamically imports the Anthropic SDK (Node-only) when
// ANTHROPIC_API_KEY is set; pin the runtime so Vercel doesn't ship this to Edge.
export const runtime = "nodejs";

const FABRIC_AGENT_ID = "patient-education-agent";

/**
 * Google A2A `tasks/send` endpoint for the Patient Education & Health Coaching
 * Agent — a patient-facing ENGAGEMENT agent that delivers personalized,
 * evidence-sourced menopause/midlife education + lifestyle coaching, and the
 * FOURTH live-Claude agent.
 *
 *   POST /api/agents/patient-education/tasks
 *
 * Flow:
 *   1. Pre-flight governance via the Agent Fabric, INCLUDING the model
 *      allow-list (like the Care Router / Care Plan), the evidence-sourced
 *      block, the education-scope block, and the consent-before-outreach block.
 *      A block returns HTTP 200 with a `failed` task.
 *   2. patient-education.curate — DETERMINISTICALLY select education modules from
 *      a defined evidence-sourced catalog based on the intake + upstream Care
 *      Plan focus areas + detected care gaps. Every module references a defined
 *      catalog id AND carries a source; a caller-asserted off-catalog curriculum
 *      trips the evidence-sourced block.
 *   3. patient-education.coach — generate a warm, motivational coaching message
 *      with live Anthropic Claude, falling back to a DETERMINISTIC scripted
 *      message (with a recorded fallbackReason) on a missing key or any SDK
 *      error. The span records `via` and, on fallback, the `fallbackReason`.
 *   4. Return a completed A2ATask with the curriculum + coaching artifact and
 *      metadata.agentFabric.
 *
 * Input (data part), either:
 *   { intake?, onHrt?, carePlanFocusAreas?, careGapMeasures?,
 *     hasCoachingConsent?, deliversMedicalAdvice?,
 *     hasAiDecisionSupportConsent? } — the agent curates + coaches
 *   { curriculum: EducationCurriculum } — a caller-asserted curriculum,
 *     admissible only if every module references a defined evidence source
 *     (else blocked)
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
  const taskId = params.id || newTaskId("patiented");
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
  const asserted = data.curriculum as EducationCurriculum | undefined;
  const usingAsserted = Boolean(asserted && typeof asserted === "object");
  const intake = (data.intake ?? {}) as IntakeRecord;
  const onHrt = typeof data.onHrt === "boolean" ? (data.onHrt as boolean) : undefined;
  const carePlanFocusAreas = Array.isArray(data.carePlanFocusAreas)
    ? (data.carePlanFocusAreas as string[])
    : undefined;
  const careGapMeasures = Array.isArray(data.careGapMeasures)
    ? (data.careGapMeasures as string[])
    : undefined;

  // Curate deterministically from the intake + upstream signals (unless the
  // caller asserted a curriculum, which the integrity gate then checks).
  const curated = buildEducationCurriculum(
    educationContextFromIntake(intake, { onHrt, carePlanFocusAreas, careGapMeasures })
  );
  const curriculum: EducationCurriculum = usingAsserted
    ? (asserted as EducationCurriculum)
    : curated;

  // The honest integrity signal: does every module trace to a defined evidence
  // source? True for curated output; a fabricated off-catalog curriculum trips
  // policy.education.evidence-sourced.
  const evidenceTrace = curriculumTracesToEvidenceSource(curriculum);

  // Scope signal: general education only. Stays true unless the caller asserts
  // the content will cross into diagnosis / dosing / individualized medical
  // advice (policy.education.no-medical-advice).
  const deliversMedicalAdvice = data.deliversMedicalAdvice === true;
  const scopeOk = coachingStaysWithinEducationScope({
    assertsMedicalAdvice: deliversMedicalAdvice
  });

  // Consent signal: any coaching outreach is consent-gated + human-approval-
  // gated. Consent defaults to present and can be toggled off
  // (policy.education.consent-before-outreach).
  const coachingOutreachHasConsent = data.hasCoachingConsent !== false;

  // Live-Claude agent: it requests a model, so it is governed by the model
  // allow-list just like the Care Router / Care Plan.
  const requestedModel =
    process.env.PAUSE_PATIENT_EDUCATION_MODEL ?? "claude-sonnet-4-5-20250929";

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      educationTracesToEvidenceSource: evidenceTrace,
      staysWithinEducationScope: scopeOk,
      coachingOutreachHasConsent,
      requestedModel
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "patient-education.curate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        modulesSelected: Array.isArray(curriculum?.moduleIds)
          ? curriculum.moduleIds.length
          : null,
        educationTracesToEvidenceSource: evidenceTrace,
        staysWithinEducationScope: scopeOk,
        coachingOutreachHasConsent,
        requestedModel,
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
          `Pause Agent Fabric blocked this patient-education task: ${governance.blockingViolations
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

  // 1. Curation span — DETERMINISTIC module selection from the evidence-sourced
  //    catalog, parented under the caller's span if any.
  const curateSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "patient-education.curate",
    protocol: "a2a",
    attributes: {
      modulesSelected: curriculum.moduleIds.length,
      modules: curriculum.moduleIds,
      focusAreas: curriculum.focusAreas,
      educationTracesToEvidenceSource: evidenceTrace,
      staysWithinEducationScope: scopeOk,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // 2. Coaching span — LIVE Claude with a deterministic scripted fallback,
  //    mirroring the Care Plan agent. Records `via` and, on fallback, the
  //    (non-clinical) fallbackReason.
  const coaching = await coachEducation(curriculum);
  const coachSpan = recordInstantSpan({
    taskId,
    parentSpanId: curateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "patient-education.coach",
    protocol: "a2a",
    attributes: {
      provider: coaching.modelProvenance.provider,
      model: coaching.modelProvenance.model,
      via: coaching.via,
      // Present ONLY on a scripted-fallback message: the leading (non-clinical)
      // diagnostic explaining why the live Claude call was not used. Absent on a
      // successful claude-api message, exactly like the Care Plan route.
      ...(coaching.fallbackReason ? { fallbackReason: coaching.fallbackReason } : {}),
      // The honesty invariants: consent-gated, human-approval-gated, general
      // education only, never auto-sent.
      coachingOutreachHasConsent,
      staysWithinEducationScope: scopeOk,
      requiresHumanApproval: true,
      sent: false,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Curated a ${curriculum.moduleIds.length}-module evidence-sourced education curriculum from the defined catalog and generated a ${
          coaching.via === "claude-api" ? "live-Claude" : "deterministic scripted"
        } coaching message (general education only — consent-gated, human-approval-gated; synthetic — illustrative modules, not a certified patient-education engine).`,
        { curriculum, coaching }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "PatientEducation",
        description:
          "A menopause/midlife education curriculum selected DETERMINISTICALLY from a defined evidence-sourced catalog (bone health, cardiovascular, sleep hygiene, vasomotor, mood/stress, nutrition, physical activity) — every module references a defined catalog id AND carries a synthetic source label (never fabricated) — plus a warm, motivational coaching message generated with live Anthropic Claude and a deterministic scripted fallback (via + fallbackReason recorded). General education only (no diagnosis/dosing/individualized medical advice); coaching outreach is consent-gated + human-approval-gated. The modules + source labels are illustrative/synthetic, NOT a certified patient-education engine.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { curriculum, coaching } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: coachSpan.id,
        traceTaskId: taskId,
        modulesSelected: curriculum.moduleIds.length,
        educationTracesToEvidenceSource: evidenceTrace,
        coachingVia: coaching.via,
        ...(coaching.fallbackReason ? { fallbackReason: coaching.fallbackReason } : {})
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
