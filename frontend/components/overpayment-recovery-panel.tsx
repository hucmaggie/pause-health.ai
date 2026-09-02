"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_RECOVERY_COB_REQUEST,
  DEMO_RECOVERY_PAST_WINDOW_REQUEST,
  DEMO_RECOVERY_REQUEST,
  type RecoveryClassification,
  type RecoveryDetermination,
  type RecoveryRequest
} from "../lib/overpayment-recovery";

/**
 * Claims Overpayment & Recovery runner for the intake demo.
 *
 * Fires the real, server-side A2A Claims Overpayment & Recovery agent at
 * /api/agents/overpayment-recovery/tasks — the plan-side payer & plan operations
 * service that decides whether a PAID claim was overpaid and, if so, whether the
 * overpayment is still recoverable. It deterministically computes the overpayment,
 * cites the governing recovery reason, derives the recovery deadline from the reason's
 * statutory lookback window, and classifies the claim as recoverable /
 * not-recoverable-within-window / no-overpayment. The panel surfaces the overpayment
 * amount, the classification, the cited reason, the recovery deadline, the
 * within-window + human-review flags, the honesty signals, the synthetic labels, and a
 * deep link into the parented Agent Fabric trace.
 *
 * A recoverable overpayment is a SAFE, honest RECOMMENDATION requiring human review —
 * never an autonomous clawback. The past-window, no-reason, and autonomous-clawback
 * presets assert offending DETERMINATIONS — so all three governance blocks are
 * demonstrable in the UI rather than hidden.
 *
 * The recovery reason catalog + lookback windows are ILLUSTRATIVE synthetics, NOT a
 * certified payment-integrity system (real overpayment recovery is governed by the ACA
 * §6402 60-day rule, CMS recovery rules, ERISA, and state insurance code). Structure,
 * styling tokens, and tone mirror <CoordinationOfBenefitsPanel> and
 * <RecordsRetentionPanel> so this reads as a native sibling on /demo/intake.
 */

const RECOVERY_ROUTE = "/api/agents/overpayment-recovery/tasks";

