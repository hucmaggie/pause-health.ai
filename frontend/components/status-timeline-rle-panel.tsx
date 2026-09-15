"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type Run,
  type StatusTimelineDetermination,
  type StatusTimelineDisposition,
  type StatusTimelineRequest,
  DEMO_STATUS_TIMELINE_INCOMPRESSIBLE_REQUEST,
  DEMO_STATUS_TIMELINE_STABLE_REQUEST,
  DEMO_STATUS_TIMELINE_REQUEST,
  evaluateStatusTimeline
} from "../lib/status-timeline-rle";

/**
 * Status Timeline Compression / Run-Length Encoding (RLE) runner for the intake demo.
 *
 * Fires the real, server-side A2A Status Timeline RLE agent at /api/agents/status-timeline-rle/tasks — a
 * platform / data-substrate stream-compression service that run-length-encodes a per-slot status stream. The
 * panel surfaces the disposition, the runs, the compression ratio, the longest run, the dominant status, the
 * honesty signals, the synthetic / PHI-adjacent labels, and a deep link into the parented Agent Fabric trace.
 *
 * An encoding — compressible or incompressible — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresStewardReview:true, autoWritten:false). An incompressible disposition is a LEGITIMATE FINDING, NOT a
 * governance block. The doesn't-decode, over-split, and auto-written presets assert offending DETERMINATIONS —
 * so all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-adjacent — device / bed monitoring timeline. The stream is an ILLUSTRATIVE synthetic, NOT a certified
 * telemetry system. Structure, styling tokens, and tone mirror <RollingCensusPeakPanel> so this reads as a
 * native sibling on /demo/intake.
 */

const STATUS_TIMELINE_ROUTE = "/api/agents/status-timeline-rle/tasks";

/** A one-click demo scenario. */
export type StatusTimelinePreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: StatusTimelineRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST);

export const STATUS_TIMELINE_PRESETS: StatusTimelinePreset[] = [
  {
    id: "compressible",
    label: "Device status — compressible",
    hint: "16-slot RPM device stream with long stable runs.",
    request: DEMO_STATUS_TIMELINE_REQUEST,
    demonstrates: "Run-length encoding — 16 slots collapse to 5 runs (3.2× compression)."
  },
  {
    id: "incompressible",
    label: "Alternating stream — incompressible",
    hint: "Statuses flip every slot; RLE gains nothing.",
    request: DEMO_STATUS_TIMELINE_INCOMPRESSIBLE_REQUEST,
    demonstrates: "Incompressible — one run per slot, no consecutive repeats to coalesce."
  },
  {
    id: "stable",
    label: "One stable run — maximal compression",
    hint: "A single unchanging status across every slot.",
    request: DEMO_STATUS_TIMELINE_STABLE_REQUEST,
    demonstrates: "Maximal compression — many slots collapse to a single run."
  },
  {
    id: "doesnt-decode-block",
    label: "Doesn't decode → governance block",
    hint: "A run whose length doesn't match the stream.",
    request: DEMO_STATUS_TIMELINE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      runs: VALID_DETERMINATION.runs.map((r, i) => (i === 0 ? { ...r, length: r.length + 1 } : r))
    },
    demonstrates:
      "The Agent Fabric blocking a run list that doesn't decode to the stream (policy.statusrle.encoding-sourced)."
  },
  {
    id: "over-split-block",
    label: "Over-split → governance block",
    hint: "A single run split into two adjacent same-value runs.",
    request: DEMO_STATUS_TIMELINE_STABLE_REQUEST,
    determination: (() => {
      const stable = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_STABLE_REQUEST);
      return {
        ...stable,
        runs: [
          { value: "occupied", length: 5 },
          { value: "occupied", length: 3 }
        ],
        runCount: 2,
        compressionRatio: 4,
        longestRun: 5
      };
    })(),
    demonstrates:
      "The Agent Fabric blocking an over-split (non-canonical) run list that still decodes (policy.statusrle.runs-canonical)."
  },
  {
    id: "auto-written-block",
    label: "Written back autonomously → governance block",
    hint: "An encoding that persisted the timeline itself.",
    request: DEMO_STATUS_TIMELINE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresStewardReview: false,
      autoWritten: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous write-back (policy.statusrle.no-autonomous-write)."
  }
];

