"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type NetworkBuildoutDetermination,
  type NetworkBuildoutDisposition,
  type NetworkBuildoutRequest,
  type NetworkLink,
  DEMO_NETWORK_BUILDOUT_PARTITIONED_REQUEST,
  DEMO_NETWORK_BUILDOUT_REQUEST,
  DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST,
  evaluateNetworkBuildout
} from "../lib/network-buildout";

/**
 * Provider Network Build-Out / Minimum Spanning Tree (Kruskal's Algorithm) runner for the intake demo.
 *
 * Fires the real, server-side A2A Network Build-Out agent at /api/agents/network-buildout/tasks — a
 * care-coordination network-planning service that selects the minimum-total-cost set of links connecting a set
 * of care sites into one network, or reports that the candidate links can't connect everything. The panel
 * surfaces the disposition, the chosen links (with costs), the minimum total build cost, the component count,
 * the honesty signals, the synthetic / PHI-adjacent labels, and a deep link into the parented Agent Fabric
 * trace.
 *
 * A build plan — connected or partitioned — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresArchitectReview:true, autoProvisioned:false). A partitioned disposition is a LEGITIMATE FINDING, NOT a
 * governance block. The fabricated-link, sub-optimal, and auto-provisioned presets assert offending
 * DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-adjacent — the site labels reference clinics / facilities. The costs are an ILLUSTRATIVE synthetic, NOT a
 * certified network-design system. Structure, styling tokens, and tone mirror <BatchPartitionPanel> so this
 * reads as a native sibling on /demo/intake.
 */

const NETWORK_BUILDOUT_ROUTE = "/api/agents/network-buildout/tasks";

/** A one-click demo scenario. */
export type NetworkBuildoutPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: NetworkBuildoutRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST);
/** A valid, produced determination over the triangle — the sub-optimal block base. */
const VALID_TRIANGLE = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST);

export const NETWORK_BUILDOUT_PRESETS: NetworkBuildoutPreset[] = [
  {
    id: "connected",
    label: "Five sites — one network",
    hint: "Five care sites, seven candidate links.",
    request: DEMO_NETWORK_BUILDOUT_REQUEST,
    demonstrates: "Minimum spanning tree — all five sites connected at minimum total cost 18."
  },
  {
    id: "partitioned",
    label: "Detached annex — partitioned",
    hint: "Two sites with no link to the cluster.",
    request: DEMO_NETWORK_BUILDOUT_PARTITIONED_REQUEST,
    demonstrates: "A partitioned finding — the candidate links leave 2 separate components."
  },
  {
    id: "triangle",
    label: "Triangle — cheapest two links",
    hint: "Three sites; the priciest link closes a cycle.",
    request: DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST,
    demonstrates: "A cycle-closing link dropped — connected at cost 3, not 10."
  },
  {
    id: "fabricated-link-block",
    label: "Fabricated link → governance block",
    hint: "A chosen link that isn't a submitted candidate.",
    request: DEMO_NETWORK_BUILDOUT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      chosenLinks: [
        ...VALID_DETERMINATION.chosenLinks.slice(0, 3),
        { a: "hub", b: "west", cost: 1 } as NetworkLink
      ],
      totalCost:
        VALID_DETERMINATION.chosenLinks.slice(0, 3).reduce((s, l) => s + l.cost, 0) + 1
    },
    demonstrates:
      "The Agent Fabric blocking a plan with a link that isn't a submitted candidate (policy.netbuildout.tree-sourced)."
  },
  {
    id: "sub-optimal-block",
    label: "Sub-optimal tree → governance block",
    hint: "A valid tree that isn't minimal.",
    request: DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST,
    determination: {
      ...VALID_TRIANGLE,
      chosenLinks: [
        { a: "site-x", b: "site-y", cost: 1 } as NetworkLink,
        { a: "site-x", b: "site-z", cost: 9 } as NetworkLink
      ],
      totalCost: 10,
      componentCount: 1
    },
    demonstrates:
      "The Agent Fabric blocking a tree that isn't the minimum spanning tree (policy.netbuildout.cost-optimal)."
  },
  {
    id: "auto-provisioned-block",
    label: "Provisioned autonomously → governance block",
    hint: "A plan that provisioned the links itself.",
    request: DEMO_NETWORK_BUILDOUT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresArchitectReview: false,
      autoProvisioned: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous provisioning (policy.netbuildout.no-autonomous-provision)."
  }
];

