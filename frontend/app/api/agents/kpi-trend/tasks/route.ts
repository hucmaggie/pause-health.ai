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
  type KpiTrendDetermination,
  type KpiTrendRequest,
  DEMO_KPI_TREND_REQUEST,
  evaluateKpiTrend,
  fitConsistent,
  kpiTrendSummary,
  noAutonomousCommit,
  seriesSourced
} from "../../../../../lib/kpi-trend";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "kpi-trend-agent";

/**
 * Google A2A `tasks/send` endpoint for the Commercial KPI Trend & Projection agent — a commercial-operations
 * / analytics service on the COMMERCIAL CRM plane (no patient PHI) that, given a time-ordered series of a
 * business metric, fits an ordinary LEAST-SQUARES linear-regression line, classifies the trend, and projects
 * the metric to a future horizon.
 *
 *   POST /api/agents/kpi-trend/tasks
 *
 * Loads a KPI-trend request and DETERMINISTICALLY evaluates it via evaluateKpiTrend: it runs ordinary
 * least-squares regression over the observations, emits one fitted point each, classifies the trend
 * (rising / flat / declining), and projects to the horizon. There is no knapsack, no CUSUM, no k-way merge,
 * no recursive boolean tree, no stable matching, no geospatial distance, no checksum, no union-find, no
 * percentile, no largest-remainder apportionment, no FSM transition, no edit distance, no interval
 * selection, no topological sort, no set-difference, no hash chain, and no forecast rollup — it is ordinary
 * least-squares linear regression, a pure function of the observations. Every fitted point is sourced, the
 * fit + projection recompute, and nothing is committed — a revenue analyst confirms. This agent carries NO
 * patient PHI (phiAccessed:false) and is NOT on the HIPAA-audit policy. The metrics are illustrative; real
 * commercial forecasting weighs seasonality, cohort dynamics, and human judgment.
 *
 * Enforced-block policies checked before any fit leaves the fabric:
 *   - policy.kpi.series-sourced (signal kpiSeriesSourced).
 *   - policy.kpi.fit-consistent (signal kpiFitConsistent).
 *   - policy.kpi.no-autonomous-commit (signal kpiNoAutonomousCommit).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: KpiTrendRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if every point is sourced, the fit recomputes, and it is not
 *   auto-committed) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("kpi-trend");
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
      ? (data.request as KpiTrendRequest)
      : DEMO_KPI_TREND_REQUEST;

  // Deterministic ordinary least-squares fit + projection.
  const determination = evaluateKpiTrend(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as KpiTrendDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: series-sourced + fit-consistent + no autonomous commit.
  const sourced = seriesSourced(determinationForCheck);
  const consistent = fitConsistent(determinationForCheck);
  const noAutonomous = noAutonomousCommit(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      kpiSeriesSourced: sourced,
      kpiFitConsistent: consistent,
      kpiNoAutonomousCommit: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "kpi.fit-regression.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        seriesRef: request.seriesRef,
        kpiSeriesSourced: sourced,
        kpiFitConsistent: consistent,
        kpiNoAutonomousCommit: noAutonomous,
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
          `Pause Agent Fabric blocked this KPI-trend fit: ${governance.blockingViolations
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

  const summary = kpiTrendSummary(determination);

  // Receive-series span — the fabric records the observations it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "kpi.receive-series",
    protocol: "a2a",
    attributes: {
      seriesRef: request.seriesRef,
      observationCount: determination.observations.length,
      horizon: determination.horizon,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Fit-regression span — the least-squares fit, parented to the received series.
  const fitSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "kpi.fit-regression",
    protocol: "a2a",
    attributes: {
      seriesRef: request.seriesRef,
      slope: determination.slope,
      rSquared: determination.rSquared,
      kpiSeriesSourced: sourced,
      kpiFitConsistent: consistent,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-trend span — the trend + projection, parented to the fit.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: fitSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "kpi.classify-trend",
    protocol: "a2a",
    attributes: {
      seriesRef: request.seriesRef,
      trend: determination.trend,
      projection: determination.projection,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the fit recorded to the audit trail, parented to the classification.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "kpi.log-audit",
    protocol: "a2a",
    attributes: {
      seriesRef: request.seriesRef,
      trend: determination.trend,
      kpiNoAutonomousCommit: noAutonomous,
      requiresAnalystReview: determination.requiresAnalystReview,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, seriesRef: request.seriesRef };

  const round = (x: number) => Math.round(x * 100) / 100;
  const completedMessage = `KPI trend complete — ${determination.trend.toUpperCase()} (slope ${round(
    determination.slope
  )}, R² ${round(determination.rSquared)}), projecting ${round(determination.projection)} at index ${
    determination.horizon
  }; a recommendation for a revenue analyst, nothing committed (synthetic — ordinary least-squares regression, no patient PHI, NOT a certified forecasting / FP&A system).`;

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
        name: "KpiTrendDetermination",
        description:
          "Deterministically-produced commercial KPI trend + projection. Given a time-ordered series of a business metric, it fits an ordinary LEAST-SQUARES linear-regression line (slope = (n·Σxy − Σx·Σy) / (n·Σx² − (Σx)²), intercept = (Σy − slope·Σx) / n, R² = 1 − SSres/SStot), emits one fitted point per observation (with its fitted value + residual), classifies the trend (rising / flat / declining) against a documented flat tolerance, and projects the metric to a future horizon (ŷ = slope·horizon + intercept). Every fitted point traces to a submitted observation (no fabricated point), every observation appears exactly once (none dropped or double-plotted), the fit + projection recompute from the observations, and no projection is committed as a forecast, no quota adjusted, and finance not notified; a revenue analyst confirms. There is no knapsack, no CUSUM, no k-way merge, no recursive boolean tree, no stable matching, no geospatial distance, no checksum, no union-find, no percentile, no largest-remainder apportionment, no FSM transition, no edit distance, no interval selection, no topological sort, no set-difference, no hash chain, and no forecast rollup — it is ordinary least-squares linear regression, a pure function of the observations. This agent operates ONLY on the commercial CRM plane — it carries NO patient PHI and is NOT on the HIPAA-audit policy. It is DISTINCT from the Pipeline Management agent (which rolls up CRM opportunity records into a forecast) and the Account Management agent (which health-scores signed accounts); this fits a least-squares trend line to a KPI series and projects it. The metrics are illustrative aggregate business figures, NOT a certified forecasting / FP&A system (real commercial forecasting weighs seasonality, pipeline mix, cohort dynamics, macro conditions, and human judgment — not a single straight line through past points).",
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
        trend: determination.trend,
        slope: determination.slope,
        intercept: determination.intercept,
        rSquared: determination.rSquared,
        projection: determination.projection,
        horizon: determination.horizon,
        observationCount: summary.observationCount,
        requiresAnalystReview: summary.requiresAnalystReview,
        kpiSeriesSourced: sourced,
        kpiFitConsistent: consistent,
        kpiNoAutonomousCommit: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
