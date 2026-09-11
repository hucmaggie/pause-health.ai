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
  type PeakWindowDetermination,
  type PeakWindowRequest,
  DEMO_PEAK_WINDOW_REQUEST,
  evaluatePeakWindow,
  noAutonomousAction,
  peakWindowSummary,
  windowOptimal,
  windowSourced
} from "../../../../../lib/peak-window";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "peak-window-agent";

/**
 * Google A2A `tasks/send` endpoint for the Commercial Peak-Window / Maximum Contiguous Net-Gain Detection
 * agent — a commercial-analytics service that, given a time-ordered series of a business metric's signed
 * per-period net change, finds the single maximum-sum contiguous window via KADANE'S MAXIMUM-SUBARRAY.
 *
 *   POST /api/agents/peak-window/tasks
 *
 * Loads a peak-window request and DETERMINISTICALLY evaluates it via evaluatePeakWindow: a single linear scan
 * carrying a running sum that resets when starting fresh beats extending, tracking the best window. There is
 * no least-squares regression, no CUSUM, no sliding-window count, no window-vs-baseline, no knapsack, no
 * weighted-interval schedule, no Dijkstra, no majority vote, no trie match, no k-way merge, no percentile, no
 * union-find, and no checksum — it is Kadane's maximum-subarray, a pure function of the series. The window is
 * sourced + self-honest, optimal, and nothing is committed — a revenue analyst confirms. This is DELIBERATELY
 * NOT a PHI-bearing agent (phiAccessed:false throughout) — it runs only on the commercial CRM plane.
 *
 * Enforced-block policies checked before any finding leaves the fabric:
 *   - policy.peak-window.window-sourced (signal peakWindowSourced).
 *   - policy.peak-window.window-optimal (signal peakWindowOptimal).
 *   - policy.peak-window.no-autonomous-action (signal peakWindowNoAutonomousAction).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: PeakWindowRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the window is sourced + self-honest, optimal, and not auto-actioned)
 *   demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("peak-window");
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
      ? (data.request as PeakWindowRequest)
      : DEMO_PEAK_WINDOW_REQUEST;

  // Deterministic Kadane maximum-subarray detection.
  const determination = evaluatePeakWindow(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as PeakWindowDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: window sourced + self-honest, window optimal, no autonomous action.
  const sourced = windowSourced(determinationForCheck);
  const optimal = windowOptimal(determinationForCheck);
  const noAutonomous = noAutonomousAction(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      peakWindowSourced: sourced,
      peakWindowOptimal: optimal,
      peakWindowNoAutonomousAction: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "peak.scan-max-subarray.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        seriesRef: request.seriesRef,
        peakWindowSourced: sourced,
        peakWindowOptimal: optimal,
        peakWindowNoAutonomousAction: noAutonomous,
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
          `Pause Agent Fabric blocked this peak-window finding: ${governance.blockingViolations
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

  const summary = peakWindowSummary(determination);

  // Receive-series span — the fabric records the series it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "peak.receive-series",
    protocol: "a2a",
    attributes: {
      seriesRef: request.seriesRef,
      periodCount: determination.series.length,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Scan span — Kadane's maximum-subarray, parented to the received series.
  const scanSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "peak.scan-max-subarray",
    protocol: "a2a",
    attributes: {
      seriesRef: request.seriesRef,
      windowSum: determination.windowSum,
      windowLength: determination.windowLength,
      peakWindowSourced: sourced,
      peakWindowOptimal: optimal,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the finding disposition, parented to the scan.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: scanSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "peak.classify-disposition",
    protocol: "a2a",
    attributes: {
      seriesRef: request.seriesRef,
      disposition: determination.disposition,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the finding recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "peak.log-audit",
    protocol: "a2a",
    attributes: {
      seriesRef: request.seriesRef,
      disposition: determination.disposition,
      peakWindowNoAutonomousAction: noAutonomous,
      requiresAnalystReview: determination.requiresAnalystReview,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, seriesRef: request.seriesRef };

  const completedMessage =
    determination.hasPositiveWindow
      ? `Peak-window detection complete — peak net-gain window nets +${determination.windowSum} over ${determination.windowLength} period(s); a recommendation for a revenue analyst, nothing committed (synthetic — Kadane's maximum-subarray, NOT a certified analytics system).`
      : `Peak-window detection complete — no positive net-gain window (best ${determination.windowSum}); a recommendation for a revenue analyst, nothing committed (synthetic — Kadane's maximum-subarray, NOT a certified analytics system).`;

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
        name: "PeakWindowDetermination",
        description:
          "Deterministically-produced commercial peak-window finding. Given a time-ordered series of a business metric's signed per-period net change (net-new ARR = bookings − churn, net enrolled patients = adds − drops, net revenue delta), it runs KADANE'S MAXIMUM-SUBARRAY algorithm — a single linear scan carrying a running sum that resets whenever extending the previous stretch would do worse than starting fresh at the current period (curSum = max(x_i, curSum + x_i)), tracking the best window seen — to find the single maximum-sum contiguous window (the strongest sustained net-gain stretch), reporting its start / end period, summed net gain, and length, or honestly reporting no positive window when every contiguous stretch nets a loss, and deriving the disposition: positive-window or no-positive-window. The window is sourced + self-honest (a real contiguous sub-range of the series, the reported length matching, the reported windowSum equal to the actual sum over that range), optimal — re-running Kadane's maximum-subarray reproduces the reported windowSum + disposition — and nothing is committed, no quota adjusted, and finance not notified; a revenue analyst confirms. A fixed-width or whole-series average hides the true peak run; Kadane finds the exact contiguous window that maximizes net gain. There is no least-squares regression, no CUSUM, no sliding-window count, no window-vs-baseline, no knapsack, no weighted-interval schedule, no Dijkstra path, no majority vote, no trie match, no k-way merge, no percentile, no union-find, and no checksum — it is Kadane's maximum-subarray, a pure function of the series. It COMPLEMENTS the KPI Trend agent (which fits a least-squares trend line and projects it) and the Pipeline Management agent (which rolls up CRM opportunity records): this finds the peak contiguous net-gain window. It operates ONLY on the commercial CRM plane — NO patient PHI. The series are illustrative aggregate business figures, NOT a certified analytics / FP&A system (real commercial analytics weighs seasonality, cohort dynamics, pipeline mix, macro conditions, and human judgment).",
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
        seriesRef: request.seriesRef,
        disposition: determination.disposition,
        startIndex: determination.startIndex,
        endIndex: determination.endIndex,
        windowSum: determination.windowSum,
        windowLength: determination.windowLength,
        periodCount: summary.periodCount,
        requiresAnalystReview: summary.requiresAnalystReview,
        peakWindowSourced: sourced,
        peakWindowOptimal: optimal,
        peakWindowNoAutonomousAction: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
