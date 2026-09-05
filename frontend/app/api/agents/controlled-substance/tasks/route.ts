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
  type ControlledSubstanceDetermination,
  type ControlledSubstanceRequest,
  DEMO_CONTROLLED_SUBSTANCE_REQUEST,
  controlledSubstanceGuidelineSourced,
  controlledSubstanceMmeComputed,
  controlledSubstanceNoAutonomousDecision,
  controlledSubstanceSummary,
  evaluateControlledSubstance
} from "../../../../../lib/controlled-substance";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "controlled-substance-agent";

/**
 * Google A2A `tasks/send` endpoint for the Controlled Substance / PDMP Safety Check agent — the
 * clinical-decision service that screens a proposed controlled-substance prescription against the
 * patient's PDMP history.
 *
 *   POST /api/agents/controlled-substance/tasks
 *
 * Loads a request and DETERMINISTICALLY evaluates it via evaluateControlledSubstance: it sums the
 * total opioid MME/day (proposed + concurrent), flags a concurrent opioid+benzodiazepine
 * combination and multi-prescriber / multi-pharmacy patterns, compares the total against the
 * cited guideline's caution / high-risk thresholds, and classifies the risk. The finding is a
 * pure function of the request's data + the cited guideline (no randomness, no clock). Every
 * finding cites a recorded guideline, the total MME/day is computed (not guessed), and a risk
 * finding is never an autonomous prescribing decision — an elevated / high finding requires
 * prescriber review. The thresholds + MME figures are illustrative; real monitoring uses the
 * state PDMP, the CDC MME conversion factors, and the CDC 2022 opioid-prescribing guideline.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.controlledsubstance.guideline-sourced (signal controlledSubstanceGuidelineSourced) —
 *     the finding cites a recorded guideline.
 *   - policy.controlledsubstance.mme-computed (signal controlledSubstanceMmeComputed) — the total
 *     MME/day matches the computed proposed + concurrent sum.
 *   - policy.controlledsubstance.no-autonomous-prescribing-decision (signal
 *     controlledSubstanceNoAutonomousDecision) — an elevated / high finding requires prescriber
 *     review and is never auto-decided.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: ControlledSubstanceRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if it cites a recorded guideline, has a
 *   computed MME total, and does not auto-decide / under-review an elevated finding) demonstrates
 *   the three governance blocks.
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
  const taskId = params.id || newTaskId("controlled-substance");
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
      ? (data.request as ControlledSubstanceRequest)
      : DEMO_CONTROLLED_SUBSTANCE_REQUEST;

  // Deterministic controlled-substance evaluation.
  const determination = evaluateControlledSubstance(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced determination.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as ControlledSubstanceDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: sourced guideline + a computed (not guessed) MME total + no
  // autonomous prescribing decision.
  const guidelineSourced = controlledSubstanceGuidelineSourced(determinationForCheck);
  const mmeComputed = controlledSubstanceMmeComputed(determinationForCheck);
  const noAutonomousDecision = controlledSubstanceNoAutonomousDecision(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      controlledSubstanceGuidelineSourced: guidelineSourced,
      controlledSubstanceMmeComputed: mmeComputed,
      controlledSubstanceNoAutonomousDecision: noAutonomousDecision
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "controlledsubstance.classify.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        controlledSubstanceGuidelineSourced: guidelineSourced,
        controlledSubstanceMmeComputed: mmeComputed,
        controlledSubstanceNoAutonomousDecision: noAutonomousDecision,
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
          `Pause Agent Fabric blocked this controlled-substance run: ${governance.blockingViolations
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

  const summary = controlledSubstanceSummary(determination);

  // Receive-request span — the fabric records the request it received, parented under the
  // caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "controlledsubstance.receive-request",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      guidelineId: request.guidelineId,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-MME span — the deterministic MME sum + threshold comparison, parented to the received
  // request.
  const computeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "controlledsubstance.compute-mme",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      totalMmePerDay: determination.totalMmePerDay,
      concurrentOpioidBenzo: determination.concurrentOpioidBenzo,
      controlledSubstanceGuidelineSourced: guidelineSourced,
      controlledSubstanceMmeComputed: mmeComputed,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify span — the risk classification (review-gated on an elevated / high finding),
  // parented to the MME computation.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: computeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "controlledsubstance.classify",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      riskLevel: determination.riskLevel,
      disposition: determination.disposition,
      requiresPrescriberReview: determination.requiresPrescriberReview,
      controlledSubstanceNoAutonomousDecision: noAutonomousDecision,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the
  // classification.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "controlledsubstance.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      riskLevel: determination.riskLevel,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage =
    determination.riskLevel === "low"
      ? `Request ${request.requestRef}: LOW risk — total ${determination.totalMmePerDay} MME/day below the ${determination.cautionMme} caution threshold (synthetic — illustrative MME thresholds, NOT clinical advice; informational, no autonomous approval).`
      : `Request ${request.requestRef}: ${determination.riskLevel.toUpperCase()} risk — ${determination.riskFactors.join("; ")} → prescriber review required, NOT auto-approved or auto-denied (synthetic — illustrative MME thresholds, NOT clinical advice).`;

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
        name: "ControlledSubstanceDetermination",
        description:
          "Deterministically-produced controlled-substance / PDMP safety determination. It sums the total opioid MME/day (proposed opioid contribution + concurrent active opioids), flags a concurrent opioid+benzodiazepine combination and multi-prescriber / multi-pharmacy patterns, compares the total against the cited guideline's caution (50) and high-risk (90) MME/day thresholds, and classifies the risk (low / elevated / high). Every finding cites a recorded guideline, the total MME/day is computed (not guessed), and a risk finding is NEVER an autonomous prescribing decision — the agent never approves, denies, dispenses, or writes the prescription; an elevated / high finding requires prescriber review. The finding is a pure function of the request's data + the cited guideline (no randomness, no clock). The thresholds + MME figures are illustrative, NOT a certified PDMP or clinical decision support — real monitoring uses the state PDMP, the CDC MME conversion factors, the CDC 2022 opioid-prescribing guideline, and the prescriber's clinical judgment.",
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
        requestRef: request.requestRef,
        guidelineId: determination.guidelineId,
        totalMmePerDay: determination.totalMmePerDay,
        concurrentOpioidBenzo: determination.concurrentOpioidBenzo,
        distinctPrescribers: determination.distinctPrescribers,
        distinctPharmacies: determination.distinctPharmacies,
        riskLevel: determination.riskLevel,
        disposition: determination.disposition,
        requiresPrescriberReview: determination.requiresPrescriberReview,
        controlledSubstanceGuidelineSourced: guidelineSourced,
        controlledSubstanceMmeComputed: mmeComputed,
        controlledSubstanceNoAutonomousDecision: noAutonomousDecision,
        summaryTotalMme: summary.totalMmePerDay
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
