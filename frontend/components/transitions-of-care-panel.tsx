"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_AWAITING_SCHEDULE_PATIENT,
  DEMO_TOC_PATIENT,
  type FollowUpAppointment,
  type MedicationReconciliation,
  type PatientTransitionContext,
  type RedFlagWarning,
  type ReconciliationChangeProposal,
  type TeachBackItem,
  type TransitionOfCarePackage
} from "../lib/transitions-of-care";

/**
 * Discharge & Transitions of Care runner for the intake demo.
 *
 * Fires the real, server-side A2A TOC agent at
 * /api/agents/transitions-of-care/tasks — a care-coordination agent that
 * closes the loop back to primary care after a hospitalization / ED / obs
 * encounter. The panel surfaces the medication reconciliation (with change
 * kinds), the scheduled follow-up (or awaiting-schedule handoff), the
 * encounter-reason red-flag warning signs, the teach-back checklist, the
 * PCP handoff summary, the honesty signals, and a deep link into the
 * parented Agent Fabric trace.
 *
 * The verbal-source, autonomous-med-change, and fake-schedule
 * governance-block presets assert offending plans — so all three
 * governance blocks are demonstrable in the UI rather than hidden.
 */

const TOC_ROUTE = "/api/agents/transitions-of-care/tasks";

/** A one-click demo scenario. */
export type TransitionsOfCarePreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  patient?: PatientTransitionContext;
  assertedProposals?: Array<Record<string, unknown>>;
  assertedFollowUpPlan?: Record<string, unknown>;
};

