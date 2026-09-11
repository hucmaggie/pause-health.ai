"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type CareRouteDetermination,
  type CareRouteDisposition,
  type CareRouteRequest,
  DEMO_CARE_ROUTE_DIRECT_REQUEST,
  DEMO_CARE_ROUTE_NO_ROUTE_REQUEST,
  DEMO_CARE_ROUTE_REQUEST,
  evaluateCareRoute
} from "../lib/care-routing";

/**
 * Care-Transition Routing / Least-Burden Path runner for the intake demo.
 *
 * Fires the real, server-side A2A Care Routing agent at /api/agents/care-routing/tasks — a care-coordination
 * transition-planning service that finds the minimum-total-burden path from a patient's current care setting
 * to a goal setting via Dijkstra's weighted shortest path. The panel surfaces the disposition, the path, the
 * total burden, the honesty signals, the synthetic / PHI labels, and a deep link into the parented Agent
 * Fabric trace.
 *
 * A route — route-found or no-route — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresCareLeadReview:true, autoRouted:false). The fabricated-edge, sub-optimal, and auto-routed presets
 * assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than
 * hidden.
 *
 * PHI-bearing — the route is a patient's care plan. The settings + transitions are ILLUSTRATIVE synthetics,
 * NOT a certified care-transition / discharge-planning system. Structure, styling tokens, and tone mirror
 * <OutreachPrioritizationPanel> so this reads as a native sibling on /demo/intake.
 */

const CARE_ROUTE_ROUTE = "/api/agents/care-routing/tasks";

/** A one-click demo scenario. */
export type CareRoutePreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: CareRouteRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the multi-hop demo — the block base. */
const VALID_DETERMINATION = evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST);

export const CARE_ROUTE_PRESETS: CareRoutePreset[] = [
  {
    id: "multi-hop",
    label: "Hospital \u2192 home \u2192 least-burden route",
    hint: "Discharge routing across SNF / rehab / home-health.",
    request: DEMO_CARE_ROUTE_REQUEST,
    demonstrates:
      "Dijkstra's weighted shortest path \u2014 the minimum-total-burden route, not the fewest hops."
  },
  {
    id: "direct",
    label: "Clinic \u2192 specialist \u2192 direct is cheapest",
    hint: "A direct referral beats the imaging detour.",
    request: DEMO_CARE_ROUTE_DIRECT_REQUEST,
    demonstrates: "The direct edge wins when its burden is lowest."
  },
  {
    id: "no-route",
    label: "Goal unreachable \u2192 no-route",
    hint: "No transitions reach the goal setting.",
    request: DEMO_CARE_ROUTE_NO_ROUTE_REQUEST,
    demonstrates: "An honest no-route \u2014 empty path, no fabricated shortcut."
  },
  {
    id: "phantom-edge-block",
    label: "Fabricated transition \u2192 governance block",
    hint: "A path hop that isn't a permitted transition.",
    request: DEMO_CARE_ROUTE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      path: ["hospital", "home-health", "home"],
      hops: 2
    },
    demonstrates:
      "The Agent Fabric blocking a path with a fabricated transition not among the submitted edges (policy.route.path-sourced)."
  },
  {
    id: "sub-optimal-block",
    label: "Sub-optimal route \u2192 governance block",
    hint: "A valid path that isn't the least burden.",
    request: DEMO_CARE_ROUTE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      path: ["hospital", "snf", "home"],
      totalCost: 8,
      hops: 2
    },
    demonstrates:
      "The Agent Fabric blocking a real-edge route that doesn't match the Dijkstra optimum (policy.route.route-optimal)."
  },
  {
    id: "auto-routed-block",
    label: "Transition initiated autonomously \u2192 governance block",
    hint: "A route that moved the patient itself.",
    request: DEMO_CARE_ROUTE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresCareLeadReview: false,
      autoRouted: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous care-transition (policy.route.no-autonomous-routing)."
  }
];

