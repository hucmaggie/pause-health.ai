"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type Assignment,
  type InterpreterAssignmentDetermination,
  type InterpreterAssignmentDisposition,
  type InterpreterAssignmentRequest,
  DEMO_INTERPRETER_ASSIGNMENT_GREEDY_TRAP_REQUEST,
  DEMO_INTERPRETER_ASSIGNMENT_INFEASIBLE_REQUEST,
  DEMO_INTERPRETER_ASSIGNMENT_REQUEST,
  evaluateInterpreterAssignment
} from "../lib/interpreter-assignment";

/**
 * Interpreter Assignment / Optimal Assignment (Hungarian Algorithm) runner for the intake demo.
 *
 * Fires the real, server-side A2A Interpreter Assignment agent at /api/agents/interpreter-assignment/tasks — a
 * care-coordination assignment service that computes the minimum-total-cost one-to-one matching of interpreters
 * to appointments. The panel surfaces the disposition, the pairings, the total cost, any uncoverable
 * appointments, the honesty signals, the synthetic / PHI-adjacent labels, and a deep link into the parented
 * Agent Fabric trace.
 *
 * An assignment — assignable or infeasible — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresCoordinatorReview:true, autoDispatched:false). An infeasible disposition is a LEGITIMATE FINDING, NOT
 * a governance block. The reused-interpreter, sub-optimal, and auto-dispatched presets assert offending
 * DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-adjacent — appointment encounters. The costs are an ILLUSTRATIVE synthetic, NOT a certified scheduling
 * system. Structure, styling tokens, and tone mirror <BenefitAccumulatorPanel> so this reads as a native sibling
 * on /demo/intake.
 */

const INTERPRETER_ASSIGNMENT_ROUTE = "/api/agents/interpreter-assignment/tasks";

/** A one-click demo scenario. */
export type InterpreterAssignmentPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: InterpreterAssignmentRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST);

export const INTERPRETER_ASSIGNMENT_PRESETS: InterpreterAssignmentPreset[] = [
  {
    id: "assignable",
    label: "Language roster — optimal assignment",
    hint: "Three interpreters, three concurrent appointments.",
    request: DEMO_INTERPRETER_ASSIGNMENT_REQUEST,
    demonstrates: "Hungarian algorithm — the min-total-cost perfect matching (cost 12, not the greedy pick)."
  },
  {
    id: "greedy-trap",
    label: "Greedy trap — spread beats double-book",
    hint: "The cheapest-per-appointment pick would collide.",
    request: DEMO_INTERPRETER_ASSIGNMENT_GREEDY_TRAP_REQUEST,
    demonstrates: "The optimum spreads interpreters for a lower total than the naive greedy assignment."
  },
  {
    id: "infeasible",
    label: "Coverage gap — infeasible",
    hint: "An appointment has no qualified interpreter.",
    request: DEMO_INTERPRETER_ASSIGNMENT_INFEASIBLE_REQUEST,
    demonstrates: "An infeasible roster — one appointment is left unmatched, flagging the coverage gap."
  },
  {
    id: "reused-interpreter-block",
    label: "Reused interpreter → governance block",
    hint: "The same interpreter used for two appointments.",
    request: DEMO_INTERPRETER_ASSIGNMENT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      assignments: [
        { interpreter: "interp-ES", appointment: "appt-A-spanish", cost: 4 },
        { interpreter: "interp-ES", appointment: "appt-B-mandarin", cost: 2 },
        { interpreter: "interp-AR", appointment: "appt-C-arabic", cost: 6 }
      ],
      totalCost: 12
    },
    demonstrates:
      "The Agent Fabric blocking a matching that reuses an interpreter (policy.interpasg.assignment-sourced)."
  },
  {
    id: "sub-optimal-block",
    label: "Sub-optimal → governance block",
    hint: "A valid matching that isn't the minimum cost.",
    request: DEMO_INTERPRETER_ASSIGNMENT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      assignments: [
        { interpreter: "interp-ES", appointment: "appt-A-spanish", cost: 4 },
        { interpreter: "interp-ZH", appointment: "appt-B-mandarin", cost: 3 },
        { interpreter: "interp-AR", appointment: "appt-C-arabic", cost: 6 }
      ],
      totalCost: 13
    },
    demonstrates:
      "The Agent Fabric blocking a matching that isn't the Hungarian minimum (policy.interpasg.cost-optimal)."
  },
  {
    id: "auto-dispatched-block",
    label: "Dispatched autonomously → governance block",
    hint: "A plan that booked the interpreters itself.",
    request: DEMO_INTERPRETER_ASSIGNMENT_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresCoordinatorReview: false,
      autoDispatched: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous dispatch (policy.interpasg.no-autonomous-dispatch)."
  }
];

