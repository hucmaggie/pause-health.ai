"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_IMMUNIZATION_CONTRAINDICATION_REQUEST,
  DEMO_IMMUNIZATION_REQUEST,
  DEMO_IMMUNIZATION_UPTODATE_REQUEST,
  type ForecastEntry,
  type ImmunizationDetermination,
  type ImmunizationRequest
} from "../lib/immunization";

/**
 * Immunization Forecasting (ACIP) runner for the intake demo.
 *
 * Fires the real, server-side A2A Immunization agent at /api/agents/immunization/tasks — the
 * clinical-decision service that forecasts which vaccines a patient is up-to-date / due /
 * overdue / contraindicated / not-indicated for against an ACIP-style schedule. It
 * deterministically computes age and forecasts each vaccine, citing the governing schedule
 * rule and next-due date. The panel surfaces the per-vaccine forecast, the due / overdue /
 * contraindicated counts, the clinician-order flag, the honesty signals, the synthetic
 * labels, and a deep link into the parented Agent Fabric trace.
 *
 * A forecast — with due / overdue vaccines — is a SAFE, honest OUTPUT (it completes; due /
 * overdue vaccines carry requiresClinicianOrder:true). The off-schedule, contraindicated,
 * and autonomous presets assert offending DETERMINATIONS — so all three governance blocks
 * are demonstrable in the UI rather than hidden.
 *
 * The ACIP-style schedule + intervals are ILLUSTRATIVE synthetics, NOT a certified
 * immunization forecaster (a real forecast uses the current ACIP recommendations + CDC
 * schedules). Structure, styling tokens, and tone mirror <LabResultPanel> and
 * <BalanceBillingPanel> so this reads as a native sibling on /demo/intake.
 */

const IMMUNIZATION_ROUTE = "/api/agents/immunization/tasks";

