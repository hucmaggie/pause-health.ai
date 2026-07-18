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
  type PatientPanelSignals,
  type PatientRiskProfile,
  type TierCareAction,
  excludesProtectedAttributes,
  modelScoringFactorIds,
  riskScoreTracesToFactors,
  stratifyPanel,
  tierActionsReviewedByHuman
} from "../../../../../lib/population-health";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "population-health-agent";

/**
 * Google A2A `tasks/send` endpoint for the Population Health & Risk
 * Stratification agent — the Salesforce "Agentforce for Health" / Health Cloud
 * population-health / risk-stratification analog.
 *
 *   POST /api/agents/population-health/tasks
 *
 * Ingests a PANEL (cohort) of already-produced per-patient signals (intake
 * severity, validated-assessment band, open care gaps, positive SDOH domains,
 * medication-adherence status, monitored-symptom trend), DETERMINISTICALLY
 * scores each patient with a TRANSPARENT additive/weighted risk model, assigns a
 * risk tier (low / rising / high) by fixed cutoffs, and emits a prioritized
 * outreach worklist for a human care manager. The factors + weights + cutoffs are
 * illustrative/synthetic, NOT a certified risk-stratification model, and the
 * patientRefs are synthetic/de-identified.
 *
 * Enforced-block policies checked before any stratification is acted on:
 *   - policy.pophealth.transparent-risk-model (signal riskScoreTracesToFactors) —
 *     every patient's tier must trace to the documented risk-factor spec (no
 *     opaque / black-box score).
 *   - policy.pophealth.no-protected-class-factors (signal excludesProtectedAttributes)
 *     — the risk model may not score on a protected-class attribute.
 *   - policy.pophealth.no-autonomous-care-decision (signal tierReviewedByHuman) —
 *     a risk tier is a prioritization signal only; every tier→action requires
 *     human / care-manager review, never an autonomous care decision.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { panel: PatientPanelSignals[], scoringFactors?: string[],
 *     careActions?: TierCareAction[], profiles?: PatientRiskProfile[] } — the
 *   panel is stratified; caller-asserted `scoringFactors` (admissible only if
 *   none is a protected-class attribute) demonstrate the no-protected-class
 *   block, `careActions` (admissible only if every one routes to a care manager)
 *   demonstrate the no-autonomous-care-decision block, and `profiles`
 *   (admissible only if every tier traces to the factor spec) demonstrate the
 *   transparent-risk-model block.
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
  const taskId = params.id || newTaskId("pophealth");
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
  const panel = Array.isArray(data.panel)
    ? (data.panel as PatientPanelSignals[])
    : [];
  const assertedProfiles = data.profiles as PatientRiskProfile[] | undefined;
  const usingAssertedProfiles = Array.isArray(assertedProfiles);
  const scoringFactors = Array.isArray(data.scoringFactors)
    ? (data.scoringFactors as string[])
    : modelScoringFactorIds();
  const careActions = Array.isArray(data.careActions)
    ? (data.careActions as TierCareAction[])
    : [];

  // Deterministic stratification of the ingested panel.
  const stratification = stratifyPanel(panel);
  // The profiles the transparency gate checks: the caller-asserted set (to
  // demonstrate the transparent-risk-model block) or the deterministic set.
  const profiles = usingAssertedProfiles
    ? (assertedProfiles as PatientRiskProfile[])
    : stratification.perPatient;

  // Honest governance signals. Every tier must trace to the defined factors; the
  // model may not score on a protected-class attribute; a tier never triggers an
  // autonomous care action (every tier→action is routed for human review).
  const scoreTraces = riskScoreTracesToFactors(profiles);
  const excludesProtected = excludesProtectedAttributes(scoringFactors);
  const tierReviewed = tierActionsReviewedByHuman(careActions);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      riskScoreTracesToFactors: scoreTraces,
      excludesProtectedAttributes: excludesProtected,
      tierReviewedByHuman: tierReviewed
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "pophealth.stratify.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientsConsidered: panel.length,
        riskScoreTracesToFactors: scoreTraces,
        excludesProtectedAttributes: excludesProtected,
        tierReviewedByHuman: tierReviewed,
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
          `Pause Agent Fabric blocked this population-health run: ${governance.blockingViolations
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

  // Ingest span — the fabric records the panel it ingested, parented under the
  // caller's span if any.
  const ingestSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "pophealth.ingest-panel",
    protocol: "a2a",
    attributes: {
      patientsIngested: panel.length,
      scoringFactors,
      excludesProtectedAttributes: excludesProtected,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Score span — the fabric records the per-patient scores it computed, parented
  // to the ingest it read from.
  const scoreSpan = recordInstantSpan({
    taskId,
    parentSpanId: ingestSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "pophealth.score",
    protocol: "a2a",
    attributes: {
      patientsScored: stratification.perPatient.length,
      riskScoreTracesToFactors: scoreTraces,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Stratify span — the fabric records the tier assignment, parented to the score.
  const stratifySpan = recordInstantSpan({
    taskId,
    parentSpanId: scoreSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "pophealth.stratify",
    protocol: "a2a",
    attributes: {
      tierCounts: stratification.tierCounts,
      riskScoreTracesToFactors: scoreTraces,
      tierReviewedByHuman: tierReviewed,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Worklist span — the prioritized outreach worklist for care-manager review,
  // parented to the stratification it orders. Never an autonomous care action.
  recordInstantSpan({
    taskId,
    parentSpanId: stratifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "pophealth.build-worklist",
    protocol: "a2a",
    attributes: {
      worklistLength: stratification.worklist.length,
      routedTo: "care-manager-review",
      autonomousCareDecision: false,
      tierReviewedByHuman: tierReviewed,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const tierSummary = `${stratification.tierCounts.high} high, ${stratification.tierCounts.rising} rising, ${stratification.tierCounts.low} low`;

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Stratified ${stratification.perPatient.length} patient${
          stratification.perPatient.length === 1 ? "" : "s"
        } into risk tiers (${tierSummary}) with a transparent, additive risk model and produced a prioritized outreach worklist of ${
          stratification.worklist.length
        } patient${
          stratification.worklist.length === 1 ? "" : "s"
        } for care-manager review. Every tier is explainable by its contributing factors; no autonomous care decision was taken (synthetic — illustrative factors + weights + cutoffs, not a certified risk-stratification model).`,
        { stratification }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "PanelStratification",
        description:
          "Deterministically-produced panel/cohort-level risk stratification for a menopause/midlife patient panel — a transparent additive/weighted risk score per patient (each explainable by its contributing risk factors), a risk tier (low / rising / high) by fixed cutoffs, tier counts, and a prioritized outreach worklist ordered highest-risk-first for a human care manager. The risk model may not score on a protected-class attribute, and a tier never triggers an autonomous care action. The factors + weights + cutoffs + patientRefs are illustrative/synthetic, NOT a certified risk-stratification model.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { stratification } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: stratifySpan.id,
        traceTaskId: taskId,
        patientsStratified: stratification.perPatient.length,
        tierCounts: stratification.tierCounts,
        worklistLength: stratification.worklist.length,
        riskScoreTracesToFactors: scoreTraces,
        excludesProtectedAttributes: excludesProtected,
        tierReviewedByHuman: tierReviewed
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
