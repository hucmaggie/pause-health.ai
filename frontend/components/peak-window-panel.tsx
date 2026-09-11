"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type PeakWindowDetermination,
  type PeakWindowDisposition,
  type PeakWindowRequest,
  type PeriodValue,
  DEMO_PEAK_WINDOW_ALL_NEGATIVE_REQUEST,
  DEMO_PEAK_WINDOW_ALL_POSITIVE_REQUEST,
  DEMO_PEAK_WINDOW_REQUEST,
  evaluatePeakWindow
} from "../lib/peak-window";

/**
 * Commercial Peak-Window / Maximum Contiguous Net-Gain Detection runner for the intake demo.
 *
 * Fires the real, server-side A2A Peak Window agent at /api/agents/peak-window/tasks — a commercial-analytics
 * service that finds the maximum-sum contiguous net-gain window in a signed metric series via Kadane's
 * maximum-subarray. The panel surfaces the disposition, the per-period series (highlighting the peak window),
 * the honesty signals, the synthetic / non-PHI labels, and a deep link into the parented Agent Fabric trace.
 *
 * A window — positive-window or no-positive-window — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresAnalystReview:true, autoActioned:false). The fabricated-window, sub-optimal, and auto-actioned
 * presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather
 * than hidden.
 *
 * DELIBERATELY NOT PHI-bearing — this agent runs only on the commercial CRM plane. The series are ILLUSTRATIVE
 * aggregate business figures, NOT a certified analytics / FP&A system. Structure, styling tokens, and tone
 * mirror <ResourceSchedulingPanel> so this reads as a native sibling on /demo/intake.
 */

const PEAK_WINDOW_ROUTE = "/api/agents/peak-window/tasks";

/** A one-click demo scenario. */
export type PeakWindowPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: PeakWindowRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST);

export const PEAK_WINDOW_PRESETS: PeakWindowPreset[] = [
  {
    id: "positive",
    label: "Peak net-gain window",
    hint: "Twelve months of net-new ARR with a mid-year surge.",
    request: DEMO_PEAK_WINDOW_REQUEST,
    demonstrates: "Kadane's maximum-subarray \u2014 the exact Apr\u2192Aug peak run, not a fixed window."
  },
  {
    id: "all-negative",
    label: "No positive window",
    hint: "Every contiguous stretch nets a loss.",
    request: DEMO_PEAK_WINDOW_ALL_NEGATIVE_REQUEST,
    demonstrates: "An honest no-positive-window \u2014 the least-negative single period."
  },
  {
    id: "all-positive",
    label: "Whole series is the window",
    hint: "Every period nets a gain.",
    request: DEMO_PEAK_WINDOW_ALL_POSITIVE_REQUEST,
    demonstrates: "The peak window spans the entire series."
  },
  {
    id: "phantom-window-block",
    label: "Fabricated window \u2192 governance block",
    hint: "A window whose sum doesn't match its range.",
    request: DEMO_PEAK_WINDOW_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      startIndex: 0,
      endIndex: 1,
      windowLength: 2
    },
    demonstrates:
      "The Agent Fabric blocking a window that overstates its own range's sum (policy.peak-window.window-sourced)."
  },
  {
    id: "suboptimal-block",
    label: "Sub-optimal window \u2192 governance block",
    hint: "A real window below the true peak.",
    request: DEMO_PEAK_WINDOW_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      startIndex: 9,
      endIndex: 10,
      windowSum: 11,
      windowLength: 2,
      hasPositiveWindow: true,
      disposition: "positive-window"
    },
    demonstrates:
      "The Agent Fabric blocking a window below the Kadane optimum (policy.peak-window.window-optimal)."
  },
  {
    id: "auto-actioned-block",
    label: "Committed autonomously \u2192 governance block",
    hint: "A finding that adjusted a quota itself.",
    request: DEMO_PEAK_WINDOW_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresAnalystReview: false,
      autoActioned: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous action (policy.peak-window.no-autonomous-action)."
  }
];

