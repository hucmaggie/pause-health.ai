"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type MergedEntry,
  type SourceContribution,
  type TimelineMergeDetermination,
  type TimelineMergeDisposition,
  type TimelineMergeRequest,
  DEMO_TIMELINE_MERGE_CLEAN_REQUEST,
  DEMO_TIMELINE_MERGE_REQUEST,
  DEMO_TIMELINE_MERGE_SINGLE_REQUEST,
  evaluateTimelineMerge
} from "../lib/timeline-merge";

/**
 * Clinical Event Timeline Merge / Multi-Source Record Reconciliation runner for the intake demo.
 *
 * Fires the real, server-side A2A Timeline Merge agent at /api/agents/timeline-merge/tasks — a data-substrate
 * service that merges a patient's clinical events from several already-sorted source streams into one
 * chronological unified timeline using the k-way merge of sorted streams, flagging cross-source duplicates.
 * The panel surfaces the disposition, the merged timeline (each entry with its duplicate-of link), the
 * per-source contributions, the honesty signals, the synthetic / PHI labels, and a deep link into the
 * parented Agent Fabric trace.
 *
 * A merge — clean-merge or duplicates-found — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresStewardReview:true, autoWritten:false). The phantom-event, mis-ordered, and auto-written presets
 * assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than
 * hidden.
 *
 * PHI-bearing — the events are a patient's clinical data. The events are ILLUSTRATIVE, NOT a certified
 * record-reconciliation / EMPI system. Structure, styling tokens, and tone mirror <ReportableConditionPanel>
 * so this reads as a native sibling on /demo/intake.
 */

const TIMELINE_MERGE_ROUTE = "/api/agents/timeline-merge/tasks";

/** A one-click demo scenario. */
export type TimelineMergePreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: TimelineMergeRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the duplicates-found demo — the block base. */
const VALID_DETERMINATION = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);

/** The block base with two real events swapped so the timeline is out of chronological order. */
const MIS_ORDERED_TIMELINE: MergedEntry[] = (() => {
  const t = [...VALID_DETERMINATION.timeline];
  const i = t.findIndex((e) => e.eventId === "b1");
  const j = t.findIndex((e) => e.eventId === "a2");
  [t[i], t[j]] = [t[j], t[i]];
  return t;
})();

/** The block base with a fabricated event appended. */
const PHANTOM_EVENT: MergedEntry = {
  eventId: "x9",
  source: "ghost",
  timestamp: 999,
  kind: "phantom",
  dedupKey: "phantom|999",
  duplicateOf: null
};

export const TIMELINE_MERGE_PRESETS: TimelineMergePreset[] = [
  {
    id: "duplicates-found",
    label: "3 streams, 2 cross-source dupes \u2192 duplicates-found",
    hint: "EHR-A, EHR-B, and pharmacy report overlapping events.",
    request: DEMO_TIMELINE_MERGE_REQUEST,
    demonstrates:
      "K-way merge of sorted streams \u2014 one chronological timeline with the duplicate visit + lab flagged."
  },
  {
    id: "clean-merge",
    label: "Distinct events \u2192 clean-merge",
    hint: "Two streams whose events never collide.",
    request: DEMO_TIMELINE_MERGE_CLEAN_REQUEST,
    demonstrates: "A clean chronological merge across two sources \u2014 no duplicates."
  },
  {
    id: "single-stream",
    label: "Single ordered stream \u2192 clean-merge",
    hint: "One stream already in time order.",
    request: DEMO_TIMELINE_MERGE_SINGLE_REQUEST,
    demonstrates: "A single stream passes through in order \u2014 a clean merge."
  },
  {
    id: "phantom-event-block",
    label: "Phantom event \u2192 governance block",
    hint: "A timeline entry for an event not in any stream.",
    request: DEMO_TIMELINE_MERGE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      timeline: [...VALID_DETERMINATION.timeline, PHANTOM_EVENT]
    },
    demonstrates:
      "The Agent Fabric blocking a timeline with a fabricated event not in any submitted stream (policy.timeline.events-sourced)."
  },
  {
    id: "mis-ordered-block",
    label: "Out-of-order timeline \u2192 governance block",
    hint: "Two events placed out of chronological order.",
    request: DEMO_TIMELINE_MERGE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      timeline: MIS_ORDERED_TIMELINE
    },
    demonstrates:
      "The Agent Fabric blocking a mis-ordered timeline whose merge doesn't recompute (policy.timeline.merge-consistent)."
  },
  {
    id: "auto-written-block",
    label: "Timeline written back autonomously \u2192 governance block",
    hint: "A merge that wrote itself back to the record.",
    request: DEMO_TIMELINE_MERGE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresStewardReview: false,
      autoWritten: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous write-back to the source of record (policy.timeline.no-autonomous-merge)."
  }
];

