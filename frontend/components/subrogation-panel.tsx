"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type RecoverableReduction,
  type SubrogationDetermination,
  type SubrogationRequest,
  DEMO_SUBROGATION_COMMONFUND_REQUEST,
  DEMO_SUBROGATION_MADEWHOLE_REQUEST,
  DEMO_SUBROGATION_NONE_REQUEST,
  DEMO_SUBROGATION_REQUEST
} from "../lib/subrogation";

/**
 * Subrogation / Third-Party Liability (TPL) runner for the intake demo.
 *
 * Fires the real, server-side A2A Subrogation agent at /api/agents/subrogation/tasks — the
 * payer-operations service that decides whether a plan has a subrogation interest in a liable third
 * party's settlement for injury claims it paid, computes a bounded recoverable amount, and routes for
 * specialist / counsel review. The panel surfaces eligibility, the plan-paid / settlement / bounded
 * recoverable amounts, the doctrine reductions, the disposition, the honesty signals, the synthetic
 * labels, and a deep link into the parented Agent Fabric trace.
 *
 * A determination — eligible OR not — is a SAFE, honest OUTPUT (it completes; an eligible case
 * carries requiresHumanReview:true). The off-catalog-basis, over-recoverable, and auto-asserted-lien
 * presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI
 * rather than hidden.
 *
 * The basis catalog + reductions are ILLUSTRATIVE, NOT a certified subrogation engine (real
 * subrogation is governed by the plan document, state subrogation / made-whole / common-fund law, and
 * workers-comp statutes). Structure, styling tokens, and tone mirror <TimelyFilingPanel> and
 * <BalanceBillingPanel> so this reads as a native sibling on /demo/intake.
 */

const SUBROGATION_ROUTE = "/api/agents/subrogation/tasks";

