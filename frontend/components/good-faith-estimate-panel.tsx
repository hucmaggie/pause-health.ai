"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_GFE_IMAGING_REQUEST,
  DEMO_GFE_REQUEST,
  type GfePricedLineItem,
  type GoodFaithEstimateDetermination,
  type GoodFaithEstimateRequest
} from "../lib/good-faith-estimate";

/**
 * Good Faith Estimate (No Surprises Act) runner for the intake demo.
 *
 * Fires the real, server-side A2A Good Faith Estimate agent at
 * /api/agents/good-faith-estimate/tasks — the patient-access service that assembles an
 * itemized Good Faith Estimate of expected charges for a self-pay / uninsured patient
 * BEFORE care, from a charge master. It deterministically prices each line item, verifies
 * every reasonably-expected co-item is included, sums the total, and returns an ESTIMATE
 * (never a binding bill) requiring patient confirmation. The panel surfaces the line
 * items, the total, the completeness + sourcing flags, the honesty signals, the synthetic
 * labels, and a deep link into the parented Agent Fabric trace.
 *
 * A GFE is a SAFE, honest OUTPUT (it completes; binding:false, requiresPatientConfirmation
 * :true). The off-catalog-charge, missing-item, and binding-bill presets assert offending
 * DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than
 * hidden.
 *
 * The charge master + expected-co-item rules are ILLUSTRATIVE synthetics, NOT a certified
 * chargemaster (a real GFE is governed by the No Surprises Act / 45 CFR 149.610 + the
 * provider's actual charges). Structure, styling tokens, and tone mirror
 * <LabResultPanel> and <FinancialAssistancePanel> so this reads as a native sibling on
 * /demo/intake.
 */

const GFE_ROUTE = "/api/agents/good-faith-estimate/tasks";

