"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_BALANCE_BILLING_ANCILLARY_REQUEST,
  DEMO_BALANCE_BILLING_GROUND_AMBULANCE_REQUEST,
  DEMO_BALANCE_BILLING_REQUEST,
  DEMO_BALANCE_BILLING_WAIVER_REQUEST,
  type BalanceBillingDetermination,
  type BalanceBillingRequest,
  type CostShareBasis
} from "../lib/balance-billing";

/**
 * Balance Billing Protection (No Surprises Act) runner for the intake demo.
 *
 * Fires the real, server-side A2A Balance Billing Protection agent at
 * /api/agents/balance-billing/tasks — the payer-side service that decides whether the NSA
 * prohibits balance-billing an out-of-network claim, and on what basis a protected
 * patient's cost-share is computed. It deterministically resolves the protection basis,
 * applies any effective waiver, decides protection, computes the cost-share basis, and
 * computes the balance-bill amount. The panel surfaces the protection decision, the
 * cost-share basis + amount, the balance-bill amount, the honesty signals, the synthetic
 * labels, and a deep link into the parented Agent Fabric trace.
 *
 * A determination — protected or not — is a SAFE, honest OUTPUT (it completes; a permitted
 * balance bill on a non-protected claim carries requiresHumanReview:true). The no-basis,
 * oon-cost-share, and balance-bill-protected presets assert offending DETERMINATIONS — so
 * all three governance blocks are demonstrable in the UI rather than hidden.
 *
 * The protection bases + QPA amounts are ILLUSTRATIVE synthetics, NOT a certified No
 * Surprises Act engine (a real determination uses the actual QPA + the federal IDR process
 * under 45 CFR 149). Structure, styling tokens, and tone mirror <GoodFaithEstimatePanel>
 * and <OverpaymentRecoveryPanel> so this reads as a native sibling on /demo/intake.
 */

const BALANCE_BILLING_ROUTE = "/api/agents/balance-billing/tasks";

