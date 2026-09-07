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
  type CostShareDetermination,
  type CostShareRequest,
  DEMO_COST_SHARE_REQUEST,
  costShareBenefitSourced,
  costShareMathConsistent,
  costShareNoAutonomousCharge,
  costShareSummary,
  evaluateCostShare
} from "../../../../../lib/member-cost-share";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "member-cost-share-agent";

/**
 * Google A2A `tasks/send` endpoint for the Member Cost-Share / EOB Calculation agent — a claims /
 * payer-operations service on the payer & plan operations plane that splits an adjudicated claim's
 * allowed amount into the member's cost-share and the plan-paid portion.
 *
 *   POST /api/agents/member-cost-share/tasks
 *
 * Loads a cost-share request and DETERMINISTICALLY evaluates it via evaluateCostShare: it loads the
 * plan benefit design and runs the deductible → coinsurance → out-of-pocket-max waterfall, splitting
 * the allowed amount into member vs. plan responsibility. The split is a pure function of the claim's
 * own fields + the plan (no randomness, no clock). The benefit design traces to the recorded catalog,
 * the split adds up and stays bounded, and the member is never autonomously charged — the EOB
 * cost-share is an estimate the claims system / a human finalizes. This is a PHI-bearing agent
 * (phiAccessed:true throughout). The plan catalog + waterfall are illustrative; real cost-share is
 * governed by the member's SBC, the payer's adjudication system, and applicable law.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.costshare.benefit-design-sourced (signal costShareBenefitSourced) — the plan is cataloged.
 *   - policy.costshare.math-consistent (signal costShareMathConsistent) — the split adds up / is bounded.
 *   - policy.costshare.no-autonomous-member-charge (signal costShareNoAutonomousCharge) — no member
 *     charge is posted, and every breakdown is review-gated.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: CostShareRequest, determination?: object } — the request is evaluated; a caller-
 *   asserted `determination` (admissible only if the plan is cataloged, the split adds up, and no
 *   member charge is posted / it is review-gated) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("member-cost-share");
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
      ? (data.request as CostShareRequest)
      : DEMO_COST_SHARE_REQUEST;

  // Deterministic cost-share.
  const determination = evaluateCostShare(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as CostShareDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: benefit-sourced + math-consistent + no autonomous member charge.
  const benefitSourced = costShareBenefitSourced(determinationForCheck);
  const mathConsistent = costShareMathConsistent(determinationForCheck);
  const noAutonomousCharge = costShareNoAutonomousCharge(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      costShareBenefitSourced: benefitSourced,
      costShareMathConsistent: mathConsistent,
      costShareNoAutonomousCharge: noAutonomousCharge
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "costshare.compute-cost-share.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        claimRef: request.claimRef,
        costShareBenefitSourced: benefitSourced,
        costShareMathConsistent: mathConsistent,
        costShareNoAutonomousCharge: noAutonomousCharge,
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
          `Pause Agent Fabric blocked this member cost-share run: ${governance.blockingViolations
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

  const summary = costShareSummary(determination);

  // Receive-claim span — the fabric records the claim it received, parented under the caller's span.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "costshare.receive-claim",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      memberRef: request.memberRef,
      allowedAmount: determination.allowedAmount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Load-benefits span — the plan benefit design, parented to the received claim.
  const benefitsSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "costshare.load-benefits",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      planId: determination.planId,
      costShareBenefitSourced: benefitSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-cost-share span — the deterministic waterfall + split, parented to the benefits.
  const computeSpan = recordInstantSpan({
    taskId,
    parentSpanId: benefitsSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "costshare.compute-cost-share",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      memberResponsibility: determination.memberResponsibility,
      planPaid: determination.planPaid,
      costShareMathConsistent: mathConsistent,
      costShareNoAutonomousCharge: noAutonomousCharge,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the breakdown recorded to the HIPAA audit trail, parented to the computation.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: computeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "costshare.log-audit",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      memberResponsibility: determination.memberResponsibility,
      requiresAdjudicationReview: determination.requiresAdjudicationReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, claimRef: request.claimRef };

  const completedMessage = `Claim ${request.claimRef} for ${request.memberRef} on ${determination.planName}: allowed $${determination.allowedAmount.toFixed(2)} → member $${determination.memberResponsibility.toFixed(2)} (deductible $${determination.deductibleApplied.toFixed(2)} + coinsurance $${determination.coinsuranceApplied.toFixed(2)}${determination.oopCapReduction > 0 ? `, $${determination.oopCapReduction.toFixed(2)} capped at the OOP max` : ""}), plan pays $${determination.planPaid.toFixed(2)} — EOB estimate for adjudication review, no charge posted (synthetic — illustrative plan catalog, NOT a certified claims system).`;

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
        name: "CostShareDetermination",
        description:
          "Deterministically-produced member cost-share / EOB breakdown. It runs the deductible → coinsurance → out-of-pocket-maximum waterfall against the member's plan benefit design + current accumulators, splitting the adjudicated allowed amount into the member's cost-share (deductible + coinsurance, capped at the remaining OOP maximum) and the plan-paid portion. The benefit design traces to the recorded catalog, the split adds up and stays bounded (member + plan = allowed), and the member is NEVER autonomously charged — the EOB cost-share is an estimate the claims system / a human finalizes. The split is a pure function of the claim's own fields + the plan (no randomness, no clock). This is a PHI-bearing agent — the claim references the patient's care. The plan catalog + waterfall are illustrative (no copays, tiering, family accumulators, or out-of-network penalties), NOT a certified claims / adjudication system — real cost-share is governed by the member's certificate of coverage / SBC, the payer's adjudication system, and applicable law.",
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
        memberRef: determination.memberRef,
        planId: determination.planId,
        allowedAmount: determination.allowedAmount,
        deductibleApplied: determination.deductibleApplied,
        coinsuranceApplied: determination.coinsuranceApplied,
        oopCapReduction: determination.oopCapReduction,
        memberResponsibility: determination.memberResponsibility,
        planPaid: determination.planPaid,
        requiresAdjudicationReview: determination.requiresAdjudicationReview,
        costShareBenefitSourced: benefitSourced,
        costShareMathConsistent: mathConsistent,
        costShareNoAutonomousCharge: noAutonomousCharge,
        summaryMember: summary.memberResponsibility
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
