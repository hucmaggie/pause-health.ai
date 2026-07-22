"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_AE_DEATH_LIFE_THREATENING,
  DEMO_AE_MEDWATCH_DRUG,
  DEMO_AE_NON_SERIOUS,
  DEMO_AE_UNVERIFIED_REPORTER,
  DEMO_AE_VAERS_VACCINE,
  type AdverseEventDecision,
  type AdverseEventRequest
} from "../lib/adverse-event-reporting";

/**
 * Adverse Event Reporting runner for the intake demo.
 *
 * Fires the real, server-side A2A adverse-event agent at
 * /api/agents/adverse-event-reporting/tasks — deterministic
 * pharmacovigilance / device-safety classification into MedWatch or VAERS
 * drafts, with regulatory-team cosign for every FDA submission.
 */

const AE_ROUTE = "/api/agents/adverse-event-reporting/tasks";

export type AdverseEventReportingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  request?: AdverseEventRequest;
  decisionOverride?: AdverseEventDecision;
};

export const ADVERSE_EVENT_REPORTING_PRESETS: AdverseEventReportingPreset[] = [
  {
    id: "medwatch-serious-drug",
    label: "MedWatch draft · serious drug ADR (hospitalization)",
    hint: "Clinician-reported drug ADR requiring hospitalization.",
    request: DEMO_AE_MEDWATCH_DRUG,
    demonstrates:
      "The agent drafting a MedWatch (3500A) form for a serious drug ADR — routes to regulatory-team queue for cosign. All three honesty signals green."
  },
  {
    id: "vaers-vaccine",
    label: "VAERS draft · vaccine reaction",
    hint: "Clinician-reported vaccine reaction, medically important.",
    request: DEMO_AE_VAERS_VACCINE,
    demonstrates:
      "The agent drafting a VAERS report for a vaccine reaction (AE-101) — routes to regulatory-team VAERS queue for cosign."
  },
  {
    id: "medwatch-life-threatening",
    label: "MedWatch draft · life-threatening drug ADR",
    hint: "Clinician-reported life-threatening drug reaction.",
    request: DEMO_AE_DEATH_LIFE_THREATENING,
    demonstrates:
      "The seriousness tier computes to life-threatening (highest above serious) — MedWatch draft routed to regulatory-team queue for cosign."
  },
  {
    id: "medwatch-non-serious",
    label: "MedWatch draft · non-serious voluntary report",
    hint: "Patient-reported non-serious drug side effect.",
    request: DEMO_AE_NON_SERIOUS,
    demonstrates:
      "Even non-serious voluntary 3500 reports are drafted (not filed) — the agent never autonomously files."
  },
  {
    id: "blocked-unverified-reporter",
    label: "Blocked · reporter identity unverified",
    hint: "Anonymous consumer report — no attested reporter.",
    request: DEMO_AE_UNVERIFIED_REPORTER,
    demonstrates:
      "Blocked at first pass (AE-400) — FDA reporting requires an attested reporter; anonymous reports poison the surveillance signal."
  },
  {
    id: "offcat-event-block",
    label: "Off-catalog event → governance block",
    hint: "Caller-asserted draft cites a made-up event type.",
    request: DEMO_AE_MEDWATCH_DRUG,
    decisionOverride: {
      requestRef: DEMO_AE_MEDWATCH_DRUG.requestRef,
      patientRef: DEMO_AE_MEDWATCH_DRUG.patientRef,
      eventTypeId: "event.made-up",
      eventTypeLabel: "Fake",
      seriousnessTierId: "seriousness.serious",
      seriousnessTierLabel: "Serious",
      onsetDate: DEMO_AE_MEDWATCH_DRUG.onsetDate,
      reportedDate: DEMO_AE_MEDWATCH_DRUG.reportedDate,
      asOfDate: DEMO_AE_MEDWATCH_DRUG.asOfDate,
      reporterType: "clinician",
      reporterIdentityVerified: true,
      decision: "draft-medwatch",
      appliedRules: [
        {
          ruleId: "rule.medwatch-eligible",
          ruleLabel: "Ok",
          reasonCode: "reason.AE-100",
          reasonLabel: "Ok",
          detail: "override"
        }
      ],
      primaryReasonCode: "reason.AE-100",
      primaryReasonLabel: "Ok",
      routedTo: "regulatory-team-medwatch-queue",
      requiresRegulatoryTeamCosign: true,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a draft that cites an off-catalog event type (policy.adverse-event.event-catalog-sourced) — no bespoke events."
  },
  {
    id: "autonomous-cosign-block",
    label: "Autonomous cosign → governance block",
    hint: "Caller-asserted draft claims cosigned:true.",
    request: DEMO_AE_MEDWATCH_DRUG,
    decisionOverride: {
      requestRef: DEMO_AE_MEDWATCH_DRUG.requestRef,
      patientRef: DEMO_AE_MEDWATCH_DRUG.patientRef,
      eventTypeId: DEMO_AE_MEDWATCH_DRUG.eventTypeId,
      eventTypeLabel: "Drug ADR",
      seriousnessTierId: "seriousness.serious",
      seriousnessTierLabel: "Serious",
      onsetDate: DEMO_AE_MEDWATCH_DRUG.onsetDate,
      reportedDate: DEMO_AE_MEDWATCH_DRUG.reportedDate,
      asOfDate: DEMO_AE_MEDWATCH_DRUG.asOfDate,
      reporterType: "clinician",
      reporterIdentityVerified: true,
      decision: "draft-medwatch",
      appliedRules: [
        {
          ruleId: "rule.medwatch-eligible",
          ruleLabel: "Ok",
          reasonCode: "reason.AE-100",
          reasonLabel: "Ok",
          detail: "override"
        }
      ],
      primaryReasonCode: "reason.AE-100",
      primaryReasonLabel: "Ok",
      routedTo: "regulatory-team-medwatch-queue",
      requiresRegulatoryTeamCosign: false,
      cosigned: true as unknown as false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-cosigned FDA submission (policy.adverse-event.no-autonomous-submission) — 21 CFR 314.80 requires regulatory-team cosign."
  },
  {
    id: "unverified-reporter-block",
    label: "Unverified-reporter-lie → governance block",
    hint: "Caller claims draft-medwatch with unverified reporter.",
    request: DEMO_AE_MEDWATCH_DRUG,
    decisionOverride: {
      requestRef: DEMO_AE_MEDWATCH_DRUG.requestRef,
      patientRef: DEMO_AE_MEDWATCH_DRUG.patientRef,
      eventTypeId: DEMO_AE_MEDWATCH_DRUG.eventTypeId,
      eventTypeLabel: "Drug ADR",
      seriousnessTierId: "seriousness.serious",
      seriousnessTierLabel: "Serious",
      onsetDate: DEMO_AE_MEDWATCH_DRUG.onsetDate,
      reportedDate: DEMO_AE_MEDWATCH_DRUG.reportedDate,
      asOfDate: DEMO_AE_MEDWATCH_DRUG.asOfDate,
      reporterType: "consumer",
      reporterIdentityVerified: false,
      decision: "draft-medwatch",
      appliedRules: [
        {
          ruleId: "rule.medwatch-eligible",
          ruleLabel: "Ok",
          reasonCode: "reason.AE-100",
          reasonLabel: "Ok",
          detail: "override"
        }
      ],
      primaryReasonCode: "reason.AE-100",
      primaryReasonLabel: "Ok",
      routedTo: "regulatory-team-medwatch-queue",
      requiresRegulatoryTeamCosign: true,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a draft that admits an unverified reporter (policy.adverse-event.reporter-verified) — anonymous reports are not admissible."
  }
];

export type AdverseEventReportingReportedView = {
  kind: "reported";
  decision: AdverseEventDecision;
  eventsTraceToCatalog: boolean;
  submissionRequiresRegulatoryTeamCosign: boolean;
  reporterIdentityVerified: boolean;
  traceTaskId: string;
};

export type AdverseEventReportingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

export type AdverseEventReportingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type AdverseEventReportingView =
  | AdverseEventReportingReportedView
  | AdverseEventReportingBlockedView
  | AdverseEventReportingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  eventsTraceToCatalog?: unknown;
  submissionRequiresRegulatoryTeamCosign?: unknown;
  reporterIdentityVerified?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

export function buildAdverseEventReportingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: AdverseEventRequest;
  decisionOverride?: AdverseEventDecision;
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

export async function runAdverseEventReportingTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: AdverseEventRequest;
    decisionOverride?: AdverseEventDecision;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(AE_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAdverseEventReportingRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

export function adverseEventReportingViewFromTask(
  task: A2ATask
): AdverseEventReportingView {
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
        "The Agent Fabric blocked this adverse-event report.";
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
        : "The adverse-event report could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { decision?: AdverseEventDecision } | undefined) ?? undefined;
  const decision = result?.decision;
  if (!decision) {
    return {
      kind: "invalid",
      message: "The adverse-event decision could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    decision,
    eventsTraceToCatalog: fabric.eventsTraceToCatalog === true,
    submissionRequiresRegulatoryTeamCosign:
      fabric.submissionRequiresRegulatoryTeamCosign === true,
    reporterIdentityVerified: fabric.reporterIdentityVerified === true,
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
  "draft-medwatch": "#8fd6b0",
  "draft-vaers": "#8fd6b0",
  "blocked-non-catalog-event": "#ffb6c8",
  "blocked-reporter-unverified": "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: AdverseEventReportingView }
  | { status: "error"; message: string };

export function AdverseEventReportingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: AdverseEventReportingPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runAdverseEventReportingTask({
          taskId: newTaskId("ae"),
          personaId: "demo",
          request: preset.request,
          decisionOverride: preset.decisionOverride
        });
        setRunState({
          status: "done",
          view: adverseEventReportingViewFromTask(task)
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
        Adverse Event Reporting · FDA MedWatch / VAERS analog
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that classifies drug ADRs / vaccine reactions / device
        malfunctions and drafts MedWatch or VAERS — never autonomously files to
        the FDA
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The adverse-event agent runs a{" "}
        <strong>pharmacovigilance / device-safety reporting pipeline</strong>.
        For each reported event (drug ADR, vaccine reaction, device
        malfunction, medication error, therapeutic failure) it computes the{" "}
        <strong>21-CFR-314.80 seriousness tier</strong> (non-serious / serious
        / life-threatening / death) from caller-provided outcome flags,
        verifies reporter identity attestation, and classifies as{" "}
        <strong>draft-medwatch (3500 / 3500A) / draft-vaers /
        blocked-non-catalog-event / blocked-reporter-unverified</strong>. All
        drafts route to a <strong>regulatory-team queue for cosign</strong>.
        The agent NEVER autonomously files to the FDA (21 CFR 314.80 mandatory
        reporting has sponsor / manufacturer / clinician liability), and NEVER
        drafts on an unverified reporter (FDA reporting requires an attested
        reporter).{" "}
        <strong>
          The event-type catalog, seriousness tiers, rules, and reason codes
          are illustrative synthetics, not FDA MedWatch, VAERS, EudraVigilance,
          or a real sponsor's pharmacovigilance database.
        </strong>{" "}
        Every run is governed by the Agent Fabric.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {ADVERSE_EVENT_REPORTING_PRESETS.map((preset) => (
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
          Adverse-event report failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <AdverseEventReportingResult view={runState.view} />}
    </section>
  );
}

function AdverseEventReportingResult({ view }: { view: AdverseEventReportingView }) {
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
        Adverse-event decision (deterministic, catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Event" value={d.eventTypeLabel} tone="#9fb3c8" />{" "}
        <Pill label="Seriousness" value={d.seriousnessTierLabel} tone="#9fb3c8" />{" "}
        <Pill
          label="Decision"
          value={d.decision}
          tone={DECISION_TONE[d.decision] ?? "#9fb3c8"}
        />{" "}
        <Pill label="Reason" value={d.primaryReasonCode} tone="#9fb3c8" />{" "}
        <Pill label="Routed to" value={d.routedTo} tone="#9fb3c8" />
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
        Reporter: {d.reporterType} · Requires cosign:{" "}
        {String(d.requiresRegulatoryTeamCosign)} · Cosigned: {String(d.cosigned)}
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
        aria-label="Adverse-event note"
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
          eventsTraceToCatalog = {String(view.eventsTraceToCatalog)} ·
          submissionRequiresRegulatoryTeamCosign ={" "}
          {String(view.submissionRequiresRegulatoryTeamCosign)} ·
          reporterIdentityVerified ={" "}
          {String(view.reporterIdentityVerified)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
