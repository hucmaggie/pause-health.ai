"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type ProviderBenchmarkingDetermination,
  type ProviderBenchmarkingDisposition,
  type ProviderBenchmarkingRequest,
  DEMO_COST_COHORT,
  DEMO_PROVIDER_BENCHMARKING_QUALITY_REQUEST,
  DEMO_PROVIDER_BENCHMARKING_REQUEST,
  DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST
} from "../lib/provider-benchmarking";

/**
 * Provider Cost & Quality Percentile Benchmarking runner for the intake demo.
 *
 * Fires the real, server-side A2A Provider Benchmarking agent at /api/agents/provider-benchmarking/tasks —
 * a commercial-operations service that ranks a target provider within a peer cohort using percentile /
 * rank statistics over a numeric distribution. The panel surfaces the disposition, the percentile rank +
 * effective percentile, the performance band, the cohort median + size, the honesty signals, the
 * synthetic / not-PHI labels, and a deep link into the parented Agent Fabric trace.
 *
 * A finding — benchmark-favorable or benchmark-review — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresNetworkReview:true, autoTiered:false). The mis-sized-cohort, miscomputed-stats, and auto-tiered
 * presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI
 * rather than hidden.
 *
 * DELIBERATELY NOT PHI-bearing — provider-level aggregate metrics, not patient health information. The
 * panel is ILLUSTRATIVE, NOT a certified benchmarking system. Structure, styling tokens, and tone mirror
 * <ClaimLifecyclePanel> so this reads as a native sibling on /demo/intake.
 */

const PROVIDER_BENCHMARKING_ROUTE = "/api/agents/provider-benchmarking/tasks";

/** A one-click demo scenario. */
export type ProviderBenchmarkingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: ProviderBenchmarkingRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the high-cost (bottom-quartile) demo — the block base. */
const VALID_DETERMINATION = {
  benchmarkRef: "bmk-002",
  providerRef: "prov-target-high",
  metricName: "risk-adjusted-cost-per-episode",
  metricDirection: "lower-is-better",
  targetValue: 1450,
  cohort: DEMO_COST_COHORT.map((c) => ({ providerId: c.providerId, value: c.value })),
  cohortSize: 9,
  countBelow: 8,
  countEqual: 0,
  countAbove: 1,
  percentileRank: 88.89,
  effectivePercentile: 11.11,
  median: 1150,
  performanceBand: "bottom-quartile",
  disposition: "benchmark-review",
  requiresNetworkReview: true,
  autoTiered: false
};

export const PROVIDER_BENCHMARKING_PRESETS: ProviderBenchmarkingPreset[] = [
  {
    id: "favorable",
    label: "Low cost (top quartile)",
    hint: "Cost 900 vs a cohort median 1150.",
    request: DEMO_PROVIDER_BENCHMARKING_REQUEST,
    demonstrates: "A favorable benchmark — top-quartile on a lower-is-better metric."
  },
  {
    id: "review",
    label: "High cost (bottom quartile)",
    hint: "Cost 1450 — 8 of 9 peers cheaper.",
    request: DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST,
    demonstrates: "An unfavorable benchmark flagged for network review — bottom-quartile."
  },
  {
    id: "quality",
    label: "Low quality (bottom quartile)",
    hint: "Quality 63 on a higher-is-better metric.",
    request: DEMO_PROVIDER_BENCHMARKING_QUALITY_REQUEST,
    demonstrates: "The direction inversion — a low score on a higher-is-better metric is bottom-quartile."
  },
  {
    id: "mis-sized-cohort-block",
    label: "Mis-sized cohort \u2192 governance block",
    hint: "Claims 14 peers but supplies 9.",
    request: DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: a claimed cohort of 14 peers while only 9 are supplied — a mis-sized denominator.
      cohortSize: 14
    },
    demonstrates:
      "The Agent Fabric blocking a finding whose reported cohort size doesn't match the peers (policy.benchmark.cohort-sourced)."
  },
  {
    id: "miscomputed-stats-block",
    label: "Inverted percentile \u2192 governance block",
    hint: "Reports the percentile the wrong way round.",
    request: DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: the percentile is inverted (as if the direction were mishandled), flattering a
      // bottom-quartile provider into a self-consistent-looking top-quartile favorable.
      percentileRank: 11.11,
      effectivePercentile: 88.89,
      performanceBand: "top-quartile",
      disposition: "benchmark-favorable"
    },
    demonstrates:
      "The Agent Fabric blocking a finding whose rank statistics don't recompute (policy.benchmark.stats-consistent)."
  },
  {
    id: "auto-tiered-block",
    label: "Provider tiered autonomously \u2192 governance block",
    hint: "A finding that tiered the provider.",
    request: DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: the agent tiered the provider and skipped network review.
      requiresNetworkReview: false,
      autoTiered: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous tiering (policy.benchmark.no-autonomous-tiering)."
  }
];

