"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type MlrAllocation,
  type MlrRebateDetermination,
  type MlrRebateRequest,
  DEMO_MLR_REBATE_MEETS_REQUEST,
  DEMO_MLR_REBATE_REQUEST,
  DEMO_MLR_REBATE_SMALL_GROUP_REQUEST
} from "../lib/mlr-rebate";

/**
 * Medical Loss Ratio (MLR) Rebate Calculation runner for the intake demo.
 *
 * Fires the real, server-side A2A MLR Rebate agent at /api/agents/mlr-rebate/tasks — a payer-operations
 * service that computes an ACA MLR and apportions any rebate owed across subscribers. The panel
 * surfaces the MLR, the standard, the total rebate, the per-subscriber apportionment, the honesty
 * signals, the synthetic / non-PHI labels, and a deep link into the parented Agent Fabric trace.
 *
 * A determination — a rebate owed OR the standard met — is a SAFE, honest OUTPUT (it completes; it
 * carries requiresTreasuryReview:true, autoDisbursed:false). The off-catalog-standard, inconsistent-
 * apportionment, and auto-disbursed presets assert offending DETERMINATIONS — so all three governance
 * blocks are demonstrable in the UI rather than hidden.
 *
 * NON-PHI — aggregate financials + a subscriber premium roster. The standards / formula are
 * ILLUSTRATIVE, NOT a certified MLR filing system. Structure, styling tokens, and tone mirror
 * <MemberCostSharePanel> so this reads as a native sibling on /demo/intake.
 */

const MLR_REBATE_ROUTE = "/api/agents/mlr-rebate/tasks";

