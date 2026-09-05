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
  type ClaimTimelinessRequest,
  type TimelyFilingDetermination,
  DEMO_TIMELY_FILING_REQUEST,
  evaluateTimelyFiling,
  timelyFilingDeadlineComputed,
  timelyFilingNoAutonomousWriteOff,
  timelyFilingRuleSourced,
  timelyFilingSummary
} from "../../../../../lib/timely-filing";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "timely-filing-agent";

/**
 * Google A2A `tasks/send` endpoint for the Timely Filing Compliance agent — the payer-operations
 * service that decides whether a claim was filed within its payer's timely-filing limit.
 *
 *   POST /api/agents/timely-filing/tasks
 *
 * Loads a claim and DETERMINISTICALLY evaluates it via evaluateTimelyFiling: it computes the
 * deadline (date of service + the cited rule's limit days), compares the submission date,
 * computes how many days late an untimely claim is, honors a recognized exception when claimed,
 * and decides the disposition (accept / appeal-with-exception / write-off-review). The decision
 * is a pure function of the claim's dates + the cited rule (no randomness, no clock). Every
 * decision cites a recorded filing-limit rule, the deadline is computed (not guessed), and an
 * untimely claim is never autonomously written off — it requires human review. The filing limits
 * + exceptions are illustrative; real limits are governed by each payer's provider contract,
 * Medicare / Medicaid rules, and state prompt-pay law.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.timelyfiling.filing-limit-sourced (signal timelyFilingRuleSourced) — the decision
 *     cites a recorded filing-limit rule.
 *   - policy.timelyfiling.deadline-computed (signal timelyFilingDeadlineComputed) — the deadline
 *     matches the computed date of service + limit.
 *   - policy.timelyfiling.no-autonomous-write-off (signal timelyFilingNoAutonomousWriteOff) — an
 *     untimely claim is never autonomously written off.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: ClaimTimelinessRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if it cites a recorded rule, has a computed
 *   deadline, and does not write off / under-review an untimely claim) demonstrates the three
 *   governance blocks.
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
  const taskId = params.id || newTaskId("timely-filing");
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
      ? (data.request as ClaimTimelinessRequest)
      : DEMO_TIMELY_FILING_REQUEST;

  // Deterministic timely-filing evaluation.
  const determination = evaluateTimelyFiling(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced determination.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as TimelyFilingDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: sourced rule + a computed (not guessed) deadline + no
  // autonomous write-off.
  const ruleSourced = timelyFilingRuleSourced(determinationForCheck);
  const deadlineComputed = timelyFilingDeadlineComputed(determinationForCheck);
  const noAutonomousWriteOff = timelyFilingNoAutonomousWriteOff(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      timelyFilingRuleSourced: ruleSourced,
      timelyFilingDeadlineComputed: deadlineComputed,
      timelyFilingNoAutonomousWriteOff: noAutonomousWriteOff
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "timelyfiling.decide.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        claimRef: request.claimRef,
        timelyFilingRuleSourced: ruleSourced,
        timelyFilingDeadlineComputed: deadlineComputed,
        timelyFilingNoAutonomousWriteOff: noAutonomousWriteOff,
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
          `Pause Agent Fabric blocked this timely-filing run: ${governance.blockingViolations
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

  const summary = timelyFilingSummary(determination);

  // Receive-claim span — the fabric records the claim it received, parented under the caller's
  // span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "timelyfiling.receive-claim",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      filingRuleId: request.filingRuleId,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-deadline span — the deterministic deadline computation + timeliness comparison,
  // parented to the received claim.
  const computeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "timelyfiling.compute-deadline",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      deadline: determination.deadline,
      daysLate: determination.daysLate,
      timely: determination.timely,
      timelyFilingRuleSourced: ruleSourced,
      timelyFilingDeadlineComputed: deadlineComputed,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Decide span — the disposition (review-gated on an untimely claim), parented to the deadline
  // computation.
  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: computeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "timelyfiling.decide",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      disposition: determination.disposition,
      requiresHumanReview: determination.requiresHumanReview,
      timelyFilingNoAutonomousWriteOff: noAutonomousWriteOff,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the decision.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: decideSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "timelyfiling.log-audit",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      disposition: determination.disposition,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, claimRef: request.claimRef };

  const completedMessage = determination.timely
    ? `Claim ${request.claimRef}: TIMELY — submitted ${determination.submissionDate}, on or before the ${determination.deadline} deadline (${determination.limitDays}-day limit; synthetic — illustrative filing limits, NOT a certified engine).`
    : `Claim ${request.claimRef}: UNTIMELY by ${determination.daysLate} day(s) past the ${determination.deadline} deadline → ${determination.disposition}; human review required, NOT auto-written-off (synthetic — illustrative filing limits).`;

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
        name: "TimelyFilingDetermination",
        description:
          "Deterministically-produced timely-filing determination. It computes the filing deadline (date of service + the cited rule's limit days), compares the submission date to it, computes how many days late an untimely claim is, honors a recognized filing-limit exception when claimed, and decides the disposition (accept / appeal-with-exception / write-off-review). Every decision cites a recorded filing-limit rule, the deadline is computed (not guessed), and an untimely claim is NEVER autonomously written off — it is a recommendation requiring human review. The decision is a pure function of the claim's dates + the cited rule (no randomness, no clock). The filing limits + exceptions are illustrative, NOT a certified timely-filing engine — real limits are governed by each payer's provider contract, Medicare (generally 12 months / 42 CFR 424.44), state Medicaid rules, and state prompt-pay law.",
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
        claimRef: request.claimRef,
        filingRuleId: determination.filingRuleId,
        limitDays: determination.limitDays,
        deadline: determination.deadline,
        daysLate: determination.daysLate,
        timely: determination.timely,
        exceptionRecognized: determination.exceptionRecognized,
        disposition: determination.disposition,
        requiresHumanReview: determination.requiresHumanReview,
        timelyFilingRuleSourced: ruleSourced,
        timelyFilingDeadlineComputed: deadlineComputed,
        timelyFilingNoAutonomousWriteOff: noAutonomousWriteOff,
        summaryDeadline: summary.deadline
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
