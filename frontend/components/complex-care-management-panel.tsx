"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_COMPLEX_PATIENT,
  DEMO_ELIGIBLE_PATIENT,
  DEMO_INELIGIBLE_PATIENT,
  type CcmBillingPackage,
  type CcmEligibility,
  type CcmMonthContext,
  type CcmMonthReport,
  type CcmTimeSummary
} from "../lib/complex-care-management";

/**
 * Complex Care Management runner for the intake demo.
 *
 * Fires the real, server-side A2A CCM agent at
 * /api/agents/complex-care-management/tasks — confirms Medicare CCM
 * eligibility, tracks per-activity time, and assembles a CPT-coded billing
 * package for human quality-team review. The panel surfaces the eligibility
 * outcome + qualifying conditions, the time summary + total minutes, the
 * CPT selection + billing state, the honesty signals, and a deep link into
 * the parented Agent Fabric trace.
 */

const CCM_ROUTE = "/api/agents/complex-care-management/tasks";

/** A one-click demo scenario. */
export type CcmPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  context?: CcmMonthContext;
  eligibilityOverride?: CcmEligibility;
  billingOverride?: CcmBillingPackage | null;
  timeSummaryOverride?: CcmTimeSummary;
};

export const COMPLEX_CARE_MANAGEMENT_PRESETS: CcmPreset[] = [
  {
    id: "non-complex-99490",
    label: "Non-complex 99490 · eligible 68F · 35min",
    hint: "3 chronic conditions on catalog, 35min across catalog activities.",
    context: DEMO_ELIGIBLE_PATIENT,
    demonstrates:
      "The agent confirming CCM eligibility (3 catalog-sourced conditions + Medicare age + consent), summing 35min across catalog-sourced activities, and assembling a CPT 99490 billing package ready for human quality-team review (never autonomously submitted to CMS)."
  },
  {
    id: "complex-99487",
    label: "Complex 99487 · eligible 71F · 72min",
    hint: "4 chronic conditions, 72min across activities, moderate/high complexity.",
    context: DEMO_COMPLEX_PATIENT,
    demonstrates:
      "The agent picking CPT 99487 (complex CCM base) when the monthly total crosses the 60-min complex threshold with moderate/high complexity decision-making."
  },
  {
    id: "ineligible",
    label: "Ineligible 52F · under Medicare age",
    hint: "Age below Medicare eligibility → no billing package.",
    context: DEMO_INELIGIBLE_PATIENT,
    demonstrates:
      "The agent producing an ineligible report cleanly — no coverage, no consent, and only 1 catalog-sourced condition — so no billing package is assembled."
  },
  {
    id: "offcat-condition-block",
    label: "Off-catalog condition claim → governance block",
    hint: "Eligibility override cites a fabricated condition.",
    context: DEMO_ELIGIBLE_PATIENT,
    eligibilityOverride: {
      eligible: true,
      qualifyingConditions: ["condition.hypertension", "condition.made-up"],
      hasTwoOrMoreConditions: true,
      meetsAgeGate: true,
      medicareCoverageOnFile: true,
      consentOnFile: true,
      ineligibilityReasons: []
    },
    demonstrates:
      "The Agent Fabric blocking an eligibility claim that cites an off-catalog chronic condition (policy.ccm.eligibility-catalog-sourced) — the guard against fabricating conditions to reach the 2+ threshold."
  },
  {
    id: "auto-submit-block",
    label: "Autonomous CMS submit → governance block",
    hint: "Caller-asserted billing package claims submitted:true.",
    context: DEMO_ELIGIBLE_PATIENT,
    billingOverride: {
      state: "ready-for-quality-team-review",
      patientRef: DEMO_ELIGIBLE_PATIENT.patientRef,
      month: DEMO_ELIGIBLE_PATIENT.month,
      totalMinutes: 35,
      cptCode: "99490",
      complexity: "non-complex",
      requiresQualityTeamApproval: false as unknown as true,
      submitted: true as unknown as false,
      packageId: "override",
      body: "override"
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous CMS submission — every CCM claim requires human quality-team approval (policy.ccm.no-autonomous-billing)."
  },
  {
    id: "phantom-minutes-block",
    label: "Phantom minutes → governance block",
    hint: "Time-summary override reports 60min but entries sum to 35min.",
    context: DEMO_ELIGIBLE_PATIENT,
    timeSummaryOverride: {
      perActivity: [],
      totalMinutes: 60,
      everyActivityIsCatalogSourced: true
    },
    demonstrates:
      "The Agent Fabric blocking a time report where the reported total exceeds the sum of the entries — the load-bearing guard against the classic CCM audit finding of phantom-minute inflation (policy.ccm.time-integrity)."
  }
];

/** Render-ready view of a produced report lifted from the task. */
export type CcmReportedView = {
  kind: "reported";
  report: CcmMonthReport;
  eligibilityTracesToCatalog: boolean;
  billingRequiresHumanApproval: boolean;
  timeEntriesAddUp: boolean;
  traceTaskId: string;
};

export type CcmBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

export type CcmInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ComplexCareManagementView =
  | CcmReportedView
  | CcmBlockedView
  | CcmInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  eligibilityTracesToCatalog?: unknown;
  billingRequiresHumanApproval?: unknown;
  timeEntriesAddUp?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

export function buildComplexCareManagementRequestBody(input: {
  taskId: string;
  personaId?: string;
  context?: CcmMonthContext;
  eligibilityOverride?: CcmEligibility;
  billingOverride?: CcmBillingPackage | null;
  timeSummaryOverride?: CcmTimeSummary;
}) {
  const data: Record<string, unknown> = {};
  if (input.context !== undefined) data.context = input.context;
  if (input.eligibilityOverride !== undefined) {
    data.eligibilityOverride = input.eligibilityOverride;
  }
  if (input.billingOverride !== undefined) {
    data.billingOverride = input.billingOverride;
  }
  if (input.timeSummaryOverride !== undefined) {
    data.timeSummaryOverride = input.timeSummaryOverride;
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

export async function runComplexCareManagementTask(
  input: {
    taskId: string;
    personaId?: string;
    context?: CcmMonthContext;
    eligibilityOverride?: CcmEligibility;
    billingOverride?: CcmBillingPackage | null;
    timeSummaryOverride?: CcmTimeSummary;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CCM_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildComplexCareManagementRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

export function complexCareManagementViewFromTask(
  task: A2ATask
): ComplexCareManagementView {
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
        "The Agent Fabric blocked this CCM run.";
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
        : "The CCM month report could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { report?: CcmMonthReport } | undefined) ?? undefined;
  const report = result?.report;
  if (!report) {
    return {
      kind: "invalid",
      message: "The CCM month report could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    report,
    eligibilityTracesToCatalog: fabric.eligibilityTracesToCatalog === true,
    billingRequiresHumanApproval: fabric.billingRequiresHumanApproval === true,
    timeEntriesAddUp: fabric.timeEntriesAddUp === true,
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

const CPT_TONE: Record<string, string> = {
  NOT_BILLABLE: "#9fb3c8",
  "99490": "#8fd6b0",
  "99491": "#8fd6b0",
  "99487": "#ffd28a",
  "99489": "#ffd28a"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ComplexCareManagementView }
  | { status: "error"; message: string };

export function ComplexCareManagementPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: CcmPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runComplexCareManagementTask({
          taskId: newTaskId("ccm"),
          personaId: "demo",
          context: preset.context,
          eligibilityOverride: preset.eligibilityOverride,
          billingOverride: preset.billingOverride,
          timeSummaryOverride: preset.timeSummaryOverride
        });
        setRunState({
          status: "done",
          view: complexCareManagementViewFromTask(task)
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
        Complex Care Management (CCM) · reimbursable time-tracking
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that assembles the CPT 99490 / 99491 / 99487 / 99489 billing
        package — never autonomously submits to CMS
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The CCM agent runs the reimbursable{" "}
        <strong>time-tracking</strong> piece of care management for a
        Medicare-eligible high-need patient — it confirms{" "}
        <strong>CCM eligibility</strong> (≥ 2 catalog-sourced chronic
        conditions, Medicare age, coverage flag, consent), tracks{" "}
        <strong>per-activity monthly minutes</strong> against a defined
        activity catalog, maps the total to the{" "}
        <strong>CPT ladder</strong> (99490 → 99491 → 99487 → 99489), and
        assembles a billing package for{" "}
        <strong>human quality-team review</strong>. It NEVER autonomously
        submits a CMS claim, and every logged minute traces to a catalog
        activity + sums to the reported total (the guard against{" "}
        <em>phantom-minute inflation</em>, the classic CCM audit finding).{" "}
        <strong>
          The chronic-condition catalog, CCM activity catalog, CPT thresholds,
          and Medicare flags are illustrative synthetics, not CMS Chapter 12
          CCM billing.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {COMPLEX_CARE_MANAGEMENT_PRESETS.map((preset) => (
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
              ? "Assembling…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          CCM run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && (
        <ComplexCareManagementResult view={runState.view} />
      )}
    </section>
  );
}

function ComplexCareManagementResult({
  view
}: {
  view: ComplexCareManagementView;
}) {
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

  const r = view.report;
  const cpt = r.billingPackage?.cptCode ?? "NOT_BILLABLE";
  const state = r.billingPackage?.state ?? "not-billable";

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Monthly CCM report (deterministic, synthetic catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Patient" value={r.patientRef} tone="#9fb3c8" />{" "}
        <Pill label="Month" value={r.month} tone="#9fb3c8" />{" "}
        <Pill
          label="Eligible"
          value={String(r.eligibility.eligible)}
          tone={r.eligibility.eligible ? "#8fd6b0" : "#ffb6c8"}
        />{" "}
        <Pill label="Minutes" value={String(r.timeSummary.totalMinutes)} tone="#9fb3c8" />{" "}
        <Pill label="CPT" value={cpt} tone={CPT_TONE[cpt] ?? "#9fb3c8"} />{" "}
        <Pill label="Billing" value={state} tone="#9fb3c8" />
      </p>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Eligibility
      </p>
      <ul
        style={{
          margin: 0,
          paddingLeft: "1.1rem",
          color: "var(--muted)",
          fontSize: "0.85rem"
        }}
      >
        <li>
          <code>hasTwoOrMoreConditions</code>:{" "}
          {String(r.eligibility.hasTwoOrMoreConditions)} — qualifying:{" "}
          {r.eligibility.qualifyingConditions.join(", ") || "(none)"}
        </li>
        <li>
          <code>meetsAgeGate</code>: {String(r.eligibility.meetsAgeGate)}
        </li>
        <li>
          <code>medicareCoverageOnFile</code>:{" "}
          {String(r.eligibility.medicareCoverageOnFile)}
        </li>
        <li>
          <code>consentOnFile</code>: {String(r.eligibility.consentOnFile)}
        </li>
        {r.eligibility.ineligibilityReasons.length > 0 && (
          <li>
            <code>ineligibilityReasons</code>:{" "}
            {r.eligibility.ineligibilityReasons.join("; ")}
          </li>
        )}
      </ul>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Time summary (per activity)
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {r.timeSummary.perActivity.map((e) => (
          <li
            key={e.activityId}
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
              <strong style={{ fontSize: "0.9rem" }}>{e.activityLabel}</strong>
              <Pill label="Minutes" value={String(e.minutes)} tone="#9fb3c8" />
            </div>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.78rem",
                color: "var(--muted)",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
              }}
            >
              activityId = {e.activityId}
            </p>
          </li>
        ))}
      </ul>

      {r.billingPackage && (
        <div
          role="note"
          aria-label="Billing package"
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Billing package · <span style={{ color: "#ffd28a" }}>{r.billingPackage.state}</span>
          </p>
          <p style={{ margin: "0.3rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
            {r.billingPackage.body}
          </p>
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            packageId = {r.billingPackage.packageId} · cptCode ={" "}
            {r.billingPackage.cptCode} · complexity = {r.billingPackage.complexity} ·
            requiresQualityTeamApproval ={" "}
            {String(r.billingPackage.requiresQualityTeamApproval)} · submitted ={" "}
            {String(r.billingPackage.submitted)}
          </p>
        </div>
      )}

      <div
        role="note"
        aria-label="CCM note"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>{r.note}</p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          eligibilityTracesToCatalog = {String(view.eligibilityTracesToCatalog)} ·
          billingRequiresHumanApproval ={" "}
          {String(view.billingRequiresHumanApproval)} · timeEntriesAddUp ={" "}
          {String(view.timeEntriesAddUp)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