export const TRANSITIONS_OF_CARE_PRESETS: TransitionsOfCarePreset[] = [
  {
    id: "cardiovascular-scheduled",
    label: "CV hospitalization → scheduled 7-day follow-up",
    hint: "Metoprolol dose changed, new anticoagulant, 7-day cardiology follow-up.",
    patient: DEMO_TOC_PATIENT,
    demonstrates:
      "The agent reconciling a discharge medication list (dose-changed Metoprolol + added Apixaban), pulling the cardiovascular red-flag list, emitting the teach-back checklist, and packaging a PCP handoff summary — every med traces to an approved source, every change requires clinician sign-off, and the follow-up is a real scheduled slot."
  },
  {
    id: "behavioral-awaiting-schedule",
    label: "Behavioral ED → awaiting-schedule handoff",
    hint: "New SSRI on discharge, no follow-up booked yet.",
    patient: DEMO_AWAITING_SCHEDULE_PATIENT,
    demonstrates:
      "The agent returning the SAFE awaiting-schedule state (not a text recommendation) when no follow-up slot is booked — a handoff to the Appointment Scheduling agent. The package is NOT marked complete until a real slot is scheduled."
  },
  {
    id: "verbal-source-block",
    label: "Verbal-only med → governance block",
    hint: "A discharge medication cited with an ad-hoc verbal source.",
    patient: {
      ...DEMO_TOC_PATIENT,
      dischargeMedications: [
        {
          medicationId: "med.metoprolol-25",
          label: "Metoprolol",
          dose: "50 mg PO BID",
          source: "verbal-not-documented"
        }
      ]
    },
    demonstrates:
      "The Agent Fabric blocking a reconciliation that includes a medication with a verbal / ad-hoc / undocumented source — the guard against a fabricated med slipping into the reconciliation (policy.toc.reconciliation-source-integrity)."
  },
  {
    id: "autonomous-med-change-block",
    label: "Autonomous med change → governance block",
    hint: "A proposal that would commit a dose change without clinician sign-off.",
    patient: DEMO_TOC_PATIENT,
    assertedProposals: [
      {
        medicationId: "med.metoprolol-25",
        changeKind: "dose-changed",
        rationale: "auto-commit",
        requiresClinicianSignoff: false,
        applied: true
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a medication change that bypasses clinician sign-off — the agent may only draft reconciliation notes, never autonomously commit a change (policy.toc.no-autonomous-medication-change)."
  },
  {
    id: "fake-schedule-block",
    label: "Fake 'scheduled' follow-up → governance block",
    hint: "A plan claiming scheduled:true with no real slot or provider.",
    patient: DEMO_TOC_PATIENT,
    assertedFollowUpPlan: {
      scheduled: true,
      awaitingSchedule: false
    },
    demonstrates:
      "The Agent Fabric blocking a follow-up marked scheduled/complete without a real slot — the load-bearing 30-day-readmission guard against 'recommended' follow-ups masquerading as complete (policy.toc.follow-up-scheduled-not-recommended)."
  }
];

/** Render-ready view of a produced package lifted from the task. */
export type TocReportedView = {
  kind: "reported";
  patientRef: string;
  dischargeDate: string;
  encounterKind: string;
  encounterReasonCategory: string;
  packageState: string;
  reconciliation: MedicationReconciliation;
  followUp: FollowUpAppointment;
  redFlagWarnings: RedFlagWarning[];
  teachBackChecklist: TeachBackItem[];
  pcpHandoffSummary: string;
  proposal: ReconciliationChangeProposal | null;
  note: string;
  medicationsTraceToApprovedSource: boolean;
  reconciliationChangeRequiresClinician: boolean;
  followUpScheduledNotRecommended: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type TocBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type TocInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type TransitionsOfCareView =
  | TocReportedView
  | TocBlockedView
  | TocInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  medicationsTraceToApprovedSource?: unknown;
  reconciliationChangeRequiresClinician?: unknown;
  followUpScheduledNotRecommended?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure
 * (no fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildTransitionsOfCareRequestBody(input: {
  taskId: string;
  personaId?: string;
  patient?: PatientTransitionContext;
  assertedProposals?: Array<Record<string, unknown>>;
  assertedFollowUpPlan?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (input.patient !== undefined) data.patient = input.patient;
  if (input.assertedProposals !== undefined) data.proposals = input.assertedProposals;
  if (input.assertedFollowUpPlan !== undefined) data.followUpPlan = input.assertedFollowUpPlan;
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
 * POST a patient (or an asserted plan) to the TOC agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the network
 * boundary.
 */
export async function runTransitionsOfCareTask(
  input: {
    taskId: string;
    personaId?: string;
    patient?: PatientTransitionContext;
    assertedProposals?: Array<Record<string, unknown>>;
    assertedFollowUpPlan?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(TOC_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildTransitionsOfCareRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * package (completed) from a governance block vs. an invalid request.
 */
export function transitionsOfCareViewFromTask(task: A2ATask): TransitionsOfCareView {
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
        "The Agent Fabric blocked this transitions-of-care run.";
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
        : "The transitions-of-care package could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { package?: TransitionOfCarePackage; proposal?: ReconciliationChangeProposal | null }
      | undefined) ?? undefined;
  const pkg = result?.package;

  return {
    kind: "reported",
    patientRef: pkg?.patientRef ?? "",
    dischargeDate: pkg?.dischargeDate ?? "",
    encounterKind: pkg?.encounterKind ?? "",
    encounterReasonCategory: pkg?.encounterReasonCategory ?? "",
    packageState: pkg?.state ?? "",
    reconciliation:
      pkg?.reconciliation ?? {
        lines: [],
        changes: 0,
        requiresClinicianSignoff: true,
        applied: false
      },
    followUp:
      pkg?.followUp ?? {
        scheduled: false,
        awaitingSchedule: true,
        body: ""
      },
    redFlagWarnings: pkg?.redFlagWarnings ?? [],
    teachBackChecklist: pkg?.teachBackChecklist ?? [],
    pcpHandoffSummary: pkg?.pcpHandoffSummary ?? "",
    proposal: result?.proposal ?? null,
    note: pkg?.note ?? "",
    medicationsTraceToApprovedSource: fabric.medicationsTraceToApprovedSource === true,
    reconciliationChangeRequiresClinician:
      fabric.reconciliationChangeRequiresClinician === true,
    followUpScheduledNotRecommended: fabric.followUpScheduledNotRecommended === true,
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

const CHANGE_TONE: Record<string, string> = {
  added: "#8fd6b0",
  removed: "#ffb6c8",
  "dose-changed": "#ffd28a",
  unchanged: "#9fb3c8"
};

const STATE_TONE: Record<string, string> = {
  "ready-for-clinician-signoff": "#8fd6b0",
  "awaiting-schedule": "#ffd28a"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: TransitionsOfCareView }
  | { status: "error"; message: string };

export function TransitionsOfCarePanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: TransitionsOfCarePreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runTransitionsOfCareTask({
          taskId: newTaskId("toc"),
          personaId: "demo",
          patient: preset.patient,
          assertedProposals: preset.assertedProposals,
          assertedFollowUpPlan: preset.assertedFollowUpPlan
        });
        setRunState({ status: "done", view: transitionsOfCareViewFromTask(task) });
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
        Discharge &amp; transitions of care
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that closes the loop back to primary care after a hospitalization
        — never a &ldquo;recommended&rdquo; follow-up, never an autonomous med change
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The TOC agent runs the close-the-loop workflow after a hospitalization /
        ED / observation encounter — it{" "}
        <strong>reconciles the discharge medication list</strong> (added,
        removed, dose-changed, unchanged),{" "}
        <strong>books the follow-up</strong> (or hands off to the Appointment
        Scheduling agent — never a text recommendation), pulls the{" "}
        <strong>encounter-reason red-flag warning signs</strong>, emits the{" "}
        <strong>teach-back checklist</strong>, and assembles the{" "}
        <strong>PCP handoff summary</strong>. Every medication must trace to an
        approved source, every medication change is{" "}
        <strong>clinician-signoff gated</strong> (no autonomous changes), and the
        follow-up is a <strong>scheduled slot</strong> or an explicit{" "}
        <strong>awaiting-schedule handoff</strong> — the load-bearing 30-day-
        readmission guard against &ldquo;recommended&rdquo; follow-ups
        masquerading as complete.{" "}
        <strong>
          The encounter categories, red-flag catalog, follow-up window,
          approved-source labels, and teach-back items are illustrative
          synthetics, not a certified TOC system.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {TRANSITIONS_OF_CARE_PRESETS.map((preset) => (
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
          Transitions-of-care run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && (
        <TransitionsOfCareResult view={runState.view} />
      )}
    </section>
  );
}

function TransitionsOfCareResult({ view }: { view: TransitionsOfCareView }) {
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

  const stateTone = STATE_TONE[view.packageState] ?? "#9fb3c8";

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Transitions-of-care package (deterministic, synthetic catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Patient" value={view.patientRef} tone="#9fb3c8" />{" "}
        <Pill label="Discharge" value={view.dischargeDate} tone="#9fb3c8" />{" "}
        <Pill label="Encounter" value={view.encounterKind} tone="#9fb3c8" />{" "}
        <Pill label="Reason" value={view.encounterReasonCategory} tone="#9fb3c8" />{" "}
        <Pill label="State" value={view.packageState} tone={stateTone} />
      </p>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Medication reconciliation (draft — clinician sign-off required)
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {view.reconciliation.lines.map((line) => (
          <li
            key={line.medicationId}
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
              <strong style={{ fontSize: "0.9rem" }}>{line.label}</strong>
              <Pill
                label="Change"
                value={line.changeKind}
                tone={CHANGE_TONE[line.changeKind] ?? "#9fb3c8"}
              />
            </div>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.78rem",
                color: "var(--muted)",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
              }}
            >
              preAdmit = {line.preAdmitDose ?? "—"} · discharge ={" "}
              {line.dischargeDose ?? "—"} · source = {line.source}
            </p>
          </li>
        ))}
      </ul>

      <div
        role="note"
        aria-label="Follow-up"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
          Follow-up ·{" "}
          <span style={{ color: stateTone }}>
            {view.followUp.scheduled ? "scheduled" : "awaiting-schedule"}
          </span>{" "}
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
        <p style={{ margin: "0.3rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
          {view.followUp.body}
        </p>
        {view.followUp.scheduled && (
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            slotStart = {view.followUp.slotStart} · provider ={" "}
            {view.followUp.providerLabel} · modality = {view.followUp.modality} ·
            daysFromDischarge = {view.followUp.daysFromDischarge}
          </p>
        )}
      </div>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem", color: "#ffd28a" }}>
        Red-flag warning signs (encounter-reason catalog)
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {view.redFlagWarnings.map((w) => (
          <li
            key={w.id}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "0.55rem",
              border: "1px solid var(--line)",
              background: "rgba(255,255,255,0.03)",
              marginBottom: "0.4rem"
            }}
          >
            <strong style={{ fontSize: "0.88rem" }}>{w.label}</strong>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.78rem",
                color: "var(--muted)"
              }}
            >
              {w.detail}
            </p>
          </li>
        ))}
      </ul>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Teach-back checklist
      </p>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--muted)", fontSize: "0.85rem" }}>
        {view.teachBackChecklist.map((t) => (
          <li key={t.id} style={{ marginBottom: "0.2rem" }}>
            <strong style={{ color: "var(--text)" }}>{t.label}</strong> — {t.detail}
          </li>
        ))}
      </ul>

      {view.proposal && (
        <div
          role="note"
          aria-label="Medication change proposal"
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Medication change proposal ·{" "}
            <span style={{ color: "#ffd28a" }}>{view.proposal.state}</span>
          </p>
          <p style={{ margin: "0.3rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
            {view.proposal.body}
          </p>
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            requiresClinicianSignoff ={" "}
            {String(view.proposal.requiresClinicianSignoff)} · applied ={" "}
            {String(view.proposal.applied)}
          </p>
        </div>
      )}

      <div
        role="note"
        aria-label="PCP handoff summary"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
          {view.pcpHandoffSummary}
        </p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          medicationsTraceToApprovedSource ={" "}
          {String(view.medicationsTraceToApprovedSource)} ·
          reconciliationChangeRequiresClinician ={" "}
          {String(view.reconciliationChangeRequiresClinician)} ·
          followUpScheduledNotRecommended ={" "}
          {String(view.followUpScheduledNotRecommended)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
