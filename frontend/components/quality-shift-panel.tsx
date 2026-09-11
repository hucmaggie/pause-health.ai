"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type AlarmDirection,
  type CusumPoint,
  type QualityShiftDetermination,
  type QualityShiftRequest,
  type QualityShiftSignal,
  DEMO_QUALITY_SHIFT_DOWN_REQUEST,
  DEMO_QUALITY_SHIFT_IN_CONTROL_REQUEST,
  DEMO_QUALITY_SHIFT_REQUEST,
  evaluateQualityShift
} from "../lib/quality-shift";

/**
 * Clinical Quality-Measure Shift Detection (Statistical Process Control) runner for the intake demo.
 *
 * Fires the real, server-side A2A Quality Shift agent at /api/agents/quality-shift/tasks — a quality-analytics
 * service that watches a time-ordered series of a clinical quality measure for a sustained shift away from
 * its target using a two-sided tabular CUSUM control chart. The panel surfaces the signal, the charted CUSUM
 * points, the honesty signals, the synthetic / PHI labels, and a deep link into the parented Agent Fabric
 * trace.
 *
 * A signal — in-control, shift-up-detected, or shift-down-detected — is a SAFE, honest OUTPUT (it completes;
 * it carries requiresQualityReview:true, autoActioned:false). The phantom-point, mis-charted, and
 * auto-actioned presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable in
 * the UI rather than hidden.
 *
 * PHI-bearing — the measures are derived from patient clinical data. The measures are ILLUSTRATIVE
 * de-identified aggregate rates, NOT a certified SPC / quality-surveillance platform. Structure, styling
 * tokens, and tone mirror <TimelineMergePanel> so this reads as a native sibling on /demo/intake.
 */

const QUALITY_SHIFT_ROUTE = "/api/agents/quality-shift/tasks";

/** A one-click demo scenario. */
export type QualityShiftPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: QualityShiftRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the shift-up demo — the block base. */
const VALID_DETERMINATION = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);

/** The block base with a fabricated charted point appended. */
const PHANTOM_POINT: CusumPoint = {
  index: 7,
  value: 99,
  cusumHigh: 0,
  cusumLow: 0,
  alarm: false
};

export const QUALITY_SHIFT_PRESETS: QualityShiftPreset[] = [
  {
    id: "shift-up",
    label: "Screening rate climbing \u2192 shift-up-detected",
    hint: "A weekly measure that drifts above target and stays there.",
    request: DEMO_QUALITY_SHIFT_REQUEST,
    demonstrates:
      "Two-sided tabular CUSUM \u2014 the upper sum crosses the threshold, flagging a sustained upward shift."
  },
  {
    id: "in-control",
    label: "Measure within the band \u2192 in-control",
    hint: "A measure that fluctuates inside the slack band.",
    request: DEMO_QUALITY_SHIFT_IN_CONTROL_REQUEST,
    demonstrates: "No cumulative deviation exceeds the threshold \u2014 the process is in control."
  },
  {
    id: "shift-down",
    label: "Control rate falling \u2192 shift-down-detected",
    hint: "A measure that drifts below target and stays there.",
    request: DEMO_QUALITY_SHIFT_DOWN_REQUEST,
    demonstrates: "The lower CUSUM crosses the threshold \u2014 a sustained downward shift."
  },
  {
    id: "phantom-point-block",
    label: "Phantom point \u2192 governance block",
    hint: "A charted point for an observation not in the series.",
    request: DEMO_QUALITY_SHIFT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      points: [...VALID_DETERMINATION.points, PHANTOM_POINT]
    },
    demonstrates:
      "The Agent Fabric blocking a chart with a fabricated point not in the submitted series (policy.quality.observations-sourced)."
  },
  {
    id: "mis-charted-block",
    label: "Mis-charted CUSUM \u2192 governance block",
    hint: "A CUSUM sum that doesn't recompute.",
    request: DEMO_QUALITY_SHIFT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      points: VALID_DETERMINATION.points.map((p) => (p.index === 5 ? { ...p, cusumHigh: 3 } : p))
    },
    demonstrates:
      "The Agent Fabric blocking a mis-charted CUSUM whose sums don't recompute (policy.quality.cusum-consistent)."
  },
  {
    id: "auto-actioned-block",
    label: "Recall launched autonomously \u2192 governance block",
    hint: "A detection that actioned itself.",
    request: DEMO_QUALITY_SHIFT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresQualityReview: false,
      autoActioned: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous corrective action / recall campaign (policy.quality.no-autonomous-intervention)."
  }
];

