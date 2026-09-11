"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type BatchPartitionDetermination,
  type BatchPartitionDisposition,
  type BatchPartitionRequest,
  type PartitionBatch,
  DEMO_BATCH_PARTITION_EVEN_REQUEST,
  DEMO_BATCH_PARTITION_ITEMBOUND_REQUEST,
  DEMO_BATCH_PARTITION_REQUEST,
  evaluateBatchPartition
} from "../lib/batch-partition";

/**
 * Chart Review Batch Partitioning / Linear Partition (Binary-Search-on-Answer) runner for the intake demo.
 *
 * Fires the real, server-side A2A Batch Partition agent at /api/agents/batch-partition/tasks — a
 * care-coordination workload-partitioning service that splits an ordered clinical review worklist into k
 * contiguous batches minimizing the busiest reviewer's load. The panel surfaces the disposition, the batch
 * boundaries (with loads), the minimal peak load vs the total weight, the honesty signals, the synthetic /
 * PHI-adjacent labels, and a deep link into the parented Agent Fabric trace.
 *
 * A partition — divisible or item-bound — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresSupervisorReview:true, autoAssigned:false). The reordered-cover, sub-optimal, and auto-assigned
 * presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather
 * than hidden.
 *
 * PHI-adjacent — the item labels reference charts / encounters. The weights are an ILLUSTRATIVE synthetic, NOT
 * a certified staffing / workforce-management system. Structure, styling tokens, and tone mirror
 * <HuffmanCodingPanel> so this reads as a native sibling on /demo/intake.
 */

const BATCH_PARTITION_ROUTE = "/api/agents/batch-partition/tasks";

/** A one-click demo scenario. */
export type BatchPartitionPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: BatchPartitionRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST);

export const BATCH_PARTITION_PRESETS: BatchPartitionPreset[] = [
  {
    id: "divisible",
    label: "Chart-review backlog — divisible",
    hint: "Six weighted charts split across three reviewers.",
    request: DEMO_BATCH_PARTITION_REQUEST,
    demonstrates: "Linear partition — minimal peak load 10 (total 24) across 3 reviewers."
  },
  {
    id: "item-bound",
    label: "Dominant chart — item-bound",
    hint: "One 20-point chart sets the floor.",
    request: DEMO_BATCH_PARTITION_ITEMBOUND_REQUEST,
    demonstrates: "An item-bound worklist — more reviewers cannot lower the peak load of 20."
  },
  {
    id: "even",
    label: "Even queue — perfectly balanced",
    hint: "Four equal-weight encounters split evenly.",
    request: DEMO_BATCH_PARTITION_EVEN_REQUEST,
    demonstrates: "A perfectly balanced split — minimal peak load 8 across 2 reviewers."
  },
  {
    id: "reordered-cover-block",
    label: "Reordered cover → governance block",
    hint: "Batches that no longer reproduce the item order.",
    request: DEMO_BATCH_PARTITION_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      batches: [
        VALID_DETERMINATION.batches[1],
        VALID_DETERMINATION.batches[0],
        VALID_DETERMINATION.batches[2]
      ]
    },
    demonstrates:
      "The Agent Fabric blocking a cover whose order doesn't match the worklist (policy.batchpartition.partition-sourced)."
  },
  {
    id: "sub-optimal-block",
    label: "Sub-optimal split → governance block",
    hint: "A valid split that overloads one reviewer.",
    request: DEMO_BATCH_PARTITION_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      batches: [
        { items: VALID_DETERMINATION.items.slice(0, 3), load: 11 },
        { items: VALID_DETERMINATION.items.slice(3, 5), load: 9 },
        { items: VALID_DETERMINATION.items.slice(5, 6), load: 4 }
      ],
      maxBatchLoad: 11
    },
    demonstrates:
      "The Agent Fabric blocking a split that isn't the linear-partition optimum (policy.batchpartition.load-optimal)."
  },
  {
    id: "auto-assigned-block",
    label: "Assigned autonomously → governance block",
    hint: "A partition that dispatched reviewers itself.",
    request: DEMO_BATCH_PARTITION_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresSupervisorReview: false,
      autoAssigned: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous assignment (policy.batchpartition.no-autonomous-assign)."
  }
];

