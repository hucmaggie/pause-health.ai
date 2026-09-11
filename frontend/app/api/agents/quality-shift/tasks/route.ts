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
  type QualityShiftDetermination,
  type QualityShiftRequest,
  DEMO_QUALITY_SHIFT_REQUEST,
  cusumConsistent,
  evaluateQualityShift,
  noAutonomousIntervention,
  observationsSourced,
  qualityShiftSummary
} from "../../../../../lib/quality-shift";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "quality-shift-agent";

/**
 * Google A2A `tasks/send` endpoint for the Clinical Quality-Measure Shift Detection (Statistical Process
 * Control) agent — a care-coordination / quality-analytics service on the patient & clinical plane that
 * watches a time-ordered series of a clinical quality measure for a SUSTAINED shift away from its target
 * using a two-sided TABULAR CUSUM change-point-detection control chart.
 *
 *   POST /api/agents/quality-shift/tasks
 *
 * Loads a quality-shift request and DETERMINISTICALLY evaluates it via evaluateQualityShift: it runs the
 * two-sided tabular CUSUM over the observations, finds the first alarm, and classifies the signal
 * (in-control / shift-up-detected / shift-down-detected). There is no k-way merge, no recursive boolean
 * tree, no stable matching, no geospatial distance, no checksum, no union-find, no percentile / rank, no
 * largest-remainder apportionment, no FSM transition, no edit distance, no interval selection, no
 * bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, and no
 * hash chain — it is change-point detection via a CUSUM control chart, a pure function of the observations.
 * Every charted point is sourced, the CUSUM recomputes, and nothing is actioned — a quality reviewer
 * confirms every signal. This is a PHI-bearing agent (phiAccessed:true throughout; the measures are derived
 * from patient clinical data). The measures are illustrative de-identified aggregate rates; real SPC tunes
 * k and h to a target ARL and combines multiple charts.
 *
 * Enforced-block policies checked before any detection leaves the fabric:
 *   - policy.quality.observations-sourced (signal qualityObservationsSourced).
 *   - policy.quality.cusum-consistent (signal qualityCusumConsistent).
 *   - policy.quality.no-autonomous-intervention (signal qualityNoAutonomousIntervention).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: QualityShiftRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if every point is sourced, the CUSUM recomputes, and it is not
 *   auto-actioned) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("quality-shift");
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
      ? (data.request as QualityShiftRequest)
      : DEMO_QUALITY_SHIFT_REQUEST;

  // Deterministic CUSUM detection.
  const determination = evaluateQualityShift(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as QualityShiftDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: observations-sourced + cusum-consistent + no autonomous intervention.
  const sourced = observationsSourced(determinationForCheck);
  const consistent = cusumConsistent(determinationForCheck);
  const noAutonomous = noAutonomousIntervention(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      qualityObservationsSourced: sourced,
      qualityCusumConsistent: consistent,
      qualityNoAutonomousIntervention: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "quality.run-cusum.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        measureRef: request.measureRef,
        qualityObservationsSourced: sourced,
        qualityCusumConsistent: consistent,
        qualityNoAutonomousIntervention: noAutonomous,
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
          `Pause Agent Fabric blocked this quality-measure detection: ${governance.blockingViolations
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

  const summary = qualityShiftSummary(determination);

  // Receive-series span — the fabric records the series it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "quality.receive-series",
    protocol: "a2a",
    attributes: {
      measureRef: request.measureRef,
      observationCount: determination.observations.length,
      target: determination.target,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Run-cusum span — the two-sided tabular CUSUM, parented to the received series.
  const cusumSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "quality.run-cusum",
    protocol: "a2a",
    attributes: {
      measureRef: request.measureRef,
      peakHigh: determination.peakHigh,
      peakLow: determination.peakLow,
      qualityObservationsSourced: sourced,
      qualityCusumConsistent: consistent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-signal span — the signal, parented to the CUSUM.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: cusumSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "quality.classify-signal",
    protocol: "a2a",
    attributes: {
      measureRef: request.measureRef,
      signal: determination.signal,
      alarmIndex: determination.alarmIndex,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the detection recorded to the audit trail, parented to the signal.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "quality.log-audit",
    protocol: "a2a",
    attributes: {
      measureRef: request.measureRef,
      signal: determination.signal,
      qualityNoAutonomousIntervention: noAutonomous,
      requiresQualityReview: determination.requiresQualityReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, measureRef: request.measureRef };

  const completedMessage =
    determination.signal === "in-control"
      ? `Quality-measure detection complete — ${determination.observations.length} observation(s) of ${determination.measureRef} charted, the measure is IN CONTROL; a recommendation for a quality reviewer, nothing actioned (synthetic — two-sided tabular CUSUM, NOT a certified SPC / quality-surveillance platform).`
      : `Quality-measure detection complete — a sustained ${determination.alarmDirection === "up" ? "UPWARD" : "DOWNWARD"} shift in ${determination.measureRef} detected at observation ${determination.alarmIndex}; a recommendation for a quality reviewer, nothing actioned (synthetic — two-sided tabular CUSUM, NOT a certified SPC / quality-surveillance platform).`;

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
        name: "QualityShiftDetermination",
        description:
          "Deterministically-produced quality-measure shift-detection finding. It watches a time-ordered series of a clinical quality measure and runs a two-sided TABULAR CUSUM (cumulative-sum) control chart — accumulating an upper sum SH_i = max(0, SH_{i-1} + (x_i − target) − k) and a lower sum SL_i = max(0, SL_{i-1} + (target − x_i) − k) and signaling the first observation whose sum exceeds the decision threshold h — reporting the charted CUSUM points, the signal (in-control / shift-up-detected / shift-down-detected), the first-alarm index + direction, and the peak sums. Every charted point traces to a submitted observation (no fabricated point), every submitted observation is charted exactly once (none dropped or double-charted), the CUSUM recomputes — re-running the chart reproduces every SH_i / SL_i, the alarm index, the direction, and the signal — and no corrective action, recall campaign, or process change is launched; a quality reviewer confirms the signal. There is no k-way merge, no recursive boolean tree, no stable matching, no geospatial distance, no checksum, no union-find, no percentile / rank, no largest-remainder apportionment, no FSM transition, no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, and no hash chain — it is change-point detection via a CUSUM control chart, a pure function of the observations. This is a PHI-bearing agent — the measures are derived from patient clinical data. It is DISTINCT from the HEDIS agent (which computes a measure rate), the Population Health agent (which prioritizes a panel by risk), the Provider Benchmarking agent (which ranks a value against peers), and the Remote Monitoring agent (which checks one patient's vitals against a threshold); this watches a quality-measure series for a sustained shift over time. The measures are illustrative de-identified aggregate rate series, NOT a certified SPC / quality-surveillance platform (real SPC tunes k and h to a target ARL, combines CUSUM with Shewhart / EWMA charts, and accounts for autocorrelation and measure specifications).",
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
        measureRef: request.measureRef,
        signal: determination.signal,
        alarmIndex: determination.alarmIndex,
        alarmDirection: determination.alarmDirection,
        observationCount: summary.observationCount,
        peakHigh: determination.peakHigh,
        peakLow: determination.peakLow,
        requiresQualityReview: summary.requiresQualityReview,
        qualityObservationsSourced: sourced,
        qualityCusumConsistent: consistent,
        qualityNoAutonomousIntervention: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
