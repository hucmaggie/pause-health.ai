"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type ConsensusDetermination,
  type ConsensusDisposition,
  type ConsensusRequest,
  type SourceAgreement,
  DEMO_CONSENSUS_NO_MAJORITY_REQUEST,
  DEMO_CONSENSUS_REQUEST,
  DEMO_CONSENSUS_UNANIMOUS_REQUEST,
  evaluateConsensus
} from "../lib/source-consensus";

/**
 * Source-of-Truth Consensus / Golden-Record Field Reconciliation runner for the intake demo.
 *
 * Fires the real, server-side A2A Source Consensus agent at /api/agents/source-consensus/tasks — a
 * data-substrate master-data service that reconciles a field's conflicting source-system values into a
 * golden-record value via the Boyer–Moore majority vote. The panel surfaces the disposition, the consensus
 * value, the per-source votes, the honesty signals, the synthetic / non-PHI labels, and a deep link into the
 * parented Agent Fabric trace.
 *
 * A reconciliation — consensus or no-consensus — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresStewardReview:true, autoWritten:false). The fabricated-source, wrong-winner, and auto-written
 * presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather
 * than hidden.
 *
 * DELIBERATELY NOT PHI-bearing — a golden-record reference attribute, not patient health information. The
 * fields + sources + values are ILLUSTRATIVE synthetics, NOT a certified master-data-management system.
 * Structure, styling tokens, and tone mirror <CareRoutingPanel> so this reads as a native sibling on
 * /demo/intake.
 */

const CONSENSUS_ROUTE = "/api/agents/source-consensus/tasks";

/** A one-click demo scenario. */
export type ConsensusPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: ConsensusRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the strict-majority demo — the block base. */
const VALID_DETERMINATION = evaluateConsensus(DEMO_CONSENSUS_REQUEST);

export const CONSENSUS_PRESETS: ConsensusPreset[] = [
  {
    id: "strict-majority",
    label: "4 of 5 feeds agree \u2192 consensus",
    hint: "One legacy feed disagrees on a provider's specialty.",
    request: DEMO_CONSENSUS_REQUEST,
    demonstrates:
      "Boyer\u2013Moore majority vote \u2014 the value the sources themselves corroborate wins."
  },
  {
    id: "no-majority",
    label: "2-2-1 split \u2192 no-consensus",
    hint: "No value carries a strict majority.",
    request: DEMO_CONSENSUS_NO_MAJORITY_REQUEST,
    demonstrates: "An honest no-consensus \u2014 the agent declines to pick a plurality winner."
  },
  {
    id: "unanimous",
    label: "All feeds agree \u2192 consensus",
    hint: "A unanimous single source of truth.",
    request: DEMO_CONSENSUS_UNANIMOUS_REQUEST,
    demonstrates: "Unanimity is the clean case \u2014 every source agrees."
  },
  {
    id: "phantom-source-block",
    label: "Fabricated source \u2192 governance block",
    hint: "An attribution for a feed that never voted.",
    request: DEMO_CONSENSUS_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      agreements: VALID_DETERMINATION.agreements.map((a, i) =>
        i === 4 ? { ...a, sourceId: "phantom-feed" } : a
      )
    },
    demonstrates:
      "The Agent Fabric blocking an attribution that traces to a source that never voted (policy.consensus.votes-sourced)."
  },
  {
    id: "wrong-winner-block",
    label: "Minority value as winner \u2192 governance block",
    hint: "Claims the losing value as the consensus.",
    request: DEMO_CONSENSUS_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      candidate: "Internal Medicine",
      candidateCount: 1
    },
    demonstrates:
      "The Agent Fabric blocking a winner that doesn't match the Boyer\u2013Moore recompute (policy.consensus.consensus-consistent)."
  },
  {
    id: "auto-written-block",
    label: "Golden record written autonomously \u2192 governance block",
    hint: "A reconciliation that wrote the value itself.",
    request: DEMO_CONSENSUS_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresStewardReview: false,
      autoWritten: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous golden-record write (policy.consensus.no-autonomous-write)."
  }
];

