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
  type RecoveryDetermination,
  type RecoveryRequest,
  DEMO_RECOVERY_REQUEST,
  evaluateRecovery,
  recoveryClawbackHumanReviewed,
  recoveryReasonCited,
  recoverySummary,
  recoveryWithinLookback
} from "../../../../../lib/overpayment-recovery";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "overpayment-recovery-agent";

/**
 * Google A2A `tasks/send` endpoint for the Claims Overpayment & Recovery agent — the
 * plan-side payer & plan operations service that decides whether a PAID claim was
 * overpaid and, if so, whether the overpayment is still recoverable.
 *
 *   POST /api/agents/overpayment-recovery/tasks
 *
 * Loads a PAID claim and DETERMINISTICALLY evaluates it via evaluateRecovery: it
 * computes the overpayment (paid − correct), cites the governing recovery reason,
 * derives the recovery deadline from the reason's statutory lookback window, and
 * classifies the claim as recoverable / not-recoverable-within-window / no-overpayment.
 * The determination is a pure function of the claim's amounts + dates + the request's
 * own asOfDate (no randomness, no clock). It NEVER autonomously claws back or offsets a
 * payment: a recoverable overpayment is a RECOMMENDATION requiring human review with
 * member/provider notice, and a claim past its statutory lookback window is NEVER
 * recoverable. The recovery reason catalog + lookback windows are illustrative /
 * synthetic; real overpayment recovery is governed by the ACA §6402 60-day rule, CMS
 * recovery rules, ERISA, and state insurance code.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.recovery.within-lookback-window (signal recoveryWithinLookback) — never
 *     mark a claim recoverable past its statutory lookback window.
 *   - policy.recovery.reason-catalog-sourced (signal recoveryReasonCited) — every
 *     recovery must cite a recorded recovery reason.
 *   - policy.recovery.no-autonomous-clawback (signal recoveryClawbackHumanReviewed) —
 *     a recovery is human-review-gated; it never autonomously claws back.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: RecoveryRequest, determination?: object } — the claim is evaluated;
 *   a caller-asserted `determination` (admissible only if it stays within the lookback
 *   window, cites a recorded recovery reason, and is human-review-gated) demonstrates
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
  const taskId = params.id || newTaskId("recovery");
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
      ? (data.request as RecoveryRequest)
      : DEMO_RECOVERY_REQUEST;

  // Deterministic overpayment-recovery determination.
  const determination = evaluateRecovery(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced recommendation.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as RecoveryDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals. A determination must stay within the statutory lookback
  // window, cite a recorded recovery reason, and be human-review-gated.
  const withinWindow = recoveryWithinLookback(determinationForCheck);
  const reasonCited = recoveryReasonCited(determinationForCheck);
  const humanReviewed = recoveryClawbackHumanReviewed(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      recoveryWithinLookback: withinWindow,
      recoveryReasonCited: reasonCited,
      recoveryClawbackHumanReviewed: humanReviewed
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "recovery.evaluate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        claimId: request.claimId,
        recoveryReasonId: request.reasonId,
        recoveryWithinLookback: withinWindow,
        recoveryReasonCited: reasonCited,
        recoveryClawbackHumanReviewed: humanReviewed,
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
          `Pause Agent Fabric blocked this overpayment-recovery run: ${governance.blockingViolations
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

  const summary = recoverySummary(determination);

  // Receive-claim span — the fabric records the paid claim it received to evaluate,
  // parented under the caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "recovery.receive-claim",
    protocol: "a2a",
    attributes: {
      claimId: request.claimId,
      recoveryReasonId: determination.recoveryReasonId,
      recoveryReasonCited: reasonCited,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Evaluate span — the deterministic overpayment + lookback-window evaluation,
  // parented to the received claim.
  const evaluateSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "recovery.evaluate",
    protocol: "a2a",
    attributes: {
      claimId: request.claimId,
      overpaymentAmount: determination.overpaymentAmount,
      recoverable: determination.recoverable,
      recoveryDeadline: determination.recoveryDeadline,
      recoveryWithinLookback: withinWindow,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Recommend span — the recovery recommendation (never an autonomous clawback),
  // parented to the evaluation.
  const recommendSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "recovery.recommend",
    protocol: "a2a",
    attributes: {
      claimId: request.claimId,
      overpaymentAmount: determination.overpaymentAmount,
      recoverable: determination.recoverable,
      requiresHumanReview: determination.requiresHumanReview,
      recoveryClawbackHumanReviewed: humanReviewed,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the
  // recommendation. Every overpayment-recovery decision is logged.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: recommendSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "recovery.log-audit",
    protocol: "a2a",
    attributes: {
      claimId: request.claimId,
      recoveryReasonId: determination.recoveryReasonId,
      overpaymentAmount: determination.overpaymentAmount,
      requiresHumanReview: determination.requiresHumanReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, claimId: request.claimId };

  const completedMessage =
    determination.recoverable === "no-overpayment"
      ? `Overpayment & recovery review of claim ${request.claimId}: NO OVERPAYMENT — the paid amount does not exceed the correct amount, nothing to recover (synthetic — illustrative recovery reason catalog; real recovery is governed by the ACA §6402 60-day rule).`
      : determination.recoverable === "not-recoverable-within-window"
        ? `Overpayment & recovery review of claim ${request.claimId}: overpayment of ${determination.overpaymentAmount} under ${determination.recoveryReasonLabel} is PAST its recovery deadline ${determination.recoveryDeadline} — NOT recoverable; clawing back beyond the statutory lookback is an unlawful recoupment (synthetic — NOT a certified payment-integrity system).`
        : `Overpayment & recovery review of claim ${request.claimId}: overpayment of ${determination.overpaymentAmount} under ${determination.recoveryReasonLabel} is within its recovery deadline ${determination.recoveryDeadline} — RECOVERABLE. This is a RECOMMENDATION requiring human review with member/provider notice; the agent never autonomously claws back (synthetic — illustrative recovery reason catalog; real recovery is governed by the ACA §6402 60-day rule, CMS recovery rules, ERISA, and state insurance code).`;

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
        name: "RecoveryDetermination",
        description:
          "Deterministically-produced claims-overpayment-recovery determination for a PAID claim. It computes the overpayment (paid − correct), cites the governing recovery reason (duplicate-payment, cob-primary-elsewhere, retroactive-termination, pricing-error, or services-not-rendered), derives the recovery deadline from the paid date + the reason's statutory lookback window, and classifies the claim as recoverable / not-recoverable-within-window / no-overpayment. A claim past its lookback window is NEVER recoverable (recouping beyond the statutory lookback is an unlawful recoupment). A recoverable overpayment is a RECOMMENDATION requiring human review with member/provider notice (requiresHumanReview:true) — the agent NEVER autonomously claws back or offsets a payment. The determination is a pure function of the claim's amounts + dates + the request's own asOfDate (no randomness, no clock). The recovery reason catalog + lookback windows are illustrative/synthetic, NOT a certified payment-integrity system — real overpayment recovery is governed by the ACA §6402 60-day overpayment rule, CMS recovery rules, ERISA, and state insurance code.",
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
        claimId: request.claimId,
        overpaymentAmount: determination.overpaymentAmount,
        recoverable: determination.recoverable,
        recoveryReasonId: summary.recoveryReasonId,
        recoveryDeadline: determination.recoveryDeadline,
        withinLookbackWindow: determination.withinLookbackWindow,
        requiresHumanReview: determination.requiresHumanReview,
        recoveryWithinLookback: withinWindow,
        recoveryReasonCited: reasonCited,
        recoveryClawbackHumanReviewed: humanReviewed
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
