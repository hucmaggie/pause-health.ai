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
  type BenefitAccumulatorDetermination,
  type BenefitAccumulatorRequest,
  DEMO_BENEFIT_ACCUMULATOR_REQUEST,
  accumulatorExact,
  benefitAccumulatorSummary,
  evaluateBenefitAccumulator,
  ledgerSourced,
  noAutonomousAdjust
} from "../../../../../lib/benefit-accumulator";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "benefit-accumulator-agent";

/**
 * Google A2A `tasks/send` endpoint for the Benefit Accumulator Ledger / Fenwick-Tree Prefix Sums agent — a
 * payer-operations accumulator-ledger service that, given an ordered sequence of applied claim amounts and an
 * out-of-pocket maximum, maintains a running accumulator and locates the crossover claim (the first at which the
 * member meets their OOP maximum).
 *
 *   POST /api/agents/benefit-accumulator/tasks
 *
 * Loads a request and DETERMINISTICALLY evaluates it via evaluateBenefitAccumulator: it computes the running
 * cumulative totals and locates the crossover via a FENWICK TREE (Binary Indexed Tree) lower-bound descent. There
 * is no cost-sharing waterfall, no reservoir sampling, no Bloom filter, no largest-remainder apportionment, no
 * percentile/rank, and no Kadane subarray — it is Fenwick-tree prefix sums, a pure function of the amounts + OOP
 * max. The ledger is sourced + self-consistent, accumulator-exact, and nothing is adjusted — a benefits analyst
 * confirms. It is PHI-adjacent (phiAccessed:true — the ledger references a member's claims).
 *
 * An oop-max-met disposition is a LEGITIMATE FINDING (the member reached their OOP max), NOT a governance block.
 * Enforced-block policies checked before any ledger leaves the fabric:
 *   - policy.benefitacc.ledger-sourced (signal benefitLedgerSourced).
 *   - policy.benefitacc.accumulator-exact (signal benefitAccumulatorExact).
 *   - policy.benefitacc.no-autonomous-adjust (signal benefitNoAutonomousAdjust).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: BenefitAccumulatorRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the ledger is sourced + self-consistent, accumulator-exact, and not
 *   auto-adjusted) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("benefit-accumulator");
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
      ? (data.request as BenefitAccumulatorRequest)
      : DEMO_BENEFIT_ACCUMULATOR_REQUEST;

  // Deterministic Fenwick-tree accumulator ledger.
  const determination = evaluateBenefitAccumulator(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as BenefitAccumulatorDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: ledger sourced + self-consistent, accumulator exact, no autonomous adjust.
  const sourced = ledgerSourced(determinationForCheck);
  const exact = accumulatorExact(determinationForCheck);
  const noAutonomous = noAutonomousAdjust(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      benefitLedgerSourced: sourced,
      benefitAccumulatorExact: exact,
      benefitNoAutonomousAdjust: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "benefitacc.ledger.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        ledgerRef: request.ledgerRef,
        benefitLedgerSourced: sourced,
        benefitAccumulatorExact: exact,
        benefitNoAutonomousAdjust: noAutonomous,
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
          `Pause Agent Fabric blocked this ledger: ${governance.blockingViolations
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

  const summary = benefitAccumulatorSummary(determination);

  // Receive-ledger span — the fabric records the ledger it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "benefitacc.receive-ledger",
    protocol: "a2a",
    attributes: {
      ledgerRef: request.ledgerRef,
      claimCount: determination.claimCount,
      oopMax: determination.oopMax,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Accumulate span — Fenwick-tree prefix sums + crossover descent, parented to the received ledger.
  const accumulateSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "benefitacc.accumulate",
    protocol: "a2a",
    attributes: {
      ledgerRef: request.ledgerRef,
      totalApplied: determination.totalApplied,
      crossoverIndex: determination.crossoverIndex,
      benefitLedgerSourced: sourced,
      benefitAccumulatorExact: exact,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the ledger disposition, parented to the accumulate.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: accumulateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "benefitacc.classify-disposition",
    protocol: "a2a",
    attributes: {
      ledgerRef: request.ledgerRef,
      disposition: determination.disposition,
      remainingBeforeOopMax: determination.remainingBeforeOopMax,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the ledger recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "benefitacc.log-audit",
    protocol: "a2a",
    attributes: {
      ledgerRef: request.ledgerRef,
      disposition: determination.disposition,
      benefitNoAutonomousAdjust: noAutonomous,
      requiresAnalystReview: determination.requiresAnalystReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, ledgerRef: request.ledgerRef };

  const completedMessage =
    determination.disposition === "oop-max-met"
      ? `Ledger complete — member ledger ${request.ledgerRef} reached the OOP maximum of ${determination.oopMax} at claim ${determination.crossoverIndex + 1} of ${determination.claimCount} (total applied ${determination.totalApplied}); a recommendation for a benefits analyst, nothing adjusted (synthetic — Fenwick prefix sums, NOT a certified accumulator system).`
      : `Ledger complete — member ledger ${request.ledgerRef} is under the OOP maximum of ${determination.oopMax}; total applied ${determination.totalApplied} across ${determination.claimCount} claim(s), ${determination.remainingBeforeOopMax} remaining; a recommendation for a benefits analyst, nothing adjusted (synthetic — Fenwick prefix sums, NOT a certified accumulator system).`;

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
        name: "BenefitAccumulatorDetermination",
        description:
          "Deterministically-produced benefit-accumulator ledger. Given an ORDERED sequence of applied claim amounts and an OUT-OF-POCKET MAXIMUM, it maintains a running accumulator and answers two questions via a FENWICK TREE (Binary Indexed Tree): the CUMULATIVE amount applied through each claim (prefix-sum queries), and the CROSSOVER claim — the first at which the running total reaches or exceeds the OOP maximum (a binary lower-bound descent over the tree). If the total never reaches the OOP max the disposition is under-oop-max; otherwise oop-max-met (the honest finding that the member has met their OOP maximum — after which the plan pays 100%). The running prefix sums and the crossover index are the invariants. The ledger is sourced + self-consistent (the running totals are the true prefix sums of the submitted amounts, the total applied and remaining honest, the crossover a real submitted-claim index), accumulator-exact — re-building the Fenwick tree reproduces every prefix sum and the crossover located by the tree's lower-bound descent matches — and nothing is posted or adjusted; a benefits analyst confirms. CRUCIALLY this is NOT the Member Cost-Share agent's COST-SHARING WATERFALL (which splits a SINGLE claim across deductible / coinsurance / OOP for one date of service — this is a CUMULATIVE data structure over a SEQUENCE of claims with prefix-sum + find-by-threshold queries), NOT the Audit Sample agent's RESERVOIR SAMPLING, NOT the Duplicate-Claim Screen agent's BLOOM FILTER, NOT the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, NOT the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, and NOT the Peak-Window agent's KADANE MAXIMUM-SUBARRAY — it is Fenwick-tree prefix sums with a lower-bound descent, a pure function of the amounts + OOP max. It is PHI-adjacent — the ledger references a member's claims, so a determination is on the HIPAA audit path. The amounts are an illustrative synthetic, NOT a certified benefits-accumulator / claims-payment system (real accumulator processing weighs the full benefit design — embedded vs aggregate family deductibles, network tiers, carve-outs, EOB reversals — plan-year resets, and an authoritative accumulator store — not a bare prefix-sum over illustrative amounts).",
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
        ledgerRef: request.ledgerRef,
        disposition: determination.disposition,
        totalApplied: determination.totalApplied,
        oopMax: determination.oopMax,
        crossoverIndex: determination.crossoverIndex,
        remainingBeforeOopMax: determination.remainingBeforeOopMax,
        claimCount: summary.claimCount,
        requiresAnalystReview: summary.requiresAnalystReview,
        benefitLedgerSourced: sourced,
        benefitAccumulatorExact: exact,
        benefitNoAutonomousAdjust: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