/** A one-click demo scenario. */
export type BalanceBillingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The claim the agent evaluates (the common case). */
  request?: BalanceBillingRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const BALANCE_BILLING_PRESETS: BalanceBillingPreset[] = [
  {
    id: "emergency-protected",
    label: "OON emergency → protected, no balance bill",
    hint: "An out-of-network emergency, $5,000 billed / $1,200 in-network.",
    request: DEMO_BALANCE_BILLING_REQUEST,
    demonstrates:
      "An emergency service is protected → balance billing prohibited; cost-share on the in-network (QPA) basis ($1,200), the $3,800 difference cannot be billed."
  },
  {
    id: "ancillary-protected",
    label: "OON anesthesiology (ancillary) → protected",
    hint: "An OON anesthesiologist at an in-network facility, even with a waiver.",
    request: DEMO_BALANCE_BILLING_ANCILLARY_REQUEST,
    demonstrates:
      "An ancillary service (anesthesiology) at an in-network facility cannot be waived → protected, balance billing prohibited."
  },
  {
    id: "waiver-permitted",
    label: "OON elective surgery + waiver → permitted",
    hint: "An OON elective surgeon at an in-network facility with a valid waiver.",
    request: DEMO_BALANCE_BILLING_WAIVER_REQUEST,
    demonstrates:
      "A valid notice-and-consent waiver for a non-ancillary service → not protected; a $1,200 balance bill is permitted and requires human review."
  },
  {
    id: "ground-ambulance",
    label: "OON ground ambulance → not protected",
    hint: "An out-of-network ground ambulance, $1,800 billed / $700 in-network.",
    request: DEMO_BALANCE_BILLING_GROUND_AMBULANCE_REQUEST,
    demonstrates:
      "Ground ambulance is a known NSA gap → not protected; a $1,100 balance bill is permitted and requires human review."
  },
  {
    id: "no-basis-block",
    label: "No cited protection basis → governance block",
    hint: "An ad-hoc protection call that doesn't cite a recorded basis.",
    request: DEMO_BALANCE_BILLING_REQUEST,
    determination: {
      claimRef: "bb-claim-001",
      patientRef: "bb-patient-001",
      basisId: "basis.we-just-decided",
      protected: true,
      costShareBasis: "in-network-qpa",
      balanceBillAllowed: false
    },
    demonstrates:
      "The Agent Fabric blocking an ad-hoc protection call that doesn't cite a recorded protection basis (policy.balancebill.protection-basis-sourced)."
  },
  {
    id: "oon-cost-share-block",
    label: "Protected on billed-charge basis → governance block",
    hint: "A protected claim whose cost-share is based on the OON billed charge.",
    request: DEMO_BALANCE_BILLING_REQUEST,
    determination: {
      claimRef: "bb-claim-001",
      patientRef: "bb-patient-001",
      basisId: "basis.emergency",
      protected: true,
      costShareBasis: "billed-charge",
      balanceBillAllowed: false
    },
    demonstrates:
      "The Agent Fabric blocking a protected patient's cost-share based on the out-of-network billed charge instead of the in-network QPA (policy.balancebill.cost-share-in-network-basis)."
  },
  {
    id: "balance-bill-protected-block",
    label: "Balance bill on a protected claim → governance block",
    hint: "A determination that allows a balance bill on a protected claim.",
    request: DEMO_BALANCE_BILLING_REQUEST,
    determination: {
      claimRef: "bb-claim-001",
      patientRef: "bb-patient-001",
      basisId: "basis.emergency",
      protected: true,
      costShareBasis: "in-network-qpa",
      balanceBillAllowed: true
    },
    demonstrates:
      "The Agent Fabric blocking a balance bill allowed on a protected claim — a protected claim is never balance-billed (policy.balancebill.no-autonomous-balance-bill)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type BalanceBillingResolvedView = {
  kind: "resolved";
  claimRef: string;
  patientRef: string;
  basisId: string;
  basisLabel: string;
  serviceType: string;
  protected: boolean;
  waiverEffective: boolean;
  balanceBillProhibited: boolean;
  costShareBasis: CostShareBasis;
  patientCostShareBasisAmount: number;
  billedCharge: number;
  inNetworkAllowed: number;
  balanceBillAmount: number;
  balanceBillAllowed: boolean;
  requiresHumanReview: boolean;
  reason: string;
  note: string;
  balanceBillBasisCited: boolean;
  balanceBillCostShareInNetwork: boolean;
  balanceBillProhibitionHonored: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type BalanceBillingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type BalanceBillingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type BalanceBillingView =
  | BalanceBillingResolvedView
  | BalanceBillingBlockedView
  | BalanceBillingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  balanceBillBasisCited?: unknown;
  balanceBillCostShareInNetwork?: unknown;
  balanceBillProhibitionHonored?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildGoodFaithEstimateRequestBody.
 */
export function buildBalanceBillingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: BalanceBillingRequest;
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
 * POST a claim (or an asserted determination) to the Balance Billing Protection agent and
 * return the resulting A2A task. `fetchImpl` is injectable so tests can stub the network
 * boundary. A governance block comes back as HTTP 200 with a `failed` task — only a
 * malformed envelope / parse error is a non-OK response.
 */
export async function runBalanceBillingTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: BalanceBillingRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(BALANCE_BILLING_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBalanceBillingRequestBody(input))
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
export function balanceBillingViewFromTask(task: A2ATask): BalanceBillingView {
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
        "The Agent Fabric blocked this balance-billing run.";
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
        : "The balance-billing determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: BalanceBillingDetermination; claimRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    claimRef: result?.claimRef ?? det?.claimRef ?? "",
    patientRef: det?.patientRef ?? "",
    basisId: det?.basisId ?? "",
    basisLabel: det?.basisLabel ?? "",
    serviceType: det?.serviceType ?? "",
    protected: det?.protected ?? false,
    waiverEffective: det?.waiverEffective ?? false,
    balanceBillProhibited: det?.balanceBillProhibited ?? false,
    costShareBasis: det?.costShareBasis ?? "billed-charge",
    patientCostShareBasisAmount: det?.patientCostShareBasisAmount ?? 0,
    billedCharge: det?.billedCharge ?? 0,
    inNetworkAllowed: det?.inNetworkAllowed ?? 0,
    balanceBillAmount: det?.balanceBillAmount ?? 0,
    balanceBillAllowed: det?.balanceBillAllowed ?? false,
    requiresHumanReview: det?.requiresHumanReview ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    balanceBillBasisCited: fabric.balanceBillBasisCited === true,
    balanceBillCostShareInNetwork: fabric.balanceBillCostShareInNetwork === true,
    balanceBillProhibitionHonored: fabric.balanceBillProhibitionHonored === true,
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
  | { status: "done"; view: BalanceBillingView }
  | { status: "error"; message: string };

export function BalanceBillingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: BalanceBillingPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runBalanceBillingTask({
          taskId: newTaskId("balancebill"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: balanceBillingViewFromTask(task) });
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
        Balance billing protection · No Surprises Act · payer operations
      </p>
      <h3 style={{ margin: 0 }}>
        Balance billing — basis-sourced, a protected patient is on the in-network basis,
        never a surprise bill
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given an out-of-network <strong>claim</strong>, the Balance Billing Protection
        agent <strong>deterministically</strong> decides whether the{" "}
        <strong>No Surprises Act prohibits balance billing</strong> (emergency, OON at an
        in-network facility, air ambulance — but not ground ambulance), computes the
        patient&rsquo;s <strong>cost-share basis</strong> (the in-network{" "}
        <strong>QPA</strong> for a protected claim, never the billed charge), and computes
        the balance-bill amount. A <strong>protected claim is never balance-billed</strong>
        ; a permitted balance bill (a valid waiver, ground ambulance) requires human
        review.{" "}
        <strong>
          The protection bases and QPA amounts are illustrative synthetics, not a certified
          No Surprises Act engine — a real determination uses the actual Qualifying Payment
          Amount and the federal IDR process under 45 CFR 149.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {BALANCE_BILLING_PRESETS.map((preset) => (
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
          Balance-billing run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <BalanceBillingResult view={runState.view} />}
    </section>
  );
}

function BalanceBillingResult({ view }: { view: BalanceBillingView }) {
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
        Balance-billing determination (deterministic, synthetic NSA)
        {view.claimRef ? ` · claim ${view.claimRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="Protected"
          value={String(view.protected)}
          tone={view.protected ? "#8fd6b0" : "#ffd28a"}
        />{" "}
        <Pill
          label="Balance billing"
          value={view.balanceBillProhibited ? "prohibited" : `$${view.balanceBillAmount}`}
          tone={view.balanceBillProhibited ? "#8fd6b0" : "#ffb6c8"}
        />{" "}
        <Pill
          label="Cost-share basis"
          value={view.costShareBasis === "in-network-qpa" ? "in-network QPA" : "billed charge"}
          tone={view.costShareBasis === "in-network-qpa" ? "#8fd6b0" : "#ffb6c8"}
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
        Basis:{" "}
        <strong style={{ color: "var(--fg)" }}>{view.basisLabel || view.basisId}</strong>{" "}
        (<code>{view.basisId}</code>) · billed <code>${view.billedCharge}</code> ·
        in-network / QPA <code>${view.inNetworkAllowed}</code> · cost-share on{" "}
        <code>${view.patientCostShareBasisAmount}</code>
        {view.waiverEffective ? " · waiver effective" : ""}
      </p>

      <div
        role="note"
        aria-label="Balance-billing integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Protection-basis-sourced · in-network cost-share · never a surprise bill{" "}
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
          balanceBillBasisCited = {String(view.balanceBillBasisCited)} ·
          balanceBillCostShareInNetwork = {String(view.balanceBillCostShareInNetwork)} ·
          balanceBillProhibitionHonored = {String(view.balanceBillProhibitionHonored)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
