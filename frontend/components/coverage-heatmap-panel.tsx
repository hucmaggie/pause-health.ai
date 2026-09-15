"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type CoverageHeatmapDetermination,
  type CoverageHeatmapDisposition,
  type CoverageHeatmapRequest,
  DEMO_COVERAGE_HEATMAP_COVERED_REQUEST,
  DEMO_COVERAGE_HEATMAP_REQUEST,
  DEMO_COVERAGE_HEATMAP_SPIKE_REQUEST,
  evaluateCoverageHeatmap
} from "../lib/coverage-heatmap";

/**
 * Coverage Heatmap / Difference-Array Range Accumulation runner for the intake demo.
 *
 * Fires the real, server-side A2A Coverage Heatmap agent at /api/agents/coverage-heatmap/tasks — a
 * care-coordination capacity-visibility service that computes per-slot concurrent staffing coverage via a
 * difference array and flags under-staffed slots. The panel surfaces the disposition, the per-slot coverage bar,
 * the under-staffed slots, the min/max, the honesty signals, the synthetic / PHI-adjacent labels, and a deep
 * link into the parented Agent Fabric trace.
 *
 * A heatmap — fully-covered or understaffed — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresManagerReview:true, autoStaffed:false). An understaffed disposition is a LEGITIMATE FINDING, NOT a
 * governance block. The fabricated-coverage, mis-materialized, and auto-staffed presets assert offending
 * DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-adjacent — care-unit staffing. The intervals are an ILLUSTRATIVE synthetic, NOT a certified workforce
 * system. Structure, styling tokens, and tone mirror <InterpreterAssignmentPanel> so this reads as a native
 * sibling on /demo/intake.
 */

const COVERAGE_HEATMAP_ROUTE = "/api/agents/coverage-heatmap/tasks";

/** A one-click demo scenario. */
export type CoverageHeatmapPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: CoverageHeatmapRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST);

export const COVERAGE_HEATMAP_PRESETS: CoverageHeatmapPreset[] = [
  {
    id: "understaffed",
    label: "Care-unit day — understaffed dip",
    hint: "Twelve slots, four shifts, required min 2.",
    request: DEMO_COVERAGE_HEATMAP_REQUEST,
    demonstrates: "Difference array — a midday dip leaves two slots below the required minimum."
  },
  {
    id: "fully-covered",
    label: "Blanketed shift — fully covered",
    hint: "Every slot at or above the minimum.",
    request: DEMO_COVERAGE_HEATMAP_COVERED_REQUEST,
    demonstrates: "Fully covered — no slot dips below the required minimum."
  },
  {
    id: "spike",
    label: "Many overlaps — spike + edges",
    hint: "Overlapping short intervals spike the middle.",
    request: DEMO_COVERAGE_HEATMAP_SPIKE_REQUEST,
    demonstrates: "The difference-array O(m + T) shines — a midday spike, understaffed edges."
  },
  {
    id: "fabricated-coverage-block",
    label: "Fabricated coverage → governance block",
    hint: "A coverage value that isn't the true count.",
    request: DEMO_COVERAGE_HEATMAP_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      coverage: VALID_DETERMINATION.coverage.map((c, i) => (i === 6 ? c + 5 : c))
    },
    demonstrates:
      "The Agent Fabric blocking a coverage value that isn't the true count (policy.coverageheat.coverage-sourced)."
  },
  {
    id: "mis-materialized-block",
    label: "Mis-materialized → governance block",
    hint: "A coverage array the difference array wouldn't produce.",
    request: DEMO_COVERAGE_HEATMAP_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      coverage: VALID_DETERMINATION.coverage.map((c, i) => (i === 2 ? c + 1 : c))
    },
    demonstrates:
      "The Agent Fabric blocking a heatmap the difference array wouldn't materialize (policy.coverageheat.accumulation-exact)."
  },
  {
    id: "auto-staffed-block",
    label: "Staffed autonomously → governance block",
    hint: "A heatmap that scheduled staff itself.",
    request: DEMO_COVERAGE_HEATMAP_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresManagerReview: false,
      autoStaffed: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous staffing action (policy.coverageheat.no-autonomous-staff)."
  }
];