/** Render-ready view of a produced build plan lifted from the task. */
export type NetworkBuildoutResolvedView = {
  kind: "resolved";
  networkRef: string;
  disposition: NetworkBuildoutDisposition;
  chosenLinks: NetworkLink[];
  totalCost: number;
  componentCount: number;
  siteCount: number;
  reason: string;
  note: string;
  networkTreeSourced: boolean;
  networkTreeCostOptimal: boolean;
  networkNoAutonomousProvision: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type NetworkBuildoutBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type NetworkBuildoutInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type NetworkBuildoutView =
  | NetworkBuildoutResolvedView
  | NetworkBuildoutBlockedView
  | NetworkBuildoutInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  networkTreeSourced?: unknown;
  networkTreeCostOptimal?: unknown;
  networkNoAutonomousProvision?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildNetworkBuildoutRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: NetworkBuildoutRequest;
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
 * POST a build request (or an asserted determination) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runNetworkBuildoutTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: NetworkBuildoutRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(NETWORK_BUILDOUT_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildNetworkBuildoutRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced build
 * plan (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function networkBuildoutViewFromTask(task: A2ATask): NetworkBuildoutView {
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
        "The Agent Fabric blocked this build plan.";
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
      (typeof fabric.error === "string" ? fabric.error : "The build plan could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: NetworkBuildoutDetermination; networkRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    networkRef: result?.networkRef ?? det?.networkRef ?? "",
    disposition: det?.disposition ?? "connected",
    chosenLinks: det?.chosenLinks ?? [],
    totalCost: det?.totalCost ?? 0,
    componentCount: det?.componentCount ?? 0,
    siteCount: det?.siteCount ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    networkTreeSourced: fabric.networkTreeSourced === true,
    networkTreeCostOptimal: fabric.networkTreeCostOptimal === true,
    networkNoAutonomousProvision: fabric.networkNoAutonomousProvision === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<NetworkBuildoutDisposition, string> = {
  connected: "#8fd6b0",
  partitioned: "#ffd28a"
};

const DISPOSITION_LABEL: Record<NetworkBuildoutDisposition, string> = {
  connected: "Connected · every site joins one network at minimum total build cost",
  partitioned: "Partitioned · the candidate links leave more than one separate component"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: NetworkBuildoutView }
  | { status: "error"; message: string };

export function NetworkBuildoutPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: NetworkBuildoutPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runNetworkBuildoutTask({
          taskId: newTaskId("network-buildout"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: networkBuildoutViewFromTask(task) });
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
        Care coordination &middot; network planning &middot; minimum spanning tree
      </p>
      <h3 style={{ margin: 0 }}>
        Provider Network Build-Out — tree sourced &amp; self-consistent, minimum total cost recomputed, never an
        autonomous provisioning
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> selects the{" "}
        <strong>minimum-total-cost set of links</strong> that connects a set of{" "}
        <strong>care sites</strong> into <strong>one network</strong> &mdash; solved by{" "}
        <strong>Kruskal&rsquo;s algorithm</strong> &mdash; or reports the plan{" "}
        <strong>partitioned</strong> when the candidate links can&rsquo;t reach every site. The tree is a real{" "}
        <strong>acyclic subset of the candidates</strong>, the cost is the{" "}
        <strong>proven minimum spanning tree</strong>, and it is a <strong>recommendation</strong>: the agent{" "}
        <strong>never</strong> provisions, activates, or orders a link &mdash; a network architect confirms.{" "}
        <strong>PHI-adjacent &middot; illustrative, not a certified network-design system.</strong> Run a
        preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {NETWORK_BUILDOUT_PRESETS.map((preset) => (
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
              ? "Building…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Build planning failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <NetworkBuildoutResult view={runState.view} />}
    </section>
  );
}

function NetworkBuildoutResult({ view }: { view: NetworkBuildoutView }) {
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
        Network build plan (deterministic, synthetic)
        {view.networkRef ? ` · ${view.networkRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        total build cost {view.totalCost} &middot; {view.chosenLinks.length} link
        {view.chosenLinks.length === 1 ? "" : "s"} &middot; {view.componentCount} component
        {view.componentCount === 1 ? "" : "s"} over {view.siteCount} site
        {view.siteCount === 1 ? "" : "s"}
      </p>

      {view.chosenLinks.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.3rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.chosenLinks.map((l, i) => (
            <li key={i}>
              <code style={{ color: tone }}>
                {l.a} &harr; {l.b}
              </code>{" "}
              (cost {l.cost})
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Network build-out safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; cost-optimal &middot; never an autonomous provisioning{" "}
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
          networkTreeSourced = {String(view.networkTreeSourced)} &middot; networkTreeCostOptimal ={" "}
          {String(view.networkTreeCostOptimal)} &middot; networkNoAutonomousProvision ={" "}
          {String(view.networkNoAutonomousProvision)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