/** Render-ready view of a produced partition lifted from the task. */
export type BatchPartitionResolvedView = {
  kind: "resolved";
  worklistRef: string;
  disposition: BatchPartitionDisposition;
  batches: PartitionBatch[];
  maxBatchLoad: number;
  totalWeight: number;
  reason: string;
  note: string;
  batchPartitionSourced: boolean;
  batchPartitionLoadOptimal: boolean;
  batchPartitionNoAutonomousAssign: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type BatchPartitionBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type BatchPartitionInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type BatchPartitionView =
  | BatchPartitionResolvedView
  | BatchPartitionBlockedView
  | BatchPartitionInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  batchPartitionSourced?: unknown;
  batchPartitionLoadOptimal?: unknown;
  batchPartitionNoAutonomousAssign?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildBatchPartitionRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: BatchPartitionRequest;
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
 * POST a partition request (or an asserted determination) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runBatchPartitionTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: BatchPartitionRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(BATCH_PARTITION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBatchPartitionRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * partition (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function batchPartitionViewFromTask(task: A2ATask): BatchPartitionView {
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
        "The Agent Fabric blocked this partition.";
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
      (typeof fabric.error === "string" ? fabric.error : "The partition could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: BatchPartitionDetermination; worklistRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    worklistRef: result?.worklistRef ?? det?.worklistRef ?? "",
    disposition: det?.disposition ?? "divisible",
    batches: det?.batches ?? [],
    maxBatchLoad: det?.maxBatchLoad ?? 0,
    totalWeight: det?.totalWeight ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    batchPartitionSourced: fabric.batchPartitionSourced === true,
    batchPartitionLoadOptimal: fabric.batchPartitionLoadOptimal === true,
    batchPartitionNoAutonomousAssign: fabric.batchPartitionNoAutonomousAssign === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<BatchPartitionDisposition, string> = {
  divisible: "#8fd6b0",
  "item-bound": "#ffd28a"
};

const DISPOSITION_LABEL: Record<BatchPartitionDisposition, string> = {
  divisible: "Divisible · the minimal peak load exceeds every single item",
  "item-bound": "Item-bound · one dominant item sets the peak (more reviewers cannot lower it)"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: BatchPartitionView }
  | { status: "error"; message: string };

export function BatchPartitionPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: BatchPartitionPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runBatchPartitionTask({
          taskId: newTaskId("batch-partition"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: batchPartitionViewFromTask(task) });
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
        Care coordination &middot; workload partitioning &middot; linear partition
      </p>
      <h3 style={{ margin: 0 }}>
        Chart Review Batch Partitioning — partition sourced &amp; self-consistent, minimal peak load
        recomputed, never an autonomous assignment
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> splits an{" "}
        <strong>ordered clinical review worklist</strong> into <strong>k contiguous batches</strong> that{" "}
        <strong>minimize the busiest reviewer&rsquo;s load</strong> &mdash; solved by{" "}
        <strong>binary search on the answer</strong>. The split is a real{" "}
        <strong>order-preserving cover</strong>, the peak load is the{" "}
        <strong>proven linear-partition minimum</strong>, and it is a <strong>recommendation</strong>: the
        agent <strong>never</strong> assigns a named reviewer or dispatches the worklist &mdash; a supervisor
        confirms.{" "}
        <strong>PHI-adjacent &middot; illustrative, not a certified staffing system.</strong> Run a preset,
        then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {BATCH_PARTITION_PRESETS.map((preset) => (
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
              ? "Partitioning…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Partitioning failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <BatchPartitionResult view={runState.view} />}
    </section>
  );
}

function BatchPartitionResult({ view }: { view: BatchPartitionView }) {
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
        Batch partition (deterministic, synthetic)
        {view.worklistRef ? ` · ${view.worklistRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        minimal peak load {view.maxBatchLoad} &middot; total {view.totalWeight} &middot; {view.batches.length}{" "}
        reviewer{view.batches.length === 1 ? "" : "s"}
      </p>

      {view.batches.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.3rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.batches.map((b, i) => (
            <li key={i}>
              Reviewer {i + 1} &rarr;{" "}
              <code style={{ color: tone }}>{b.items.map((it) => it.label).join(", ")}</code> (load {b.load})
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Batch partition safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; load-optimal &middot; never an autonomous assignment{" "}
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
          batchPartitionSourced = {String(view.batchPartitionSourced)} &middot; batchPartitionLoadOptimal ={" "}
          {String(view.batchPartitionLoadOptimal)} &middot; batchPartitionNoAutonomousAssign ={" "}
          {String(view.batchPartitionNoAutonomousAssign)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