/** A one-click demo scenario. */
export type SubrogationPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The subrogation case the agent evaluates (the common case). */
  request?: SubrogationRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const SUBROGATION_PRESETS: SubrogationPreset[] = [
  {
    id: "auto-fully-recoverable",
    label: "Auto accident → fully recoverable",
    hint: "ERISA plan clause, settlement above what the plan paid.",
    request: DEMO_SUBROGATION_REQUEST,
    demonstrates:
      "An eligible auto-accident case where the plan recovers all $42,000 it paid; specialist / counsel review required before any lien."
  },
  {
    id: "common-fund",
    label: "Common-fund → recovery reduced by attorney fees",
    hint: "Premises liability, 33% common-fund attorney-fee reduction.",
    request: DEMO_SUBROGATION_COMMONFUND_REQUEST,
    demonstrates:
      "An eligible case where the common-fund doctrine reduces the $30,000 recoverable by a 33% attorney-fee share to $20,100."
  },
  {
    id: "made-whole-bar",
    label: "Made-whole doctrine → recovery barred",
    hint: "Settlement below the member's damages — member not yet made whole.",
    request: DEMO_SUBROGATION_MADEWHOLE_REQUEST,
    demonstrates:
      "An eligible case where the made-whole doctrine BARS recovery (recoverable $0); notify and hold, review required."
  },
  {
    id: "no-interest",
    label: "No injury / no third party → no interest",
    hint: "A non-injury claim with no liable third party.",
    request: DEMO_SUBROGATION_NONE_REQUEST,
    demonstrates:
      "No subrogation interest — nothing to recover, no review needed."
  },
  {
    id: "off-catalog-basis-block",
    label: "Off-catalog basis → governance block",
    hint: "A determination citing a made-up subrogation basis.",
    request: DEMO_SUBROGATION_REQUEST,
    determination: {
      caseRef: "subro-case-001",
      patientRef: "patient-subro-001",
      basisId: "basis.we-made-up",
      eligible: true,
      planPaidAmount: 42000,
      settlementAmount: 150000,
      recoverableAmount: 42000,
      disposition: "assert-lien-with-review",
      requiresHumanReview: true,
      autoAssertedLien: false
    },
    demonstrates:
      "The Agent Fabric blocking a recovery decision citing an off-catalog subrogation basis (policy.subrogation.basis-sourced)."
  },
  {
    id: "over-recoverable-block",
    label: "Recoverable > plan paid → governance block",
    hint: "A determination asserting more than the plan paid (profit).",
    request: DEMO_SUBROGATION_REQUEST,
    determination: {
      caseRef: "subro-case-001",
      patientRef: "patient-subro-001",
      basisId: "basis.erisa-plan-reimbursement",
      eligible: true,
      planPaidAmount: 42000,
      settlementAmount: 150000,
      // Wrong: asserting $60,000 when the plan only paid $42,000.
      recoverableAmount: 60000,
      disposition: "assert-lien-with-review",
      requiresHumanReview: true,
      autoAssertedLien: false
    },
    demonstrates:
      "The Agent Fabric blocking a recoverable that exceeds what the plan paid — reimbursement, not profit (policy.subrogation.recoverable-within-paid)."
  },
  {
    id: "auto-lien-block",
    label: "Auto-asserted lien → governance block",
    hint: "A determination that autonomously asserts a lien.",
    request: DEMO_SUBROGATION_REQUEST,
    determination: {
      caseRef: "subro-case-001",
      patientRef: "patient-subro-001",
      basisId: "basis.erisa-plan-reimbursement",
      eligible: true,
      planPaidAmount: 42000,
      settlementAmount: 150000,
      recoverableAmount: 42000,
      disposition: "assert-lien-with-review",
      requiresHumanReview: false,
      autoAssertedLien: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-asserted / unreviewed lien (policy.subrogation.no-autonomous-lien)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type SubrogationResolvedView = {
  kind: "resolved";
  caseRef: string;
  patientRef: string;
  basisId: string;
  eligible: boolean;
  accidentType: string;
  planPaidAmount: number;
  settlementAmount: number | null;
  recoverableAmount: number;
  reductions: RecoverableReduction[];
  disposition: string;
  requiresHumanReview: boolean;
  reason: string;
  note: string;
  subrogationBasisSourced: boolean;
  subrogationRecoverableWithinPaid: boolean;
  subrogationNoAutonomousLien: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type SubrogationBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type SubrogationInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type SubrogationView =
  | SubrogationResolvedView
  | SubrogationBlockedView
  | SubrogationInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  subrogationBasisSourced?: unknown;
  subrogationRecoverableWithinPaid?: unknown;
  subrogationNoAutonomousLien?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildTimelyFilingRequestBody.
 */
export function buildSubrogationRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: SubrogationRequest;
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
 * POST a subrogation case (or an asserted determination) to the Subrogation agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A governance
 * block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse error is a
 * non-OK response.
 */
export async function runSubrogationTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: SubrogationRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(SUBROGATION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSubrogationRequestBody(input))
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
export function subrogationViewFromTask(task: A2ATask): SubrogationView {
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
        "The Agent Fabric blocked this subrogation run.";
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
        : "The subrogation determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: SubrogationDetermination; caseRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    caseRef: result?.caseRef ?? det?.caseRef ?? "",
    patientRef: det?.patientRef ?? "",
    basisId: det?.basisId ?? "",
    eligible: det?.eligible ?? false,
    accidentType: det?.accidentType ?? "none",
    planPaidAmount: det?.planPaidAmount ?? 0,
    settlementAmount: det?.settlementAmount ?? null,
    recoverableAmount: det?.recoverableAmount ?? 0,
    reductions: det?.reductions ?? [],
    disposition: det?.disposition ?? "",
    requiresHumanReview: det?.requiresHumanReview ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    subrogationBasisSourced: fabric.subrogationBasisSourced === true,
    subrogationRecoverableWithinPaid: fabric.subrogationRecoverableWithinPaid === true,
    subrogationNoAutonomousLien: fabric.subrogationNoAutonomousLien === true,
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

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: SubrogationView }
  | { status: "error"; message: string };

export function SubrogationPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: SubrogationPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runSubrogationTask({
          taskId: newTaskId("subrogation"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: subrogationViewFromTask(task) });
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
        Subrogation · third-party liability · payer operations
      </p>
      <h3 style={{ margin: 0 }}>
        Subrogation / TPL — a bounded recoverable, never an autonomous lien
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        When a plan pays claims for an injury caused by a <strong>liable third party</strong>, it
        generally has a <strong>subrogation right</strong> to recover its payments out of the
        settlement. Given the case (injury-related, accident type, a liable third party, what the
        plan <strong>paid</strong>, the cited <strong>basis</strong>, the settlement, and the
        made-whole / common-fund doctrines), this agent <strong>deterministically</strong> decides
        eligibility, computes a <strong>bounded recoverable</strong> (never more than the plan paid,
        never more than the settlement, reduced by the doctrines), and decides the disposition. It{" "}
        <strong>never</strong> autonomously asserts a lien — an eligible case is a{" "}
        <strong>recommendation requiring specialist / counsel review</strong>.{" "}
        <strong>The basis catalog and reductions are illustrative, not a certified subrogation
        engine.</strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {SUBROGATION_PRESETS.map((preset) => (
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
              ? "Assessing…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Subrogation run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <SubrogationResult view={runState.view} />}
    </section>
  );
}

function money(n: number | null): string {
  if (n === null) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SubrogationResult({ view }: { view: SubrogationView }) {
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
        Subrogation determination (deterministic, synthetic)
        {view.caseRef ? ` · ${view.caseRef}` : ""} · {view.accidentType}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="Eligible"
          value={String(view.eligible)}
          tone={view.eligible ? "#8fd6b0" : "#9db8ff"}
        />{" "}
        <Pill label="Plan paid" value={money(view.planPaidAmount)} tone="#9db8ff" />{" "}
        <Pill label="Settlement" value={money(view.settlementAmount)} tone="#9db8ff" />{" "}
        <Pill label="Recoverable" value={money(view.recoverableAmount)} tone="#8fd6b0" />{" "}
        <Pill
          label="Review"
          value={String(view.requiresHumanReview)}
          tone={view.requiresHumanReview ? "#ffd28a" : "#8fd6b0"}
        />
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.9rem" }}>
        Disposition: <strong>{view.disposition}</strong> · basis <code>{view.basisId}</code>
      </p>

      {view.reductions.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.reductions.map((r) => (
            <li key={r.label}>
              {r.label}: −{money(r.amount)}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Subrogation compliance"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Basis sourced · recoverable ≤ plan paid & settlement · never an autonomous lien{" "}
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
          subrogationBasisSourced = {String(view.subrogationBasisSourced)} ·
          subrogationRecoverableWithinPaid = {String(view.subrogationRecoverableWithinPaid)} ·
          subrogationNoAutonomousLien = {String(view.subrogationNoAutonomousLien)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
