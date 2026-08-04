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
  type RiskAdjustmentAction,
  type RiskAdjustmentContext,
  type SuspectedHcc,
  DEMO_RISK_ADJUSTMENT_CONTEXT,
  assessRiskAdjustment,
  codesTraceToClinicalEvidence,
  codingRequiresClinicianValidation,
  noAutonomousCodeSubmission,
  riskAdjustmentSummary
} from "../../../../../lib/risk-adjustment";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "risk-adjustment-agent";

/**
 * Google A2A `tasks/send` endpoint for the Risk Adjustment & HCC Coding agent —
 * a patient-care clinical-documentation-integrity agent for value-based care.
 *
 *   POST /api/agents/risk-adjustment/tasks
 *
 * DETERMINISTICALLY reviews a patient's (synthetic) clinical context, identifies
 * suspected / confirmed HIERARCHICAL CONDITION CATEGORIES (HCCs) for risk
 * adjustment (each mapped to the documented clinical evidence that supports it),
 * computes a RAF-style risk score from the confirmed set, and flags coding gaps
 * (suspected-but-unconfirmed) and unsupported / over-coded entries. It is a
 * RECOMMENDER + integrity checker — every suspected code requires clinician
 * validation and the agent NEVER autonomously submits codes or adjusts a claim.
 * The assessment is a pure function of the clinical context (no randomness, no
 * clock). The HCC catalog, RAF weights, and evidence are illustrative / synthetic,
 * NOT a certified risk-adjustment / coding engine.
 *
 * Enforced-block policies checked before any code is treated as final:
 *   - policy.riskadj.evidence-supported-coding (signal codesTraceToClinicalEvidence)
 *     — every confirmed / suspected HCC must trace to documented clinical evidence
 *     (no upcoding).
 *   - policy.riskadj.clinician-validation-required (signal
 *     codingRequiresClinicianValidation) — a suspected code may only be finalized
 *     after a clinician validates it.
 *   - policy.riskadj.no-autonomous-submission (signal noAutonomousCodeSubmission)
 *     — the agent may never autonomously submit codes or adjust a claim / RAF.
 * A block returns HTTP 200 with a `failed` task. A CODING GAP (a suspected HCC) or
 * an UNSUPPORTED / OVER-CODED FLAG is NOT a block — it is a safe completed answer
 * with the gap / flag surfaced for a clinician to validate / correct.
 *
 * Input (data part):
 *   { context?: RiskAdjustmentContext, hccs?: SuspectedHcc[], action?: object } —
 *   the context is assessed; a caller-asserted `hccs` set (admissible only if
 *   every confirmed / suspected HCC traces to documented catalog evidence)
 *   demonstrates the evidence-supported-coding block, and a caller-asserted
 *   `action` (a submit without clinician validation, or one asserting an
 *   autonomous submission) demonstrates the clinician-validation / no-autonomous-
 *   submission blocks.
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
  const taskId = params.id || newTaskId("riskadj");
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
  const context =
    data.context && typeof data.context === "object"
      ? (data.context as RiskAdjustmentContext)
      : DEMO_RISK_ADJUSTMENT_CONTEXT;

  // Deterministic HCC suspicion + RAF-style scoring.
  const assessment = assessRiskAdjustment(context);

  // The HCC set the evidence-supported-coding gate checks: the caller-asserted set
  // (to demonstrate the block) or the produced HCCs.
  const assertedHccs = data.hccs as SuspectedHcc[] | undefined;
  const hccsForCheck = Array.isArray(assertedHccs) ? assertedHccs : assessment.hccs;

  // The code action the clinician-validation + no-autonomous-submission gates
  // check: the caller-asserted action (to demonstrate a block) or a plain assess.
  const assertedAction =
    data.action && typeof data.action === "object"
      ? (data.action as RiskAdjustmentAction)
      : undefined;
  const action: RiskAdjustmentAction = assertedAction ?? { kind: "assess" };

  // Honest governance signals. Every confirmed / suspected HCC must trace to
  // documented clinical evidence; a suspected code requires clinician validation;
  // the agent never autonomously submits codes or adjusts a claim / RAF.
  const evidenceSupported = codesTraceToClinicalEvidence(hccsForCheck);
  const clinicianValidation = codingRequiresClinicianValidation(action);
  const noAutonomousSubmission = noAutonomousCodeSubmission(action);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      codesTraceToClinicalEvidence: evidenceSupported,
      codingRequiresClinicianValidation: clinicianValidation,
      noAutonomousCodeSubmission: noAutonomousSubmission
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "riskadj.assess.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: context.patientRef,
        codesTraceToClinicalEvidence: evidenceSupported,
        codingRequiresClinicianValidation: clinicianValidation,
        noAutonomousCodeSubmission: noAutonomousSubmission,
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
          `Pause Agent Fabric blocked this risk-adjustment run: ${governance.blockingViolations
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

  const summary = riskAdjustmentSummary(assessment);

  // Review-documentation span — the fabric records that the agent read the
  // patient's clinical context, parented under the caller's span if any.
  const reviewSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "riskadj.review-documentation",
    protocol: "a2a",
    attributes: {
      patientRef: context.patientRef,
      documentedEvidenceCount: Array.isArray(context.documentedEvidence)
        ? context.documentedEvidence.length
        : 0,
      codedConditionCount: Array.isArray(context.codedConditions)
        ? context.codedConditions.length
        : 0,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Suspect-HCCs span — the confirmed / suspected / unsupported HCCs it produced,
  // parented to the documentation review it follows.
  const suspectSpan = recordInstantSpan({
    taskId,
    parentSpanId: reviewSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "riskadj.suspect-hccs",
    protocol: "a2a",
    attributes: {
      hccCount: summary.hccCount,
      confirmedCount: summary.confirmedCount,
      suspectedCount: summary.suspectedCount,
      unsupportedCount: summary.unsupportedCount,
      codesTraceToClinicalEvidence: evidenceSupported,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Score span — the RAF-style total from the confirmed set, parented to the
  // suspected HCCs it scores.
  const scoreSpan = recordInstantSpan({
    taskId,
    parentSpanId: suspectSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "riskadj.score",
    protocol: "a2a",
    attributes: {
      rafScore: assessment.rafScore,
      confirmedCount: summary.confirmedCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Flag-for-validation span — the coding gaps + unsupported flags handed to a
  // clinician, parented to the score. Every suspected code requires validation;
  // the agent never submits autonomously.
  const flagSpan = recordInstantSpan({
    taskId,
    parentSpanId: scoreSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "riskadj.flag-for-validation",
    protocol: "a2a",
    attributes: {
      codingGapCount: assessment.codingGaps.length,
      unsupportedFlagCount: assessment.unsupportedFlags.length,
      requiresClinicianValidation: assessment.requiresClinicianValidation,
      codingRequiresClinicianValidation: clinicianValidation,
      noAutonomousCodeSubmission: noAutonomousSubmission,
      submitted: assessment.submitted,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { assessment };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Assessed risk adjustment for ${assessment.patientRef}: ${summary.confirmedCount} confirmed HCC${
          summary.confirmedCount === 1 ? "" : "s"
        } (RAF ${assessment.rafScore.toFixed(3)}), ${assessment.codingGaps.length} suspected coding gap${
          assessment.codingGaps.length === 1 ? "" : "s"
        }, ${assessment.unsupportedFlags.length} unsupported / over-coded flag${
          assessment.unsupportedFlags.length === 1 ? "" : "s"
        }. Every suspected code is a RECOMMENDATION requiring clinician validation; every confirmed / suspected HCC traces to documented clinical evidence (no upcoding); the agent NEVER autonomously submits codes or adjusts a claim / RAF (synthetic — illustrative HCC catalog, RAF weights, and evidence, not a certified risk-adjustment / coding engine).`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "RiskAdjustmentAssessment",
        description:
          "Deterministically-produced risk-adjustment assessment for a single menopause/midlife patient — the confirmed / suspected / unsupported HCCs (each tracing to the documented clinical evidence that supports it, from an illustrative supporting-evidence catalog), the RAF-style risk score computed from the confirmed set, the suspected coding gaps (a clinician validates and codes them), and the unsupported / over-coded flags (a clinician corrects them). Every suspected code is a RECOMMENDATION carrying requiresClinicianValidation:true; the agent NEVER autonomously submits codes or adjusts a claim / RAF (submitted:false). The HCC catalog, RAF weights, and evidence are illustrative/synthetic, NOT the certified CMS-HCC model, real RAF coefficients, or a certified coding engine.",
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
        traceSpanId: flagSpan.id,
        traceTaskId: taskId,
        rafScore: assessment.rafScore,
        confirmedCount: summary.confirmedCount,
        suspectedCount: summary.suspectedCount,
        unsupportedCount: summary.unsupportedCount,
        requiresClinicianValidation: assessment.requiresClinicianValidation,
        submitted: assessment.submitted,
        codesTraceToClinicalEvidence: evidenceSupported,
        codingRequiresClinicianValidation: clinicianValidation,
        noAutonomousCodeSubmission: noAutonomousSubmission
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
