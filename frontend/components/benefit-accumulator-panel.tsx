"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type BenefitAccumulatorDetermination,
  type BenefitAccumulatorDisposition,
  type BenefitAccumulatorRequest,
  DEMO_BENEFIT_ACCUMULATOR_IMMEDIATE_REQUEST,
  DEMO_BENEFIT_ACCUMULATOR_REQUEST,
  DEMO_BENEFIT_ACCUMULATOR_UNDER_REQUEST,
  evaluateBenefitAccumulator
} from "../lib/benefit-accumulator";

/**
 * Benefit Accumulator Ledger / Fenwick-Tree Prefix Sums runner for the intake demo.
 *
 * Fires the real, server-side A2A Benefit Accumulator agent at /api/agents/benefit-accumulator/tasks — a
 * payer-operations accumulator-ledger service that tallies a running benefit accumulator and locates the
 * OOP-max crossover claim via a Fenwick tree. The panel surfaces the disposition, the running totals, the
 * crossover claim, the remaining-before-OOP-max, the honesty signals, the synthetic / PHI-adjacent labels, and a
 * deep link into the parented Agent Fabric trace.
 *
 * A ledger — under-oop-max or oop-max-met — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresAnalystReview:true, autoAdjusted:false). An oop-max-met disposition is a LEGITIMATE FINDING, NOT a
 * governance block. The fabricated-total, mislocated-crossover, and auto-adjusted presets assert offending
 * DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-adjacent — a member's claims. The amounts are an ILLUSTRATIVE synthetic, NOT a certified accumulator
 * system. Structure, styling tokens, and tone mirror <AuditSamplePanel> so this reads as a native sibling on
 * /demo/intake.
 */

const BENEFIT_ACCUMULATOR_ROUTE = "/api/agents/benefit-accumulator/tasks";

/** A one-click demo scenario. */
export type BenefitAccumulatorPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: BenefitAccumulatorRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST);

export const BENEFIT_ACCUMULATOR_PRESETS: BenefitAccumulatorPreset[] = [
  {
    id: "oop-max-met",
    label: "Member ledger — OOP max met",
    hint: "Six claims against a $3,000 OOP max.",
    request: DEMO_BENEFIT_ACCUMULATOR_REQUEST,
    demonstrates: "Fenwick prefix sums — the running total crosses $3,000 at the fifth claim."
  },
  {
    id: "under-oop-max",
    label: "Member ledger — under the OOP max",
    hint: "Claims stay below the OOP maximum.",
    request: DEMO_BENEFIT_ACCUMULATOR_UNDER_REQUEST,
    demonstrates: "Under-oop-max — total applied stays below the max; a remaining balance is reported."
  },
  {
    id: "immediate",
    label: "One large claim — immediate crossover",
    hint: "The first claim alone meets the OOP max.",
    request: DEMO_BENEFIT_ACCUMULATOR_IMMEDIATE_REQUEST,
    demonstrates: "Crossover at claim 1 — the plan pays 100% from there."
  },
  {
    id: "fabricated-total-block",
    label: "Fabricated total → governance block",
    hint: "A running total that isn't the true prefix sum.",
    request: DEMO_BENEFIT_ACCUMULATOR_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      runningTotals: VALID_DETERMINATION.runningTotals.map((t, i) => (i === 2 ? t + 100 : t))
    },
    demonstrates:
      "The Agent Fabric blocking a running total that isn't the true prefix sum (policy.benefitacc.ledger-sourced)."
  },
  {
    id: "mislocated-crossover-block",
    label: "Mislocated crossover → governance block",
    hint: "A valid index, but not where the OOP max is met.",
    request: DEMO_BENEFIT_ACCUMULATOR_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      crossoverIndex: 3
    },
    demonstrates:
      "The Agent Fabric blocking a crossover the Fenwick descent disagrees with (policy.benefitacc.accumulator-exact)."
  },
  {
    id: "auto-adjusted-block",
    label: "Adjusted autonomously → governance block",
    hint: "A ledger that posted to the real accumulator.",
    request: DEMO_BENEFIT_ACCUMULATOR_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresAnalystReview: false,
      autoAdjusted: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous adjustment (policy.benefitacc.no-autonomous-adjust)."
  }
];

