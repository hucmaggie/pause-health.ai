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
  type MaterialAvailability,
  type PatientLanguageContext,
  DEMO_LANGUAGE_PATIENT,
  arrangeInterpreter,
  assessLanguageAccess,
  defaultConsentCommunicationPlan,
  materialsTraceToApprovedSource,
  noMachineTranslationForConsent,
  usesQualifiedInterpreter
} from "../../../../../lib/language-access";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "language-access-agent";

/**
 * Google A2A `tasks/send` endpoint for the Language Access & Health Equity agent
 * — a patient-care EQUITY agent that ensures limited-English-proficiency (LEP)
 * patients can understand their care.
 *
 *   POST /api/agents/language-access/tasks
 *
 * DETERMINISTICALLY determines the patient's PREFERRED LANGUAGE (deferring in
 * copy to the Consent & Preferences Management agent's preferred-language
 * preference), decides whether a QUALIFIED MEDICAL INTERPRETER is required and of
 * which modality (in-person / video / phone), checks whether the needed PATIENT
 * MATERIALS exist in that language (from an approved translated-materials
 * catalog), and FLAGS EQUITY / ACCESS GAPS. It NEVER substitutes machine
 * translation or an untrained / family interpreter for clinical communication or
 * consent. The assessment is a pure function of the patient context (no
 * randomness, no clock). The languages, interpreter availability, and materials
 * are illustrative/synthetic, NOT a certified language-access system.
 *
 * Enforced-block policies checked before any plan is acted on:
 *   - policy.langaccess.qualified-interpreter-only (signal usesQualifiedInterpreter)
 *     — clinical interpretation must use a qualified medical interpreter.
 *   - policy.langaccess.translated-material-source-integrity (signal
 *     materialsTraceToApprovedSource) — in-language materials must trace to the
 *     approved translated-materials catalog.
 *   - policy.langaccess.no-machine-translation-for-consent (signal
 *     noMachineTranslationForConsent) — machine translation may not be used for
 *     clinical consent / clinical decision communication.
 * A block returns HTTP 200 with a `failed` task. An EQUITY GAP (no qualified
 * interpreter for a language, a consent form only in English) is NOT a block —
 * it is a safe completed answer with the gap surfaced and escalated to a human.
 *
 * Input (data part):
 *   { patient?: PatientLanguageContext, interpreterPlan?: object,
 *     materials?: MaterialAvailability[], consentPlan?: object } — the patient is
 *   assessed for language access; a caller-asserted `interpreterPlan` (admissible
 *   only if it uses a qualified interpreter) demonstrates the qualified-
 *   interpreter-only block, a caller-asserted `materials` set (admissible only if
 *   every available in-language material traces to the approved catalog)
 *   demonstrates the source-integrity block, and a caller-asserted `consentPlan`
 *   (admissible only if it does not machine-translate clinical consent)
 *   demonstrates the no-machine-translation block.
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
  const taskId = params.id || newTaskId("langaccess");
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
      ? (data.patient as PatientLanguageContext)
      : DEMO_LANGUAGE_PATIENT;

  // Deterministic language-access assessment + qualified-interpreter arrangement.
  const assessment = assessLanguageAccess(patient);
  const interpreterRequest = arrangeInterpreter(assessment);

  // The interpreter plan the qualified-interpreter gate checks: the caller-
  // asserted plan (to demonstrate the block) or the produced request.
  const assertedInterpreterPlan =
    data.interpreterPlan && typeof data.interpreterPlan === "object"
      ? (data.interpreterPlan as Record<string, unknown>)
      : undefined;
  const interpreterPlanForCheck = assertedInterpreterPlan ?? interpreterRequest;

  // The materials the source-integrity gate checks: the caller-asserted set (to
  // demonstrate the block) or the produced in-language materials.
  const assertedMaterials = data.materials as MaterialAvailability[] | undefined;
  const materialsForCheck = Array.isArray(assertedMaterials)
    ? assertedMaterials
    : assessment.materialsInLanguage;

  // The consent-communication plan the no-machine-translation gate checks: the
  // caller-asserted plan (to demonstrate the block) or the produced safe plan.
  const assertedConsentPlan =
    data.consentPlan && typeof data.consentPlan === "object"
      ? (data.consentPlan as Record<string, unknown>)
      : undefined;
  const consentPlanForCheck =
    assertedConsentPlan ?? defaultConsentCommunicationPlan(assessment);

  // Honest governance signals. Clinical interpretation must use a qualified
  // interpreter; in-language materials must trace to the approved catalog;
  // machine translation must never be used for clinical consent.
  const qualifiedInterpreter = usesQualifiedInterpreter(interpreterPlanForCheck);
  const materialsApproved = materialsTraceToApprovedSource(materialsForCheck);
  const noMachineConsent = noMachineTranslationForConsent(consentPlanForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      usesQualifiedInterpreter: qualifiedInterpreter,
      materialsTraceToApprovedSource: materialsApproved,
      noMachineTranslationForConsent: noMachineConsent
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "langaccess.assess.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: patient.patientRef,
        usesQualifiedInterpreter: qualifiedInterpreter,
        materialsTraceToApprovedSource: materialsApproved,
        noMachineTranslationForConsent: noMachineConsent,
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
          `Pause Agent Fabric blocked this language-access run: ${governance.blockingViolations
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

  // Detect-language span — the fabric records the resolved preferred language,
  // parented under the caller's span if any.
  const detectSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "langaccess.detect-language",
    protocol: "a2a",
    attributes: {
      patientRef: patient.patientRef,
      preferredLanguageCode: assessment.preferredLanguage.code,
      preferredLanguageLabel: assessment.preferredLanguage.label,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Assess span — the fabric records the language-access assessment it produced,
  // parented to the language it detected.
  const assessSpan = recordInstantSpan({
    taskId,
    parentSpanId: detectSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "langaccess.assess",
    protocol: "a2a",
    attributes: {
      interpreterNeeded: assessment.interpreterNeeded,
      qualifiedInterpreterAvailable: assessment.qualifiedInterpreterAvailable,
      equityGapCount: assessment.equityGaps.length,
      materialsTraceToApprovedSource: materialsApproved,
      noMachineTranslationForConsent: noMachineConsent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Arrange-interpreter span — the qualified-interpreter arrangement (or an
  // equity-gap escalation to a human), parented to the assessment it follows.
  const arrangeSpan = recordInstantSpan({
    taskId,
    parentSpanId: assessSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "langaccess.arrange-interpreter",
    protocol: "a2a",
    attributes: {
      interpreterState: interpreterRequest.state,
      usesQualifiedInterpreter: qualifiedInterpreter,
      escalated: interpreterRequest.escalated,
      ...(interpreterRequest.routedTo ? { routedTo: interpreterRequest.routedTo } : {}),
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { assessment, interpreterRequest };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Assessed language access for ${assessment.patientRef}: preferred language ${
          assessment.preferredLanguage.label
        }; ${
          assessment.interpreterNeeded
            ? assessment.qualifiedInterpreterAvailable
              ? `a qualified medical interpreter (${assessment.recommendedModality}) is arranged`
              : "NO qualified interpreter is available — ESCALATED to a human language-access coordinator (never an unqualified fallback)"
            : "no interpreter required (English, the clinical default)"
        }; ${assessment.equityGaps.length} equity gap${
          assessment.equityGaps.length === 1 ? "" : "s"
        } flagged. Clinical interpretation uses a qualified medical interpreter only; in-language materials trace to the approved translated-materials catalog; machine translation is never used for clinical consent (synthetic — illustrative languages, interpreter availability, and materials, not a certified language-access system).`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "LanguageAccessAssessment",
        description:
          "Deterministically-produced language-access assessment for a single menopause/midlife patient — the resolved preferred language (deferring to the Consent & Preferences Management agent's preferred-language preference), whether a qualified medical interpreter is required and of which modality, the per-material in-language availability tracing to the approved translated-materials catalog (each with a translation-provenance label), the flagged equity / access gaps, and a qualified-interpreter arrangement that NEVER substitutes an untrained / family / machine interpreter (when no qualified interpreter is available it is an equity-gap escalation to a human coordinator, not an unqualified fallback). The languages, interpreter availability, materials, and provenance are illustrative/synthetic, NOT a certified language-access system.",
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
        traceSpanId: arrangeSpan.id,
        traceTaskId: taskId,
        preferredLanguageCode: assessment.preferredLanguage.code,
        interpreterNeeded: assessment.interpreterNeeded,
        qualifiedInterpreterAvailable: assessment.qualifiedInterpreterAvailable,
        recommendedModality: assessment.recommendedModality,
        interpreterState: interpreterRequest.state,
        equityGapCount: assessment.equityGaps.length,
        usesQualifiedInterpreter: qualifiedInterpreter,
        materialsTraceToApprovedSource: materialsApproved,
        noMachineTranslationForConsent: noMachineConsent
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