/** Render-ready view of a produced route lifted from the task. */
export type CareRouteResolvedView = {
  kind: "resolved";
  routeRef: string;
  disposition: CareRouteDisposition;
  start: string;
  goal: string;
  path: string[];
  totalCost: number | null;
  hops: number;
  reachable: boolean;
  reason: string;
  note: string;
  routePathSourced: boolean;
  routeOptimal: boolean;
  routeNoAutonomousRouting: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type CareRouteBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type CareRouteInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type CareRouteView = CareRouteResolvedView | CareRouteBlockedView | CareRouteInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  routePathSourced?: unknown;
  routeOptimal?: unknown;
  routeNoAutonomousRouting?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildCareRouteRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: CareRouteRequest;
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
 * POST a routing request (or an asserted route) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP
 * 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runCareRouteTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: CareRouteRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CARE_ROUTE_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCareRouteRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced route
 * (completed) from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function careRouteViewFromTask(task: A2ATask): CareRouteView {
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
        "The Agent Fabric blocked this care route.";
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
      (typeof fabric.error === "string" ? fabric.error : "The route could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: CareRouteDetermination; routeRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    routeRef: result?.routeRef ?? det?.routeRef ?? "",
    disposition: det?.disposition ?? "no-route",
    start: det?.start ?? "",
    goal: det?.goal ?? "",
    path: det?.path ?? [],
    totalCost: det?.totalCost ?? null,
    hops: det?.hops ?? 0,
    reachable: det?.reachable ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    routePathSourced: fabric.routePathSourced === true,
    routeOptimal: fabric.routeOptimal === true,
    routeNoAutonomousRouting: fabric.routeNoAutonomousRouting === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<CareRouteDisposition, string> = {
  "route-found": "#8fd6b0",
  "no-route": "#ffd28a"
};

const DISPOSITION_LABEL: Record<CareRouteDisposition, string> = {
  "route-found": "Route found \u00b7 least-burden path via Dijkstra",
  "no-route": "No route \u00b7 the goal setting is unreachable"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: CareRouteView }
  | { status: "error"; message: string };

export function CareRoutingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: CareRoutePreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runCareRouteTask({
          taskId: newTaskId("care-routing"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: careRouteViewFromTask(task) });
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
        Care coordination &middot; transition planning &middot; Dijkstra shortest path
      </p>
      <h3 style={{ margin: 0 }}>
        Care-Transition Routing — path sourced, route optimal, never an autonomous transition
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> finds the <strong>least-burden route</strong> from a
        patient&rsquo;s current care setting to a goal setting through a <strong>weighted graph</strong> of
        permitted transitions &mdash; not a topological order, not a hop-count &mdash;{" "}
        <strong>Dijkstra&rsquo;s weighted shortest path</strong>. Every hop is a{" "}
        <strong>real transition</strong>, the route is provably <strong>optimal</strong>, and the plan is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> initiates the transition or moves
        the patient &mdash; a care lead confirms.{" "}
        <strong>PHI-bearing &middot; illustrative, not a certified discharge-planning system.</strong> Run a
        preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CARE_ROUTE_PRESETS.map((preset) => (
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
              ? "Routing\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Routing failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <CareRouteResult view={runState.view} />}
    </section>
  );
}

function CareRouteResult({ view }: { view: CareRouteView }) {
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
        Route (deterministic, synthetic)
        {view.routeRef ? ` \u00b7 ${view.routeRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>

      {view.reachable ? (
        <>
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
            {view.start} &rarr; {view.goal} &middot; total burden {view.totalCost} &middot; {view.hops}{" "}
            transition(s)
          </p>
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.9rem",
              fontWeight: 600,
              color: "var(--fg)"
            }}
          >
            {view.path.join(" \u2192 ")}
          </p>
        </>
      ) : (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
          {view.goal} is unreachable from {view.start} across the submitted transitions &mdash; no fabricated
          shortcut.
        </p>
      )}

      <div
        role="note"
        aria-label="Route safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; optimal &middot; never an autonomous transition{" "}
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
          routePathSourced = {String(view.routePathSourced)} &middot; routeOptimal ={" "}
          {String(view.routeOptimal)} &middot; routeNoAutonomousRouting ={" "}
          {String(view.routeNoAutonomousRouting)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