/** Render-ready view of a produced window lifted from the task. */
export type PeakWindowResolvedView = {
  kind: "resolved";
  seriesRef: string;
  disposition: PeakWindowDisposition;
  series: PeriodValue[];
  startIndex: number;
  endIndex: number;
  windowSum: number;
  windowLength: number;
  reason: string;
  note: string;
  peakWindowSourced: boolean;
  peakWindowOptimal: boolean;
  peakWindowNoAutonomousAction: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type PeakWindowBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type PeakWindowInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type PeakWindowView =
  | PeakWindowResolvedView
  | PeakWindowBlockedView
  | PeakWindowInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  peakWindowSourced?: unknown;
  peakWindowOptimal?: unknown;
  peakWindowNoAutonomousAction?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildPeakWindowRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: PeakWindowRequest;
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
 * POST a peak-window request (or an asserted determination) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runPeakWindowTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: PeakWindowRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(PEAK_WINDOW_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPeakWindowRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced window
 * (completed) from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function peakWindowViewFromTask(task: A2ATask): PeakWindowView {
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
        "The Agent Fabric blocked this peak-window finding.";
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
      (typeof fabric.error === "string" ? fabric.error : "The finding could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: PeakWindowDetermination; seriesRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    seriesRef: result?.seriesRef ?? det?.seriesRef ?? "",
    disposition: det?.disposition ?? "no-positive-window",
    series: det?.series ?? [],
    startIndex: det?.startIndex ?? -1,
    endIndex: det?.endIndex ?? -1,
    windowSum: det?.windowSum ?? 0,
    windowLength: det?.windowLength ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    peakWindowSourced: fabric.peakWindowSourced === true,
    peakWindowOptimal: fabric.peakWindowOptimal === true,
    peakWindowNoAutonomousAction: fabric.peakWindowNoAutonomousAction === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<PeakWindowDisposition, string> = {
  "positive-window": "#8fd6b0",
  "no-positive-window": "#ffd28a"
};

const DISPOSITION_LABEL: Record<PeakWindowDisposition, string> = {
  "positive-window": "Positive window \u00b7 the peak net-gain stretch was found",
  "no-positive-window": "No positive window \u00b7 every contiguous stretch nets a loss"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: PeakWindowView }
  | { status: "error"; message: string };

export function PeakWindowPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: PeakWindowPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runPeakWindowTask({
          taskId: newTaskId("peak-window"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: peakWindowViewFromTask(task) });
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
        Commercial plane &middot; analytics &middot; Kadane&rsquo;s maximum-subarray
      </p>
      <h3 style={{ margin: 0 }}>
        Commercial Peak-Window — window sourced &amp; self-honest, optimum recomputed, never an autonomous
        action
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> finds the{" "}
        <strong>maximum-sum contiguous window</strong> in a signed metric series &mdash; the strongest
        sustained net-gain stretch &mdash; via <strong>Kadane&rsquo;s maximum-subarray</strong>, not a trend
        line and not a fixed window. The reported window is a <strong>real sub-range</strong> whose sum is{" "}
        <strong>honestly its own</strong>, the total is the <strong>proven optimum</strong>, and it is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> commits the finding or adjusts a
        quota &mdash; a revenue analyst confirms.{" "}
        <strong>Not PHI &middot; commercial plane only &middot; illustrative, not a certified analytics system.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {PEAK_WINDOW_PRESETS.map((preset) => (
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
              ? "Scanning\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Detection failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <PeakWindowResult view={runState.view} />}
    </section>
  );
}

function PeakWindowResult({ view }: { view: PeakWindowView }) {
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
        Detection (deterministic, synthetic)
        {view.seriesRef ? ` \u00b7 ${view.seriesRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        peak window nets <strong style={{ color: tone }}>{view.windowSum}</strong> over{" "}
        {view.windowLength} period(s)
      </p>

      {view.series.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.series.map((p, i) => {
            const inWindow = i >= view.startIndex && i <= view.endIndex;
            return (
              <li key={p.period}>
                <code>{p.period}</code> {p.net >= 0 ? `+${p.net}` : p.net}{" "}
                {inWindow ? (
                  <span style={{ color: "#8fd6b0" }}>&#10003; peak window</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

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
          Sourced &middot; optimal &middot; never an autonomous action{" "}
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
          peakWindowSourced = {String(view.peakWindowSourced)} &middot; peakWindowOptimal ={" "}
          {String(view.peakWindowOptimal)} &middot; peakWindowNoAutonomousAction ={" "}
          {String(view.peakWindowNoAutonomousAction)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