/** A one-click demo scenario. */
export type GoodFaithEstimatePreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The GFE request the agent prices (the common case). */
  request?: GoodFaithEstimateRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const GOOD_FAITH_ESTIMATE_PRESETS: GoodFaithEstimatePreset[] = [
  {
    id: "complete-consult",
    label: "Consult + hormone panel → $580 estimate",
    hint: "A comprehensive menopause consult with its expected hormone panel.",
    request: DEMO_GFE_REQUEST,
    demonstrates:
      "A complete, charge-master-sourced estimate ($400 consult + $180 panel = $580) — an ESTIMATE requiring patient confirmation, never a binding bill."
  },
  {
    id: "complete-imaging",
    label: "DEXA + office visit → $470 estimate",
    hint: "A bone-density DEXA with its expected office visit.",
    request: DEMO_GFE_IMAGING_REQUEST,
    demonstrates:
      "A complete, charge-master-sourced estimate ($250 DEXA + $220 visit = $470) with the primary imaging and its expected ordering visit."
  },
  {
    id: "off-catalog-block",
    label: "Off-schedule charge → governance block",
    hint: "A line item that isn't priced from the charge master.",
    request: DEMO_GFE_REQUEST,
    determination: {
      patientRef: "gfe-patient-001",
      providerRef: "gfe-provider-001",
      primaryServiceId: "svc.menopause-consult-comprehensive",
      lineItems: [
        { serviceId: "svc.menopause-consult-comprehensive", unitAmount: 400, quantity: 1 },
        { serviceId: "svc.we-made-this-up", unitAmount: 999, quantity: 1 }
      ],
      binding: false
    },
    demonstrates:
      "The Agent Fabric blocking a line item that isn't charge-master-sourced (an off-catalog service id / fabricated charge) — policy.gfe.charge-master-sourced."
  },
  {
    id: "missing-item-block",
    label: "Incomplete estimate → governance block",
    hint: "An estimate for a consult that omits its expected hormone panel.",
    request: DEMO_GFE_REQUEST,
    determination: {
      patientRef: "gfe-patient-001",
      providerRef: "gfe-provider-001",
      primaryServiceId: "svc.menopause-consult-comprehensive",
      lineItems: [
        { serviceId: "svc.menopause-consult-comprehensive", unitAmount: 400, quantity: 1 }
      ],
      binding: false
    },
    demonstrates:
      "The Agent Fabric blocking an incomplete estimate that omits a reasonably-expected item (the hormone panel) — policy.gfe.expected-items-complete."
  },
  {
    id: "binding-bill-block",
    label: "Binding bill → governance block",
    hint: "A determination presented as a final / binding charge.",
    request: DEMO_GFE_REQUEST,
    determination: {
      patientRef: "gfe-patient-001",
      providerRef: "gfe-provider-001",
      primaryServiceId: "svc.menopause-consult-comprehensive",
      lineItems: [
        { serviceId: "svc.menopause-consult-comprehensive", unitAmount: 400, quantity: 1 },
        { serviceId: "svc.lab-panel-hormone", unitAmount: 180, quantity: 1 }
      ],
      binding: true
    },
    demonstrates:
      "The Agent Fabric blocking a GFE presented as a binding / final bill — a GFE is an estimate requiring patient confirmation (policy.gfe.estimate-not-binding)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type GoodFaithEstimateResolvedView = {
  kind: "resolved";
  patientRef: string;
  primaryServiceId: string;
  primaryServiceLabel: string;
  lineItems: GfePricedLineItem[];
  missingExpectedItems: string[];
  totalEstimate: number;
  allLineItemsSourced: boolean;
  expectedItemsComplete: boolean;
  binding: boolean;
  requiresPatientConfirmation: boolean;
  disputeThreshold: number;
  reason: string;
  note: string;
  gfeChargeMasterSourced: boolean;
  gfeExpectedItemsComplete: boolean;
  gfeEstimateNotBinding: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type GoodFaithEstimateBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type GoodFaithEstimateInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type GoodFaithEstimateView =
  | GoodFaithEstimateResolvedView
  | GoodFaithEstimateBlockedView
  | GoodFaithEstimateInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  gfeChargeMasterSourced?: unknown;
  gfeExpectedItemsComplete?: unknown;
  gfeEstimateNotBinding?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildLabResultRequestBody.
 */
export function buildGoodFaithEstimateRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: GoodFaithEstimateRequest;
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
 * POST a GFE request (or an asserted determination) to the Good Faith Estimate agent and
 * return the resulting A2A task. `fetchImpl` is injectable so tests can stub the network
 * boundary. A governance block comes back as HTTP 200 with a `failed` task — only a
 * malformed envelope / parse error is a non-OK response.
 */
export async function runGoodFaithEstimateTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: GoodFaithEstimateRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(GFE_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildGoodFaithEstimateRequestBody(input))
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
export function goodFaithEstimateViewFromTask(task: A2ATask): GoodFaithEstimateView {
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
        "The Agent Fabric blocked this good-faith-estimate run.";
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
        : "The good-faith-estimate could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: GoodFaithEstimateDetermination; patientRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    patientRef: result?.patientRef ?? det?.patientRef ?? "",
    primaryServiceId: det?.primaryServiceId ?? "",
    primaryServiceLabel: det?.primaryServiceLabel ?? "",
    lineItems: det?.lineItems ?? [],
    missingExpectedItems: det?.missingExpectedItems ?? [],
    totalEstimate: det?.totalEstimate ?? 0,
    allLineItemsSourced: det?.allLineItemsSourced ?? false,
    expectedItemsComplete: det?.expectedItemsComplete ?? false,
    binding: det?.binding ?? false,
    requiresPatientConfirmation: det?.requiresPatientConfirmation ?? false,
    disputeThreshold: det?.disputeThreshold ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    gfeChargeMasterSourced: fabric.gfeChargeMasterSourced === true,
    gfeExpectedItemsComplete: fabric.gfeExpectedItemsComplete === true,
    gfeEstimateNotBinding: fabric.gfeEstimateNotBinding === true,
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
  | { status: "done"; view: GoodFaithEstimateView }
  | { status: "error"; message: string };

export function GoodFaithEstimatePanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: GoodFaithEstimatePreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runGoodFaithEstimateTask({
          taskId: newTaskId("gfe"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: goodFaithEstimateViewFromTask(task) });
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
        Good Faith Estimate · No Surprises Act · patient access
      </p>
      <h3 style={{ margin: 0 }}>
        Good Faith Estimate — charge-master-sourced, complete, an estimate never a binding
        bill
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given a scheduled <strong>primary service</strong> and the expected{" "}
        <strong>line items</strong>, the Good Faith Estimate agent{" "}
        <strong>deterministically</strong> prices each line item from the{" "}
        <strong>charge master</strong>, verifies every{" "}
        <strong>reasonably-expected co-item</strong> is included, sums the total, and
        returns an <strong>ESTIMATE</strong> (never a binding bill) requiring patient
        confirmation — with the <strong>No Surprises Act</strong> $400 dispute threshold
        recorded.{" "}
        <strong>
          The charge master and expected-item rules are illustrative synthetics, not a
          certified chargemaster — a real GFE is governed by the No Surprises Act (45 CFR
          149.610) and the provider&rsquo;s actual charges.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {GOOD_FAITH_ESTIMATE_PRESETS.map((preset) => (
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
              ? "Estimating…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Good-faith-estimate run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <GoodFaithEstimateResult view={runState.view} />}
    </section>
  );
}

function GoodFaithEstimateResult({ view }: { view: GoodFaithEstimateView }) {
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
        Good Faith Estimate (deterministic, synthetic charge master)
        {view.patientRef ? ` · patient ${view.patientRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Total" value={`$${view.totalEstimate}`} tone="#8fd6b0" />{" "}
        <Pill
          label="Complete"
          value={String(view.expectedItemsComplete)}
          tone={view.expectedItemsComplete ? "#8fd6b0" : "#ffb6c8"}
        />{" "}
        <Pill
          label="Estimate (not a bill)"
          value={String(!view.binding)}
          tone={!view.binding ? "#8fd6b0" : "#ffb6c8"}
        />{" "}
        <Pill label="Dispute ≥" value={`$${view.disputeThreshold}`} tone="#9fb3c8" />
      </p>

      {view.lineItems.length > 0 && (
        <ul
          style={{
            margin: "0.7rem 0 0",
            paddingLeft: "1.1rem",
            fontSize: "0.86rem",
            color: "var(--muted)"
          }}
        >
          {view.lineItems.map((li, i) => (
            <li key={`${li.serviceId}-${i}`}>
              <strong style={{ color: "var(--fg)" }}>{li.label}</strong> — {li.quantity} ×
              ${li.unitAmount} = ${li.lineTotal}{" "}
              <code>{li.serviceId}</code>
              {li.sourced ? "" : " ⚠ off-catalog"}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Good-faith-estimate integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Charge-master-sourced · complete · an estimate, never a binding bill{" "}
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
          gfeChargeMasterSourced = {String(view.gfeChargeMasterSourced)} ·
          gfeExpectedItemsComplete = {String(view.gfeExpectedItemsComplete)} ·
          gfeEstimateNotBinding = {String(view.gfeEstimateNotBinding)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