/** Render-ready view of a produced reconciliation lifted from the task. */
export type ConsensusResolvedView = {
  kind: "resolved";
  fieldRef: string;
  disposition: ConsensusDisposition;
  candidate: string | null;
  candidateCount: number;
  total: number;
  hasConsensus: boolean;
  agreements: SourceAgreement[];
  reason: string;
  note: string;
  consensusVotesSourced: boolean;
  consensusConsistent: boolean;
  consensusNoAutonomousWrite: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ConsensusBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ConsensusInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ConsensusView = ConsensusResolvedView | ConsensusBlockedView | ConsensusInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  consensusVotesSourced?: unknown;
  consensusConsistent?: unknown;
  consensusNoAutonomousWrite?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildConsensusRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ConsensusRequest;
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
 * POST a reconciliation request (or an asserted determination) to the agent and return the resulting A2A
 * task. `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as
 * HTTP 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runConsensusTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ConsensusRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CONSENSUS_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildConsensusRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * reconciliation (completed) from a governance block vs. an invalid request
 * (both `failed`, told apart by metadata.agentFabric.decision).
 */
export function consensusViewFromTask(task: A2ATask): ConsensusView {
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
        "The Agent Fabric blocked this reconciliation.";
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
      (typeof fabric.error === "string" ? fabric.error : "The reconciliation could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: ConsensusDetermination; fieldRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    fieldRef: result?.fieldRef ?? det?.fieldRef ?? "",
    disposition: det?.disposition ?? "no-consensus",
    candidate: det?.candidate ?? null,
    candidateCount: det?.candidateCount ?? 0,
    total: det?.total ?? 0,
    hasConsensus: det?.hasConsensus ?? false,
    agreements: det?.agreements ?? [],
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    consensusVotesSourced: fabric.consensusVotesSourced === true,
    consensusConsistent: fabric.consensusConsistent === true,
    consensusNoAutonomousWrite: fabric.consensusNoAutonomousWrite === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<ConsensusDisposition, string> = {
  consensus: "#8fd6b0",
  "no-consensus": "#ffd28a"
};

const DISPOSITION_LABEL: Record<ConsensusDisposition, string> = {
  consensus: "Consensus \u00b7 a strict majority via Boyer\u2013Moore",
  "no-consensus": "No consensus \u00b7 no value has a strict majority"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ConsensusView }
  | { status: "error"; message: string };

export function SourceConsensusPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ConsensusPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runConsensusTask({
          taskId: newTaskId("source-consensus"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: consensusViewFromTask(task) });
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
        Data substrate &middot; master data &middot; Boyer&ndash;Moore majority vote
      </p>
      <h3 style={{ margin: 0 }}>
        Source-of-Truth Consensus — votes sourced, consensus recomputed, never an autonomous write
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> reconciles a field whose value several{" "}
        <strong>source systems</strong> disagree on into a <strong>golden-record</strong> value &mdash; not a
        roster diff, not a record match &mdash; the <strong>Boyer&ndash;Moore majority vote</strong>. It picks
        the value the <strong>sources themselves corroborate</strong> (a strict majority) and{" "}
        <strong>honestly declines</strong> when none does. Every attribution is a{" "}
        <strong>real vote</strong>, the winner <strong>recomputes</strong>, and the write is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> writes the golden record &mdash; a
        data steward confirms.{" "}
        <strong>Not PHI-bearing &middot; illustrative, not a certified MDM system.</strong> Run a preset, then
        open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CONSENSUS_PRESETS.map((preset) => (
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
              ? "Reconciling\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Reconciliation failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ConsensusResult view={runState.view} />}
    </section>
  );
}

function ConsensusResult({ view }: { view: ConsensusView }) {
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
        Reconciliation (deterministic, synthetic)
        {view.fieldRef ? ` \u00b7 ${view.fieldRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>

      {view.hasConsensus ? (
        <p
          style={{
            margin: "0.4rem 0 0",
            fontSize: "0.9rem",
            fontWeight: 600,
            color: "var(--fg)"
          }}
        >
          {view.candidate}{" "}
          <span style={{ fontWeight: 400, color: "var(--muted)" }}>
            &middot; {view.candidateCount} of {view.total} sources
          </span>
        </p>
      ) : (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
          No value carries a strict majority across the {view.total} source vote(s) &mdash; left to a data
          steward to adjudicate.
        </p>
      )}

      {view.agreements.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.agreements.map((a) => (
            <li key={a.sourceId}>
              <code>{a.sourceId}</code>: {a.value}{" "}
              {a.agreesWithConsensus ? (
                <span style={{ color: "#8fd6b0" }}>&#10003; agrees</span>
              ) : (
                <span style={{ color: "#ffd28a" }}>&middot; differs</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Reconciliation safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; recomputed &middot; never an autonomous write{" "}
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
            synthetic &middot; not PHI
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
          consensusVotesSourced = {String(view.consensusVotesSourced)} &middot; consensusConsistent ={" "}
          {String(view.consensusConsistent)} &middot; consensusNoAutonomousWrite ={" "}
          {String(view.consensusNoAutonomousWrite)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