/** A one-click demo scenario. */
export type ImmunizationPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The patient the agent evaluates (the common case). */
  request?: ImmunizationRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const IMMUNIZATION_PRESETS: ImmunizationPreset[] = [
  {
    id: "midlife-due",
    label: "52-year-old → due + overdue vaccines",
    hint: "Recent flu, very old Tdap, no zoster, no COVID.",
    request: DEMO_IMMUNIZATION_REQUEST,
    demonstrates:
      "Flu up-to-date, Tdap overdue, zoster overdue, pneumococcal not-indicated (age < 65), COVID due → a recommendation requiring a clinician order."
  },
  {
    id: "contraindicated",
    label: "Zoster contraindicated → withheld",
    hint: "Immunocompromised patient with a recorded zoster contraindication.",
    request: DEMO_IMMUNIZATION_CONTRAINDICATION_REQUEST,
    demonstrates:
      "The zoster vaccine is contraindicated → withheld and flagged, never recommended (patient-safety gate)."
  },
  {
    id: "up-to-date",
    label: "40-year-old → all up-to-date",
    hint: "Recent flu, recent Tdap, recent COVID.",
    request: DEMO_IMMUNIZATION_UPTODATE_REQUEST,
    demonstrates:
      "All recurring vaccines up-to-date, zoster / pneumococcal not-indicated (age < 50 / 65) → no clinician order required."
  },
  {
    id: "off-schedule-block",
    label: "Off-catalog rule → governance block",
    hint: "A forecast citing a rule not in the ACIP catalog.",
    request: DEMO_IMMUNIZATION_REQUEST,
    determination: {
      patientRef: "imm-patient-001",
      forecast: [
        { ruleId: "rule.we-made-up", vaccine: "mystery", status: "due", contraindicated: false }
      ],
      dueCount: 1,
      overdueCount: 0,
      requiresClinicianOrder: true
    },
    demonstrates:
      "The Agent Fabric blocking a vaccine recommendation that cites no recorded ACIP schedule rule (policy.immunization.schedule-sourced)."
  },
  {
    id: "contraindication-block",
    label: "Contraindicated vaccine recommended → governance block",
    hint: "A forecast recommending a vaccine the patient is contraindicated for.",
    request: DEMO_IMMUNIZATION_REQUEST,
    determination: {
      patientRef: "imm-patient-001",
      forecast: [
        { ruleId: "rule.zoster-rzv", vaccine: "zoster", status: "overdue", contraindicated: true }
      ],
      dueCount: 0,
      overdueCount: 1,
      requiresClinicianOrder: true
    },
    demonstrates:
      "The Agent Fabric blocking a recommendation of a contraindicated vaccine (policy.immunization.contraindication-honored)."
  },
  {
    id: "autonomous-block",
    label: "Due vaccines, no clinician order → governance block",
    hint: "A determination that acts on due vaccines without a clinician order.",
    request: DEMO_IMMUNIZATION_REQUEST,
    determination: {
      patientRef: "imm-patient-001",
      forecast: [
        { ruleId: "rule.covid19", vaccine: "covid19", status: "due", contraindicated: false }
      ],
      dueCount: 1,
      overdueCount: 0,
      requiresClinicianOrder: false
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous administration — due / overdue vaccines that do not require a clinician order (policy.immunization.no-autonomous-administration)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type ImmunizationResolvedView = {
  kind: "resolved";
  patientRef: string;
  asOfDate: string;
  ageYears: number;
  forecast: ForecastEntry[];
  dueCount: number;
  overdueCount: number;
  contraindicatedCount: number;
  requiresClinicianOrder: boolean;
  reason: string;
  note: string;
  immunizationScheduleCited: boolean;
  immunizationContraindicationHonored: boolean;
  immunizationNoAutonomousAdministration: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ImmunizationBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ImmunizationInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ImmunizationView =
  | ImmunizationResolvedView
  | ImmunizationBlockedView
  | ImmunizationInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  immunizationScheduleCited?: unknown;
  immunizationContraindicationHonored?: unknown;
  immunizationNoAutonomousAdministration?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildBalanceBillingRequestBody.
 */
export function buildImmunizationRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ImmunizationRequest;
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
 * POST a patient (or an asserted determination) to the Immunization agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A
 * governance block comes back as HTTP 200 with a `failed` task — only a malformed envelope /
 * parse error is a non-OK response.
 */
export async function runImmunizationTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ImmunizationRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(IMMUNIZATION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildImmunizationRequestBody(input))
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
export function immunizationViewFromTask(task: A2ATask): ImmunizationView {
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
        "The Agent Fabric blocked this immunization run.";
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
        : "The immunization forecast could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: ImmunizationDetermination; patientRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    patientRef: result?.patientRef ?? det?.patientRef ?? "",
    asOfDate: det?.asOfDate ?? "",
    ageYears: det?.ageYears ?? 0,
    forecast: det?.forecast ?? [],
    dueCount: det?.dueCount ?? 0,
    overdueCount: det?.overdueCount ?? 0,
    contraindicatedCount: det?.contraindicatedCount ?? 0,
    requiresClinicianOrder: det?.requiresClinicianOrder ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    immunizationScheduleCited: fabric.immunizationScheduleCited === true,
    immunizationContraindicationHonored: fabric.immunizationContraindicationHonored === true,
    immunizationNoAutonomousAdministration:
      fabric.immunizationNoAutonomousAdministration === true,
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

const STATUS_TONE: Record<string, string> = {
  "up-to-date": "#8fd6b0",
  due: "#ffd28a",
  overdue: "#ffb6c8",
  contraindicated: "#ff9db1",
  "not-indicated": "#9aa4b2"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ImmunizationView }
  | { status: "error"; message: string };

export function ImmunizationPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ImmunizationPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runImmunizationTask({
          taskId: newTaskId("immunization"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: immunizationViewFromTask(task) });
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
        Immunization forecasting · ACIP schedule · clinical decision
      </p>
      <h3 style={{ margin: 0 }}>
        Immunization — schedule-sourced, contraindications honored, never an autonomous
        administration
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given a <strong>patient</strong> (birth date, immunization history, recorded
        contraindications) and an <strong>asOfDate</strong>, the Immunization agent{" "}
        <strong>deterministically</strong> forecasts each vaccine against an{" "}
        <strong>ACIP-style schedule</strong> — up-to-date / due / overdue / contraindicated /
        not-indicated — citing the governing rule and next-due date. A{" "}
        <strong>contraindicated vaccine is never recommended</strong>; a due / overdue vaccine
        is a recommendation requiring a <strong>clinician order</strong>, never autonomous
        administration.{" "}
        <strong>
          The schedule and intervals are illustrative synthetics, not a certified immunization
          forecaster — a real forecast uses the current ACIP recommendations and the CDC
          immunization schedules.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {IMMUNIZATION_PRESETS.map((preset) => (
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
              ? "Forecasting…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Immunization run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ImmunizationResult view={runState.view} />}
    </section>
  );
}

function ImmunizationResult({ view }: { view: ImmunizationView }) {
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
        Immunization forecast (deterministic, synthetic ACIP)
        {view.patientRef ? ` · patient ${view.patientRef}` : ""} · age {view.ageYears}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Due" value={String(view.dueCount)} tone="#ffd28a" />{" "}
        <Pill label="Overdue" value={String(view.overdueCount)} tone="#ffb6c8" />{" "}
        <Pill
          label="Contraindicated"
          value={String(view.contraindicatedCount)}
          tone="#ff9db1"
        />{" "}
        <Pill
          label="Requires clinician order"
          value={String(view.requiresClinicianOrder)}
          tone={view.requiresClinicianOrder ? "#ffd28a" : "#8fd6b0"}
        />
      </p>

      <ul style={{ margin: "0.7rem 0 0", paddingLeft: "1.1rem", fontSize: "0.86rem" }}>
        {view.forecast.map((f) => (
          <li key={f.ruleId} style={{ marginBottom: "0.2rem" }}>
            <strong style={{ color: "var(--fg)" }}>{f.label}</strong> —{" "}
            <span style={{ color: STATUS_TONE[f.status] ?? "var(--muted)", fontWeight: 600 }}>
              {f.status}
            </span>
            {f.nextDueDate ? (
              <span style={{ color: "var(--muted)" }}> · next due {f.nextDueDate}</span>
            ) : null}
          </li>
        ))}
      </ul>

      <div
        role="note"
        aria-label="Immunization integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Schedule-sourced · contraindications honored · never autonomous{" "}
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
          immunizationScheduleCited = {String(view.immunizationScheduleCited)} ·
          immunizationContraindicationHonored ={" "}
          {String(view.immunizationContraindicationHonored)} ·
          immunizationNoAutonomousAdministration ={" "}
          {String(view.immunizationNoAutonomousAdministration)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
