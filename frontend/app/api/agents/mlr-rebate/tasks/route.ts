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
  type MlrRebateDetermination,
  type MlrRebateRequest,
  DEMO_MLR_REBATE_REQUEST,
  evaluateMlrRebate,
  mlrAllocationConsistent,
  mlrInputsSourced,
  mlrNoAutonomousDisbursement,
  mlrRebateSummary
} from "../../../../../lib/mlr-rebate";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "mlr-rebate-agent";

/**
 * Google A2A `tasks/send` endpoint for the Medical Loss Ratio (MLR) Rebate Calculation agent — a
 * claims / payer-operations service on the payer & plan operations plane that computes an ACA MLR
 * rebate and apportions it across subscribers.
 *
 *   POST /api/agents/mlr-rebate/tasks
 *
 * Loads a rebate request and DETERMINISTICALLY evaluates it via evaluateMlrRebate: it computes the
 * MLR, decides whether the market standard is met, computes the total rebate owed, and apportions it
 * penny-exactly across the subscriber roster (largest-remainder method). There is no sequential
 * waterfall and no identity match — it is a ratio-vs-threshold test + an exact proportional
 * apportionment, a pure function of the request's own fields. The applied standard cites the recorded
 * market catalog, the MLR + rebate + apportionment are exact, and the rebate is never autonomously
 * disbursed — a treasury / compliance reviewer issues every payment. This is a NON-PHI agent
 * (phiAccessed:false throughout — aggregate financials + a subscriber premium roster). The standards +
 * formula are illustrative; real MLR reporting is governed by 45 CFR Part 158.
 *
 * Enforced-block policies checked before any determination leaves the fabric:
 *   - policy.mlr.inputs-sourced (signal mlrInputsSourced).
 *   - policy.mlr.allocation-consistent (signal mlrAllocationConsistent).
 *   - policy.mlr.no-autonomous-disbursement (signal mlrNoAutonomousDisbursement).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: MlrRebateRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if the standard is sourced, the MLR /
 *   apportionment is consistent, and no auto disbursement) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("mlr-rebate");
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
      ? (data.request as MlrRebateRequest)
      : DEMO_MLR_REBATE_REQUEST;

  // Deterministic MLR rebate calculation.
  const determination = evaluateMlrRebate(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as MlrRebateDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: inputs-sourced + allocation-consistent + no autonomous disbursement.
  const inputsSourced = mlrInputsSourced(determinationForCheck);
  const allocationConsistent = mlrAllocationConsistent(determinationForCheck);
  const noAutonomous = mlrNoAutonomousDisbursement(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      mlrInputsSourced: inputsSourced,
      mlrAllocationConsistent: allocationConsistent,
      mlrNoAutonomousDisbursement: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "mlr.apportion-rebate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        mlrInputsSourced: inputsSourced,
        mlrAllocationConsistent: allocationConsistent,
        mlrNoAutonomousDisbursement: noAutonomous,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        phiAccessed: false,
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
          `Pause Agent Fabric blocked this MLR-rebate run: ${governance.blockingViolations
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

  const summary = mlrRebateSummary(determination);

  // Receive-financials span — the fabric records the rebate request it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "mlr.receive-financials",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      planRef: request.planRef,
      market: determination.market,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-ratio span — the MLR + meets-standard, parented to the received financials.
  const ratioSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "mlr.compute-ratio",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      mlr: determination.mlr,
      meetsStandard: determination.meetsStandard,
      mlrInputsSourced: inputsSourced,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Apportion-rebate span — the total rebate + apportionment, parented to the ratio.
  const apportionSpan = recordInstantSpan({
    taskId,
    parentSpanId: ratioSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "mlr.apportion-rebate",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      totalRebate: determination.totalRebate,
      subscriberCount: determination.allocations.length,
      mlrAllocationConsistent: allocationConsistent,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the apportionment.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: apportionSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "mlr.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      totalRebate: determination.totalRebate,
      mlrNoAutonomousDisbursement: noAutonomous,
      requiresTreasuryReview: determination.requiresTreasuryReview,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const outcome = determination.meetsStandard
    ? `MLR ${(determination.mlr * 100).toFixed(2)}% meets the ${(determination.standard * 100).toFixed(0)}% ${determination.market} standard — no rebate owed`
    : `MLR ${(determination.mlr * 100).toFixed(2)}% below the ${(determination.standard * 100).toFixed(0)}% ${determination.market} standard — rebate ${determination.totalRebate.toFixed(2)} apportioned across ${determination.allocations.length} subscriber(s)`;

  const completedMessage = `MLR rebate ${request.requestRef} for ${request.planRef}: ${outcome} — a recommendation for a treasury / compliance reviewer, no rebate disbursed autonomously (synthetic — illustrative ACA MLR standards, NOT a certified MLR filing system).`;

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
        name: "MlrRebateDetermination",
        description:
          "Deterministically-produced ACA Medical Loss Ratio (MLR) rebate determination. It computes the MLR = (incurred claims + quality improvement) / (earned premium − taxes & fees), decides whether it meets the market standard (80% individual / small-group, 85% large-group), computes the total rebate owed = max(0, standard − MLR) × earned premium, and apportions it across the subscriber premium roster penny-exactly using the largest-remainder method (the allocated cents sum EXACTLY to the total — no penny lost or invented). The applied standard cites the recorded market catalog, the MLR + rebate + apportionment are exact, and the rebate is NEVER autonomously disbursed — a treasury / compliance reviewer confirms and issues every payment. There is no sequential waterfall and no identity match — it is a ratio-vs-threshold test + an exact proportional apportionment, a pure function of the request's own fields. This is a NON-PHI agent — it works on aggregate plan-year financials + a subscriber premium roster, no patient health information. The standards + simplified formula are illustrative, NOT a certified MLR filing system — real MLR reporting uses the NAIC MLR Annual Reporting Form, credibility adjustments, multi-year averaging, permitted claim / premium adjustments, and the applicable federal / state regulations (45 CFR Part 158).",
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
        planRef: determination.planRef,
        market: determination.market,
        mlr: determination.mlr,
        meetsStandard: determination.meetsStandard,
        totalRebate: determination.totalRebate,
        subscriberCount: determination.allocations.length,
        requiresTreasuryReview: determination.requiresTreasuryReview,
        mlrInputsSourced: inputsSourced,
        mlrAllocationConsistent: allocationConsistent,
        mlrNoAutonomousDisbursement: noAutonomous,
        summaryTotalRebate: summary.totalRebate
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
