"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type BlockScheduleDetermination,
  type BlockScheduleDisposition,
  type BlockScheduleRequest,
  type ResourceRequest,
  DEMO_BLOCK_SCHEDULE_ALL_REQUEST,
  DEMO_BLOCK_SCHEDULE_REQUEST,
  DEMO_BLOCK_SCHEDULE_WEIGHTED_REQUEST,
  evaluateBlockSchedule
} from "../lib/resource-scheduling";

/**
 * Resource-Block Scheduling / Max-Value Non-Overlapping Selection runner for the intake demo.
 *
 * Fires the real, server-side A2A Resource Scheduling agent at /api/agents/resource-scheduling/tasks — a
 * care-coordination capacity-optimization service that selects the max-total-weight non-overlapping subset of
 * competing requests for one contended resource via weighted interval scheduling (DP). The panel surfaces the
 * disposition, the selected + contended blocks, the honesty signals, the synthetic / PHI labels, and a deep
 * link into the parented Agent Fabric trace.
 *
 * A schedule — all-scheduled or contended — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresSchedulerReview:true, autoBooked:false). The fabricated-block, sub-optimal, and auto-booked presets
 * assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than
 * hidden.
 *
 * PHI-bearing — each request references the patient being scheduled. The resource + requests are ILLUSTRATIVE
 * synthetics, NOT a certified scheduling / capacity system. Structure, styling tokens, and tone mirror
 * <CodeTaxonomyPanel> so this reads as a native sibling on /demo/intake.
 */

const RESOURCE_SCHEDULING_ROUTE = "/api/agents/resource-scheduling/tasks";

/** A one-click demo scenario. */
export type ResourceSchedulingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: BlockScheduleRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the contended demo — the block base. */
const VALID_DETERMINATION = evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST);

export const RESOURCE_SCHEDULING_PRESETS: ResourceSchedulingPreset[] = [
  {
    id: "contended",
    label: "Contended resource \u2192 max-weight subset",
    hint: "Five infusion-chair requests, three can't fit.",
    request: DEMO_BLOCK_SCHEDULE_REQUEST,
    demonstrates:
      "Weighted interval scheduling \u2014 the max-value non-overlapping set, not the max count."
  },
  {
    id: "all-scheduled",
    label: "No contention \u2192 all-scheduled",
    hint: "Every request fits without overlap.",
    request: DEMO_BLOCK_SCHEDULE_ALL_REQUEST,
    demonstrates: "A clean resource \u2014 every request is scheduled."
  },
  {
    id: "weight-over-count",
    label: "Weight beats count",
    hint: "One long high-value block vs two short ones.",
    request: DEMO_BLOCK_SCHEDULE_WEIGHTED_REQUEST,
    demonstrates: "The DP takes the single weight-10 block over two weight-3 blocks."
  },
  {
    id: "phantom-block-block",
    label: "Fabricated block \u2192 governance block",
    hint: "A selected block that wasn't requested.",
    request: DEMO_BLOCK_SCHEDULE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      selected: VALID_DETERMINATION.selected.map((id) =>
        id === "infusion-1104" ? "phantom-block" : id
      )
    },
    demonstrates:
      "The Agent Fabric blocking a selection whose block was never requested (policy.block-schedule.selection-sourced)."
  },
  {
    id: "suboptimal-block",
    label: "Sub-optimal schedule \u2192 governance block",
    hint: "A feasible schedule that leaves value unbooked.",
    request: DEMO_BLOCK_SCHEDULE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      selected: ["infusion-1101", "infusion-1103"],
      totalWeight: 8,
      scheduledCount: 2,
      contendedCount: 3,
      disposition: "contended"
    },
    demonstrates:
      "The Agent Fabric blocking a schedule below the DP optimum (policy.block-schedule.schedule-optimal)."
  },
  {
    id: "auto-booked-block",
    label: "Booked autonomously \u2192 governance block",
    hint: "A schedule that booked the blocks itself.",
    request: DEMO_BLOCK_SCHEDULE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresSchedulerReview: false,
      autoBooked: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous booking (policy.block-schedule.no-autonomous-booking)."
  }
];

