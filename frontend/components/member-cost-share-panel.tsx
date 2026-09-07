"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type CostShareDetermination,
  type CostShareRequest,
  DEMO_COST_SHARE_DEDUCTIBLE_REQUEST,
  DEMO_COST_SHARE_OOP_REQUEST,
  DEMO_COST_SHARE_REQUEST
} from "../lib/member-cost-share";

/**
 * Member Cost-Share / EOB Calculation runner for the intake demo.
 *
 * Fires the real, server-side A2A Member Cost-Share agent at /api/agents/member-cost-share/tasks — a
 * claims / payer-operations service that splits an adjudicated claim's allowed amount into the
 * member's cost-share and the plan-paid portion via the deductible → coinsurance → OOP-max waterfall.
 * The panel surfaces the split (deductible / coinsurance / OOP-cap / member / plan), the honesty
 * signals, the synthetic labels, and a deep link into the parented Agent Fabric trace.
 *
 * A determination — whatever the member's share works out to — is a SAFE, honest OUTPUT (it
 * completes; it carries requiresAdjudicationReview:true, autoPostedCharge:false). The off-catalog-plan,
 * bad-math, and posted-charge presets assert offending DETERMINATIONS — so all three governance
 * blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-bearing — the claim references the patient's care. The plan catalog + waterfall are
 * ILLUSTRATIVE, NOT a certified claims system. Structure, styling tokens, and tone mirror
 * <SubrogationPanel> and <DealDeskPanel> so this reads as a native sibling on /demo/intake.
 */

const MEMBER_COST_SHARE_ROUTE = "/api/agents/member-cost-share/tasks";