/** A one-click demo scenario. */
export type MlrRebatePreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: MlrRebateRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const MLR_REBATE_PRESETS: MlrRebatePreset[] = [
  {
    id: "individual-rebate",
    label: "Individual 77.89% < 80% → $21,100 rebate",
    hint: "Below standard; apportioned across 3 subscribers.",
    request: DEMO_MLR_REBATE_REQUEST,
    demonstrates:
      "An individual-market plan below the 80% standard → a rebate apportioned penny-exactly."
  },
  {
    id: "large-group-meets",
    label: "Large-group 89.58% ≥ 85% → no rebate",
    hint: "Meets standard.",
    request: DEMO_MLR_REBATE_MEETS_REQUEST,
    demonstrates:
      "A large-group plan that meets the 85% standard → the standard is met, no rebate owed."
  },
  {
    id: "small-group-remainder",
    label: "Small-group $8,400 → largest-remainder split",
    hint: "Uneven premiums exercise the penny distribution.",
    request: DEMO_MLR_REBATE_SMALL_GROUP_REQUEST,
    demonstrates:
      "Uneven premiums → the leftover cent lands on the largest fractional remainder; the split still sums exactly."
  },
  {
    id: "off-catalog-standard-block",
    label: "Off-catalog market → governance block",
    hint: "A standard not in the catalog for the market.",
    request: DEMO_MLR_REBATE_REQUEST,
    determination: {
      requestRef: "mlr-001",
      market: "platinum-market",
      standard: 0.5,
      earnedPremium: 1_000_000,
      incurredClaims: 700_000,
      qualityImprovementExpense: 40_000,
      taxesAndFees: 50_000,
      mlr: 0.7789,
      totalRebate: 0,
      allocations: [],
      requiresTreasuryReview: true,
      autoDisbursed: false
    },
    demonstrates:
      "The Agent Fabric blocking an off-catalog market standard (policy.mlr.inputs-sourced)."
  },
  {
    id: "inconsistent-apportionment-block",
    label: "Pennies don't sum → governance block",
    hint: "Allocations that don't add up to the total.",
    request: DEMO_MLR_REBATE_REQUEST,
    determination: {
      requestRef: "mlr-001",
      market: "individual",
      standard: 0.8,
      earnedPremium: 1_000_000,
      incurredClaims: 700_000,
      qualityImprovementExpense: 40_000,
      taxesAndFees: 50_000,
      mlr: 0.7789,
      totalRebate: 21_100,
      // Wrong: the allocations sum to 21,000, not 21,100 — 100 dollars vanished.
      allocations: [
        { subscriberRef: "sub-A", premiumPaid: 400_000, rebate: 8_400 },
        { subscriberRef: "sub-B", premiumPaid: 350_000, rebate: 7_350 },
        { subscriberRef: "sub-C", premiumPaid: 250_000, rebate: 5_250 }
      ],
      requiresTreasuryReview: true,
      autoDisbursed: false
    },
    demonstrates:
      "The Agent Fabric blocking an apportionment that loses pennies (policy.mlr.allocation-consistent)."
  },
  {
    id: "auto-disbursed-block",
    label: "Rebate disbursed autonomously → governance block",
    hint: "A determination that paid the rebate itself.",
    request: DEMO_MLR_REBATE_REQUEST,
    determination: {
      requestRef: "mlr-001",
      market: "individual",
      standard: 0.8,
      earnedPremium: 1_000_000,
      incurredClaims: 700_000,
      qualityImprovementExpense: 40_000,
      taxesAndFees: 50_000,
      mlr: 0.7789,
      totalRebate: 21_100,
      allocations: [
        { subscriberRef: "sub-A", premiumPaid: 400_000, rebate: 8_440 },
        { subscriberRef: "sub-B", premiumPaid: 350_000, rebate: 7_385 },
        { subscriberRef: "sub-C", premiumPaid: 250_000, rebate: 5_275 }
      ],
      // Wrong: the agent disbursed and skipped treasury review.
      requiresTreasuryReview: false,
      autoDisbursed: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous disbursement (policy.mlr.no-autonomous-disbursement)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type MlrRebateResolvedView = {
  kind: "resolved";
  requestRef: string;
  planRef: string;
  market: string;
  standard: number;
  mlr: number;
  meetsStandard: boolean;
  totalRebate: number;
  allocations: MlrAllocation[];
  reason: string;
  note: string;
  mlrInputsSourced: boolean;
  mlrAllocationConsistent: boolean;
  mlrNoAutonomousDisbursement: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type MlrRebateBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type MlrRebateInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type MlrRebateView =
  | MlrRebateResolvedView
  | MlrRebateBlockedView
  | MlrRebateInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  mlrInputsSourced?: unknown;
  mlrAllocationConsistent?: unknown;
  mlrNoAutonomousDisbursement?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildMlrRebateRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: MlrRebateRequest;
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
 * POST a rebate request (or an asserted determination) to the MLR Rebate agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A governance
 * block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse error is a
 * non-OK response.
 */
export async function runMlrRebateTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: MlrRebateRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(MLR_REBATE_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildMlrRebateRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * determination (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function mlrRebateViewFromTask(task: A2ATask): MlrRebateView {
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
        "The Agent Fabric blocked this MLR-rebate run.";
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
      (typeof fabric.error === "string"
        ? fabric.error
        : "The MLR-rebate determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: MlrRebateDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    planRef: det?.planRef ?? "",
    market: det?.market ?? "",
    standard: det?.standard ?? 0,
    mlr: det?.mlr ?? 0,
    meetsStandard: det?.meetsStandard ?? false,
    totalRebate: det?.totalRebate ?? 0,
    allocations: det?.allocations ?? [],
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    mlrInputsSourced: fabric.mlrInputsSourced === true,
    mlrAllocationConsistent: fabric.mlrAllocationConsistent === true,
    mlrNoAutonomousDisbursement: fabric.mlrNoAutonomousDisbursement === true,
    traceTaskId
  };
}

const USD = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Pill({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.1rem 0.5rem",
        borderRadius: "999px",
        border: `1px solid ${tone}`,
        color: tone,
        fontSize: "0.74rem",
        fontWeight: 600
      }}
    >
      {label}: {value}
    </span>
  );
}

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: MlrRebateView }
  | { status: "error"; message: string };

export function MlrRebatePanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: MlrRebatePreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runMlrRebateTask({
          taskId: newTaskId("mlr-rebate"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: mlrRebateViewFromTask(task) });
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
        Medical loss ratio · ACA rebate · payer &amp; plan operations
      </p>
      <h3 style={{ margin: 0 }}>
        MLR Rebate — a sourced standard, an exact penny-split, never an autonomous disbursement
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> computes a plan&rsquo;s Medical Loss Ratio,
        decides whether it meets the ACA standard <strong>(80% individual / small-group, 85%
        large-group)</strong>, and — when it falls short — <strong>apportions</strong> the rebate owed
        across subscribers penny-exactly (largest-remainder method; the cents sum <em>exactly</em> to
        the total). No dollar waterfall, no identity match — a ratio-vs-threshold test + an exact
        apportionment. The rebate is a <strong>recommendation</strong>: the agent{" "}
        <strong>never</strong> disburses it — a treasury / compliance reviewer issues payment.{" "}
        <strong>Non-PHI · illustrative standards, not a certified MLR filing system.</strong> Run a
        preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {MLR_REBATE_PRESETS.map((preset) => (
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
              ? "Calculating…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          MLR-rebate run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <MlrRebateResult view={runState.view} />}
    </section>
  );
}

function MlrRebateResult({ view }: { view: MlrRebateView }) {
  const traceLink = (
    <p style={{ margin: "0.6rem 0 0", fontSize: "0.86rem" }}>
      <a
        href={`/demo/agent-fabric?taskId=${encodeURIComponent(view.traceTaskId)}`}
        className="agentforce-voice-help-link"
      >
        Open the multi-agent trace →
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
                <code>{v.policyId}</code> — {v.reason}
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

  const tone = view.meetsStandard ? "#8fd6b0" : "#ffd28a";
  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        MLR determination (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""}
        {view.market ? ` · ${view.market}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="MLR" value={`${(view.mlr * 100).toFixed(2)}%`} tone={tone} />{" "}
        <Pill label="Standard" value={`${(view.standard * 100).toFixed(0)}%`} tone="#9db8ff" />{" "}
        <Pill
          label={view.meetsStandard ? "Result" : "Rebate"}
          value={view.meetsStandard ? "met — no rebate" : USD(view.totalRebate)}
          tone={tone}
        />
      </p>

      {view.allocations.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.allocations.map((a) => (
            <li key={a.subscriberRef}>
              <strong>{a.subscriberRef}</strong> (premium {USD(a.premiumPaid)}) →{" "}
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {USD(a.rebate)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="MLR rebate safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Standard sourced · MLR + apportionment exact · never an autonomous disbursement{" "}
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
            synthetic · non-PHI
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
          mlrInputsSourced = {String(view.mlrInputsSourced)} · mlrAllocationConsistent ={" "}
          {String(view.mlrAllocationConsistent)} · mlrNoAutonomousDisbursement ={" "}
          {String(view.mlrNoAutonomousDisbursement)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
