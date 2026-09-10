"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type ClaimLifecycleDetermination,
  type ClaimLifecycleDisposition,
  type ClaimLifecycleRequest,
  DEFAULT_CLAIM_STATE_MACHINE,
  DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST,
  DEMO_CLAIM_LIFECYCLE_REQUEST,
  DEMO_CLAIM_LIFECYCLE_UNREACHABLE_REQUEST
} from "../lib/claim-lifecycle";

/**
 * Claim Lifecycle / Status-Transition Guard runner for the intake demo.
 *
 * Fires the real, server-side A2A Claim Lifecycle agent at /api/agents/claim-lifecycle/tasks — a
 * payer-operations service that validates a claim-status transition against a state machine using an FSM
 * transition-table lookup + BFS reachability. The panel surfaces the disposition, the current → requested
 * pair, the allowed next states, the shortest legal path, the honesty signals, the synthetic / PHI
 * labels, and a deep link into the parented Agent Fabric trace.
 *
 * A finding — transition-allowed, transition-illegal-but-reachable, or transition-unreachable — is a
 * SAFE, honest OUTPUT (it completes; it carries requiresAdjusterReview:true, autoAdvanced:false). The
 * fabricated-state, miscomputed-transition, and auto-advanced presets assert offending DETERMINATIONS —
 * so all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-bearing — the claim references a patient. The panel is ILLUSTRATIVE, NOT a certified
 * claims-processing system. Structure, styling tokens, and tone mirror <MedicationNameSafetyPanel> so
 * this reads as a native sibling on /demo/intake.
 */

const CLAIM_LIFECYCLE_ROUTE = "/api/agents/claim-lifecycle/tasks";

/** A one-click demo scenario. */
export type ClaimLifecyclePreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: ClaimLifecycleRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the draft→paid illegal-but-reachable demo — the block base. */
const VALID_DETERMINATION = {
  claimRef: "clm-002",
  patientRef: "patient-5528",
  currentStatus: "draft",
  requestedStatus: "paid",
  stateMachine: {
    states: [...DEFAULT_CLAIM_STATE_MACHINE.states],
    transitions: { ...DEFAULT_CLAIM_STATE_MACHINE.transitions },
    terminalStates: [...DEFAULT_CLAIM_STATE_MACHINE.terminalStates]
  },
  directEdge: false,
  reachable: true,
  allowedNextStates: ["submitted", "void"],
  shortestPath: ["draft", "submitted", "acknowledged", "adjudicated", "paid"],
  pathLength: 4,
  disposition: "transition-illegal-but-reachable",
  requiresAdjusterReview: true,
  autoAdvanced: false
};

export const CLAIM_LIFECYCLE_PRESETS: ClaimLifecyclePreset[] = [
  {
    id: "transition-allowed",
    label: "adjudicated \u2192 paid (allowed)",
    hint: "A legal single-step transition.",
    request: DEMO_CLAIM_LIFECYCLE_REQUEST,
    demonstrates: "A legal single-step edge in the state machine — transition-allowed."
  },
  {
    id: "illegal-but-reachable",
    label: "draft \u2192 paid (illegal, reachable)",
    hint: "Skips adjudication; reachable in 4 steps.",
    request: DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST,
    demonstrates:
      "Not a legal single step (it skips adjudication) but reachable — the path shows the required steps."
  },
  {
    id: "unreachable",
    label: "void \u2192 paid (unreachable)",
    hint: "void is terminal.",
    request: DEMO_CLAIM_LIFECYCLE_UNREACHABLE_REQUEST,
    demonstrates: "The target can never follow the current status — transition-unreachable."
  },
  {
    id: "fabricated-state-block",
    label: "Fabricated lifecycle state \u2192 governance block",
    hint: "A path through a state not in the machine.",
    request: DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: "teleport" is not a defined state and submitted→teleport is not a real transition.
      shortestPath: ["draft", "submitted", "teleport", "adjudicated", "paid"]
    },
    demonstrates:
      "The Agent Fabric blocking a finding that names a state / edge not in the machine (policy.claim.states-sourced)."
  },
  {
    id: "miscomputed-transition-block",
    label: "Wrong direct-edge flag \u2192 governance block",
    hint: "Claims a legal single step that isn't.",
    request: DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: draft→paid is not a direct edge, so this cannot be transition-allowed.
      directEdge: true,
      disposition: "transition-allowed"
    },
    demonstrates:
      "The Agent Fabric blocking a finding whose transition logic doesn't recompute (policy.claim.transition-consistent)."
  },
  {
    id: "auto-advanced-block",
    label: "Claim advanced autonomously \u2192 governance block",
    hint: "A finding that advanced the claim.",
    request: DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: the agent advanced the claim and skipped adjuster review.
      requiresAdjusterReview: false,
      autoAdvanced: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous advance (policy.claim.no-autonomous-advance)."
  }
];

