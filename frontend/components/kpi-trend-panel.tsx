"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type KpiFitPoint,
  type KpiTrend,
  type KpiTrendDetermination,
  type KpiTrendRequest,
  DEMO_KPI_TREND_DECLINING_REQUEST,
  DEMO_KPI_TREND_FLAT_REQUEST,
  DEMO_KPI_TREND_REQUEST,
  evaluateKpiTrend
} from "../lib/kpi-trend";

/**
 * Commercial KPI Trend & Projection runner for the intake demo.
 *
 * Fires the real, server-side A2A KPI Trend agent at /api/agents/kpi-trend/tasks — a commercial-operations
 * analytics service that fits an ordinary least-squares linear-regression line to a business-metric series,
 * classifies the trend, and projects the metric to a future horizon. The panel surfaces the trend, the
 * slope / R² / projection, the honesty signals, the synthetic / no-PHI labels, and a deep link into the
 * parented Agent Fabric trace.
 *
 * A fit — rising / flat / declining — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresAnalystReview:true, autoCommitted:false). The phantom-point, mis-fit, and auto-committed presets
 * assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than
 * hidden.
 *
 * NO patient PHI — the metrics are aggregate business figures on the commercial CRM plane. They are
 * ILLUSTRATIVE synthetics, NOT a certified forecasting / FP&A system. Structure, styling tokens, and tone
 * mirror <OutreachPrioritizationPanel> so this reads as a native sibling on /demo/intake.
 */

const KPI_ROUTE = "/api/agents/kpi-trend/tasks";

/** A one-click demo scenario. */
export type KpiPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: KpiTrendRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the rising demo — the block base. */
const VALID_DETERMINATION = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);

export const KPI_PRESETS: KpiPreset[] = [
  {
    id: "rising",
    label: "Adoption climbing \u2192 rising",
    hint: "Six months of provider-org adoption trending up.",
    request: DEMO_KPI_TREND_REQUEST,
    demonstrates:
      "Least-squares regression \u2014 a positive slope, high R², projected forward to the next horizon."
  },
  {
    id: "flat",
    label: "Steady \u2192 flat",
    hint: "A constant metric within the flat tolerance.",
    request: DEMO_KPI_TREND_FLAT_REQUEST,
    demonstrates: "A near-zero slope inside the flat band \u2014 classified flat."
  },
  {
    id: "declining",
    label: "Cohort shrinking \u2192 declining",
    hint: "A metric trending down month over month.",
    request: DEMO_KPI_TREND_DECLINING_REQUEST,
    demonstrates: "A negative slope \u2014 classified declining, projected lower."
  },
  {
    id: "phantom-point-block",
    label: "Phantom data point \u2192 governance block",
    hint: "A fitted point not among the observations.",
    request: DEMO_KPI_TREND_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      points: [...VALID_DETERMINATION.points, { index: 99, value: 999, fitted: 0, residual: 0 }]
    },
    demonstrates:
      "The Agent Fabric blocking a fit with a fabricated point not among the observations (policy.kpi.series-sourced)."
  },
  {
    id: "mis-fit-block",
    label: "Mis-fit line \u2192 governance block",
    hint: "A reported slope the data doesn't support.",
    request: DEMO_KPI_TREND_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      slope: 5,
      projection: 50
    },
    demonstrates:
      "The Agent Fabric blocking a mis-fit line whose slope + projection don't recompute (policy.kpi.fit-consistent)."
  },
  {
    id: "auto-committed-block",
    label: "Forecast committed autonomously \u2192 governance block",
    hint: "A projection that committed itself as a forecast.",
    request: DEMO_KPI_TREND_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresAnalystReview: false,
      autoCommitted: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous forecast commit (policy.kpi.no-autonomous-commit)."
  }
];

