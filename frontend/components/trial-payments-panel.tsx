"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_EXTRA_PROCEDURE,
  DEMO_MISSED_VISIT,
  DEMO_NO_CONSENT,
  DEMO_STANDARD_PAYMENT,
  DEMO_TRAVEL_OUT_OF_RANGE,
  type TrialPaymentDecision,
  type TrialPaymentRequest
} from "../lib/trial-payments";

/**
 * Clinical Trial Payments & Stipends runner for the intake demo.
 *
 * Fires the real, server-side A2A trial-payments agent at
 * /api/agents/trial-payments/tasks — deterministic stipend computation
 * against IRB-approved payment schedules with study-coordinator cosign
 * for non-standard payments.
 */

const TP_ROUTE = "/api/agents/trial-payments/tasks";

export type TrialPaymentsPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  request?: TrialPaymentRequest;
  decisionOverride?: TrialPaymentDecision;
};

export const TRIAL_PAYMENTS_PRESETS: TrialPaymentsPreset[] = [
  {
    id: "schedule-approved",
    label: "Schedule-approved · treatment visit + travel",
    hint: "Completed treatment visit, 40 miles round trip, consent on file.",
    request: DEMO_STANDARD_PAYMENT,
    demonstrates:
      "The agent auto-paying against the IRB schedule — $150 stipend + $8.40 travel (40mi × 21¢). All three honesty signals green."
  },
  {
    id: "missed-visit-pend",
    label: "Missed visit → coordinator cosign",
    hint: "Follow-up visit missed. Requires coordinator to determine partial comp.",
    request: DEMO_MISSED_VISIT,
    demonstrates:
      "Missed visit routes to study-coordinator review (TP-200) — the agent never autonomously decides partial comp; that's an IRB judgment."
  },
  {
    id: "travel-out-of-range-pend",
    label: "Travel out of range → coordinator cosign",
    hint: "90 miles > 60 mile IRB max for this trial.",
    request: DEMO_TRAVEL_OUT_OF_RANGE,
    demonstrates:
      "Travel exceeds the IRB-approved maximum. Routes to coordinator (TP-201) — never autonomously exceeds IRB limits."
  },
  {
    id: "extra-procedure-pend",
    label: "Extra procedure request → coordinator cosign",
    hint: "Participant requests comp for a procedure outside the IRB schedule.",
    request: DEMO_EXTRA_PROCEDURE,
    demonstrates:
      "Extra-procedure comp request routes to coordinator (TP-202) — the agent NEVER autonomously deviates from an IRB-approved schedule."
  },
  {
    id: "blocked-no-consent",
    label: "No consent → blocked-hold ($0)",
    hint: "Participant has no research-payment consent on file.",
    request: DEMO_NO_CONSENT,
    demonstrates:
      "Blocked-no-consent — zero payment, routed to a blocked-hold queue (TP-300). Payments without consent violate 45 CFR 46."
  },
  {
    id: "offcat-trial-block",
    label: "Off-catalog trial → governance block",
    hint: "Caller-asserted decision cites a made-up trial id.",
    request: DEMO_STANDARD_PAYMENT,
    decisionOverride: {
      requestRef: DEMO_STANDARD_PAYMENT.requestRef,
      participantRef: DEMO_STANDARD_PAYMENT.participantRef,
      trialId: "trial.made-up",
      trialLabel: "Fake",
      visitTypeId: "visit.treatment",
      visitTypeLabel: "Treatment",
      asOfDate: DEMO_STANDARD_PAYMENT.asOfDate,
      decision: "schedule-approved",
      stipendAmountCents: 15000,
      travelReimbursementCents: 0,
      appliedRules: [
        {
          ruleId: "rule.standard-visit-completed",
          ruleLabel: "Standard",
          reasonCode: "reason.TP-100",
          reasonLabel: "Standard",
          detail: "override"
        }
      ],
      primaryReasonCode: "reason.TP-100",
      primaryReasonLabel: "Standard",
      routedTo: "schedule-auto-pay",
      requiresCoordinatorCosign: false,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a decision that cites an off-catalog trial id (policy.trial-payments.schedule-catalog-sourced) — no ad-hoc trial payments."
  },
  {
    id: "autonomous-cosign-block",
    label: "Autonomous cosign → governance block",
    hint: "Caller-asserted pend decision claims cosigned:true.",
    request: DEMO_MISSED_VISIT,
    decisionOverride: {
      requestRef: DEMO_MISSED_VISIT.requestRef,
      participantRef: DEMO_MISSED_VISIT.participantRef,
      trialId: DEMO_MISSED_VISIT.trialId,
      trialLabel: "Fez",
      visitTypeId: DEMO_MISSED_VISIT.visitTypeId,
      visitTypeLabel: "Follow-up",
      asOfDate: DEMO_MISSED_VISIT.asOfDate,
      decision: "pend-coordinator-review",
      stipendAmountCents: 10000,
      travelReimbursementCents: 0,
      appliedRules: [
        {
          ruleId: "rule.missed-visit-partial-comp",
          ruleLabel: "Missed",
          reasonCode: "reason.TP-200",
          reasonLabel: "Missed",
          detail: "override"
        }
      ],
      primaryReasonCode: "reason.TP-200",
      primaryReasonLabel: "Missed",
      routedTo: "study-coordinator-review",
      requiresCoordinatorCosign: false,
      cosigned: true as unknown as false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-cosigned IRB deviation (policy.trial-payments.no-autonomous-irb-deviation) — IRB deviations require a real human coordinator sign-off."
  },
  {
    id: "no-consent-lied-block",
    label: "Approved without consent → governance block",
    hint: "Caller claims schedule-approved for a non-consented participant.",
    request: DEMO_NO_CONSENT,
    decisionOverride: {
      requestRef: DEMO_NO_CONSENT.requestRef,
      participantRef: DEMO_NO_CONSENT.participantRef,
      trialId: DEMO_NO_CONSENT.trialId,
      trialLabel: "Fez",
      visitTypeId: DEMO_NO_CONSENT.visitTypeId,
      visitTypeLabel: "Treatment",
      asOfDate: DEMO_NO_CONSENT.asOfDate,
      decision: "schedule-approved",
      stipendAmountCents: 15000,
      travelReimbursementCents: 840,
      appliedRules: [
        {
          ruleId: "rule.standard-visit-completed",
          ruleLabel: "Standard",
          reasonCode: "reason.TP-100",
          reasonLabel: "Standard",
          detail: "override"
        }
      ],
      primaryReasonCode: "reason.TP-100",
      primaryReasonLabel: "Standard",
      routedTo: "schedule-auto-pay",
      requiresCoordinatorCosign: false,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a payment approved without participant consent (policy.trial-payments.participant-consented) — a 45 CFR 46 requirement."
  }
];

export type TrialPaymentsReportedView = {
  kind: "reported";
  decision: TrialPaymentDecision;
  paymentsTraceToCatalog: boolean;
  deviationRequiresCoordinatorCosign: boolean;
  paymentHasParticipantConsent: boolean;
  traceTaskId: string;
};

export type TrialPaymentsBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

export type TrialPaymentsInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type TrialPaymentsView =
  | TrialPaymentsReportedView
  | TrialPaymentsBlockedView
  | TrialPaymentsInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  paymentsTraceToCatalog?: unknown;
  deviationRequiresCoordinatorCosign?: unknown;
  paymentHasParticipantConsent?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

export function buildTrialPaymentsRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: TrialPaymentRequest;
  decisionOverride?: TrialPaymentDecision;
}) {
  const data: Record<string, unknown> = {};
  if (input.request !== undefined) data.request = input.request;
  if (input.decisionOverride !== undefined) data.decisionOverride = input.decisionOverride;
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

export async function runTrialPaymentsTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: TrialPaymentRequest;
    decisionOverride?: TrialPaymentDecision;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(TP_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildTrialPaymentsRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

export function trialPaymentsViewFromTask(task: A2ATask): TrialPaymentsView {
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
        "The Agent Fabric blocked this trial payment.";
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
        : "The trial payment could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { decision?: TrialPaymentDecision } | undefined) ?? undefined;
  const decision = result?.decision;
  if (!decision) {
    return {
      kind: "invalid",
      message: "The trial payment could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    decision,
    paymentsTraceToCatalog: fabric.paymentsTraceToCatalog === true,
    deviationRequiresCoordinatorCosign:
      fabric.deviationRequiresCoordinatorCosign === true,
    paymentHasParticipantConsent: fabric.paymentHasParticipantConsent === true,
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
  "schedule-approved": "#8fd6b0",
  "pend-coordinator-review": "#ffd28a",
  "blocked-no-consent": "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: TrialPaymentsView }
  | { status: "error"; message: string };

export function TrialPaymentsPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: TrialPaymentsPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runTrialPaymentsTask({
          taskId: newTaskId("tp"),
          personaId: "demo",
          request: preset.request,
          decisionOverride: preset.decisionOverride
        });
        setRunState({
          status: "done",
          view: trialPaymentsViewFromTask(task)
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
        Clinical Trial Payments &amp; Stipends · IRB-schedule payment engine
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that pays per-visit stipends against IRB-approved schedules — never
        deviates without coordinator cosign, never pays without consent
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The trial-payments agent pairs with Clinical Trials Matching. For each
        participant visit it looks up the{" "}
        <strong>IRB-approved compensation schedule</strong> (trial + visit type
        + IRB approval ref), verifies{" "}
        <strong>research-payment informed consent</strong> is on file (45 CFR
        46 requirement), computes the stipend + travel reimbursement, and
        routes non-standard payments (missed visit, out-of-range travel, extra
        procedure) to the <strong>study coordinator for cosign</strong>. The
        agent NEVER autonomously deviates from an IRB-approved schedule and
        NEVER pays a non-consented participant.{" "}
        <strong>
          The trial catalog, IRB schedules, visit types, rules, and travel
          rates are illustrative synthetics, not IRBNet / WCG IRB / Advarra
          IRB or a real sponsor's payment protocol.
        </strong>{" "}
        Every run is governed by the Agent Fabric.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {TRIAL_PAYMENTS_PRESETS.map((preset) => (
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
          Trial payment failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <TrialPaymentsResult view={runState.view} />}
    </section>
  );
}

function TrialPaymentsResult({ view }: { view: TrialPaymentsView }) {
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
        Trial payment decision (deterministic, IRB catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Trial" value={d.trialLabel} tone="#9fb3c8" />{" "}
        <Pill label="Visit" value={d.visitTypeLabel} tone="#9fb3c8" />{" "}
        <Pill
          label="Decision"
          value={d.decision}
          tone={DECISION_TONE[d.decision] ?? "#9fb3c8"}
        />{" "}
        <Pill label="Reason" value={d.primaryReasonCode} tone="#9fb3c8" />{" "}
        <Pill label="Routed to" value={d.routedTo} tone="#9fb3c8" />
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
        Stipend: ${(d.stipendAmountCents / 100).toFixed(2)} · Travel: $
        {(d.travelReimbursementCents / 100).toFixed(2)} · Requires cosign:{" "}
        {String(d.requiresCoordinatorCosign)} · Cosigned: {String(d.cosigned)}
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
        aria-label="Trial-payments note"
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
          paymentsTraceToCatalog = {String(view.paymentsTraceToCatalog)} ·
          deviationRequiresCoordinatorCosign ={" "}
          {String(view.deviationRequiresCoordinatorCosign)} ·
          paymentHasParticipantConsent ={" "}
          {String(view.paymentHasParticipantConsent)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