/** A one-click demo scenario. */
export type RecoveryPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The recovery request the agent evaluates (the common case). */
  request?: RecoveryRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const RECOVERY_PRESETS: RecoveryPreset[] = [
  {
    id: "duplicate-payment",
    label: "Duplicate payment, within window → recoverable",
    hint: "A claim paid twice, discovered within its 1-year lookback window.",
    request: DEMO_RECOVERY_REQUEST,
    demonstrates:
      "A duplicate payment within its statutory lookback window is RECOVERABLE — a recommendation requiring human review with member/provider notice (reason.recovery.duplicate-payment)."
  },
  {
    id: "cob-primary-elsewhere",
    label: "COB — another payer was primary → recoverable",
    hint: "A coordination-of-benefits determination establishes another payer was primary.",
    request: DEMO_RECOVERY_COB_REQUEST,
    demonstrates:
      "This plan overpaid as if primary when another payer was primary; within its 2-year lookback → RECOVERABLE (reason.recovery.cob-primary-elsewhere — pairs with the Coordination of Benefits agent)."
  },
  {
    id: "past-window",
    label: "Retro-termination, past window → not recoverable",
    hint: "A retroactive-termination overpayment discovered well past its 1-year lookback.",
    request: DEMO_RECOVERY_PAST_WINDOW_REQUEST,
    demonstrates:
      "An overpayment past its statutory lookback window is NOT recoverable — clawing back beyond the lookback is an unlawful recoupment (not-recoverable-within-window)."
  },
  {
    id: "past-window-block",
    label: "Recover past the window → governance block",
    hint: "A determination that asserts a clawback past the statutory lookback window.",
    request: DEMO_RECOVERY_PAST_WINDOW_REQUEST,
    determination: {
      claimId: "recovery-claim-003",
      recoveryReasonId: "reason.recovery.retroactive-termination",
      overpaymentAmount: 800,
      recoverable: "recoverable",
      withinLookbackWindow: false,
      requiresHumanReview: true
    },
    demonstrates:
      "The Agent Fabric blocking a clawback asserted past the statutory lookback window (policy.recovery.within-lookback-window)."
  },
  {
    id: "no-reason-block",
    label: "No cited recovery reason → governance block",
    hint: "An ad-hoc clawback that doesn't cite a recorded recovery reason.",
    request: DEMO_RECOVERY_REQUEST,
    determination: {
      claimId: "recovery-claim-001",
      recoveryReasonId: "reason.recovery.we-just-decided",
      overpaymentAmount: 600,
      recoverable: "recoverable",
      withinLookbackWindow: true,
      requiresHumanReview: true
    },
    demonstrates:
      "The Agent Fabric blocking an ad-hoc recovery that doesn't cite a recorded recovery reason (policy.recovery.reason-catalog-sourced)."
  },
  {
    id: "autonomous-clawback-block",
    label: "Autonomous clawback → governance block",
    hint: "A determination that would claw back autonomously, without human review.",
    request: DEMO_RECOVERY_REQUEST,
    determination: {
      claimId: "recovery-claim-001",
      recoveryReasonId: "reason.recovery.duplicate-payment",
      overpaymentAmount: 600,
      recoverable: "recoverable",
      withinLookbackWindow: true,
      requiresHumanReview: false
    },
    demonstrates:
      "The Agent Fabric blocking a determination that would autonomously claw back — a recovery is a recommendation requiring human review (policy.recovery.no-autonomous-clawback)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type RecoveryResolvedView = {
  kind: "resolved";
  claimId: string;
  overpaymentAmount: number;
  recoverable: RecoveryClassification;
  recoveryReasonId: string;
  recoveryReasonLabel: string;
  recoveryDeadline: string;
  lookbackDays: number;
  withinLookbackWindow: boolean;
  requiresHumanReview: boolean;
  reason: string;
  note: string;
  recoveryWithinLookback: boolean;
  recoveryReasonCited: boolean;
  recoveryClawbackHumanReviewed: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type RecoveryBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type RecoveryInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type RecoveryView =
  | RecoveryResolvedView
  | RecoveryBlockedView
  | RecoveryInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  recoveryWithinLookback?: unknown;
  recoveryReasonCited?: unknown;
  recoveryClawbackHumanReviewed?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildCobRequestBody.
 */
export function buildRecoveryRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: RecoveryRequest;
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
 * POST a recovery request (or an asserted determination) to the Claims Overpayment &
 * Recovery agent and return the resulting A2A task. `fetchImpl` is injectable so tests
 * can stub the network boundary. A governance block comes back as HTTP 200 with a
 * `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runRecoveryTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: RecoveryRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(RECOVERY_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRecoveryRequestBody(input))
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
export function recoveryViewFromTask(task: A2ATask): RecoveryView {
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
        "The Agent Fabric blocked this overpayment-recovery run.";
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
        : "The overpayment-recovery determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: RecoveryDetermination; claimId?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    claimId: result?.claimId ?? det?.claimId ?? "",
    overpaymentAmount: det?.overpaymentAmount ?? 0,
    recoverable: det?.recoverable ?? "no-overpayment",
    recoveryReasonId: det?.recoveryReasonId ?? "",
    recoveryReasonLabel: det?.recoveryReasonLabel ?? "",
    recoveryDeadline: det?.recoveryDeadline ?? "",
    lookbackDays: det?.lookbackDays ?? 0,
    withinLookbackWindow: det?.withinLookbackWindow ?? false,
    requiresHumanReview: det?.requiresHumanReview ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    recoveryWithinLookback: fabric.recoveryWithinLookback === true,
    recoveryReasonCited: fabric.recoveryReasonCited === true,
    recoveryClawbackHumanReviewed: fabric.recoveryClawbackHumanReviewed === true,
    traceTaskId
  };
}

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

const CLASSIFICATION_LABEL: Record<RecoveryClassification, string> = {
  recoverable: "Recoverable",
  "not-recoverable-within-window": "Not recoverable (past window)",
  "no-overpayment": "No overpayment"
};

const CLASSIFICATION_TONE: Record<RecoveryClassification, string> = {
  recoverable: "#8fd6b0",
  "not-recoverable-within-window": "#ffb6c8",
  "no-overpayment": "#9fb3c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: RecoveryView }
  | { status: "error"; message: string };

export function OverpaymentRecoveryPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: RecoveryPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runRecoveryTask({
          taskId: newTaskId("recovery"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: recoveryViewFromTask(task) });
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
        Claims overpayment &amp; recovery · payer &amp; plan operations
      </p>
      <h3 style={{ margin: 0 }}>
        Post-payment recovery — within-lookback, reason-sourced, never an autonomous
        clawback
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given a <strong>paid claim</strong>, the Claims Overpayment &amp; Recovery agent{" "}
        <strong>deterministically</strong> computes the{" "}
        <strong>overpayment</strong> (paid − correct), cites the governing{" "}
        <strong>recovery reason</strong>, derives the{" "}
        <strong>recovery deadline</strong> from the reason&rsquo;s statutory{" "}
        <strong>lookback window</strong>, and classifies the claim as recoverable /
        not-recoverable-within-window / no-overpayment. A claim{" "}
        <strong>past its lookback window is never recoverable</strong>. It{" "}
        <strong>never autonomously claws back</strong>: a recoverable overpayment is a{" "}
        <strong>recommendation requiring human review</strong> with member/provider
        notice.{" "}
        <strong>
          The recovery reason catalog and lookback windows are illustrative synthetics,
          not a certified payment-integrity system — real recovery is governed by the
          ACA §6402 60-day rule, CMS recovery rules, ERISA, and state insurance code.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {RECOVERY_PRESETS.map((preset) => (
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
              ? "Evaluating…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Overpayment-recovery run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <RecoveryResult view={runState.view} />}
    </section>
  );
}

function RecoveryResult({ view }: { view: RecoveryView }) {
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

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Overpayment recovery (deterministic, synthetic claim)
        {view.claimId ? ` · claim ${view.claimId}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="Overpayment"
          value={`$${view.overpaymentAmount}`}
          tone="#9fb3c8"
        />{" "}
        <Pill
          label="Status"
          value={CLASSIFICATION_LABEL[view.recoverable]}
          tone={CLASSIFICATION_TONE[view.recoverable]}
        />{" "}
        <Pill
          label="Within window"
          value={String(view.withinLookbackWindow)}
          tone={view.withinLookbackWindow ? "#8fd6b0" : "#ffb6c8"}
        />{" "}
        <Pill
          label="Requires human review"
          value={String(view.requiresHumanReview)}
          tone="#ffd28a"
        />
      </p>

      <p
        style={{
          margin: "0.7rem 0 0",
          fontSize: "0.86rem",
          color: "var(--muted)"
        }}
      >
        Reason:{" "}
        <strong style={{ color: "var(--fg)" }}>
          {view.recoveryReasonLabel || view.recoveryReasonId}
        </strong>{" "}
        (<code>{view.recoveryReasonId}</code>) · recovery deadline{" "}
        <code>{view.recoveryDeadline}</code> (lookback {view.lookbackDays}d)
      </p>

      <div
        role="note"
        aria-label="Overpayment-recovery integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Within-lookback · reason-sourced · no autonomous clawback{" "}
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
            synthetic
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
          recoveryWithinLookback = {String(view.recoveryWithinLookback)} ·
          recoveryReasonCited = {String(view.recoveryReasonCited)} ·
          recoveryClawbackHumanReviewed = {String(view.recoveryClawbackHumanReviewed)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