/** Render-ready view of a produced fit lifted from the task. */
export type KpiResolvedView = {
  kind: "resolved";
  seriesRef: string;
  trend: KpiTrend;
  points: KpiFitPoint[];
  slope: number;
  intercept: number;
  rSquared: number;
  projection: number;
  horizon: number;
  reason: string;
  note: string;
  kpiSeriesSourced: boolean;
  kpiFitConsistent: boolean;
  kpiNoAutonomousCommit: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type KpiBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type KpiInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type KpiView = KpiResolvedView | KpiBlockedView | KpiInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  kpiSeriesSourced?: unknown;
  kpiFitConsistent?: unknown;
  kpiNoAutonomousCommit?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildKpiRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: KpiTrendRequest;
  determination?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (input.request !== undefined) data.request = input.request;
  if (input.determination !== undefined) data.determination = input.determination;
  return {
    jsonrpc: "2.0" as const,
    id: input.taskId,
    method: "tasks/send" as const,
    params: {
      id: input.taskId,
      message: {
        role: "user" as const,
        parts: [{ type: "data" as const, data }]
      },
      metadata: { personaId: input.personaId ?? "demo" }
    }
  };
}

/**
 * POST a KPI-trend request (or an asserted fit) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP
 * 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runKpiTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: KpiTrendRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(KPI_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildKpiRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced fit
 * (completed) from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function kpiViewFromTask(task: A2ATask): KpiView {
  const fabric = ((task.metadata?.agentFabric as FabricMeta) ?? {}) as FabricMeta;
  const traceTaskId =
    (typeof fabric.traceTaskId === "string" && fabric.traceTaskId) || task.id;

  if (task.status.state === "failed") {
    if (fabric.decision === "block") {
      const violations = Array.isArray(fabric.violations)
        ? (fabric.violations as { policyId: string; reason: string }[])
        : [];
      const message =
        task.status.message?.parts.find((p) => p.type === "text")?.text ??
        "The Agent Fabric blocked this KPI-trend fit.";
      return {
        kind: "blocked",
        message,
        policiesEvaluated: asStringArray(fabric.policiesEvaluated),
        violations,
        traceTaskId
      };
    }
    const message =
      task.status.message?.parts.find((p) => p.type === "text")?.text ??
      (typeof fabric.error === "string" ? fabric.error : "The fit could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: KpiTrendDetermination; seriesRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    seriesRef: result?.seriesRef ?? det?.seriesRef ?? "",
    trend: det?.trend ?? "flat",
    points: det?.points ?? [],
    slope: det?.slope ?? 0,
    intercept: det?.intercept ?? 0,
    rSquared: det?.rSquared ?? 0,
    projection: det?.projection ?? 0,
    horizon: det?.horizon ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    kpiSeriesSourced: fabric.kpiSeriesSourced === true,
    kpiFitConsistent: fabric.kpiFitConsistent === true,
    kpiNoAutonomousCommit: fabric.kpiNoAutonomousCommit === true,
    traceTaskId
  };
}

const TREND_TONE: Record<KpiTrend, string> = {
  rising: "#8fd6b0",
  flat: "#cbd5e1",
  declining: "#ffb6c8"
};

const TREND_LABEL: Record<KpiTrend, string> = {
  rising: "Rising \u00b7 positive least-squares slope",
  flat: "Flat \u00b7 slope within the flat tolerance",
  declining: "Declining \u00b7 negative least-squares slope"
};

const round = (x: number) => Math.round(x * 100) / 100;

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: KpiView }
  | { status: "error"; message: string };

export function KpiTrendPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: KpiPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runKpiTask({
          taskId: newTaskId("kpi-trend"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: kpiViewFromTask(task) });
      } catch (err) {
        setRunState({
          status: "error",
          message: err instanceof Error ? err.message : String(err)
        });
      }
    })();
  };

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
        Commercial operations &middot; analytics &middot; least-squares regression
      </p>
      <h3 style={{ margin: 0 }}>
        Commercial KPI Trend &amp; Projection — series sourced, fit consistent, never an autonomous commit
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> fits an ordinary <strong>least-squares</strong>{" "}
        regression line to a business-metric series &mdash; not a forecast rollup, not a percentile &mdash;
        reporting its <strong>slope</strong>, <strong>R&sup2;</strong>, and a <strong>projection</strong> to a
        future horizon. Every point is <strong>sourced</strong>, the fit <strong>recomputes</strong>, and the
        projection is a <strong>recommendation</strong>: the agent <strong>never</strong> commits a forecast,
        adjusts a quota, or notifies finance &mdash; a revenue analyst confirms.{" "}
        <strong>Commercial CRM plane &middot; NO patient PHI &middot; illustrative, not a certified FP&amp;A
        system.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {KPI_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => runPreset(preset)}
            title={`${preset.hint} ${preset.demonstrates}`}
            style={{ fontSize: "0.85rem" }}
          >
            {runState.status === "running" && runState.label === preset.label
              ? "Fitting\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Fit failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <KpiResult view={runState.view} />}
    </section>
  );
}

function KpiResult({ view }: { view: KpiView }) {
  const traceLink = (
    <p style={{ margin: "0.6rem 0 0", fontSize: "0.86rem" }}>
      <a
        href={`/demo/agent-fabric?taskId=${encodeURIComponent(view.traceTaskId)}`}
        className="agentforce-voice-help-link"
      >
        Open the multi-agent trace &rarr;
      </a>
    </p>
  );

  if (view.kind === "blocked") {
    return (
      <div className="routing-live-result">
        <p className="eyebrow" style={{ marginBottom: "0.3rem", color: "#ffb6c8" }}>
          Blocked by the Agent Fabric
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>{view.message}</p>
        {view.violations.length > 0 && (
          <ul
            style={{
              margin: "0.5rem 0 0",
              paddingLeft: "1.1rem",
              color: "var(--muted)",
              fontSize: "0.85rem"
            }}
          >
            {view.violations.map((v) => (
              <li key={v.policyId}>
                <code>{v.policyId}</code> &mdash; {v.reason}
              </li>
            ))}
          </ul>
        )}
        {view.policiesEvaluated.length > 0 && (
          <p
            style={{
              margin: "0.5rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            policies evaluated: {view.policiesEvaluated.join(", ")}
          </p>
        )}
        {traceLink}
      </div>
    );
  }

  if (view.kind === "invalid") {
    return (
      <div className="routing-live-result">
        <p className="eyebrow" style={{ marginBottom: "0.3rem", color: "#ffd28a" }}>
          Not processed
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>{view.message}</p>
        {traceLink}
      </div>
    );
  }

  const tone = TREND_TONE[view.trend];

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Fit (deterministic, synthetic, no PHI)
        {view.seriesRef ? ` \u00b7 ${view.seriesRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {TREND_LABEL[view.trend]}
      </p>

      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        slope {round(view.slope)} &middot; intercept {round(view.intercept)} &middot; R&sup2;{" "}
        {round(view.rSquared)} &middot; projection {round(view.projection)} at index {view.horizon}
      </p>

      {view.points.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.5rem 0 0.2rem" }}>
            Observations &amp; fitted values
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: "1.1rem",
              fontSize: "0.84rem",
              color: "var(--muted)"
            }}
          >
            {view.points.map((p) => (
              <li key={p.index}>
                index {p.index} &middot; actual {round(p.value)} &middot; fitted {round(p.fitted)} &middot;
                residual {round(p.residual)}
              </li>
            ))}
          </ul>
        </>
      )}

      <div
        role="note"
        aria-label="Fit safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; consistent &middot; never an autonomous commit{" "}
          <span
            style={{
              fontSize: "0.72rem",
              fontWeight: 600,
              color: "#ffd28a",
              border: "1px solid #ffd28a",
              borderRadius: "999px",
              padding: "0.05rem 0.4rem",
              marginLeft: "0.35rem"
            }}
          >
            synthetic &middot; no PHI
          </span>
        </p>
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
          {view.note}
        </p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          kpiSeriesSourced = {String(view.kpiSeriesSourced)} &middot; kpiFitConsistent ={" "}
          {String(view.kpiFitConsistent)} &middot; kpiNoAutonomousCommit ={" "}
          {String(view.kpiNoAutonomousCommit)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