/** Render-ready view of a produced finding lifted from the task. */
export type ProviderBenchmarkingResolvedView = {
  kind: "resolved";
  benchmarkRef: string;
  providerRef: string;
  metricName: string;
  metricDirection: string;
  targetValue: number;
  disposition: ProviderBenchmarkingDisposition;
  percentileRank: number;
  effectivePercentile: number;
  performanceBand: string;
  median: number | null;
  cohortSize: number;
  reason: string;
  note: string;
  benchmarkCohortSourced: boolean;
  benchmarkStatsConsistent: boolean;
  benchmarkNoAutonomousTiering: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ProviderBenchmarkingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ProviderBenchmarkingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ProviderBenchmarkingView =
  | ProviderBenchmarkingResolvedView
  | ProviderBenchmarkingBlockedView
  | ProviderBenchmarkingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  benchmarkCohortSourced?: unknown;
  benchmarkStatsConsistent?: unknown;
  benchmarkNoAutonomousTiering?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildProviderBenchmarkingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ProviderBenchmarkingRequest;
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
 * POST a benchmarking request (or an asserted finding) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP
 * 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runProviderBenchmarkingTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ProviderBenchmarkingRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(PROVIDER_BENCHMARKING_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildProviderBenchmarkingRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * finding (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function providerBenchmarkingViewFromTask(task: A2ATask): ProviderBenchmarkingView {
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
        "The Agent Fabric blocked this provider-benchmarking run.";
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
      (typeof fabric.error === "string" ? fabric.error : "The benchmark could not be computed.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: ProviderBenchmarkingDetermination; benchmarkRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    benchmarkRef: result?.benchmarkRef ?? det?.benchmarkRef ?? "",
    providerRef: det?.providerRef ?? "",
    metricName: det?.metricName ?? "",
    metricDirection: det?.metricDirection ?? "",
    targetValue: det?.targetValue ?? 0,
    disposition: det?.disposition ?? "benchmark-review",
    percentileRank: det?.percentileRank ?? 0,
    effectivePercentile: det?.effectivePercentile ?? 0,
    performanceBand: det?.performanceBand ?? "",
    median: det?.median ?? null,
    cohortSize: det?.cohortSize ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    benchmarkCohortSourced: fabric.benchmarkCohortSourced === true,
    benchmarkStatsConsistent: fabric.benchmarkStatsConsistent === true,
    benchmarkNoAutonomousTiering: fabric.benchmarkNoAutonomousTiering === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<ProviderBenchmarkingDisposition, string> = {
  "benchmark-favorable": "#8fd6b0",
  "benchmark-review": "#ffd28a"
};

const DISPOSITION_LABEL: Record<ProviderBenchmarkingDisposition, string> = {
  "benchmark-favorable": "Favorable benchmark \u00b7 above median or better",
  "benchmark-review": "Flagged for network review \u00b7 below median"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ProviderBenchmarkingView }
  | { status: "error"; message: string };

export function ProviderBenchmarkingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ProviderBenchmarkingPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runProviderBenchmarkingTask({
          taskId: newTaskId("provider-benchmarking"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: providerBenchmarkingViewFromTask(task) });
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
        Commercial &middot; provider percentile benchmarking &middot; commercial operations
      </p>
      <h3 style={{ margin: 0 }}>
        Provider Benchmarking — cohort sourced, statistics exact, never an autonomous tiering
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> takes a provider&rsquo;s{" "}
        <strong>metric value</strong> and a <strong>peer cohort</strong> and computes{" "}
        <strong>where it falls in the distribution</strong>: its <strong>percentile rank</strong>{" "}
        (midpoint method), the cohort <strong>median</strong>, and a <strong>performance band</strong>{" "}
        (top-quartile &rarr; bottom-quartile), honoring the metric <strong>direction</strong>{" "}
        (lower-is-better for cost, higher-is-better for quality). Not an FSM transition, not an edit
        distance &mdash; <strong>percentile / rank statistics</strong>. The cohort is{" "}
        <strong>sourced</strong>, the statistics <strong>recompute exactly</strong>, and the result is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> tiers, penalizes, or de-networks
        &mdash; a network manager confirms.{" "}
        <strong>Not PHI-bearing &middot; illustrative cohort, not a certified system.</strong> Run a
        preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {PROVIDER_BENCHMARKING_PRESETS.map((preset) => (
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
              ? "Benchmarking\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Benchmark failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ProviderBenchmarkingResult view={runState.view} />}
    </section>
  );
}

function ProviderBenchmarkingResult({ view }: { view: ProviderBenchmarkingView }) {
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

  const tone = DISPOSITION_TONE[view.disposition];

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Finding (deterministic, synthetic)
        {view.providerRef ? ` \u00b7 ${view.providerRef}` : ""}
        {view.metricName ? ` \u00b7 ${view.metricName}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>

      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        Percentile rank {view.percentileRank} &middot; effective {view.effectivePercentile} &middot;{" "}
        {view.performanceBand} &middot; cohort n={view.cohortSize}
        {view.median !== null ? ` \u00b7 median ${view.median}` : ""}
      </p>

      <div
        role="note"
        aria-label="Finding safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; exact statistics &middot; never an autonomous tiering{" "}
          <span
            style={{
              fontSize: "0.72rem",
              fontWeight: 600,
              color: "#8fd6b0",
              border: "1px solid #8fd6b0",
              borderRadius: "999px",
              padding: "0.05rem 0.4rem",
              marginLeft: "0.35rem"
            }}
          >
            synthetic &middot; not PHI
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
          benchmarkCohortSourced = {String(view.benchmarkCohortSourced)} &middot;
          benchmarkStatsConsistent = {String(view.benchmarkStatsConsistent)} &middot;
          benchmarkNoAutonomousTiering = {String(view.benchmarkNoAutonomousTiering)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
