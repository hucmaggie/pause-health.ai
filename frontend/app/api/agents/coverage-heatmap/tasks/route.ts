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
  type CoverageHeatmapDetermination,
  type CoverageHeatmapRequest,
  DEMO_COVERAGE_HEATMAP_REQUEST,
  accumulationExact,
  coverageHeatmapSummary,
  coverageSourced,
  evaluateCoverageHeatmap,
  noAutonomousStaff
} from "../../../../../lib/coverage-heatmap";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "coverage-heatmap-agent";

/**
 * Google A2A `tasks/send` endpoint for the Coverage Heatmap / Difference-Array Range Accumulation agent — a
 * care-coordination capacity-visibility service that, given staffing coverage intervals and a required minimum,
 * computes the concurrent coverage at every slot and flags the under-staffed slots.
 *
 *   POST /api/agents/coverage-heatmap/tasks
 *
 * Loads a request and DETERMINISTICALLY evaluates it via evaluateCoverageHeatmap: it materializes per-slot
 * coverage via the DIFFERENCE ARRAY (imos range-update + a single prefix-sum pass). There is no Fenwick
 * point-update tree, no greedy interval selection, no Kadane max-subarray, no bin-packing, and no linear
 * partition — it is difference-array range accumulation, a pure function of the intervals + slot count. The
 * coverage is sourced + self-consistent (cross-checked by direct counting), accumulation-exact, and nothing is
 * scheduled — a staffing manager confirms. It is PHI-adjacent (phiAccessed:true — the intervals reference
 * care-unit staffing).
 *
 * An understaffed disposition is a LEGITIMATE FINDING (some slot is below the required minimum), NOT a governance
 * block. Enforced-block policies checked before any heatmap leaves the fabric:
 *   - policy.coverageheat.coverage-sourced (signal coverageSourcedSignal).
 *   - policy.coverageheat.accumulation-exact (signal coverageAccumulationExact).
 *   - policy.coverageheat.no-autonomous-staff (signal coverageNoAutonomousStaff).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: CoverageHeatmapRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the coverage is sourced + self-consistent, accumulation-exact, and not
 *   auto-staffed) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("coverage-heatmap");
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
      ? (data.request as CoverageHeatmapRequest)
      : DEMO_COVERAGE_HEATMAP_REQUEST;

  // Deterministic difference-array coverage heatmap.
  const determination = evaluateCoverageHeatmap(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as CoverageHeatmapDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: coverage sourced + self-consistent, accumulation exact, no autonomous staff.
  const sourced = coverageSourced(determinationForCheck);
  const exact = accumulationExact(determinationForCheck);
  const noAutonomous = noAutonomousStaff(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      coverageSourcedSignal: sourced,
      coverageAccumulationExact: exact,
      coverageNoAutonomousStaff: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "coverageheat.map.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        scheduleRef: request.scheduleRef,
        coverageSourcedSignal: sourced,
        coverageAccumulationExact: exact,
        coverageNoAutonomousStaff: noAutonomous,
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
          `Pause Agent Fabric blocked this heatmap: ${governance.blockingViolations
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

  const summary = coverageHeatmapSummary(determination);

  // Receive-schedule span — the fabric records the schedule it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "coverageheat.receive-schedule",
    protocol: "a2a",
    attributes: {
      scheduleRef: request.scheduleRef,
      slotCount: determination.slotCount,
      intervalCount: determination.intervalCount,
      requiredMin: determination.requiredMin,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Accumulate span — difference-array range accumulation, parented to the received schedule.
  const accumulateSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "coverageheat.accumulate",
    protocol: "a2a",
    attributes: {
      scheduleRef: request.scheduleRef,
      minCoverage: determination.minCoverage,
      maxCoverage: determination.maxCoverage,
      coverageSourcedSignal: sourced,
      coverageAccumulationExact: exact,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the heatmap disposition, parented to the accumulate.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: accumulateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "coverageheat.classify-disposition",
    protocol: "a2a",
    attributes: {
      scheduleRef: request.scheduleRef,
      disposition: determination.disposition,
      understaffedCount: determination.understaffedSlots.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the heatmap recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "coverageheat.log-audit",
    protocol: "a2a",
    attributes: {
      scheduleRef: request.scheduleRef,
      disposition: determination.disposition,
      coverageNoAutonomousStaff: noAutonomous,
      requiresManagerReview: determination.requiresManagerReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, scheduleRef: request.scheduleRef };

  const completedMessage =
    determination.disposition === "fully-covered"
      ? `Heatmap complete — all ${determination.slotCount} slot(s) of ${request.scheduleRef} meet the required minimum of ${determination.requiredMin} staff (coverage ${determination.minCoverage}–${determination.maxCoverage}); a recommendation for a staffing manager, nothing scheduled (synthetic — difference-array accumulation, NOT a certified workforce system).`
      : `Heatmap complete — ${determination.understaffedSlots.length} of ${determination.slotCount} slot(s) of ${request.scheduleRef} are below the required minimum of ${determination.requiredMin} staff (coverage dips to ${determination.minCoverage}); a recommendation for a staffing manager, nothing scheduled (synthetic — difference-array accumulation, NOT a certified workforce system).`;

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
        name: "CoverageHeatmapDetermination",
        description:
          "Deterministically-produced staffing coverage heatmap. Given a set of staffing COVERAGE INTERVALS (each adding some number of staff over a contiguous window of time slots) and a REQUIRED MINIMUM staffing level, it computes the CONCURRENT coverage at every slot via the DIFFERENCE ARRAY (imos / range-update technique): to add `staff` to every slot in [start, end), increment diff[start] and decrement diff[end], then a single PREFIX-SUM pass materializes the coverage at every slot — applying m overlapping intervals in O(m + T), not O(m·T) — and flags the UNDER-STAFFED slots (those below the required minimum). If every slot meets the minimum the disposition is fully-covered; otherwise understaffed (the honest finding that some slot is below the minimum — NOT an error). The per-slot concurrent coverage is the invariant. The coverage is sourced + self-consistent (each coverage[t] equals the true count of staff covering slot t, cross-checked by DIRECT interval counting independent of the difference-array method; the under-staffed slots exactly the below-min slots; honest min/max), accumulation-exact — re-applying the intervals to a fresh difference array reproduces the coverage array — and nothing is scheduled; a staffing manager confirms. CRUCIALLY this is NOT the Fenwick / Benefit Accumulator agent's POINT-UPDATE + PREFIX-QUERY tree (the dual problem — this is RANGE-UPDATE + full MATERIALIZE), NOT the Schedule Conflict agent's GREEDY INTERVAL SELECTION (which picks a max non-overlapping subset — this COUNTS overlaps per slot), NOT the Peak-Window agent's KADANE MAXIMUM-SUBARRAY (a max contiguous sum — this is per-slot occupancy), NOT the Caseload Balancing agent's BIN-PACKING, and NOT the Batch Partition agent's LINEAR PARTITION — it is difference-array range accumulation, a pure function of the intervals + slot count. It is PHI-adjacent — the intervals reference care-unit staffing, so a determination is on the HIPAA audit path. The intervals are an illustrative synthetic, NOT a certified workforce-management / staffing system (real staffing weighs skill mix, acuity-adjusted ratios, licensure, breaks & meal relief, union rules, and float pools — not a bare count of overlapping intervals).",
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
        scheduleRef: request.scheduleRef,
        disposition: determination.disposition,
        minCoverage: determination.minCoverage,
        maxCoverage: determination.maxCoverage,
        requiredMin: determination.requiredMin,
        slotCount: summary.slotCount,
        intervalCount: summary.intervalCount,
        understaffedCount: summary.understaffedCount,
        requiresManagerReview: summary.requiresManagerReview,
        coverageSourcedSignal: sourced,
        coverageAccumulationExact: exact,
        coverageNoAutonomousStaff: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
