"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_LAB_RESULT_ABNORMAL_REQUEST,
  DEMO_LAB_RESULT_CRITICAL_LOW_REQUEST,
  DEMO_LAB_RESULT_CRITICAL_REQUEST,
  DEMO_LAB_RESULT_REQUEST,
  type LabResultDetermination,
  type LabResultRequest,
  type ResultClassification
} from "../lib/lab-result";

/**
 * Lab Result & Critical-Value Notification runner for the intake demo.
 *
 * Fires the real, server-side A2A Lab Result & Critical-Value Notification agent at
 * /api/agents/lab-result/tasks — the clinical-decision service that classifies a discrete
 * diagnostic lab result against a reference-range + critical-threshold catalog and, for a
 * critical (panic) value, requires mandatory clinician notification. It deterministically
 * classifies the value as normal / abnormal-high / abnormal-low / critical-high /
 * critical-low, flags whether the result requires mandatory clinician notification and
 * whether it requires clinician review. The panel surfaces the classification, the
 * reference range + critical thresholds, the notification + review flags, the honesty
 * signals, the synthetic labels, and a deep link into the parented Agent Fabric trace.
 *
 * A classification — even a CRITICAL one — is a SAFE, honest RESULT (it completes; a
 * critical value requires notification, an abnormal result requires clinician review).
 * The suppress-critical, no-range, and autonomous-action presets assert offending
 * DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather than
 * hidden.
 *
 * The analyte catalog + reference ranges are ILLUSTRATIVE synthetics, NOT a certified
 * laboratory information system (real critical-value policy is CLIA-validated / 42 CFR
 * 493 and set by the laboratory's medical director). Structure, styling tokens, and tone
 * mirror <FinancialAssistancePanel> and <OverpaymentRecoveryPanel> so this reads as a
 * native sibling on /demo/intake.
 */

const LAB_RESULT_ROUTE = "/api/agents/lab-result/tasks";

