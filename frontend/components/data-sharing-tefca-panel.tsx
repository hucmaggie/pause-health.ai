"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_DS_NON_TPO_CONSENTED,
  DEMO_DS_NON_TPO_NO_CONSENT,
  DEMO_DS_PATIENT_ACCESS,
  DEMO_DS_TPO_TREATMENT,
  DEMO_DS_UNVERIFIED_PARTICIPANT,
  type DataSharingDecision,
  type DataSharingRequest
} from "../lib/data-sharing-tefca";

/**
 * Data-Sharing / TEFCA Interoperability runner for the intake demo.
 *
 * Fires the real, server-side A2A agent at
 * /api/agents/data-sharing-tefca/tasks — deterministic classification of
 * cross-org PHI exchanges (TEFCA QHIN, Carequality, CommonWell, Direct
 * Secure Messaging) with participant-identity verification and
 * consent-scope gating for non-TPO purposes.
 */

const DS_ROUTE = "/api/agents/data-sharing-tefca/tasks";

export type DataSharingTefcaPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  request?: DataSharingRequest;
  decisionOverride?: DataSharingDecision;
};

export const DATA_SHARING_TEFCA_PRESETS: DataSharingTefcaPreset[] = [
  {
    id: "release-tpo-treatment",
    label: "Release · TPO treatment over TEFCA QHIN",
    hint: "TPO treatment exchange — no consent required.",
    request: DEMO_DS_TPO_TREATMENT,
    demonstrates:
      "The agent auto-releasing PHI for a HIPAA §164.506 TPO purpose (treatment). All three honesty signals green."
  },
  {
    id: "release-non-tpo-consented",
    label: "Release · non-TPO research (consent on file)",
    hint: "Research over Carequality with an active research consent scope.",
    request: DEMO_DS_NON_TPO_CONSENTED,
    demonstrates:
      "Non-TPO research release with consent on file (DS-101) — the Consent agent's scope satisfies the invariant."
  },
  {
    id: "blocked-non-tpo-no-consent",
    label: "Blocked · non-TPO research (no consent)",
    hint: "Research request without a matching consent scope.",
    request: DEMO_DS_NON_TPO_NO_CONSENT,
    demonstrates:
      "Non-TPO release blocked (DS-200) — HIPAA §164.506 boundary; route to consent-capture."
  },
  {
    id: "blocked-unverified-participant",
    label: "Blocked · unverified requester participant",
    hint: "TPO request from a requester not on the participant registry.",
    request: DEMO_DS_UNVERIFIED_PARTICIPANT,
    demonstrates:
      "TEFCA / 45 CFR 171 requires an attested participant — routed to participant-registry-verification (DS-400)."
  },
  {
    id: "release-patient-access",
    label: "Release · patient right of access",
    hint: "Patient app requesting their own record via Direct Secure Messaging.",
    request: DEMO_DS_PATIENT_ACCESS,
    demonstrates:
      "HIPAA §164.524 patient right of access — released when consent scope is on file."
  },
  {
    id: "offcat-purpose-block",
    label: "Off-catalog purpose → governance block",
    hint: "Caller-asserted release cites a made-up purpose.",
    request: DEMO_DS_TPO_TREATMENT,
    decisionOverride: {
      requestRef: DEMO_DS_TPO_TREATMENT.requestRef,
      patientRef: DEMO_DS_TPO_TREATMENT.patientRef,
      requesterRef: DEMO_DS_TPO_TREATMENT.requesterRef,
      networkId: DEMO_DS_TPO_TREATMENT.networkId,
      networkLabel: "TEFCA",
      purposeId: "purpose.made-up",
      purposeLabel: "Fake",
      isTpo: true,
      asOfDate: DEMO_DS_TPO_TREATMENT.asOfDate,
      requesterIdentityVerified: true,
      consentedPurposeIds: [],
      decision: "release-authorized",
      appliedRules: [
        {
          ruleId: "rule.tpo-release-authorized",
          ruleLabel: "TPO",
          reasonCode: "reason.DS-100",
          reasonLabel: "TPO",
          detail: "override"
        }
      ],
      primaryReasonCode: "reason.DS-100",
      primaryReasonLabel: "TPO",
      routedTo: "auto-release",
      requiresPrivacyOfficerCosign: false,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a release that cites an off-catalog exchange purpose (policy.data-sharing.purpose-catalog-sourced)."
  },
  {
    id: "non-tpo-release-lie-block",
    label: "Non-TPO-release-lie → governance block",
    hint: "Caller claims release-authorized for research without consent.",
    request: DEMO_DS_NON_TPO_NO_CONSENT,
    decisionOverride: {
      requestRef: DEMO_DS_NON_TPO_NO_CONSENT.requestRef,
      patientRef: DEMO_DS_NON_TPO_NO_CONSENT.patientRef,
      requesterRef: DEMO_DS_NON_TPO_NO_CONSENT.requesterRef,
      networkId: DEMO_DS_NON_TPO_NO_CONSENT.networkId,
      networkLabel: "Carequality",
      purposeId: DEMO_DS_NON_TPO_NO_CONSENT.purposeId,
      purposeLabel: "Research",
      isTpo: false,
      asOfDate: DEMO_DS_NON_TPO_NO_CONSENT.asOfDate,
      requesterIdentityVerified: true,
      consentedPurposeIds: [],
      decision: "release-authorized",
      appliedRules: [
        {
          ruleId: "rule.non-tpo-consented-release",
          ruleLabel: "Ok",
          reasonCode: "reason.DS-101",
          reasonLabel: "Ok",
          detail: "override"
        }
      ],
      primaryReasonCode: "reason.DS-101",
      primaryReasonLabel: "Ok",
      routedTo: "auto-release",
      requiresPrivacyOfficerCosign: false,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a non-TPO release without consent (policy.data-sharing.no-autonomous-non-tpo-release) — HIPAA §164.506 boundary."
  },
  {
    id: "unverified-participant-lie-block",
    label: "Unverified-participant-lie → governance block",
    hint: "Caller claims release-authorized with unverified requester.",
    request: DEMO_DS_TPO_TREATMENT,
    decisionOverride: {
      requestRef: DEMO_DS_TPO_TREATMENT.requestRef,
      patientRef: DEMO_DS_TPO_TREATMENT.patientRef,
      requesterRef: DEMO_DS_TPO_TREATMENT.requesterRef,
      networkId: DEMO_DS_TPO_TREATMENT.networkId,
      networkLabel: "TEFCA",
      purposeId: DEMO_DS_TPO_TREATMENT.purposeId,
      purposeLabel: "Treatment",
      isTpo: true,
      asOfDate: DEMO_DS_TPO_TREATMENT.asOfDate,
      requesterIdentityVerified: false,
      consentedPurposeIds: [],
      decision: "release-authorized",
      appliedRules: [
        {
          ruleId: "rule.tpo-release-authorized",
          ruleLabel: "TPO",
          reasonCode: "reason.DS-100",
          reasonLabel: "TPO",
          detail: "override"
        }
      ],
      primaryReasonCode: "reason.DS-100",
      primaryReasonLabel: "TPO",
      routedTo: "auto-release",
      requiresPrivacyOfficerCosign: false,
      cosigned: false,
      synthetic: true,
      note: "override"
    },
    demonstrates:
      "The Agent Fabric blocking a release to an unverified requester (policy.data-sharing.participant-verified) — TEFCA / 45 CFR 171."
  }
];

export type DataSharingTefcaReportedView = {
  kind: "reported";
  decision: DataSharingDecision;
  purposesTraceToCatalog: boolean;
  releaseHonorsNonTpoConsent: boolean;
  participantIdentityVerified: boolean;
  traceTaskId: string;
};

export type DataSharingTefcaBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

export type DataSharingTefcaInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type DataSharingTefcaView =
  | DataSharingTefcaReportedView
  | DataSharingTefcaBlockedView
  | DataSharingTefcaInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  purposesTraceToCatalog?: unknown;
  releaseHonorsNonTpoConsent?: unknown;
  participantIdentityVerified?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

export function buildDataSharingTefcaRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: DataSharingRequest;
  decisionOverride?: DataSharingDecision;
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

export async function runDataSharingTefcaTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: DataSharingRequest;
    decisionOverride?: DataSharingDecision;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(DS_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildDataSharingTefcaRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

export function dataSharingTefcaViewFromTask(task: A2ATask): DataSharingTefcaView {
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
        "The Agent Fabric blocked this data-sharing exchange.";
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
        : "The data-sharing decision could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { decision?: DataSharingDecision } | undefined) ?? undefined;
  const decision = result?.decision;
  if (!decision) {
    return {
      kind: "invalid",
      message: "The data-sharing decision could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    decision,
    purposesTraceToCatalog: fabric.purposesTraceToCatalog === true,
    releaseHonorsNonTpoConsent: fabric.releaseHonorsNonTpoConsent === true,
    participantIdentityVerified: fabric.participantIdentityVerified === true,
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
  "release-authorized": "#8fd6b0",
  "pend-purpose-verification": "#ffd28a",
  "blocked-non-catalog-purpose": "#ffb6c8",
  "blocked-participant-unverified": "#ffb6c8",
  "blocked-consent-required-non-tpo": "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: DataSharingTefcaView }
  | { status: "error"; message: string };

export function DataSharingTefcaPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: DataSharingTefcaPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runDataSharingTefcaTask({
          taskId: newTaskId("ds"),
          personaId: "demo",
          request: preset.request,
          decisionOverride: preset.decisionOverride
        });
        setRunState({
          status: "done",
          view: dataSharingTefcaViewFromTask(task)
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
        Data-Sharing / TEFCA Interoperability · HIPAA §164.506 + 45 CFR 171
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that classifies cross-org PHI exchanges (TEFCA / Carequality
        / CommonWell) — never releases non-TPO PHI without consent, never
        releases to an unverified participant
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The data-sharing agent handles cross-organization PHI exchanges over
        <strong> TEFCA QHIN / Carequality / CommonWell / Direct Secure
        Messaging</strong>. For each request it classifies the exchange
        purpose (treatment / payment / operations / patient-request /
        public-health / research), verifies the counterparty is a Trusted
        Exchange Framework participant, applies the patient's data-sharing
        consent scopes from the Consent agent, and classifies as{" "}
        <strong>release-authorized / pend-purpose-verification /
        blocked-non-catalog-purpose / blocked-participant-unverified /
        blocked-consent-required-non-tpo</strong>. The agent NEVER
        autonomously releases PHI for a non-TPO purpose without an active
        consent scope (HIPAA §164.506 boundary — TPO doesn't need consent,
        everything else does) and NEVER releases to an unverified counterparty
        (45 CFR 171 / TEFCA Common Agreement).{" "}
        <strong>
          The exchange-network catalog, exchange-purpose catalog, rules, and
          reason codes are illustrative synthetics, not an actual TEFCA QHIN
          implementation, the Carequality Interoperability Framework, or a
          certified ONC data-sharing gateway.
        </strong>{" "}
        Every run is governed by the Agent Fabric.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {DATA_SHARING_TEFCA_PRESETS.map((preset) => (
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
          Data-sharing decision failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <DataSharingTefcaResult view={runState.view} />}
    </section>
  );
}

function DataSharingTefcaResult({ view }: { view: DataSharingTefcaView }) {
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
        Data-sharing decision (deterministic, catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Network" value={d.networkLabel} tone="#9fb3c8" />{" "}
        <Pill label="Purpose" value={d.purposeLabel} tone="#9fb3c8" />{" "}
        <Pill label="TPO?" value={String(d.isTpo)} tone="#9fb3c8" />{" "}
        <Pill
          label="Decision"
          value={d.decision}
          tone={DECISION_TONE[d.decision] ?? "#9fb3c8"}
        />{" "}
        <Pill label="Reason" value={d.primaryReasonCode} tone="#9fb3c8" />{" "}
        <Pill label="Routed to" value={d.routedTo} tone="#9fb3c8" />
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
        Requester: {d.requesterRef} · Consent scopes on file:{" "}
        {d.consentedPurposeIds.length === 0 ? "none" : d.consentedPurposeIds.join(", ")} ·
        Requires cosign: {String(d.requiresPrivacyOfficerCosign)} · Cosigned:{" "}
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
        aria-label="Data-sharing note"
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
          purposesTraceToCatalog = {String(view.purposesTraceToCatalog)} ·
          releaseHonorsNonTpoConsent ={" "}
          {String(view.releaseHonorsNonTpoConsent)} ·
          participantIdentityVerified ={" "}
          {String(view.participantIdentityVerified)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
