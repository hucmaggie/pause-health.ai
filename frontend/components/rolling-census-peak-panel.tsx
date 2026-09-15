"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type RollingCensusDetermination,
  type RollingCensusDisposition,
  type RollingCensusRequest,
  DEMO_ROLLING_CENSUS_SPIKE_REQUEST,
  DEMO_ROLLING_CENSUS_WITHIN_REQUEST,
  DEMO_ROLLING_CENSUS_REQUEST,
  evaluateRollingCensus
} from "../lib/rolling-census-peak";

/**
 * Rolling Census Peak / Sliding-Window Maximum (Monotonic Deque) runner for the intake demo.
 *
 * Fires the real, server-side A2A Rolling Census Peak agent at /api/agents/rolling-census-peak/tasks — a
 * care-coordination capacity-monitoring service that computes the peak census in every trailing window via a
 * monotonic deque and flags windows over a capacity threshold. The panel surfaces the disposition, the per-window
 * peaks, the over-capacity windows, the overall peak, the honesty signals, the synthetic / PHI-adjacent labels,
 * and a deep link into the parented Agent Fabric trace.
 *
 * A report — within-capacity or over-capacity — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresSupervisorReview:true, autoDiverted:false). An over-capacity disposition is a LEGITIMATE FINDING, NOT
 * a governance block. The fabricated-max, mis-derived, and auto-diverted presets assert offending DETERMINATIONS
 * — so all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-adjacent — care-unit occupancy. The readings are an ILLUSTRATIVE synthetic, NOT a certified capacity
 * system. Structure, styling tokens, and tone mirror <CoverageHeatmapPanel> so this reads as a native sibling on
 * /demo/intake.
 */

const ROLLING_CENSUS_ROUTE = "/api/agents/rolling-census-peak/tasks";

/** A one-click demo scenario. */
export type RollingCensusPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: RollingCensusRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST);

export const ROLLING_CENSUS_PRESETS: RollingCensusPreset[] = [
  {
    id: "over-capacity",
    label: "Care unit — over-capacity surge",
    hint: "Ten hourly readings, 3-hour window, capacity 18.",
    request: DEMO_ROLLING_CENSUS_REQUEST,
    demonstrates: "Sliding-window max — a mid-shift surge pushes four windows over capacity (peak 20)."
  },
  {
    id: "within-capacity",
    label: "Steady unit — within capacity",
    hint: "Census never breaches capacity in any window.",
    request: DEMO_ROLLING_CENSUS_WITHIN_REQUEST,
    demonstrates: "Within capacity — every trailing window peak stays under the threshold."
  },
  {
    id: "spike",
    label: "Decreasing run then spike",
    hint: "Exercises the monotonic deque's back-eviction.",
    request: DEMO_ROLLING_CENSUS_SPIKE_REQUEST,
    demonstrates: "A single spike dominates its windows — the deque evicts the decreasing run."
  },
  {
    id: "fabricated-max-block",
    label: "Fabricated peak → governance block",
    hint: "A window max that isn't the true peak.",
    request: DEMO_ROLLING_CENSUS_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      windowMaxes: VALID_DETERMINATION.windowMaxes.map((m, i) => (i === 0 ? m + 5 : m))
    },
    demonstrates:
      "The Agent Fabric blocking a window max that isn't the true peak (policy.rollingcensus.windows-sourced)."
  },
  {
    id: "mis-derived-block",
    label: "Mis-derived → governance block",
    hint: "A maxima array the deque wouldn't produce.",
    request: DEMO_ROLLING_CENSUS_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      windowMaxes: VALID_DETERMINATION.windowMaxes.map((m, i) => (i === 5 ? m + 1 : m))
    },
    demonstrates:
      "The Agent Fabric blocking a maxima array the monotonic deque wouldn't produce (policy.rollingcensus.deque-exact)."
  },
  {
    id: "auto-diverted-block",
    label: "Diverted autonomously → governance block",
    hint: "A report that diverted admissions itself.",
    request: DEMO_ROLLING_CENSUS_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresSupervisorReview: false,
      autoDiverted: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous diversion (policy.rollingcensus.no-autonomous-divert)."
  }
];