/** A one-click demo scenario. */
export type LabResultPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The lab-result request the agent classifies (the common case). */
  request?: LabResultRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const LAB_RESULT_PRESETS: LabResultPreset[] = [
  {
    id: "normal",
    label: "Potassium 4.2 → normal",
    hint: "A potassium of 4.2 mmol/L, within the 3.5–5.1 reference range.",
    request: DEMO_LAB_RESULT_REQUEST,
    demonstrates:
      "A value within the analyte's reference range → normal; no notification or review required."
  },
  {
    id: "critical-high",
    label: "Potassium 6.8 → critical-high (notify)",
    hint: "A potassium of 6.8 mmol/L, at/above the 6.5 critical-high threshold.",
    request: DEMO_LAB_RESULT_CRITICAL_REQUEST,
    demonstrates:
      "A value at/above the critical-high threshold → critical-high; MANDATORY clinician notification (CLIA §493.1291), never suppressed."
  },
  {
    id: "abnormal-high",
    label: "Glucose 180 → abnormal-high (review)",
    hint: "A fasting glucose of 180 mg/dL, above the 70–99 range but below the 500 critical.",
    request: DEMO_LAB_RESULT_ABNORMAL_REQUEST,
    demonstrates:
      "A value above the reference range but below the critical threshold → abnormal-high; clinician review, no mandatory notification."
  },
  {
    id: "critical-low",
    label: "Sodium 118 → critical-low (notify)",
    hint: "A sodium of 118 mmol/L, at/below the 120 critical-low threshold.",
    request: DEMO_LAB_RESULT_CRITICAL_LOW_REQUEST,
    demonstrates:
      "A value at/below the critical-low threshold → critical-low; MANDATORY clinician notification, never suppressed."
  },
  {
    id: "suppress-critical-block",
    label: "Suppress a critical value → governance block",
    hint: "A determination that flags a critical value as not requiring notification.",
    request: DEMO_LAB_RESULT_CRITICAL_REQUEST,
    determination: {
      patientRef: "lab-patient-002",
      providerRef: "lab-provider-002",
      analyteId: "analyte.potassium",
      classification: "critical-high",
      isCritical: true,
      requiresProviderNotification: false,
      requiresClinicianReview: true
    },
    demonstrates:
      "The Agent Fabric blocking a critical (panic) value flagged as not requiring notification — a critical value is never suppressed (policy.lab.critical-value-notified)."
  },
  {
    id: "no-range-block",
    label: "No cited reference range → governance block",
    hint: "An ad-hoc interpretation that doesn't cite a recorded analyte reference range.",
    request: DEMO_LAB_RESULT_REQUEST,
    determination: {
      patientRef: "lab-patient-001",
      providerRef: "lab-provider-001",
      analyteId: "analyte.we-just-decided",
      classification: "abnormal-high",
      isCritical: false,
      requiresProviderNotification: false,
      requiresClinicianReview: true
    },
    demonstrates:
      "The Agent Fabric blocking an ad-hoc result interpretation that doesn't cite a recorded analyte reference range (policy.lab.reference-range-sourced)."
  },
  {
    id: "autonomous-action-block",
    label: "Autonomous action → governance block",
    hint: "An abnormal result flagged as not requiring clinician review.",
    request: DEMO_LAB_RESULT_ABNORMAL_REQUEST,
    determination: {
      patientRef: "lab-patient-003",
      providerRef: "lab-provider-003",
      analyteId: "analyte.glucose",
      classification: "abnormal-high",
      isCritical: false,
      requiresProviderNotification: false,
      requiresClinicianReview: false
    },
    demonstrates:
      "The Agent Fabric blocking a non-normal result flagged as not requiring clinician review — the agent never autonomously acts on a result (policy.lab.no-autonomous-clinical-action)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type LabResultResolvedView = {
  kind: "resolved";
  patientRef: string;
  analyteId: string;
  analyteLabel: string;
  value: number;
  unit: string;
  classification: ResultClassification;
  refLow: number;
  refHigh: number;
  criticalLow: number;
  criticalHigh: number;
  isCritical: boolean;
  requiresProviderNotification: boolean;
  requiresClinicianReview: boolean;
  reason: string;
  note: string;
  labCriticalValueNotified: boolean;
  labRangeCited: boolean;
  labClinicianReviewed: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type LabResultBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type LabResultInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type LabResultView =
  | LabResultResolvedView
  | LabResultBlockedView
  | LabResultInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  labCriticalValueNotified?: unknown;
  labRangeCited?: unknown;
  labClinicianReviewed?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildFinancialAssistanceRequestBody.
 */
export function buildLabResultRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: LabResultRequest;
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
 * POST a lab-result request (or an asserted determination) to the Lab Result &
 * Critical-Value Notification agent and return the resulting A2A task. `fetchImpl` is
 * injectable so tests can stub the network boundary. A governance block comes back as
 * HTTP 200 with a `failed` task — only a malformed envelope / parse error is a non-OK
 * response.
 */
export async function runLabResultTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: LabResultRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(LAB_RESULT_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildLabResultRequestBody(input))
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
export function labResultViewFromTask(task: A2ATask): LabResultView {
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
        "The Agent Fabric blocked this lab-result run.";
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
        : "The lab-result classification could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: LabResultDetermination; patientRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    patientRef: result?.patientRef ?? det?.patientRef ?? "",
    analyteId: det?.analyteId ?? "",
    analyteLabel: det?.analyteLabel ?? "",
    value: det?.value ?? 0,
    unit: det?.unit ?? "",
    classification: det?.classification ?? "normal",
    refLow: det?.refLow ?? 0,
    refHigh: det?.refHigh ?? 0,
    criticalLow: det?.criticalLow ?? 0,
    criticalHigh: det?.criticalHigh ?? 0,
    isCritical: det?.isCritical ?? false,
    requiresProviderNotification: det?.requiresProviderNotification ?? false,
    requiresClinicianReview: det?.requiresClinicianReview ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    labCriticalValueNotified: fabric.labCriticalValueNotified === true,
    labRangeCited: fabric.labRangeCited === true,
    labClinicianReviewed: fabric.labClinicianReviewed === true,
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

const CLASS_LABEL: Record<ResultClassification, string> = {
  normal: "Normal",
  "abnormal-high": "Abnormal-high",
  "abnormal-low": "Abnormal-low",
  "critical-high": "Critical-high",
  "critical-low": "Critical-low"
};

const CLASS_TONE: Record<ResultClassification, string> = {
  normal: "#8fd6b0",
  "abnormal-high": "#ffd28a",
  "abnormal-low": "#ffd28a",
  "critical-high": "#ffb6c8",
  "critical-low": "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: LabResultView }
  | { status: "error"; message: string };

export function LabResultPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: LabResultPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runLabResultTask({
          taskId: newTaskId("lab"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: labResultViewFromTask(task) });
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
        Lab result &amp; critical-value notification · clinical decision
      </p>
      <h3 style={{ margin: 0 }}>
        Lab results — reference-range-sourced, a critical value is always notified, never
        an autonomous action
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given a discrete <strong>lab result</strong> (an analyte + value), the Lab Result
        agent <strong>deterministically</strong> classifies the value against the
        analyte&rsquo;s <strong>reference range</strong> and{" "}
        <strong>critical thresholds</strong> as normal / abnormal / critical, flags
        whether it requires <strong>mandatory clinician notification</strong> (a critical /
        panic value) and whether it requires <strong>clinician review</strong>. A{" "}
        <strong>critical value is never suppressed</strong> (CLIA &sect;493.1291), and the
        agent <strong>never autonomously acts</strong> on a result — a non-normal result is
        escalated for clinician review.{" "}
        <strong>
          The analyte catalog and reference ranges are illustrative synthetics, not a
          certified laboratory information system — real critical-value policy is
          CLIA-validated (42 CFR 493) and set by the laboratory&rsquo;s medical director.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {LAB_RESULT_PRESETS.map((preset) => (
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
              ? "Classifying…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Lab-result run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <LabResultResult view={runState.view} />}
    </section>
  );
}

function LabResultResult({ view }: { view: LabResultView }) {
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
        Lab-result classification (deterministic, synthetic ranges)
        {view.patientRef ? ` · patient ${view.patientRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="Result"
          value={CLASS_LABEL[view.classification]}
          tone={CLASS_TONE[view.classification]}
        />{" "}
        <Pill
          label="Critical"
          value={String(view.isCritical)}
          tone={view.isCritical ? "#ffb6c8" : "#9fb3c8"}
        />{" "}
        <Pill
          label="Notify provider"
          value={String(view.requiresProviderNotification)}
          tone={view.requiresProviderNotification ? "#ffb6c8" : "#9fb3c8"}
        />{" "}
        <Pill
          label="Clinician review"
          value={String(view.requiresClinicianReview)}
          tone={view.requiresClinicianReview ? "#ffd28a" : "#8fd6b0"}
        />
      </p>

      <p
        style={{
          margin: "0.7rem 0 0",
          fontSize: "0.86rem",
          color: "var(--muted)"
        }}
      >
        Analyte:{" "}
        <strong style={{ color: "var(--fg)" }}>{view.analyteLabel || view.analyteId}</strong>{" "}
        = <code>{view.value} {view.unit}</code> · ref{" "}
        <code>{view.refLow}–{view.refHigh}</code> · critical{" "}
        <code>≤{view.criticalLow} / ≥{view.criticalHigh}</code>
      </p>

      <div
        role="note"
        aria-label="Lab-result integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Reference-range-sourced · critical value always notified · no autonomous action{" "}
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
          labCriticalValueNotified = {String(view.labCriticalValueNotified)} ·
          labRangeCited = {String(view.labRangeCited)} · labClinicianReviewed ={" "}
          {String(view.labClinicianReviewed)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