/** Render-ready view of a produced encoding lifted from the task. */
export type StatusTimelineResolvedView = {
  kind: "resolved";
  streamRef: string;
  disposition: StatusTimelineDisposition;
  runs: Run[];
  runCount: number;
  originalLength: number;
  compressionRatio: number;
  longestRun: number;
  dominantStatus: string;
  reason: string;
  note: string;
  statusEncodingSourced: boolean;
  statusRunsCanonical: boolean;
  statusNoAutonomousWrite: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type StatusTimelineBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type StatusTimelineInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type StatusTimelineView =
  | StatusTimelineResolvedView
  | StatusTimelineBlockedView
  | StatusTimelineInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  statusEncodingSourced?: unknown;
  statusRunsCanonical?: unknown;
  statusNoAutonomousWrite?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildStatusTimelineRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: StatusTimelineRequest;
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
export async function runStatusTimelineTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: StatusTimelineRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(STATUS_TIMELINE_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildStatusTimelineRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced encoding
 * (completed) from a governance block vs. an invalid request (both `failed`, told
 * apart by metadata.agentFabric.decision).
 */
export function statusTimelineViewFromTask(task: A2ATask): StatusTimelineView {
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
        "The Agent Fabric blocked this encoding.";
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
      (typeof fabric.error === "string" ? fabric.error : "The encoding could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: StatusTimelineDetermination; streamRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    streamRef: result?.streamRef ?? det?.streamRef ?? "",
    disposition: det?.disposition ?? "incompressible",
    runs: det?.runs ?? [],
    runCount: det?.runCount ?? 0,
    originalLength: det?.originalLength ?? 0,
    compressionRatio: det?.compressionRatio ?? 1,
    longestRun: det?.longestRun ?? 0,
    dominantStatus: det?.dominantStatus ?? "",
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    statusEncodingSourced: fabric.statusEncodingSourced === true,
    statusRunsCanonical: fabric.statusRunsCanonical === true,
    statusNoAutonomousWrite: fabric.statusNoAutonomousWrite === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<StatusTimelineDisposition, string> = {
  compressible: "#8fd6b0",
  incompressible: "#ffd28a"
};

const DISPOSITION_LABEL: Record<StatusTimelineDisposition, string> = {
  compressible: "Compressible · consecutive runs coalesce into fewer entries",
  incompressible: "Incompressible · no consecutive repeats to coalesce"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: StatusTimelineView }
  | { status: "error"; message: string };

export function StatusTimelineRlePanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: StatusTimelinePreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runStatusTimelineTask({
          taskId: newTaskId("status-timeline-rle"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: statusTimelineViewFromTask(task) });
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
        Platform &amp; data substrate &middot; stream compression &middot; run-length encoding
      </p>
      <h3 style={{ margin: 0 }}>
        Status Timeline Compression — encoding sourced &amp; self-consistent (decodes back exactly), runs
        canonical, never an autonomous write-back
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> compresses a per-slot{" "}
        <strong>status stream</strong> into <strong>(value, length) runs</strong> &mdash;{" "}
        <strong>run-length encoding</strong>, one run per maximal block of identical consecutive statuses. The
        encoding is <strong>losslessly reversible</strong> (it decodes back exactly), the runs are the{" "}
        <strong>unique canonical form</strong>, and it is a <strong>recommendation</strong>: the agent{" "}
        <strong>never</strong> writes the compressed timeline back to a source of record &mdash; a data steward
        confirms.{" "}
        <strong>PHI-adjacent &middot; illustrative, not a certified telemetry system.</strong> Run a preset,
        then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {STATUS_TIMELINE_PRESETS.map((preset) => (
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
              ? "Encoding…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Encoding failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <StatusTimelineResult view={runState.view} />}
    </section>
  );
}

function StatusTimelineResult({ view }: { view: StatusTimelineView }) {
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
        Status timeline RLE (deterministic, synthetic)
        {view.streamRef ? ` · ${view.streamRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.originalLength} slot(s) &rarr; {view.runCount} run(s) &middot; {view.compressionRatio}×
        compression &middot; longest run {view.longestRun} &middot; dominant &ldquo;{view.dominantStatus}
        &rdquo;
      </p>

      {view.runs.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.25rem",
            marginTop: "0.5rem",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.72rem"
          }}
        >
          {view.runs.map((r, i) => (
            <span
              key={i}
              style={{
                padding: "0.15rem 0.4rem",
                borderRadius: "0.25rem",
                border: "1px solid var(--line)",
                background: "rgba(143,214,176,0.14)"
              }}
            >
              {r.value}
              <span style={{ color: tone, fontWeight: 700 }}> ×{r.length}</span>
            </span>
          ))}
        </div>
      )}

      <div
        role="note"
        aria-label="Status timeline RLE safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; canonical &middot; never an autonomous write-back{" "}
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
          statusEncodingSourced = {String(view.statusEncodingSourced)} &middot; statusRunsCanonical ={" "}
          {String(view.statusRunsCanonical)} &middot; statusNoAutonomousWrite ={" "}
          {String(view.statusNoAutonomousWrite)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