/** Render-ready view of a produced schedule lifted from the task. */
export type ResourceSchedulingResolvedView = {
  kind: "resolved";
  resourceRef: string;
  disposition: BlockScheduleDisposition;
  requests: ResourceRequest[];
  selected: string[];
  totalWeight: number;
  scheduledCount: number;
  contendedCount: number;
  total: number;
  reason: string;
  note: string;
  blockScheduleSourced: boolean;
  blockScheduleOptimal: boolean;
  blockScheduleNoAutonomousBooking: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ResourceSchedulingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ResourceSchedulingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ResourceSchedulingView =
  | ResourceSchedulingResolvedView
  | ResourceSchedulingBlockedView
  | ResourceSchedulingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  blockScheduleSourced?: unknown;
  blockScheduleOptimal?: unknown;
  blockScheduleNoAutonomousBooking?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildResourceSchedulingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: BlockScheduleRequest;
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
 * POST a scheduling request (or an asserted determination) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runResourceSchedulingTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: BlockScheduleRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(RESOURCE_SCHEDULING_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildResourceSchedulingRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * schedule (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function resourceSchedulingViewFromTask(task: A2ATask): ResourceSchedulingView {
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
        "The Agent Fabric blocked this schedule.";
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
      (typeof fabric.error === "string" ? fabric.error : "The schedule could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: BlockScheduleDetermination; resourceRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    resourceRef: result?.resourceRef ?? det?.resourceRef ?? "",
    disposition: det?.disposition ?? "all-scheduled",
    requests: det?.requests ?? [],
    selected: det?.selected ?? [],
    totalWeight: det?.totalWeight ?? 0,
    scheduledCount: det?.scheduledCount ?? 0,
    contendedCount: det?.contendedCount ?? 0,
    total: det?.total ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    blockScheduleSourced: fabric.blockScheduleSourced === true,
    blockScheduleOptimal: fabric.blockScheduleOptimal === true,
    blockScheduleNoAutonomousBooking: fabric.blockScheduleNoAutonomousBooking === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<BlockScheduleDisposition, string> = {
  "all-scheduled": "#8fd6b0",
  contended: "#ffd28a"
};

const DISPOSITION_LABEL: Record<BlockScheduleDisposition, string> = {
  "all-scheduled": "All scheduled \u00b7 every request fits without contention",
  contended: "Contended \u00b7 the max-value non-overlapping set was selected"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ResourceSchedulingView }
  | { status: "error"; message: string };

export function ResourceSchedulingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ResourceSchedulingPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runResourceSchedulingTask({
          taskId: newTaskId("resource-scheduling"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: resourceSchedulingViewFromTask(task) });
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
        Care coordination &middot; capacity optimization &middot; weighted interval scheduling
      </p>
      <h3 style={{ margin: 0 }}>
        Resource-Block Scheduling — selection sourced &amp; feasible, optimum recomputed, never an autonomous
        booking
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> selects the{" "}
        <strong>max-value non-overlapping set</strong> of competing requests for one contended resource &mdash;
        not the max <em>count</em> &mdash; via <strong>weighted interval scheduling (dynamic programming)</strong>.
        A greedy earliest-finish rule would grab two short low-acuity blocks; the DP keeps the one high-acuity
        block worth more. Every selected block is a <strong>real request</strong>, the resource is{" "}
        <strong>never double-booked</strong>, the total is the <strong>proven optimum</strong>, and it is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> books or bumps a block &mdash; a
        scheduler confirms. <strong>PHI-bearing &middot; illustrative, not a certified scheduling system.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {RESOURCE_SCHEDULING_PRESETS.map((preset) => (
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
              ? "Scheduling\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Scheduling failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ResourceSchedulingResult view={runState.view} />}
    </section>
  );
}

function ResourceSchedulingResult({ view }: { view: ResourceSchedulingView }) {
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
  const selectedSet = new Set(view.selected);

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Schedule (deterministic, synthetic)
        {view.resourceRef ? ` \u00b7 ${view.resourceRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.scheduledCount} of {view.total} request(s) scheduled &middot; total weight{" "}
        <strong style={{ color: tone }}>{view.totalWeight}</strong>
        {view.contendedCount > 0 ? ` \u00b7 ${view.contendedCount} contended` : ""}
      </p>

      {view.requests.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.requests.map((r) => {
            const scheduled = selectedSet.has(r.requestId);
            return (
              <li key={r.requestId}>
                <code>{r.requestId}</code> [{r.start}, {r.end}) &middot; weight {r.weight}{" "}
                {scheduled ? (
                  <span style={{ color: "#8fd6b0" }}>&#10003; scheduled</span>
                ) : (
                  <span style={{ color: "#ffd28a" }}>&middot; contended</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div
        role="note"
        aria-label="Schedule safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; optimal &middot; never an autonomous booking{" "}
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
            synthetic &middot; PHI
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
          blockScheduleSourced = {String(view.blockScheduleSourced)} &middot; blockScheduleOptimal ={" "}
          {String(view.blockScheduleOptimal)} &middot; blockScheduleNoAutonomousBooking ={" "}
          {String(view.blockScheduleNoAutonomousBooking)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