/** Render-ready view of a produced assignment lifted from the task. */
export type InterpreterAssignmentResolvedView = {
  kind: "resolved";
  rosterRef: string;
  disposition: InterpreterAssignmentDisposition;
  assignments: Assignment[];
  totalCost: number;
  unmatched: string[];
  feasible: boolean;
  reason: string;
  note: string;
  interpAssignmentSourced: boolean;
  interpAssignmentOptimal: boolean;
  interpNoAutonomousDispatch: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type InterpreterAssignmentBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type InterpreterAssignmentInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type InterpreterAssignmentView =
  | InterpreterAssignmentResolvedView
  | InterpreterAssignmentBlockedView
  | InterpreterAssignmentInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  interpAssignmentSourced?: unknown;
  interpAssignmentOptimal?: unknown;
  interpNoAutonomousDispatch?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildInterpreterAssignmentRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: InterpreterAssignmentRequest;
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
export async function runInterpreterAssignmentTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: InterpreterAssignmentRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(INTERPRETER_ASSIGNMENT_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildInterpreterAssignmentRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced assignment
 * (completed) from a governance block vs. an invalid request (both `failed`, told
 * apart by metadata.agentFabric.decision).
 */
export function interpreterAssignmentViewFromTask(task: A2ATask): InterpreterAssignmentView {
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
        "The Agent Fabric blocked this assignment.";
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
      (typeof fabric.error === "string" ? fabric.error : "The assignment could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: InterpreterAssignmentDetermination; rosterRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    rosterRef: result?.rosterRef ?? det?.rosterRef ?? "",
    disposition: det?.disposition ?? "assignable",
    assignments: det?.assignments ?? [],
    totalCost: det?.totalCost ?? 0,
    unmatched: det?.unmatched ?? [],
    feasible: det?.feasible ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    interpAssignmentSourced: fabric.interpAssignmentSourced === true,
    interpAssignmentOptimal: fabric.interpAssignmentOptimal === true,
    interpNoAutonomousDispatch: fabric.interpNoAutonomousDispatch === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<InterpreterAssignmentDisposition, string> = {
  assignable: "#8fd6b0",
  infeasible: "#ffd28a"
};

const DISPOSITION_LABEL: Record<InterpreterAssignmentDisposition, string> = {
  assignable: "Assignable · every appointment matched at minimum total cost",
  infeasible: "Infeasible · some appointment has no qualified interpreter"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: InterpreterAssignmentView }
  | { status: "error"; message: string };

export function InterpreterAssignmentPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: InterpreterAssignmentPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runInterpreterAssignmentTask({
          taskId: newTaskId("interpreter-assignment"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: interpreterAssignmentViewFromTask(task) });
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
        Care coordination &middot; language access &middot; optimal assignment
      </p>
      <h3 style={{ margin: 0 }}>
        Interpreter Assignment — assignment sourced &amp; self-consistent, cost re-optimized by the Hungarian
        algorithm, never an autonomous dispatch
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> matches <strong>qualified interpreters</strong> to{" "}
        <strong>concurrent appointments</strong> at <strong>minimum total cost</strong> &mdash; the{" "}
        <strong>Hungarian algorithm</strong>&rsquo;s provably optimal one-to-one assignment (not a greedy
        pick). The matching is a real <strong>one-to-one</strong> cover, the cost is the{" "}
        <strong>proven minimum</strong>, and it is a <strong>recommendation</strong>: the agent{" "}
        <strong>never</strong> books, dispatches, or notifies an interpreter &mdash; a language-access
        coordinator confirms.{" "}
        <strong>PHI-adjacent &middot; illustrative, not a certified scheduling system.</strong> Run a preset,
        then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {INTERPRETER_ASSIGNMENT_PRESETS.map((preset) => (
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
              ? "Assigning…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Assignment failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <InterpreterAssignmentResult view={runState.view} />}
    </section>
  );
}

function InterpreterAssignmentResult({ view }: { view: InterpreterAssignmentView }) {
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
        Interpreter assignment (deterministic, synthetic)
        {view.rosterRef ? ` · ${view.rosterRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        minimum total cost {view.totalCost} &middot; {view.assignments.length} matched
        {view.unmatched.length > 0 ? ` · ${view.unmatched.length} unmatched` : ""}
      </p>

      {view.assignments.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.3rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.assignments.map((a) => (
            <li key={`${a.interpreter}-${a.appointment}`}>
              <code style={{ color: tone }}>{a.interpreter}</code> &rarr; {a.appointment} (cost {a.cost})
            </li>
          ))}
        </ul>
      )}

      {view.unmatched.length > 0 && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "#ffb6c8" }}>
          Uncoverable: {view.unmatched.join(", ")}
        </p>
      )}

      <div
        role="note"
        aria-label="Interpreter assignment safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; cost-optimal &middot; never an autonomous dispatch{" "}
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
          interpAssignmentSourced = {String(view.interpAssignmentSourced)} &middot; interpAssignmentOptimal ={" "}
          {String(view.interpAssignmentOptimal)} &middot; interpNoAutonomousDispatch ={" "}
          {String(view.interpNoAutonomousDispatch)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