/** A one-click demo scenario. */
export type MemberCostSharePreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: CostShareRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const MEMBER_COST_SHARE_PRESETS: MemberCostSharePreset[] = [
  {
    id: "deductible-plus-coinsurance",
    label: "Partway through deductible → mixed split",
    hint: "Deductible + coinsurance on a Silver PPO.",
    request: DEMO_COST_SHARE_REQUEST,
    demonstrates:
      "A member partway through the deductible: $500 deductible + $700 coinsurance = $1,200 member, $2,800 plan."
  },
  {
    id: "oop-cap",
    label: "Near the OOP max → member capped",
    hint: "The out-of-pocket maximum caps the member's share.",
    request: DEMO_COST_SHARE_OOP_REQUEST,
    demonstrates:
      "A member near the OOP max: $1,000 coinsurance capped to $500, plan absorbs the rest."
  },
  {
    id: "full-deductible",
    label: "No deductible met → member pays allowed",
    hint: "The whole allowed lands on the member (under OOP max).",
    request: DEMO_COST_SHARE_DEDUCTIBLE_REQUEST,
    demonstrates:
      "A member with no deductible met on a Bronze HDHP: the $800 allowed is all deductible, plan pays $0."
  },
  {
    id: "off-catalog-plan-block",
    label: "Off-catalog plan → governance block",
    hint: "A determination computed from a made-up plan.",
    request: DEMO_COST_SHARE_REQUEST,
    determination: {
      claimRef: "claim-4471",
      memberRef: "member-8842",
      planId: "plan.we-made-up",
      planName: "unknown plan",
      allowedAmount: 4000,
      deductibleApplied: 500,
      coinsuranceApplied: 700,
      oopCapReduction: 0,
      memberResponsibility: 1200,
      planPaid: 2800,
      coinsuranceRate: 0.2,
      deductibleRemainingAfter: 0,
      oopRemainingAfter: 3800,
      requiresAdjudicationReview: true,
      autoPostedCharge: false
    },
    demonstrates:
      "The Agent Fabric blocking a cost-share computed from an off-catalog plan (policy.costshare.benefit-design-sourced)."
  },
  {
    id: "bad-math-block",
    label: "Split doesn't add up → governance block",
    hint: "A determination where member + plan ≠ allowed.",
    request: DEMO_COST_SHARE_REQUEST,
    determination: {
      claimRef: "claim-4471",
      memberRef: "member-8842",
      planId: "plan.silver-ppo",
      planName: "Silver PPO (individual)",
      allowedAmount: 4000,
      deductibleApplied: 500,
      coinsuranceApplied: 700,
      oopCapReduction: 0,
      // Wrong: member + plan = 1,200 + 2,000 = 3,200 ≠ 4,000.
      memberResponsibility: 1200,
      planPaid: 2000,
      coinsuranceRate: 0.2,
      deductibleRemainingAfter: 0,
      oopRemainingAfter: 3800,
      requiresAdjudicationReview: true,
      autoPostedCharge: false
    },
    demonstrates:
      "The Agent Fabric blocking a split where member + plan ≠ allowed (policy.costshare.math-consistent)."
  },
  {
    id: "posted-charge-block",
    label: "Charge posted to member → governance block",
    hint: "A determination that posted a member charge.",
    request: DEMO_COST_SHARE_REQUEST,
    determination: {
      claimRef: "claim-4471",
      memberRef: "member-8842",
      planId: "plan.silver-ppo",
      planName: "Silver PPO (individual)",
      allowedAmount: 4000,
      deductibleApplied: 500,
      coinsuranceApplied: 700,
      oopCapReduction: 0,
      memberResponsibility: 1200,
      planPaid: 2800,
      coinsuranceRate: 0.2,
      deductibleRemainingAfter: 0,
      oopRemainingAfter: 3800,
      // Wrong: the agent posted a charge to the member and skipped adjudication review.
      requiresAdjudicationReview: false,
      autoPostedCharge: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-posted member charge (policy.costshare.no-autonomous-member-charge)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type MemberCostShareResolvedView = {
  kind: "resolved";
  claimRef: string;
  memberRef: string;
  planName: string;
  allowedAmount: number;
  deductibleApplied: number;
  coinsuranceApplied: number;
  oopCapReduction: number;
  memberResponsibility: number;
  planPaid: number;
  reason: string;
  note: string;
  costShareBenefitSourced: boolean;
  costShareMathConsistent: boolean;
  costShareNoAutonomousCharge: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type MemberCostShareBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type MemberCostShareInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type MemberCostShareView =
  | MemberCostShareResolvedView
  | MemberCostShareBlockedView
  | MemberCostShareInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  costShareBenefitSourced?: unknown;
  costShareMathConsistent?: unknown;
  costShareNoAutonomousCharge?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildMemberCostShareRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: CostShareRequest;
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
 * POST a cost-share request (or an asserted determination) to the Member Cost-Share agent and return
 * the resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A
 * governance block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse
 * error is a non-OK response.
 */
export async function runMemberCostShareTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: CostShareRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(MEMBER_COST_SHARE_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildMemberCostShareRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced determination
 * (completed) from a governance block vs. an invalid request (both `failed`, told
 * apart by metadata.agentFabric.decision).
 */
export function memberCostShareViewFromTask(task: A2ATask): MemberCostShareView {
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
        "The Agent Fabric blocked this member cost-share run.";
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
        : "The cost-share determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: CostShareDetermination; claimRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    claimRef: result?.claimRef ?? det?.claimRef ?? "",
    memberRef: det?.memberRef ?? "",
    planName: det?.planName ?? "",
    allowedAmount: det?.allowedAmount ?? 0,
    deductibleApplied: det?.deductibleApplied ?? 0,
    coinsuranceApplied: det?.coinsuranceApplied ?? 0,
    oopCapReduction: det?.oopCapReduction ?? 0,
    memberResponsibility: det?.memberResponsibility ?? 0,
    planPaid: det?.planPaid ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    costShareBenefitSourced: fabric.costShareBenefitSourced === true,
    costShareMathConsistent: fabric.costShareMathConsistent === true,
    costShareNoAutonomousCharge: fabric.costShareNoAutonomousCharge === true,
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
  | { status: "done"; view: MemberCostShareView }
  | { status: "error"; message: string };

export function MemberCostSharePanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: MemberCostSharePreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runMemberCostShareTask({
          taskId: newTaskId("member-cost-share"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: memberCostShareViewFromTask(task) });
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
        Member cost-share · EOB calculation · payer & plan operations
      </p>
      <h3 style={{ margin: 0 }}>
        Member Cost-Share — a bounded split, never an autonomous member charge
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given an <strong>adjudicated claim</strong> (the allowed amount, the member&rsquo;s plan, and
        the member&rsquo;s current accumulators), this agent <strong>deterministically</strong> runs
        the <strong>deductible → coinsurance → out-of-pocket-max waterfall</strong> and splits the
        allowed amount into <strong>member</strong> vs. <strong>plan</strong> responsibility. The
        member + plan always equals the allowed, the member is capped at the remaining OOP max, and
        the EOB cost-share is an <strong>estimate</strong> the claims system finalizes — it{" "}
        <strong>never</strong> posts a charge to the member.{" "}
        <strong>The plan catalog and waterfall are illustrative, not a certified claims system.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {MEMBER_COST_SHARE_PRESETS.map((preset) => (
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
              ? "Computing…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Member cost-share run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <MemberCostShareResult view={runState.view} />}
    </section>
  );
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function MemberCostShareResult({ view }: { view: MemberCostShareView }) {
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
        Cost-share determination (deterministic, synthetic)
        {view.claimRef ? ` · ${view.claimRef}` : ""} · {view.planName}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Allowed" value={money(view.allowedAmount)} tone="#9db8ff" />{" "}
        <Pill label="Member" value={money(view.memberResponsibility)} tone="#ffd28a" />{" "}
        <Pill label="Plan" value={money(view.planPaid)} tone="#8fd6b0" />
      </p>

      <ul
        style={{
          margin: "0.6rem 0 0",
          paddingLeft: "1.1rem",
          color: "var(--muted)",
          fontSize: "0.84rem"
        }}
      >
        <li>Deductible applied: {money(view.deductibleApplied)}</li>
        <li>Coinsurance: {money(view.coinsuranceApplied)}</li>
        {view.oopCapReduction > 0 && (
          <li style={{ color: "#8fd6b0", fontWeight: 600 }}>
            OOP-max cap reduction: {money(view.oopCapReduction)}
          </li>
        )}
      </ul>

      <div
        role="note"
        aria-label="Cost-share compliance"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Benefit sourced · split adds up · never an autonomous member charge{" "}
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
            synthetic · PHI-bearing
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
          costShareBenefitSourced = {String(view.costShareBenefitSourced)} · costShareMathConsistent ={" "}
          {String(view.costShareMathConsistent)} · costShareNoAutonomousCharge ={" "}
          {String(view.costShareNoAutonomousCharge)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