/** Render-ready view of a produced ledger lifted from the task. */
export type BenefitAccumulatorResolvedView = {
  kind: "resolved";
  ledgerRef: string;
  disposition: BenefitAccumulatorDisposition;
  runningTotals: number[];
  totalApplied: number;
  oopMax: number;
  crossoverIndex: number;
  remainingBeforeOopMax: number;
  reason: string;
  note: string;
  benefitLedgerSourced: boolean;
  benefitAccumulatorExact: boolean;
  benefitNoAutonomousAdjust: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type BenefitAccumulatorBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type BenefitAccumulatorInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type BenefitAccumulatorView =
  | BenefitAccumulatorResolvedView
  | BenefitAccumulatorBlockedView
  | BenefitAccumulatorInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  benefitLedgerSourced?: unknown;
  benefitAccumulatorExact?: unknown;
  benefitNoAutonomousAdjust?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildBenefitAccumulatorRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: BenefitAccumulatorRequest;
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
export async function runBenefitAccumulatorTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: BenefitAccumulatorRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(BENEFIT_ACCUMULATOR_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBenefitAccumulatorRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced ledger
 * (completed) from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function benefitAccumulatorViewFromTask(task: A2ATask): BenefitAccumulatorView {
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
        "The Agent Fabric blocked this ledger.";
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
      (typeof fabric.error === "string" ? fabric.error : "The ledger could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: BenefitAccumulatorDetermination; ledgerRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    ledgerRef: result?.ledgerRef ?? det?.ledgerRef ?? "",
    disposition: det?.disposition ?? "under-oop-max",
    runningTotals: det?.runningTotals ?? [],
    totalApplied: det?.totalApplied ?? 0,
    oopMax: det?.oopMax ?? 0,
    crossoverIndex: det?.crossoverIndex ?? -1,
    remainingBeforeOopMax: det?.remainingBeforeOopMax ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    benefitLedgerSourced: fabric.benefitLedgerSourced === true,
    benefitAccumulatorExact: fabric.benefitAccumulatorExact === true,
    benefitNoAutonomousAdjust: fabric.benefitNoAutonomousAdjust === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<BenefitAccumulatorDisposition, string> = {
  "under-oop-max": "#8fd6b0",
  "oop-max-met": "#ffd28a"
};

const DISPOSITION_LABEL: Record<BenefitAccumulatorDisposition, string> = {
  "under-oop-max": "Under OOP max · the member has not reached their out-of-pocket maximum",
  "oop-max-met": "OOP max met · the plan pays 100% after the crossover claim"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: BenefitAccumulatorView }
  | { status: "error"; message: string };

export function BenefitAccumulatorPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: BenefitAccumulatorPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runBenefitAccumulatorTask({
          taskId: newTaskId("benefit-accumulator"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: benefitAccumulatorViewFromTask(task) });
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
        Payer operations &middot; benefit accumulator &middot; Fenwick prefix sums
      </p>
      <h3 style={{ margin: 0 }}>
        Benefit Accumulator Ledger — ledger sourced &amp; self-consistent, accumulator re-derived by the Fenwick
        tree, never an autonomous adjustment
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> tallies a member&rsquo;s{" "}
        <strong>running benefit accumulator</strong> as claims post and finds the{" "}
        <strong>crossover claim</strong> &mdash; the first at which they meet the{" "}
        <strong>out-of-pocket maximum</strong> &mdash; via <strong>Fenwick-tree prefix sums</strong>. The running
        totals are real <strong>prefix sums</strong>, the crossover is <strong>re-derived by the tree</strong>,
        and it is a <strong>recommendation</strong>: the agent <strong>never</strong> posts or adjusts the
        member&rsquo;s real accumulator &mdash; a benefits analyst confirms.{" "}
        <strong>PHI-adjacent &middot; illustrative, not a certified accumulator system.</strong> Run a preset,
        then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {BENEFIT_ACCUMULATOR_PRESETS.map((preset) => (
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
              ? "Tallying…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Ledger failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <BenefitAccumulatorResult view={runState.view} />}
    </section>
  );
}

function BenefitAccumulatorResult({ view }: { view: BenefitAccumulatorView }) {
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
        Benefit accumulator (deterministic, synthetic)
        {view.ledgerRef ? ` · ${view.ledgerRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        total applied {view.totalApplied} of OOP max {view.oopMax}
        {view.crossoverIndex >= 0
          ? ` · crossover at claim ${view.crossoverIndex + 1}`
          : ` · ${view.remainingBeforeOopMax} remaining`}
      </p>

      {view.runningTotals.length > 0 && (
        <ol
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.3rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.runningTotals.map((t, i) => (
            <li key={i}>
              cumulative{" "}
              <code style={{ color: i === view.crossoverIndex ? tone : "inherit" }}>{t}</code>
              {i === view.crossoverIndex ? " ← OOP max met" : ""}
            </li>
          ))}
        </ol>
      )}

      <div
        role="note"
        aria-label="Benefit accumulator safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; accumulator-exact &middot; never an autonomous adjustment{" "}
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
          benefitLedgerSourced = {String(view.benefitLedgerSourced)} &middot; benefitAccumulatorExact ={" "}
          {String(view.benefitAccumulatorExact)} &middot; benefitNoAutonomousAdjust ={" "}
          {String(view.benefitNoAutonomousAdjust)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
