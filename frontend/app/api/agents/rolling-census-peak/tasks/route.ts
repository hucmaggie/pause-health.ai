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
  type RollingCensusDetermination,
  type RollingCensusRequest,
  DEMO_ROLLING_CENSUS_REQUEST,
  dequeExact,
  evaluateRollingCensus,
  noAutonomousDivert,
  rollingCensusSummary,
  windowsSourced
} from "../../../../../lib/rolling-census-peak";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "rolling-census-peak-agent";

/**
 * Google A2A `tasks/send` endpoint for the Rolling Census Peak / Sliding-Window Maximum (Monotonic Deque) agent
 * — a care-coordination capacity-monitoring service that, given per-slot census readings and a trailing window
 * width, computes the peak census in every window and flags windows over a capacity threshold.
 *
 *   POST /api/agents/rolling-census-peak/tasks
 *
 * Loads a request and DETERMINISTICALLY evaluates it via evaluateRollingCensus: it computes the per-window peaks
 * via the MONOTONIC DEQUE sliding-window maximum (O(n)). There is no sliding-window COUNT, no difference-array
 * accumulation, no Kadane max-subarray, no prefix-sum tree, and no EDF schedule — it is the sliding-window
 * EXTREMUM, a pure function of the readings + window size. The windows are sourced + self-consistent
 * (cross-checked by direct scanning), deque-exact, and nothing is diverted — a nursing supervisor confirms. It is
 * PHI-adjacent (phiAccessed:true — the census references a care unit's occupancy).
 *
 * An over-capacity disposition is a LEGITIMATE FINDING (a window's peak breaches capacity), NOT a governance
 * block. Enforced-block policies checked before any report leaves the fabric:
 *   - policy.rollingcensus.windows-sourced (signal censusWindowsSourced).
 *   - policy.rollingcensus.deque-exact (signal censusDequeExact).
 *   - policy.rollingcensus.no-autonomous-divert (signal censusNoAutonomousDivert).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: RollingCensusRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the windows are sourced + self-consistent, deque-exact, and not
 *   auto-diverted) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("rolling-census-peak");
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
      ? (data.request as RollingCensusRequest)
      : DEMO_ROLLING_CENSUS_REQUEST;

  // Deterministic monotonic-deque sliding-window maximum.
  const determination = evaluateRollingCensus(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as RollingCensusDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: windows sourced + self-consistent, deque exact, no autonomous divert.
  const sourced = windowsSourced(determinationForCheck);
  const exact = dequeExact(determinationForCheck);
  const noAutonomous = noAutonomousDivert(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      censusWindowsSourced: sourced,
      censusDequeExact: exact,
      censusNoAutonomousDivert: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "rollingcensus.peak.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        unitRef: request.unitRef,
        censusWindowsSourced: sourced,
        censusDequeExact: exact,
        censusNoAutonomousDivert: noAutonomous,
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
          `Pause Agent Fabric blocked this census report: ${governance.blockingViolations
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

  const summary = rollingCensusSummary(determination);

  // Receive-readings span — the fabric records the readings it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "rollingcensus.receive-readings",
    protocol: "a2a",
    attributes: {
      unitRef: request.unitRef,
      readingCount: determination.readingCount,
      windowSize: determination.windowSize,
      capacity: determination.capacity,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Peak span — monotonic-deque sliding-window maximum, parented to the received readings.
  const peakSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "rollingcensus.peak",
    protocol: "a2a",
    attributes: {
      unitRef: request.unitRef,
      peakCensus: determination.peakCensus,
      windowCount: determination.windowCount,
      censusWindowsSourced: sourced,
      censusDequeExact: exact,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the report disposition, parented to the peak.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: peakSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "rollingcensus.classify-disposition",
    protocol: "a2a",
    attributes: {
      unitRef: request.unitRef,
      disposition: determination.disposition,
      overCapacityCount: determination.overCapacityWindows.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the report recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "rollingcensus.log-audit",
    protocol: "a2a",
    attributes: {
      unitRef: request.unitRef,
      disposition: determination.disposition,
      censusNoAutonomousDivert: noAutonomous,
      requiresSupervisorReview: determination.requiresSupervisorReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, unitRef: request.unitRef };

  const completedMessage =
    determination.disposition === "within-capacity"
      ? `Census report complete — all ${determination.windowCount} trailing window(s) of ${request.unitRef} stay within the capacity of ${determination.capacity} (peak census ${determination.peakCensus}); a recommendation for a nursing supervisor, nothing diverted (synthetic — sliding-window maximum, NOT a certified capacity system).`
      : `Census report complete — ${determination.overCapacityWindows.length} of ${determination.windowCount} trailing window(s) of ${request.unitRef} peak above the capacity of ${determination.capacity} (peak census ${determination.peakCensus}); a recommendation for a nursing supervisor, nothing diverted (synthetic — sliding-window maximum, NOT a certified capacity system).`;

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
        name: "RollingCensusDetermination",
        description:
          "Deterministically-produced rolling census-peak report. Given a series of per-slot CENSUS readings (occupancy over time) and a trailing WINDOW width k, it computes the PEAK census in every trailing window via the MONOTONIC DEQUE sliding-window maximum: maintain a deque of candidate indices whose readings are decreasing, pop from the back every index whose reading is ≤ the incoming reading, push the new index, drop the front once it falls out of the window — the front is always the window's maximum, O(n) overall — and flags the windows whose peak exceeds a CAPACITY threshold. If no window breaches capacity the disposition is within-capacity; otherwise over-capacity (the honest finding that a window's peak breaches capacity — NOT an error). The per-window peak is the invariant. The windows are sourced + self-consistent (each window max equals the true max of that window, cross-checked by DIRECT per-window scanning independent of the deque method; the over-capacity windows exactly the breaching windows; honest peak/counts), deque-exact — re-running the monotonic deque reproduces the maxima array — and nothing is diverted; a nursing supervisor confirms. CRUCIALLY this is NOT the Access Anomaly agent's SLIDING-WINDOW COUNTING (a fixed-window EVENT COUNT — this is the sliding-window EXTREMUM via a monotonic deque), NOT the Coverage Heatmap agent's DIFFERENCE-ARRAY RANGE ACCUMULATION (per-slot occupancy from range-adds — this is the rolling MAX over a window of an existing series), NOT the Peak-Window agent's KADANE MAXIMUM-SUBARRAY (a max contiguous SUM — this is a max VALUE per fixed-width window), NOT the Fenwick / Benefit Accumulator agent's PREFIX SUMS, and NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING — it is the sliding-window maximum, a pure function of the readings + window size. It is PHI-adjacent — the census references a care unit's occupancy, so a determination is on the HIPAA audit path. The readings are an illustrative synthetic, NOT a certified capacity-management / patient-flow system (real census management weighs acuity, staffed vs licensed beds, isolation & telemetry needs, anticipated discharges, and boarding — not a bare rolling max over illustrative counts).",
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
        unitRef: request.unitRef,
        disposition: determination.disposition,
        peakCensus: determination.peakCensus,
        capacity: determination.capacity,
        windowSize: determination.windowSize,
        windowCount: summary.windowCount,
        readingCount: summary.readingCount,
        overCapacityCount: summary.overCapacityCount,
        requiresSupervisorReview: summary.requiresSupervisorReview,
        censusWindowsSourced: sourced,
        censusDequeExact: exact,
        censusNoAutonomousDivert: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