/** Render-ready view of a produced merge lifted from the task. */
export type TimelineMergeResolvedView = {
  kind: "resolved";
  recordRef: string;
  disposition: TimelineMergeDisposition;
  timeline: MergedEntry[];
  sourceContributions: SourceContribution[];
  totalSubmitted: number;
  keptCount: number;
  duplicateCount: number;
  reason: string;
  note: string;
  timelineEventsSourced: boolean;
  timelineMergeConsistent: boolean;
  timelineNoAutonomousMerge: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type TimelineMergeBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type TimelineMergeInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type TimelineMergeView =
  | TimelineMergeResolvedView
  | TimelineMergeBlockedView
  | TimelineMergeInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  timelineEventsSourced?: unknown;
  timelineMergeConsistent?: unknown;
  timelineNoAutonomousMerge?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildTimelineMergeRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: TimelineMergeRequest;
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
 * POST a timeline-merge request (or an asserted merge) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP
 * 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runTimelineMergeTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: TimelineMergeRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(TIMELINE_MERGE_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildTimelineMergeRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced merge
 * (completed) from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function timelineMergeViewFromTask(task: A2ATask): TimelineMergeView {
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
        "The Agent Fabric blocked this timeline merge.";
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
      (typeof fabric.error === "string" ? fabric.error : "The merge could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: TimelineMergeDetermination; recordRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    recordRef: result?.recordRef ?? det?.recordRef ?? "",
    disposition: det?.disposition ?? "clean-merge",
    timeline: det?.timeline ?? [],
    sourceContributions: det?.sourceContributions ?? [],
    totalSubmitted: det?.totalSubmitted ?? 0,
    keptCount: det?.keptCount ?? 0,
    duplicateCount: det?.duplicateCount ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    timelineEventsSourced: fabric.timelineEventsSourced === true,
    timelineMergeConsistent: fabric.timelineMergeConsistent === true,
    timelineNoAutonomousMerge: fabric.timelineNoAutonomousMerge === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<TimelineMergeDisposition, string> = {
  "clean-merge": "#8fd6b0",
  "duplicates-found": "#ffd28a"
};

const DISPOSITION_LABEL: Record<TimelineMergeDisposition, string> = {
  "clean-merge": "Clean merge \u00b7 no duplicates",
  "duplicates-found": "Duplicates found \u00b7 flagged for steward review"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: TimelineMergeView }
  | { status: "error"; message: string };

export function TimelineMergePanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: TimelineMergePreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runTimelineMergeTask({
          taskId: newTaskId("timeline-merge"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: timelineMergeViewFromTask(task) });
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
        Data substrate &middot; record reconciliation &middot; k-way merge
      </p>
      <h3 style={{ margin: 0 }}>
        Timeline Merge — events sourced, merge recomputes, never an autonomous write-back
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> takes a patient&rsquo;s clinical{" "}
        <strong>events</strong> from several already-sorted source <strong>streams</strong> (EHR, EHR,
        pharmacy, claims) and merges them into one chronological <strong>timeline</strong>, flagging the{" "}
        <strong>duplicates</strong> (the same event reported by more than one source). Not a matching, not a
        distance, not an interval merge &mdash; the <strong>k-way merge of sorted streams</strong>. Every
        event is <strong>sourced</strong>, the merge <strong>recomputes</strong>, and the result is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> writes the timeline back to a source
        of record or purges a duplicate &mdash; a data steward confirms.{" "}
        <strong>PHI-bearing &middot; illustrative, not a certified EMPI.</strong> Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {TIMELINE_MERGE_PRESETS.map((preset) => (
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
              ? "Merging\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Merge failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <TimelineMergeResult view={runState.view} />}
    </section>
  );
}

function TimelineMergeResult({ view }: { view: TimelineMergeView }) {
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
        Merge (deterministic, synthetic)
        {view.recordRef ? ` \u00b7 ${view.recordRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>

      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.totalSubmitted} events &middot; {view.keptCount} unique &middot; {view.duplicateCount}{" "}
        duplicate{view.duplicateCount === 1 ? "" : "s"}
      </p>

      {view.timeline.length > 0 && (
        <ul
          style={{
            margin: "0.4rem 0 0",
            paddingLeft: "1.1rem",
            fontSize: "0.84rem",
            color: "var(--muted)"
          }}
        >
          {view.timeline.map((e) => (
            <li key={`${e.source}-${e.eventId}`}>
              <code>t{e.timestamp}</code> &middot; {e.kind} <em>({e.source})</em>
              {e.duplicateOf !== null ? (
                <span style={{ color: "#ffd28a" }}> &middot; duplicate of {e.duplicateOf}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Merge safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; recomputes &middot; never an autonomous write-back{" "}
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
          timelineEventsSourced = {String(view.timelineEventsSourced)} &middot; timelineMergeConsistent ={" "}
          {String(view.timelineMergeConsistent)} &middot; timelineNoAutonomousMerge ={" "}
          {String(view.timelineNoAutonomousMerge)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
