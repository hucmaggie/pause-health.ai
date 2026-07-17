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
  assessmentToIntakeSignal,
  isAllowlistedInstrument,
  scoreAssessment,
  type AssessmentInstrument,
  type AssessmentResponse
} from "../../../../../lib/assessments";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "assessment-agent";

/**
 * Google A2A `tasks/send` endpoint for the Agentforce Assessment agent
 * (the Salesforce "Agentforce for Health — Assessments" analog).
 *
 *   POST /api/agents/assessment/tasks
 *
 * Administers and DETERMINISTICALLY scores a validated instrument (MRS,
 * Greene, PHQ-9, ISI) and returns the structured AssessmentResult plus
 * the intake-severity signal it produces. Scoring is real cutoff-based
 * math — there is no LLM in this path.
 *
 * Enforced-block policies checked before any scoring runs:
 *   - policy.assessment.validated-instrument-only (allow-list gate)
 *   - policy.phi.no-free-text-pii (structured numeric responses only)
 *   - policy.intake.red-flag-mandatory (the agent screens red-flag items)
 * A block returns HTTP 200 with an A2A task in state `failed`.
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
  const taskId = params.id || newTaskId("assessment");
  const sessionId = params.sessionId;
  const parentSpanId =
    typeof params.metadata?.parentSpanId === "string"
      ? (params.metadata.parentSpanId as string)
      : undefined;
  const personaId =
    typeof params.metadata?.personaId === "string"
      ? (params.metadata.personaId as string)
      : undefined;

  const data = findDataPart(params.message?.parts);
  const assessment =
    (data?.assessment as AssessmentResponse) ??
    (data as AssessmentResponse | undefined) ??
    ({} as AssessmentResponse);
  const instrument = assessment.instrument as AssessmentInstrument | undefined;

  // Governance pre-flight. The allow-list signal is the honest fact: is the
  // requested instrument on the validated allow-list? Responses are the
  // structured Likert integers only (no free-text PII), and the agent runs
  // a red-flag screen on every scored instrument.
  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      administersValidatedInstrumentOnly: isAllowlistedInstrument(instrument),
      containsFreeTextPii: false,
      hasRedFlagScreen: true
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "assessment.score.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestedInstrument: String(instrument),
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
          `Pause Agent Fabric blocked this assessment: ${governance.blockingViolations
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

  // Score deterministically. A malformed response vector (wrong length /
  // out-of-range value) is a bad request, not a governance block, so it
  // surfaces as a failed task with the scorer's own diagnostic.
  let result;
  try {
    result = scoreAssessment(assessment);
  } catch (err) {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "assessment.score.invalid",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestedInstrument: String(instrument),
        error: (err as Error).message,
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
          `Assessment could not be scored: ${(err as Error).message}`
        )
      },
      metadata: {
        agentFabric: {
          decision: "allow",
          policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
          error: (err as Error).message
        }
      }
    };
    return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: failed });
  }

  const intakeSignal = assessmentToIntakeSignal(result);

  const scoreSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "assessment.score",
    protocol: "rest",
    attributes: {
      instrument: result.instrument,
      instrumentName: result.instrumentName,
      total: result.total,
      maxTotal: result.maxTotal,
      severityBand: result.severityBand,
      normalizedSeverity: result.normalizedSeverity,
      redFlag: result.redFlags.length > 0,
      validatedInstrument: true,
      scoringMethod: "deterministic",
      ...(personaId ? { personaId } : {})
    }
  });

  // A red flag (e.g. PHQ-9 item 9) is escalated as its own span so the
  // safety hand-off is visible in the trace, not buried in an attribute.
  if (result.redFlags.length > 0) {
    recordInstantSpan({
      taskId,
      parentSpanId: scoreSpan.id,
      agentId: FABRIC_AGENT_ID,
      operation: "assessment.red-flag.escalate",
      protocol: "internal",
      status: "error",
      attributes: {
        instrument: result.instrument,
        redFlags: result.redFlags.map((f) => f.code),
        ...(personaId ? { personaId } : {})
      }
    });
  }

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(result.interpretation, { result })
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "AssessmentResult",
        description:
          "Deterministically scored validated instrument with per-instrument subscores, total, normalized severity band, red flags, and the intake-severity signal it produces.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result, intakeSignal } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: scoreSpan.id,
        traceTaskId: taskId,
        // The severity signal this scored instrument contributes to intake.
        intakeSeverity: intakeSignal.severity,
        nextAgent: "agentforce-intake"
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