/** Render-ready view of a produced report lifted from the task. */
export type RollingCensusResolvedView = {
  kind: "resolved";
  unitRef: string;
  disposition: RollingCensusDisposition;
  windowMaxes: number[];
  overCapacityWindows: number[];
  peakCensus: number;
  capacity: number;
  windowSize: number;
  reason: string;
  note: string;
  censusWindowsSourced: boolean;
  censusDequeExact: boolean;
  censusNoAutonomousDivert: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type RollingCensusBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type RollingCensusInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type RollingCensusView =
  | RollingCensusResolvedView
  | RollingCensusBlockedView
  | RollingCensusInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  censusWindowsSourced?: unknown;
  censusDequeExact?: unknown;
  censusNoAutonomousDivert?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildRollingCensusRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: RollingCensusRequest;
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
 * POST a request (or an asserted determination) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runRollingCensusTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: RollingCensusRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(ROLLING_CENSUS_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRollingCensusRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced report
 * (completed) from a governance block vs. an invalid request (both `failed`, told
 * apart by metadata.agentFabric.decision).
 */
export function rollingCensusViewFromTask(task: A2ATask): RollingCensusView {
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
        "The Agent Fabric blocked this census report.";
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
      (typeof fabric.error === "string" ? fabric.error : "The census report could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: RollingCensusDetermination; unitRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    unitRef: result?.unitRef ?? det?.unitRef ?? "",
    disposition: det?.disposition ?? "within-capacity",
    windowMaxes: det?.windowMaxes ?? [],
    overCapacityWindows: det?.overCapacityWindows ?? [],
    peakCensus: det?.peakCensus ?? 0,
    capacity: det?.capacity ?? 0,
    windowSize: det?.windowSize ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    censusWindowsSourced: fabric.censusWindowsSourced === true,
    censusDequeExact: fabric.censusDequeExact === true,
    censusNoAutonomousDivert: fabric.censusNoAutonomousDivert === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<RollingCensusDisposition, string> = {
  "within-capacity": "#8fd6b0",
  "over-capacity": "#ffd28a"
};

const DISPOSITION_LABEL: Record<RollingCensusDisposition, string> = {
  "within-capacity": "Within capacity · no trailing window peaks above the threshold",
  "over-capacity": "Over capacity · a trailing window peak breaches the threshold"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: RollingCensusView }
  | { status: "error"; message: string };

export function RollingCensusPeakPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: RollingCensusPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runRollingCensusTask({
          taskId: newTaskId("rolling-census-peak"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: rollingCensusViewFromTask(task) });
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
        Care coordination &middot; capacity monitoring &middot; sliding-window maximum
      </p>
      <h3 style={{ margin: 0 }}>
        Rolling Census Peak — windows sourced &amp; self-consistent, peaks re-derived by the monotonic deque,
        never an autonomous diversion
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> computes the{" "}
        <strong>peak census in every trailing window</strong> of a unit&rsquo;s occupancy readings &mdash; the
        classic <strong>sliding-window maximum via a monotonic deque</strong> &mdash; and flags windows whose
        peak <strong>breaches capacity</strong>. The peaks are{" "}
        <strong>cross-checked by direct scanning</strong>, the deque is{" "}
        <strong>re-derived</strong>, and it is a <strong>recommendation</strong>: the agent{" "}
        <strong>never</strong> diverts admissions or triggers surge staffing &mdash; a nursing supervisor
        confirms.{" "}
        <strong>PHI-adjacent &middot; illustrative, not a certified capacity system.</strong> Run a preset, then
        open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {ROLLING_CENSUS_PRESETS.map((preset) => (
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
              ? "Scanning…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Census report failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <RollingCensusResult view={runState.view} />}
    </section>
  );
}

function RollingCensusResult({ view }: { view: RollingCensusView }) {
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
  const over = new Set(view.overCapacityWindows);

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Rolling census peak (deterministic, synthetic)
        {view.unitRef ? ` · ${view.unitRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        window {view.windowSize} &middot; capacity {view.capacity} &middot; peak census {view.peakCensus}{" "}
        &middot; {view.overCapacityWindows.length} over-capacity window
        {view.overCapacityWindows.length === 1 ? "" : "s"}
      </p>

      {view.windowMaxes.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.2rem",
            marginTop: "0.5rem",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.72rem"
          }}
        >
          {view.windowMaxes.map((m, i) => (
            <span
              key={i}
              title={`window ${i}: peak ${m}${over.has(i) ? " (over capacity)" : ""}`}
              style={{
                minWidth: "1.6rem",
                textAlign: "center",
                padding: "0.15rem 0.1rem",
                borderRadius: "0.25rem",
                border: "1px solid var(--line)",
                background: over.has(i) ? "rgba(255,182,200,0.18)" : "rgba(143,214,176,0.14)",
                color: over.has(i) ? "#ffb6c8" : "inherit"
              }}
            >
              {m}
            </span>
          ))}
        </div>
      )}

      {view.overCapacityWindows.length > 0 && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "#ffb6c8" }}>
          Over-capacity windows (by start slot): {view.overCapacityWindows.join(", ")}
        </p>
      )}

      <div
        role="note"
        aria-label="Rolling census safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; deque-exact &middot; never an autonomous diversion{" "}
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
            synthetic &middot; PHI-adjacent
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
          censusWindowsSourced = {String(view.censusWindowsSourced)} &middot; censusDequeExact ={" "}
          {String(view.censusDequeExact)} &middot; censusNoAutonomousDivert ={" "}
          {String(view.censusNoAutonomousDivert)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
