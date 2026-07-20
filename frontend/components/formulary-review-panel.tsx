"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_INTERACTION_REQUEST,
  DEMO_NON_FORMULARY_REQUEST,
  DEMO_PREFERRED_REQUEST,
  DEMO_QUANTITY_LIMIT_REQUEST,
  DEMO_STEP_THERAPY_REQUEST,
  type FormularyReviewDecision,
  type FormularyReviewRequest
} from "../lib/formulary-review";

/**
 * Formulary & Drug Utilization Review runner for the intake demo.
 *
 * Fires the real, server-side A2A formulary agent at
 * /api/agents/formulary-review/tasks — first-pass payer-side formulary + DUR
 * pipeline. Deterministically classifies as preferred-approved / pend /
 * clinician-cosign, and routes pends to a human. Never autonomously
 * overrides a formulary exception.
 */

const FORMULARY_ROUTE = "/api/agents/formulary-review/tasks";

export type FormularyReviewPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  request?: FormularyReviewRequest;
  decisionOverride?: FormularyReviewDecision;
};

export const FORMULARY_REVIEW_PRESETS: FormularyReviewPreset[] = [
  {
    id: "preferred-approved",
    label: "Preferred-approved · Tier 1 estradiol oral",
    hint: "In-quantity, no interactions, no step-therapy chain.",
    request: DEMO_PREFERRED_REQUEST,
    demonstrates:
      "The agent preferred-approving a Tier 1 in-quantity request with all three honesty signals green — no rules fired, auto-approved."
  },
  {
    id: "pend-step-therapy",
    label: "Pend step-therapy · patch, no documented oral trial",
    hint: "Transdermal estradiol patch, only self-reported prior oral use.",
    request: DEMO_STEP_THERAPY_REQUEST,
    demonstrates:
      "The agent pending for step-therapy — self-reported (documented:false) oral estradiol trial does NOT satisfy the step-therapy chain. Requires clinician cosign."
  },
  {
    id: "pend-quantity",
    label: "Pend quantity-limit · 60 units vs. 30 monthly limit",
    hint: "Estradiol oral requested at 2x the plan limit.",
    request: DEMO_QUANTITY_LIMIT_REQUEST,
    demonstrates:
      "The agent pending for quantity-limit review — 60 units exceeds the plan's 30-unit monthly limit. Requires clinician cosign for exception."
  },
  {
    id: "pend-interaction",
    label: "Pend interaction · estradiol + warfarin",
    hint: "Documented drug-drug interaction pair.",
    request: DEMO_INTERACTION_REQUEST,
    demonstrates:
      "The agent pending for pharmacist review on a documented estradiol/warfarin interaction. Routed to pharmacist-review (not clinician-review) but still clinician-cosign gated."
  },
  {
    id: "pend-non-formulary",
    label: "Pend non-formulary · fezolinetant (Veozah)",
    hint: "Non-formulary NK3 antagonist — needs formulary exception.",
    request: DEMO_NON_FORMULARY_REQUEST,
    demonstrates:
      "The agent pending for a formulary exception. Multiple rules fire in deterministic order (non-formulary + step-therapy); highest severity (non-formulary) wins the primary reason PF-203."
  },
  {
    id: "offcat-rule-block",
    label: "Off-catalog rule → governance block",
    hint: "Caller-asserted decision cites a fabricated rule.",
    request: DEMO_PREFERRED_REQUEST,
    decisionOverride: {
      requestRef: DEMO_PREFERRED_REQUEST.requestRef,
      memberRef: DEMO_PREFERRED_REQUEST.memberRef,
      asOfDate: DEMO_PREFERRED_REQUEST.asOfDate,
      proposedDrugId: DEMO_PREFERRED_REQUEST.proposedDrugId,
      proposedDrugLabel: "Estradiol",
      tier: 1,
      decision: "pend-non-formulary",
      appliedRules: [
        {
          ruleId: "rule.made-up",
          ruleLabel: "Fake rule",
          reasonCode: "reason.PF-203",
          reasonLabel: "Non-formulary",
          detail: "fabricated"
        }
      ],
      primaryReasonCode: "reason.PF-203",
      primaryReasonLabel: "Non-formulary",
      routedTo: "clinician-review",
      requiresClinicianCosign: true,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a decision that cites an off-catalog rule (policy.formulary.catalog-sourced) — the guard against fabricated formulary rules."
  },
  {
    id: "step-therapy-lied-block",
    label: "Approve-on-undocumented-history → governance block",
    hint: "Caller claims preferred-approved but only self-reported prior therapy.",
    request: DEMO_STEP_THERAPY_REQUEST,
    decisionOverride: {
      requestRef: DEMO_STEP_THERAPY_REQUEST.requestRef,
      memberRef: DEMO_STEP_THERAPY_REQUEST.memberRef,
      asOfDate: DEMO_STEP_THERAPY_REQUEST.asOfDate,
      proposedDrugId: DEMO_STEP_THERAPY_REQUEST.proposedDrugId,
      proposedDrugLabel: "Estradiol patch",
      tier: 2,
      decision: "preferred-approved",
      appliedRules: [],
      primaryReasonCode: "reason.PF-100",
      primaryReasonLabel: "Preferred approval",
      routedTo: "auto-approved",
      requiresClinicianCosign: false,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a preferred-approved decision when step-therapy is required and only undocumented history is on file (policy.formulary.step-therapy-honored)."
  },
  {
    id: "auto-cosign-block",
    label: "Auto-cosigned override → governance block",
    hint: "Caller-asserted decision claims cosigned:true.",
    request: DEMO_NON_FORMULARY_REQUEST,
    decisionOverride: {
      requestRef: DEMO_NON_FORMULARY_REQUEST.requestRef,
      memberRef: DEMO_NON_FORMULARY_REQUEST.memberRef,
      asOfDate: DEMO_NON_FORMULARY_REQUEST.asOfDate,
      proposedDrugId: DEMO_NON_FORMULARY_REQUEST.proposedDrugId,
      proposedDrugLabel: "Fezolinetant",
      tier: "non-formulary",
      decision: "pend-non-formulary",
      appliedRules: [
        {
          ruleId: "rule.non-formulary",
          ruleLabel: "Non-formulary",
          reasonCode: "reason.PF-203",
          reasonLabel: "Non-formulary",
          detail: "non-formulary"
        }
      ],
      primaryReasonCode: "reason.PF-203",
      primaryReasonLabel: "Non-formulary",
      routedTo: "clinician-review",
      requiresClinicianCosign: false,
      cosigned: true as unknown as false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-cosigned formulary override (policy.formulary.no-autonomous-override) — formulary exceptions are legally consequential and require a prescriber's documented rationale."
  }
];

export type FormularyReportedView = {
  kind: "reported";
  decision: FormularyReviewDecision;
  rulesTraceToCatalog: boolean;
  stepTherapyIsHonored: boolean;
  exceptionRequiresClinicianCosign: boolean;
  traceTaskId: string;
};

export type FormularyBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

export type FormularyInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type FormularyReviewView =
  | FormularyReportedView
  | FormularyBlockedView
  | FormularyInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  rulesTraceToCatalog?: unknown;
  stepTherapyIsHonored?: unknown;
  exceptionRequiresClinicianCosign?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

export function buildFormularyReviewRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: FormularyReviewRequest;
  decisionOverride?: FormularyReviewDecision;
}) {
  const data: Record<string, unknown> = {};
  if (input.request !== undefined) data.request = input.request;
  if (input.decisionOverride !== undefined) {
    data.decisionOverride = input.decisionOverride;
  }
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

export async function runFormularyReviewTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: FormularyReviewRequest;
    decisionOverride?: FormularyReviewDecision;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(FORMULARY_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildFormularyReviewRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

export function formularyReviewViewFromTask(task: A2ATask): FormularyReviewView {
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
        "The Agent Fabric blocked this formulary review.";
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
        : "The formulary review could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { decision?: FormularyReviewDecision } | undefined) ?? undefined;
  const decision = result?.decision;
  if (!decision) {
    return {
      kind: "invalid",
      message: "The formulary review could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    decision,
    rulesTraceToCatalog: fabric.rulesTraceToCatalog === true,
    stepTherapyIsHonored: fabric.stepTherapyIsHonored === true,
    exceptionRequiresClinicianCosign:
      fabric.exceptionRequiresClinicianCosign === true,
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

const DECISION_TONE: Record<string, string> = {
  "preferred-approved": "#8fd6b0",
  "pend-quantity-limit": "#ffd28a",
  "pend-interaction-review": "#ffd28a",
  "pend-step-therapy": "#ffd28a",
  "pend-non-formulary": "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: FormularyReviewView }
  | { status: "error"; message: string };

export function FormularyReviewPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: FormularyReviewPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runFormularyReviewTask({
          taskId: newTaskId("formulary"),
          personaId: "demo",
          request: preset.request,
          decisionOverride: preset.decisionOverride
        });
        setRunState({
          status: "done",
          view: formularyReviewViewFromTask(task)
        });
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
        Formulary &amp; Drug Utilization Review · first-pass payer-side
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that preferred-approves, pends for step-therapy / quantity /
        interaction / non-formulary, and never autonomously overrides an exception
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The formulary agent evaluates a proposed medication against the
        payer&apos;s <strong>catalog rules</strong> (tier, step-therapy,
        quantity limits, drug-drug interactions), classifies as{" "}
        <strong>preferred-approved / pend</strong> with a specific catalog
        reason code, and routes pends to a clinician (or pharmacist for
        interactions). The agent NEVER autonomously overrides a formulary
        exception — every non-preferred decision is DRAFTED for clinician
        cosign, because formulary exceptions require a prescriber&apos;s
        documented rationale under Medicare Advantage Chapter 6 + Part D.
        Menopause-relevant because <strong>HRT tier placement varies
        significantly by plan</strong> (transdermal estradiol is often
        Tier 2 or non-formulary despite being clinically preferred for
        CVD-risk profiles).{" "}
        <strong>
          The drug catalog, rule catalog, step-therapy chains, and
          interaction pairs are illustrative synthetics, not Medi-Span /
          RxNorm / a real payer formulary.
        </strong>{" "}
        Every run is governed by the Agent Fabric.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {FORMULARY_REVIEW_PRESETS.map((preset) => (
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
              ? "Reviewing…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Formulary review failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && (
        <FormularyReviewResult view={runState.view} />
      )}
    </section>
  );
}

function FormularyReviewResult({ view }: { view: FormularyReviewView }) {
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

  const d = view.decision;

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Formulary decision (deterministic, synthetic catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Request" value={d.requestRef} tone="#9fb3c8" />{" "}
        <Pill label="Drug" value={d.proposedDrugLabel} tone="#9fb3c8" />{" "}
        <Pill label="Tier" value={String(d.tier)} tone="#9fb3c8" />{" "}
        <Pill
          label="Decision"
          value={d.decision}
          tone={DECISION_TONE[d.decision] ?? "#9fb3c8"}
        />{" "}
        <Pill label="Reason" value={d.primaryReasonCode} tone="#9fb3c8" />{" "}
        <Pill label="Routed to" value={d.routedTo ?? "n/a"} tone="#9fb3c8" />
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
        Applied rules: {d.appliedRules.length} · requires clinician cosign:{" "}
        {String(d.requiresClinicianCosign)} · cosigned: {String(d.cosigned)}
      </p>

      {d.appliedRules.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
            Applied rules
          </p>
          <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
            {d.appliedRules.map((r) => (
              <li
                key={r.ruleId}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.55rem",
                  border: "1px solid var(--line)",
                  background: "rgba(255,255,255,0.03)",
                  marginBottom: "0.4rem"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                    alignItems: "baseline"
                  }}
                >
                  <strong style={{ fontSize: "0.9rem" }}>{r.ruleLabel}</strong>
                  <Pill label="Reason" value={r.reasonCode} tone="#9fb3c8" />
                </div>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                  {r.detail}
                </p>
                <p
                  style={{
                    margin: "0.15rem 0 0",
                    fontSize: "0.72rem",
                    color: "var(--muted)",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                  }}
                >
                  ruleId = {r.ruleId}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <div
        role="note"
        aria-label="Formulary note"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>{d.note}</p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          rulesTraceToCatalog = {String(view.rulesTraceToCatalog)} ·
          stepTherapyIsHonored = {String(view.stepTherapyIsHonored)} ·
          exceptionRequiresClinicianCosign ={" "}
          {String(view.exceptionRequiresClinicianCosign)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