/** Render-ready view of a produced finding lifted from the task. */
export type ClaimLifecycleResolvedView = {
  kind: "resolved";
  claimRef: string;
  patientRef: string;
  currentStatus: string;
  requestedStatus: string;
  disposition: ClaimLifecycleDisposition;
  directEdge: boolean;
  reachable: boolean;
  allowedNextStates: string[];
  shortestPath: string[];
  pathLength: number;
  reason: string;
  note: string;
  claimStatesSourced: boolean;
  claimTransitionConsistent: boolean;
  claimNoAutonomousAdvance: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ClaimLifecycleBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ClaimLifecycleInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ClaimLifecycleView =
  | ClaimLifecycleResolvedView
  | ClaimLifecycleBlockedView
  | ClaimLifecycleInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  claimStatesSourced?: unknown;
  claimTransitionConsistent?: unknown;
  claimNoAutonomousAdvance?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildClaimLifecycleRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ClaimLifecycleRequest;
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
 * POST a claim-lifecycle request (or an asserted finding) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP
 * 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runClaimLifecycleTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ClaimLifecycleRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CLAIM_LIFECYCLE_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildClaimLifecycleRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * finding (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function claimLifecycleViewFromTask(task: A2ATask): ClaimLifecycleView {
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
        "The Agent Fabric blocked this claim-lifecycle run.";
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
      (typeof fabric.error === "string" ? fabric.error : "The transition could not be validated.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: ClaimLifecycleDetermination; claimRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    claimRef: result?.claimRef ?? det?.claimRef ?? "",
    patientRef: det?.patientRef ?? "",
    currentStatus: det?.currentStatus ?? "",
    requestedStatus: det?.requestedStatus ?? "",
    disposition: det?.disposition ?? "transition-unreachable",
    directEdge: det?.directEdge ?? false,
    reachable: det?.reachable ?? false,
    allowedNextStates: det?.allowedNextStates ?? [],
    shortestPath: det?.shortestPath ?? [],
    pathLength: det?.pathLength ?? -1,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    claimStatesSourced: fabric.claimStatesSourced === true,
    claimTransitionConsistent: fabric.claimTransitionConsistent === true,
    claimNoAutonomousAdvance: fabric.claimNoAutonomousAdvance === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<ClaimLifecycleDisposition, string> = {
  "transition-allowed": "#8fd6b0",
  "transition-illegal-but-reachable": "#ffd28a",
  "transition-unreachable": "#ffb6c8"
};

const DISPOSITION_LABEL: Record<ClaimLifecycleDisposition, string> = {
  "transition-allowed": "Transition allowed \u00b7 legal single step",
  "transition-illegal-but-reachable": "Illegal single step \u00b7 but reachable",
  "transition-unreachable": "Unreachable \u00b7 can never follow"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ClaimLifecycleView }
  | { status: "error"; message: string };

export function ClaimLifecyclePanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ClaimLifecyclePreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runClaimLifecycleTask({
          taskId: newTaskId("claim-lifecycle"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: claimLifecycleViewFromTask(task) });
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
        Claims &middot; status-transition guard &middot; payer &amp; plan operations
      </p>
      <h3 style={{ margin: 0 }}>
        Claim Lifecycle — every state sourced, transition logic exact, never an autonomous advance
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> takes a claim&rsquo;s <strong>current status</strong>{" "}
        and a <strong>requested next status</strong> and, against a claim-status{" "}
        <strong>state machine</strong>, decides whether the move is a <strong>legal single step</strong>,{" "}
        <strong>reachable</strong> only via a longer path (a <strong>BFS</strong> shows the required
        steps), or <strong>impossible</strong>. Not an edit distance, not a topological sort &mdash;{" "}
        <strong>finite-state-machine transition validation</strong>. Every state is{" "}
        <strong>sourced</strong> from the machine, the logic <strong>recomputes exactly</strong>, and the
        result is a <strong>recommendation</strong>: the agent <strong>never</strong> advances, pays, or
        finalizes &mdash; an adjuster confirms.{" "}
        <strong>PHI-bearing &middot; illustrative state machine, not a certified system.</strong> Run a
        preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CLAIM_LIFECYCLE_PRESETS.map((preset) => (
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
              ? "Checking\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Transition check failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ClaimLifecycleResult view={runState.view} />}
    </section>
  );
}

function ClaimLifecycleResult({ view }: { view: ClaimLifecycleView }) {
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
        Finding (deterministic, synthetic)
        {view.claimRef ? ` \u00b7 ${view.claimRef}` : ""}
        {view.currentStatus ? ` \u00b7 ${view.currentStatus} \u2192 ${view.requestedStatus}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>

      {view.allowedNextStates.length > 0 && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
          Legal next from {view.currentStatus}: {view.allowedNextStates.join(", ")}
        </p>
      )}

      {view.reachable && view.pathLength > 1 && (
        <p style={{ margin: "0.3rem 0 0", fontSize: "0.84rem", color: "#ffd28a" }}>
          Shortest legal path ({view.pathLength} steps): {view.shortestPath.join(" \u2192 ")}
        </p>
      )}

      <div
        role="note"
        aria-label="Finding safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; exact transition logic &middot; never an autonomous advance{" "}
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
          claimStatesSourced = {String(view.claimStatesSourced)} &middot; claimTransitionConsistent ={" "}
          {String(view.claimTransitionConsistent)} &middot; claimNoAutonomousAdvance ={" "}
          {String(view.claimNoAutonomousAdvance)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
