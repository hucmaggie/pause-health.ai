"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type CutEdge,
  type EdgeFlow,
  type ReferralNetworkRequest,
  type ReferralThroughputDetermination,
  type ReferralThroughputDisposition,
  DEMO_REFERRAL_THROUGHPUT_DIAMOND_REQUEST,
  DEMO_REFERRAL_THROUGHPUT_REQUEST,
  DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST,
  evaluateReferralThroughput
} from "../lib/referral-throughput";

/**
 * Referral Throughput / Maximum-Flow Network Capacity (Edmonds–Karp) runner for the intake demo.
 *
 * Fires the real, server-side A2A Referral Throughput agent at /api/agents/referral-throughput/tasks — a
 * care-coordination network-capacity service that computes the maximum number of referrals routable through a
 * capacity network and the min-cut bottleneck. The panel surfaces the disposition, the max-flow vs demand, the
 * min-cut edges, the honesty signals, the synthetic / PHI-adjacent labels, and a deep link into the parented
 * Agent Fabric trace.
 *
 * A throughput plan — unconstrained or bottlenecked — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresCoordinatorReview:true, autoRouted:false). A bottlenecked disposition is a LEGITIMATE FINDING, NOT a
 * governance block. The over-capacity, sub-maximal, and auto-routed presets assert offending DETERMINATIONS — so
 * all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-adjacent — the node labels reference intake pools / specialties / slots. The capacities are an ILLUSTRATIVE
 * synthetic, NOT a certified capacity-planning system. Structure, styling tokens, and tone mirror
 * <NetworkBuildoutPanel> so this reads as a native sibling on /demo/intake.
 */

const REFERRAL_THROUGHPUT_ROUTE = "/api/agents/referral-throughput/tasks";

/** A one-click demo scenario. */
export type ReferralThroughputPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: ReferralNetworkRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST);
/** A valid, produced determination over the unconstrained demo — the sub-maximal block base. */
const VALID_UNCONSTRAINED = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST);

export const REFERRAL_THROUGHPUT_PRESETS: ReferralThroughputPreset[] = [
  {
    id: "bottlenecked",
    label: "Menopause clinic — bottlenecked",
    hint: "Demand 12, but the specialty→slot edges cap it.",
    request: DEMO_REFERRAL_THROUGHPUT_REQUEST,
    demonstrates: "Max-flow / min-cut — throughput 8 of 12 demanded; the bottleneck is the slot edges."
  },
  {
    id: "unconstrained",
    label: "Small clinic — unconstrained",
    hint: "Every referral routes end-to-end.",
    request: DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST,
    demonstrates: "An unconstrained network — throughput 3 meets demand 3."
  },
  {
    id: "diamond",
    label: "Diamond — back-edge cancellation",
    hint: "The cross edge forces a residual back-edge.",
    request: DEMO_REFERRAL_THROUGHPUT_DIAMOND_REQUEST,
    demonstrates: "Edmonds–Karp routing 3 of 4 via a path that cancels an earlier assignment."
  },
  {
    id: "over-capacity-block",
    label: "Over-capacity flow → governance block",
    hint: "A reported flow above an edge's capacity.",
    request: DEMO_REFERRAL_THROUGHPUT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      flows: VALID_DETERMINATION.flows.map((f, i) =>
        i === 0 ? { ...f, flow: f.flow + 100 } : f
      )
    },
    demonstrates:
      "The Agent Fabric blocking a flow that exceeds an edge's capacity (policy.referralflow.flow-sourced)."
  },
  {
    id: "sub-maximal-block",
    label: "Sub-maximal throughput → governance block",
    hint: "A feasible flow that isn't the maximum.",
    request: DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST,
    determination: {
      ...VALID_UNCONSTRAINED,
      flows: VALID_UNCONSTRAINED.flows.map((f) => ({ ...f, flow: 2 })),
      maxFlow: 2,
      minCutCapacity: 2
    },
    demonstrates:
      "The Agent Fabric blocking a flow that isn't the maximum (policy.referralflow.throughput-optimal)."
  },
  {
    id: "auto-routed-block",
    label: "Routed autonomously → governance block",
    hint: "A plan that booked the referrals itself.",
    request: DEMO_REFERRAL_THROUGHPUT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresCoordinatorReview: false,
      autoRouted: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous routing (policy.referralflow.no-autonomous-route)."
  }
];

