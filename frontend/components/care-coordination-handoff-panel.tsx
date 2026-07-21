"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_HANDOFF_ACCEPTED,
  DEMO_HANDOFF_ED_TO_PCP,
  DEMO_HANDOFF_NO_CONSENT,
  DEMO_HANDOFF_SBAR_INCOMPLETE,
  DEMO_HANDOFF_UNCREDENTIALED,
  type HandoffDecision,
  type HandoffRequest
} from "../lib/care-coordination-handoff";

/**
 * Care Coordination Handoff runner for the intake demo.
 *
 * Fires the real, server-side A2A handoff agent at
 * /api/agents/care-coordination-handoff/tasks — deterministic Joint-
 * Commission-NPSG-2 SBAR handoff for any cross-setting patient transition,
 * with receiving-clinician credentialing + transfer-consent gates.
 */

const HO_ROUTE = "/api/agents/care-coordination-handoff/tasks";

export type CareCoordinationHandoffPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  request?: HandoffRequest;
  decisionOverride?: HandoffDecision;
};

export const CARE_COORDINATION_HANDOFF_PRESETS: CareCoordinationHandoffPreset[] = [
  {
    id: "handoff-accepted",
    label: "Handoff accepted · hospital → SNF, SBAR complete",
    hint: "Full SBAR, credentialed receiving clinician, consent on file.",
    request: DEMO_HANDOFF_ACCEPTED,
    demonstrates:
      "The agent accepting a clean handoff and routing to the receiving clinician's inbox for cosign. All three honesty signals green."
  },
  {
    id: "pend-sbar-incomplete",
    label: "Pend · SBAR missing sections",
    hint: "SNF → home with missing assessment + recommendation.",
    request: DEMO_HANDOFF_SBAR_INCOMPLETE,
    demonstrates:
      "Incomplete SBAR pends to sending-clinician-completion (HO-200) — Joint Commission NPSG-2 requires all four sections; the agent won't accept a partial handoff."
  },
  {
    id: "blocked-uncredentialed",
    label: "Blocked · receiving clinician expired",
    hint: "ED → PCP where PCP credentialing is expired.",
    request: DEMO_HANDOFF_UNCREDENTIALED,
    demonstrates:
      "Routing to an uncredentialed clinician is blocked (HO-300) — the ghost-network guard, mirroring the Provider Credentialing agent."
  },
  {
    id: "blocked-no-consent",
    label: "Blocked · home → hospice without transfer consent",
    hint: "Home → hospice transition needs consent; none on file.",
    request: DEMO_HANDOFF_NO_CONSENT,
    demonstrates:
      "Sharing PHI with hospice without transfer consent is blocked (HO-400) — a HIPAA disclosure guard; route to consent-capture."
  },
  {
    id: "handoff-ed-pcp",
    label: "Accepted · ED → PCP (no consent required)",
    hint: "ED → PCP handoff does not require transfer consent.",
    request: DEMO_HANDOFF_ED_TO_PCP,
    demonstrates:
      "Some transitions (ED → PCP) don't require transfer consent — the catalog knows which ones do."
  },
  {
    id: "sbar-completeness-block",
    label: "SBAR-lie → governance block",
    hint: "Caller claims handoff-accepted but declares a missing SBAR section.",
    request: DEMO_HANDOFF_ACCEPTED,
    decisionOverride: {
      requestRef: DEMO_HANDOFF_ACCEPTED.requestRef,
      patientRef: DEMO_HANDOFF_ACCEPTED.patientRef,
      transitionTypeId: DEMO_HANDOFF_ACCEPTED.transitionTypeId,
      transitionTypeLabel: "Hospital → SNF",
      receivingClinicianRef: DEMO_HANDOFF_ACCEPTED.receivingClinicianRef,
      receivingClinicianCredentialing: "current-unsanctioned",
      transferConsentOnFile: true,
      asOfDate: DEMO_HANDOFF_ACCEPTED.asOfDate,
      decision: "handoff-accepted",
      appliedRules: [],
      missingSbarSections: ["recommendation"],
      primaryReasonCode: "reason.HO-100",
      primaryReasonLabel: "Accepted",
      routedTo: "receiving-clinician-inbox",
      requiresReceivingClinicianCosign: true,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking an accepted-handoff claim that admits a missing SBAR section (policy.handoff.sbar-completeness) — Joint Commission NPSG-2."
  },
  {
    id: "uncredentialed-block",
    label: "Uncredentialed-lie → governance block",
    hint: "Caller claims handoff-accepted with expired credentialing.",
    request: DEMO_HANDOFF_ACCEPTED,
    decisionOverride: {
      requestRef: DEMO_HANDOFF_ACCEPTED.requestRef,
      patientRef: DEMO_HANDOFF_ACCEPTED.patientRef,
      transitionTypeId: DEMO_HANDOFF_ACCEPTED.transitionTypeId,
      transitionTypeLabel: "Hospital → SNF",
      receivingClinicianRef: DEMO_HANDOFF_ACCEPTED.receivingClinicianRef,
      receivingClinicianCredentialing: "expired",
      transferConsentOnFile: true,
      asOfDate: DEMO_HANDOFF_ACCEPTED.asOfDate,
      decision: "handoff-accepted",
      appliedRules: [],
      missingSbarSections: [],
      primaryReasonCode: "reason.HO-100",
      primaryReasonLabel: "Accepted",
      routedTo: "receiving-clinician-inbox",
      requiresReceivingClinicianCosign: true,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a claimed acceptance to an expired clinician (policy.handoff.receiving-clinician-credentialed) — Section 1557 / ghost-network guard."
  },
  {
    id: "no-consent-block",
    label: "No-consent-lie → governance block",
    hint: "Caller claims handoff-accepted for hospice transfer without consent.",
    request: DEMO_HANDOFF_NO_CONSENT,
    decisionOverride: {
      requestRef: DEMO_HANDOFF_NO_CONSENT.requestRef,
      patientRef: DEMO_HANDOFF_NO_CONSENT.patientRef,
      transitionTypeId: DEMO_HANDOFF_NO_CONSENT.transitionTypeId,
      transitionTypeLabel: "Home → Hospice",
      receivingClinicianRef: DEMO_HANDOFF_NO_CONSENT.receivingClinicianRef,
      receivingClinicianCredentialing: "current-unsanctioned",
      transferConsentOnFile: false,
      asOfDate: DEMO_HANDOFF_NO_CONSENT.asOfDate,
      decision: "handoff-accepted",
      appliedRules: [],
      missingSbarSections: [],
      primaryReasonCode: "reason.HO-100",
      primaryReasonLabel: "Accepted",
      routedTo: "receiving-clinician-inbox",
      requiresReceivingClinicianCosign: true,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a claimed acceptance for a hospice handoff without consent (policy.handoff.consent-on-file) — HIPAA disclosure guard."
  }
];

export type CareCoordinationHandoffReportedView = {
  kind: "reported";
  decision: HandoffDecision;
  sbarIsComplete: boolean;
  receivingClinicianIsCredentialed: boolean;
  handoffHasConsent: boolean;
  traceTaskId: string;
};

export type CareCoordinationHandoffBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

export type CareCoordinationHandoffInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type CareCoordinationHandoffView =
  | CareCoordinationHandoffReportedView
  | CareCoordinationHandoffBlockedView
  | CareCoordinationHandoffInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  sbarIsComplete?: unknown;
  receivingClinicianIsCredentialed?: unknown;
  handoffHasConsent?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

export function buildCareCoordinationHandoffRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: HandoffRequest;
  decisionOverride?: HandoffDecision;
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

export async function runCareCoordinationHandoffTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: HandoffRequest;
    decisionOverride?: HandoffDecision;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(HO_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCareCoordinationHandoffRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

export function careCoordinationHandoffViewFromTask(
  task: A2ATask
): CareCoordinationHandoffView {
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
        "The Agent Fabric blocked this handoff.";
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
        : "The handoff could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { decision?: HandoffDecision } | undefined) ?? undefined;
  const decision = result?.decision;
  if (!decision) {
    return {
      kind: "invalid",
      message: "The handoff decision could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    decision,
    sbarIsComplete: fabric.sbarIsComplete === true,
    receivingClinicianIsCredentialed: fabric.receivingClinicianIsCredentialed === true,
    handoffHasConsent: fabric.handoffHasConsent === true,
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
  "handoff-accepted": "#8fd6b0",
  "pend-sbar-incomplete": "#ffd28a",
  "blocked-clinician-not-credentialed": "#ffb6c8",
  "blocked-no-consent": "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: CareCoordinationHandoffView }
  | { status: "error"; message: string };

export function CareCoordinationHandoffPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: CareCoordinationHandoffPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runCareCoordinationHandoffTask({
          taskId: newTaskId("ho"),
          personaId: "demo",
          request: preset.request,
          decisionOverride: preset.decisionOverride
        });
        setRunState({
          status: "done",
          view: careCoordinationHandoffViewFromTask(task)
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
        Care Coordination Handoff · cross-setting SBAR (Joint Commission NPSG-2)
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that assembles the SBAR handoff for any cross-setting patient
        transition — never routes to an uncredentialed clinician, never
        discloses PHI without consent
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The handoff agent handles{" "}
        <strong>any cross-setting patient transition</strong> (hospital → SNF,
        SNF → home, home → hospice, ED → PCP, PCP → specialist, PCP →
        behavioral health). For each transition it assembles the{" "}
        <strong>Joint-Commission-NPSG-2 SBAR</strong> (situation, background,
        assessment, recommendation), verifies the{" "}
        <strong>receiving clinician's credentialing status</strong>, and
        confirms <strong>transfer consent</strong> for transitions that share
        PHI with a new setting. Distinct from Transitions of Care
        (post-discharge hospital→home + med reconciliation) and Referral
        Management (outbound specialist referral). The agent NEVER
        autonomously accepts on behalf of the receiving clinician; every
        accepted handoff is <strong>DRAFTED for the receiving clinician's
        cosign</strong>.{" "}
        <strong>
          The care-setting catalog, transition-type catalog, SBAR rule set,
          and reason codes are illustrative synthetics, not Epic Care
          Everywhere, Cerner CareAware, or a real health system's handoff
          protocol.
        </strong>{" "}
        Every run is governed by the Agent Fabric.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CARE_COORDINATION_HANDOFF_PRESETS.map((preset) => (
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
          Handoff failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && (
        <CareCoordinationHandoffResult view={runState.view} />
      )}
    </section>
  );
}

function CareCoordinationHandoffResult({
  view
}: {
  view: CareCoordinationHandoffView;
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

  const d = view.decision;

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Handoff decision (deterministic, catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Transition" value={d.transitionTypeLabel} tone="#9fb3c8" />{" "}
        <Pill
          label="Receiving cred."
          value={d.receivingClinicianCredentialing}
          tone="#9fb3c8"
        />{" "}
        <Pill
          label="Decision"
          value={d.decision}
          tone={DECISION_TONE[d.decision] ?? "#9fb3c8"}
        />{" "}
        <Pill label="Reason" value={d.primaryReasonCode} tone="#9fb3c8" />{" "}
        <Pill label="Routed to" value={d.routedTo} tone="#9fb3c8" />
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
        Missing SBAR sections: {d.missingSbarSections.length === 0 ? "none" : d.missingSbarSections.join(", ")} ·
        Requires cosign: {String(d.requiresReceivingClinicianCosign)} · Cosigned:{" "}
        {String(d.cosigned)}
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
        aria-label="Handoff note"
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
          sbarIsComplete = {String(view.sbarIsComplete)} ·
          receivingClinicianIsCredentialed ={" "}
          {String(view.receivingClinicianIsCredentialed)} · handoffHasConsent ={" "}
          {String(view.handoffHasConsent)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
