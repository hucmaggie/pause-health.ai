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
  type OutreachDetermination,
  type OutreachRequest,
  DEMO_OUTREACH_REQUEST,
  allocationOptimal,
  evaluateOutreachPrioritization,
  noAutonomousSchedule,
  outreachSummary,
  selectionsSourced
} from "../../../../../lib/outreach-prioritization";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "outreach-prioritization-agent";

/**
 * Google A2A `tasks/send` endpoint for the Care-Management Capacity Allocation / Outreach Prioritization
 * agent — a care-coordination / capacity-planning service on the patient & clinical plane that, given a care
 * team's fixed capacity for the cycle and a set of candidate proactive interventions, selects the
 * max-benefit subset that fits the capacity via the 0/1 KNAPSACK dynamic-programming optimization.
 *
 *   POST /api/agents/outreach-prioritization/tasks
 *
 * Loads an outreach request and DETERMINISTICALLY evaluates it via evaluateOutreachPrioritization: it runs
 * the 0/1 knapsack DP over the candidates, selects the optimal feasible subset, defers the rest, and derives
 * all-scheduled / some-deferred. There is no CUSUM, no k-way merge, no recursive boolean tree, no stable
 * matching, no geospatial distance, no checksum, no union-find, no percentile, no largest-remainder
 * apportionment, no FSM transition, no edit distance, no interval selection, no bin-packing, no
 * sliding-window count, no interval merge, no topological sort, no set-difference, and no hash chain — it is
 * the 0/1 knapsack via dynamic programming, a pure function of the candidates. Every selection is sourced,
 * the allocation is optimal + feasible, and nothing is scheduled — a care lead confirms, and deferred
 * interventions are deferred, never denied. This is a PHI-bearing agent (phiAccessed:true throughout). The
 * interventions are illustrative; real capacity planning weighs urgency, consent, staffing, and equity.
 *
 * Enforced-block policies checked before any allocation leaves the fabric:
 *   - policy.outreach.selections-sourced (signal outreachSelectionsSourced).
 *   - policy.outreach.allocation-optimal (signal outreachAllocationOptimal).
 *   - policy.outreach.no-autonomous-schedule (signal outreachNoAutonomousSchedule).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: OutreachRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if every selection is sourced, the allocation is optimal + feasible,
 *   and it is not auto-scheduled) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("outreach-prioritization");
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
      ? (data.request as OutreachRequest)
      : DEMO_OUTREACH_REQUEST;

  // Deterministic 0/1 knapsack allocation.
  const determination = evaluateOutreachPrioritization(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as OutreachDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: selections-sourced + allocation-optimal + no autonomous schedule.
  const sourced = selectionsSourced(determinationForCheck);
  const optimal = allocationOptimal(determinationForCheck);
  const noAutonomous = noAutonomousSchedule(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      outreachSelectionsSourced: sourced,
      outreachAllocationOptimal: optimal,
      outreachNoAutonomousSchedule: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "outreach.optimize-allocation.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        cycleRef: request.cycleRef,
        outreachSelectionsSourced: sourced,
        outreachAllocationOptimal: optimal,
        outreachNoAutonomousSchedule: noAutonomous,
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
          `Pause Agent Fabric blocked this outreach allocation: ${governance.blockingViolations
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

  const summary = outreachSummary(determination);

  // Receive-candidates span — the fabric records the candidates it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "outreach.receive-candidates",
    protocol: "a2a",
    attributes: {
      cycleRef: request.cycleRef,
      candidateCount: determination.candidates.length,
      capacity: determination.capacity,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Optimize-allocation span — the 0/1 knapsack DP, parented to the received candidates.
  const optimizeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "outreach.optimize-allocation",
    protocol: "a2a",
    attributes: {
      cycleRef: request.cycleRef,
      selectedCount: determination.selected.length,
      totalBenefit: determination.totalBenefit,
      outreachSelectionsSourced: sourced,
      outreachAllocationOptimal: optimal,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the disposition, parented to the optimization.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: optimizeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "outreach.classify-disposition",
    protocol: "a2a",
    attributes: {
      cycleRef: request.cycleRef,
      disposition: determination.disposition,
      deferredCount: determination.deferred.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the allocation recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "outreach.log-audit",
    protocol: "a2a",
    attributes: {
      cycleRef: request.cycleRef,
      disposition: determination.disposition,
      outreachNoAutonomousSchedule: noAutonomous,
      requiresCareLeadReview: determination.requiresCareLeadReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, cycleRef: request.cycleRef };

  const completedMessage =
    determination.disposition === "all-scheduled"
      ? `Outreach prioritization complete — all ${determination.candidates.length} intervention(s) fit the ${determination.capacity}-hour capacity (projected benefit ${determination.totalBenefit}); a recommendation for a care lead, nothing scheduled (synthetic — 0/1 knapsack DP, NOT a certified care-management / capacity-planning system).`
      : `Outreach prioritization complete — ${determination.selected.length} of ${determination.candidates.length} intervention(s) selected within the ${determination.capacity}-hour capacity (max projected benefit ${determination.totalBenefit}), ${determination.deferred.length} deferred to a later cycle; a recommendation for a care lead, nothing scheduled (synthetic — 0/1 knapsack DP, NOT a certified care-management / capacity-planning system).`;

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
        name: "OutreachDetermination",
        description:
          "Deterministically-produced care-management capacity-allocation finding. Given a care team's fixed capacity (outreach hours this cycle) and a set of candidate proactive interventions (each with an hours cost and a projected benefit), it runs the 0/1 KNAPSACK via DYNAMIC PROGRAMMING — the capacity-constrained maximum-value-subset optimization, filling a DP table dp[i][c] = max(dp[i-1][c], dp[i-1][c-cost_i] + benefit_i) and reconstructing the optimal set — selecting the subset that maximizes total projected benefit within the capacity, deferring the rest, and reporting the selected + deferred sets, the total cost / benefit, the remaining capacity, and the disposition: all-scheduled (every candidate fits) or some-deferred. Every selected and deferred intervention traces to a submitted candidate (no fabricated intervention), every candidate appears exactly once across selected ∪ deferred (none dropped or double-counted), the allocation is optimal + feasible — recomputing the knapsack DP reproduces the maximum benefit and the selection fits the capacity — and no outreach is launched, no plan committed, and no intervention booked; a care lead confirms, and a deferred intervention is deferred, never denied. There is no CUSUM, no k-way merge, no recursive boolean tree, no stable matching, no geospatial distance, no checksum, no union-find, no percentile, no largest-remainder apportionment, no FSM transition, no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, and no hash chain — it is the 0/1 knapsack via dynamic programming, a pure function of the candidates. This is a PHI-bearing agent — the interventions reference patients. It is DISTINCT from the Caseload Balancing agent (which bin-packs a whole panel across managers), the Population Health agent (which ranks a panel by risk), and the Care Gap agent (which acts on a measure gap); this selects a max-benefit subset of interventions under a capacity budget. The interventions are illustrative synthetics, NOT a certified care-management / capacity-planning system (real capacity planning weighs clinical urgency, member consent, staffing mix, regulatory timeliness, and equity — not a single benefit score under one hours budget).",
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
        cycleRef: request.cycleRef,
        disposition: determination.disposition,
        capacity: determination.capacity,
        selectedCount: summary.selectedCount,
        deferredCount: summary.deferredCount,
        totalBenefit: determination.totalBenefit,
        totalCost: determination.totalCost,
        remainingCapacity: determination.remainingCapacity,
        requiresCareLeadReview: summary.requiresCareLeadReview,
        outreachSelectionsSourced: sourced,
        outreachAllocationOptimal: optimal,
        outreachNoAutonomousSchedule: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