/** Render-ready view of a produced throughput plan lifted from the task. */
export type ReferralThroughputResolvedView = {
  kind: "resolved";
  networkRef: string;
  disposition: ReferralThroughputDisposition;
  flows: EdgeFlow[];
  maxFlow: number;
  totalDemand: number;
  minCutEdges: CutEdge[];
  minCutCapacity: number;
  reason: string;
  note: string;
  referralFlowSourced: boolean;
  referralThroughputOptimal: boolean;
  referralNoAutonomousRoute: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ReferralThroughputBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ReferralThroughputInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ReferralThroughputView =
  | ReferralThroughputResolvedView
  | ReferralThroughputBlockedView
  | ReferralThroughputInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  referralFlowSourced?: unknown;
  referralThroughputOptimal?: unknown;
  referralNoAutonomousRoute?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildReferralThroughputRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ReferralNetworkRequest;
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
 * POST a network request (or an asserted determination) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runReferralThroughputTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ReferralNetworkRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(REFERRAL_THROUGHPUT_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildReferralThroughputRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * throughput plan (completed) from a governance block vs. an invalid request
 * (both `failed`, told apart by metadata.agentFabric.decision).
 */
export function referralThroughputViewFromTask(task: A2ATask): ReferralThroughputView {
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
        "The Agent Fabric blocked this throughput plan.";
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
      (typeof fabric.error === "string" ? fabric.error : "The throughput plan could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: ReferralThroughputDetermination; networkRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    networkRef: result?.networkRef ?? det?.networkRef ?? "",
    disposition: det?.disposition ?? "unconstrained",
    flows: det?.flows ?? [],
    maxFlow: det?.maxFlow ?? 0,
    totalDemand: det?.totalDemand ?? 0,
    minCutEdges: det?.minCutEdges ?? [],
    minCutCapacity: det?.minCutCapacity ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    referralFlowSourced: fabric.referralFlowSourced === true,
    referralThroughputOptimal: fabric.referralThroughputOptimal === true,
    referralNoAutonomousRoute: fabric.referralNoAutonomousRoute === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<ReferralThroughputDisposition, string> = {
  unconstrained: "#8fd6b0",
  bottlenecked: "#ffd28a"
};

const DISPOSITION_LABEL: Record<ReferralThroughputDisposition, string> = {
  unconstrained: "Unconstrained · every referral routes end-to-end (throughput meets demand)",
  bottlenecked: "Bottlenecked · a min-cut caps throughput below demand"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ReferralThroughputView }
  | { status: "error"; message: string };

export function ReferralThroughputPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ReferralThroughputPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runReferralThroughputTask({
          taskId: newTaskId("referral-throughput"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: referralThroughputViewFromTask(task) });
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
        Care coordination &middot; network capacity &middot; maximum flow
      </p>
      <h3 style={{ margin: 0 }}>
        Referral Throughput — flow sourced &amp; conservation-consistent, maximum throughput recomputed, never
        an autonomous routing
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> computes the{" "}
        <strong>maximum number of referrals</strong> routable through a{" "}
        <strong>capacity network</strong> &mdash; solved by{" "}
        <strong>Edmonds&ndash;Karp max-flow</strong> &mdash; and names the{" "}
        <strong>min-cut bottleneck</strong> when throughput can&rsquo;t meet demand. The flow is a real{" "}
        <strong>conservation-consistent</strong> assignment, the throughput is the{" "}
        <strong>proven maximum (max-flow = min-cut)</strong>, and it is a <strong>recommendation</strong>: the
        agent <strong>never</strong> books or routes a referral &mdash; a referral coordinator confirms.{" "}
        <strong>PHI-adjacent &middot; illustrative, not a certified capacity-planning system.</strong> Run a
        preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {REFERRAL_THROUGHPUT_PRESETS.map((preset) => (
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
              ? "Solving…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Throughput planning failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ReferralThroughputResult view={runState.view} />}
    </section>
  );
}

function ReferralThroughputResult({ view }: { view: ReferralThroughputView }) {
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
        Referral throughput (deterministic, synthetic)
        {view.networkRef ? ` · ${view.networkRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        maximum throughput {view.maxFlow} of {view.totalDemand} demanded &middot; min-cut capacity{" "}
        {view.minCutCapacity}
      </p>

      {view.disposition === "bottlenecked" && view.minCutEdges.length > 0 && (
        <>
          <p style={{ margin: "0.5rem 0 0.2rem", fontSize: "0.82rem", fontWeight: 600 }}>
            Bottleneck (minimum cut):
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: "1.3rem",
              color: "var(--muted)",
              fontSize: "0.84rem"
            }}
          >
            {view.minCutEdges.map((e, i) => (
              <li key={i}>
                <code style={{ color: tone }}>
                  {e.from} &rarr; {e.to}
                </code>{" "}
                (capacity {e.capacity})
              </li>
            ))}
          </ul>
        </>
      )}

      <div
        role="note"
        aria-label="Referral throughput safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; throughput-optimal &middot; never an autonomous routing{" "}
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
          referralFlowSourced = {String(view.referralFlowSourced)} &middot; referralThroughputOptimal ={" "}
          {String(view.referralThroughputOptimal)} &middot; referralNoAutonomousRoute ={" "}
          {String(view.referralNoAutonomousRoute)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