/** Render-ready view of a produced heatmap lifted from the task. */
export type CoverageHeatmapResolvedView = {
  kind: "resolved";
  scheduleRef: string;
  disposition: CoverageHeatmapDisposition;
  coverage: number[];
  understaffedSlots: number[];
  minCoverage: number;
  maxCoverage: number;
  requiredMin: number;
  reason: string;
  note: string;
  coverageSourcedSignal: boolean;
  coverageAccumulationExact: boolean;
  coverageNoAutonomousStaff: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type CoverageHeatmapBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type CoverageHeatmapInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type CoverageHeatmapView =
  | CoverageHeatmapResolvedView
  | CoverageHeatmapBlockedView
  | CoverageHeatmapInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  coverageSourcedSignal?: unknown;
  coverageAccumulationExact?: unknown;
  coverageNoAutonomousStaff?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildCoverageHeatmapRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: CoverageHeatmapRequest;
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
export async function runCoverageHeatmapTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: CoverageHeatmapRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(COVERAGE_HEATMAP_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCoverageHeatmapRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced heatmap
 * (completed) from a governance block vs. an invalid request (both `failed`, told
 * apart by metadata.agentFabric.decision).
 */
export function coverageHeatmapViewFromTask(task: A2ATask): CoverageHeatmapView {
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
        "The Agent Fabric blocked this heatmap.";
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
      (typeof fabric.error === "string" ? fabric.error : "The heatmap could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: CoverageHeatmapDetermination; scheduleRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    scheduleRef: result?.scheduleRef ?? det?.scheduleRef ?? "",
    disposition: det?.disposition ?? "fully-covered",
    coverage: det?.coverage ?? [],
    understaffedSlots: det?.understaffedSlots ?? [],
    minCoverage: det?.minCoverage ?? 0,
    maxCoverage: det?.maxCoverage ?? 0,
    requiredMin: det?.requiredMin ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    coverageSourcedSignal: fabric.coverageSourcedSignal === true,
    coverageAccumulationExact: fabric.coverageAccumulationExact === true,
    coverageNoAutonomousStaff: fabric.coverageNoAutonomousStaff === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<CoverageHeatmapDisposition, string> = {
  "fully-covered": "#8fd6b0",
  understaffed: "#ffd28a"
};

const DISPOSITION_LABEL: Record<CoverageHeatmapDisposition, string> = {
  "fully-covered": "Fully covered · every slot meets the required minimum",
  understaffed: "Understaffed · some slot is below the required minimum"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: CoverageHeatmapView }
  | { status: "error"; message: string };

export function CoverageHeatmapPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: CoverageHeatmapPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runCoverageHeatmapTask({
          taskId: newTaskId("coverage-heatmap"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: coverageHeatmapViewFromTask(task) });
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
        Care coordination &middot; capacity visibility &middot; difference-array accumulation
      </p>
      <h3 style={{ margin: 0 }}>
        Coverage Heatmap — coverage sourced &amp; self-consistent, accumulation re-materialized by the difference
        array, never an autonomous staffing action
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> computes the{" "}
        <strong>concurrent staffing coverage</strong> at every time slot from a set of{" "}
        <strong>overlapping coverage intervals</strong> &mdash; the classic{" "}
        <strong>difference-array range accumulation</strong> (range-add, then one prefix-sum pass) &mdash; and
        flags the <strong>under-staffed slots</strong> below a required minimum. The coverage is{" "}
        <strong>cross-checked by direct counting</strong>, the accumulation is{" "}
        <strong>re-materialized</strong>, and it is a <strong>recommendation</strong>: the agent{" "}
        <strong>never</strong> schedules or dispatches staff &mdash; a staffing manager confirms.{" "}
        <strong>PHI-adjacent &middot; illustrative, not a certified workforce system.</strong> Run a preset,
        then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {COVERAGE_HEATMAP_PRESETS.map((preset) => (
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
              ? "Accumulating…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Heatmap failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <CoverageHeatmapResult view={runState.view} />}
    </section>
  );
}

function CoverageHeatmapResult({ view }: { view: CoverageHeatmapView }) {
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
  const understaffed = new Set(view.understaffedSlots);

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Coverage heatmap (deterministic, synthetic)
        {view.scheduleRef ? ` · ${view.scheduleRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        required min {view.requiredMin} &middot; coverage {view.minCoverage}&ndash;{view.maxCoverage} &middot;{" "}
        {view.understaffedSlots.length} under-staffed slot{view.understaffedSlots.length === 1 ? "" : "s"}
      </p>

      {view.coverage.length > 0 && (
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
          {view.coverage.map((c, i) => (
            <span
              key={i}
              title={`slot ${i}: ${c} staff${understaffed.has(i) ? " (under min)" : ""}`}
              style={{
                minWidth: "1.4rem",
                textAlign: "center",
                padding: "0.15rem 0.1rem",
                borderRadius: "0.25rem",
                border: "1px solid var(--line)",
                background: understaffed.has(i) ? "rgba(255,182,200,0.18)" : "rgba(143,214,176,0.14)",
                color: understaffed.has(i) ? "#ffb6c8" : "inherit"
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}

      {view.understaffedSlots.length > 0 && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "#ffb6c8" }}>
          Under-staffed slots: {view.understaffedSlots.join(", ")}
        </p>
      )}

      <div
        role="note"
        aria-label="Coverage heatmap safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; accumulation-exact &middot; never an autonomous staffing action{" "}
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
          coverageSourced = {String(view.coverageSourcedSignal)} &middot; accumulationExact ={" "}
          {String(view.coverageAccumulationExact)} &middot; noAutonomousStaff ={" "}
          {String(view.coverageNoAutonomousStaff)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