/** Render-ready view of a produced detection lifted from the task. */
export type QualityShiftResolvedView = {
  kind: "resolved";
  measureRef: string;
  signal: QualityShiftSignal;
  alarmIndex: number;
  alarmDirection: AlarmDirection;
  points: CusumPoint[];
  target: number;
  threshold: number;
  peakHigh: number;
  peakLow: number;
  reason: string;
  note: string;
  qualityObservationsSourced: boolean;
  qualityCusumConsistent: boolean;
  qualityNoAutonomousIntervention: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type QualityShiftBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type QualityShiftInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type QualityShiftView =
  | QualityShiftResolvedView
  | QualityShiftBlockedView
  | QualityShiftInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  qualityObservationsSourced?: unknown;
  qualityCusumConsistent?: unknown;
  qualityNoAutonomousIntervention?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildQualityShiftRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: QualityShiftRequest;
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
 * POST a quality-shift request (or an asserted detection) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP
 * 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runQualityShiftTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: QualityShiftRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(QUALITY_SHIFT_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildQualityShiftRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced detection
 * (completed) from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function qualityShiftViewFromTask(task: A2ATask): QualityShiftView {
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
        "The Agent Fabric blocked this quality-measure detection.";
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
      (typeof fabric.error === "string" ? fabric.error : "The detection could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: QualityShiftDetermination; measureRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    measureRef: result?.measureRef ?? det?.measureRef ?? "",
    signal: det?.signal ?? "in-control",
    alarmIndex: det?.alarmIndex ?? -1,
    alarmDirection: det?.alarmDirection ?? null,
    points: det?.points ?? [],
    target: det?.target ?? 0,
    threshold: det?.threshold ?? 0,
    peakHigh: det?.peakHigh ?? 0,
    peakLow: det?.peakLow ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    qualityObservationsSourced: fabric.qualityObservationsSourced === true,
    qualityCusumConsistent: fabric.qualityCusumConsistent === true,
    qualityNoAutonomousIntervention: fabric.qualityNoAutonomousIntervention === true,
    traceTaskId
  };
}

const SIGNAL_TONE: Record<QualityShiftSignal, string> = {
  "in-control": "#8fd6b0",
  "shift-up-detected": "#ffd28a",
  "shift-down-detected": "#ffd28a"
};

const SIGNAL_LABEL: Record<QualityShiftSignal, string> = {
  "in-control": "In control \u00b7 no sustained shift",
  "shift-up-detected": "Shift up detected \u00b7 flagged for quality review",
  "shift-down-detected": "Shift down detected \u00b7 flagged for quality review"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: QualityShiftView }
  | { status: "error"; message: string };

export function QualityShiftPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: QualityShiftPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runQualityShiftTask({
          taskId: newTaskId("quality-shift"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: qualityShiftViewFromTask(task) });
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
        Quality analytics &middot; statistical process control &middot; CUSUM
      </p>
      <h3 style={{ margin: 0 }}>
        Quality Shift Detection — points sourced, CUSUM recomputes, never an autonomous intervention
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> watches a time-ordered series of a clinical{" "}
        <strong>quality measure</strong> (a weekly screening rate, a monthly control rate) and detects a{" "}
        <strong>sustained shift</strong> away from its target. Not a percentile, not a sliding-window spike
        &mdash; a two-sided <strong>tabular CUSUM</strong> control chart that accumulates a running deviation.
        Every point is <strong>sourced</strong>, the CUSUM <strong>recomputes</strong>, and the signal is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> launches a corrective action or a
        recall campaign &mdash; a quality reviewer confirms.{" "}
        <strong>PHI-bearing &middot; illustrative, not a certified SPC platform.</strong> Run a preset, then
        open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {QUALITY_SHIFT_PRESETS.map((preset) => (
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
              ? "Charting\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Detection failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <QualityShiftResult view={runState.view} />}
    </section>
  );
}

function QualityShiftResult({ view }: { view: QualityShiftView }) {
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

  const tone = SIGNAL_TONE[view.signal];

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Detection (deterministic, synthetic)
        {view.measureRef ? ` \u00b7 ${view.measureRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {SIGNAL_LABEL[view.signal]}
      </p>

      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        target {view.target} &middot; threshold h={view.threshold} &middot; peak high {view.peakHigh} &middot;
        peak low {view.peakLow}
        {view.alarmIndex >= 0 ? ` \u00b7 alarm at obs ${view.alarmIndex}` : ""}
      </p>

      {view.points.length > 0 && (
        <ul
          style={{
            margin: "0.4rem 0 0",
            paddingLeft: "1.1rem",
            fontSize: "0.84rem",
            color: "var(--muted)"
          }}
        >
          {view.points.map((p) => (
            <li key={p.index}>
              <code>obs {p.index}</code> &middot; value {p.value} &middot; SH {p.cusumHigh} / SL {p.cusumLow}
              {p.alarm ? <span style={{ color: "#ffd28a" }}> &middot; alarm</span> : null}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Detection safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; recomputes &middot; never an autonomous intervention{" "}
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
            synthetic &middot; PHI-bearing
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
          qualityObservationsSourced = {String(view.qualityObservationsSourced)} &middot;
          qualityCusumConsistent = {String(view.qualityCusumConsistent)} &middot;
          qualityNoAutonomousIntervention = {String(view.qualityNoAutonomousIntervention)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
