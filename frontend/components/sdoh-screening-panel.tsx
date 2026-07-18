"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import type {
  CommunityReferralDraft,
  SdohDomainResult,
  SdohScreener,
  SdohScreeningResponse
} from "../lib/sdoh";

/**
 * SDOH Screening runner for the intake demo.
 *
 * Fires the real, server-side A2A SDOH Screening agent at
 * /api/agents/sdoh-screening/tasks — the Salesforce "Agentforce for Health"
 * whole-person-care analog — which DETERMINISTICALLY screens the patient with
 * a validated, public-domain instrument (the CMS AHC-HRSN core-domain tool),
 * flags the positive social-need domains, escalates a positive
 * interpersonal-safety screen to a human social worker, and drafts
 * CONSENT-GATED community-resource referrals (211, food bank, housing/utility
 * assistance, a domestic-violence hotline) — never an autonomous enrollment.
 * The panel surfaces the positive domains, the safety escalation, the
 * human-approval-gated referral drafts, and a deep link into the parented
 * Agent Fabric trace.
 *
 * The consent-withheld preset trips policy.sdoh.consent-before-referral; the
 * non-allow-listed preset trips policy.sdoh.validated-screener-only. The panel
 * reports the failed state and which policy blocked it honestly.
 *
 * The community-resource catalog is ILLUSTRATIVE synthetic, NOT a live
 * directory of real programs. Structure, styling tokens (.card,
 * .btn/.btn-primary, .eyebrow, .agentforce-voice-help-link,
 * .routing-live-result), and tone mirror <CareGapPanel> and <AssessmentPanel>
 * so this reads as a native sibling on /demo/intake.
 */

const SDOH_ROUTE = "/api/agents/sdoh-screening/tasks";

/** A one-click demo scenario the panel POSTs to the SDOH agent. */
export type SdohPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  screener: SdohScreener | string;
  responses: SdohScreeningResponse["responses"];
  patientConsent: boolean;
};

/** An all-negative AHC-HRSN response set (safety items at their 1-min floor). */
const NEGATIVE: SdohScreeningResponse["responses"] = {
  housing: [0, 0],
  food: [0, 0],
  transportation: [0],
  utilities: [0],
  safety: [1, 1, 1, 1]
};

export const SDOH_PRESETS: SdohPreset[] = [
  {
    id: "food-transportation-consented",
    label: "Food + transportation → consented referrals",
    hint: "Food insecurity + a transportation barrier, patient consented.",
    screener: "ahc-hrsn",
    responses: { ...NEGATIVE, food: [1, 0], transportation: [1] },
    patientConsent: true,
    demonstrates:
      "Two positive social-need domains, each drafting a consent-gated, catalog-sourced community-resource referral (food bank + transportation assistance + the 211 helpline) — human-approval-gated, never an autonomous enrollment."
  },
  {
    id: "interpersonal-safety-escalation",
    label: "Interpersonal safety → human escalation",
    hint: "A positive HITS interpersonal-safety screen.",
    screener: "ahc-hrsn",
    responses: { ...NEGATIVE, safety: [4, 4, 4, 4] },
    patientConsent: true,
    demonstrates:
      "A positive interpersonal-safety screen escalated to a human social worker as a mandatory red flag (mirroring PHQ-9 item 9), with a confidential DV/safety referral handed to a human."
  },
  {
    id: "consent-withheld-block",
    label: "Consent withheld → governance block",
    hint: "Food insecurity but no patient consent for a referral.",
    screener: "ahc-hrsn",
    responses: { ...NEGATIVE, food: [2, 0] },
    patientConsent: false,
    demonstrates:
      "The Agent Fabric refusing to draft a community-resource referral without the patient's consent (policy.sdoh.consent-before-referral) — never an autonomous enrollment."
  },
  {
    id: "off-allowlist-block",
    label: "Non-allow-listed screener → governance block",
    hint: "A screener that isn't on the validated allow-list.",
    screener: "prapare",
    responses: {},
    patientConsent: true,
    demonstrates:
      "The Agent Fabric blocking a screener outside the validated allow-list (policy.sdoh.validated-screener-only)."
  }
];

/** Render-ready view of a completed SDOH screening lifted from the task. */
export type SdohScreenedView = {
  kind: "screened";
  domains: SdohDomainResult[];
  positiveDomains: string[];
  safetyEscalation: boolean;
  referrals: CommunityReferralDraft[];
  interpretation: string;
  nextAgent?: string;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked SDOH screening. */
export type SdohBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type SdohInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type SdohView = SdohScreenedView | SdohBlockedView | SdohInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  safetyEscalation?: unknown;
  nextAgent?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure
 * (no fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildCareGapRequestBody.
 */
export function buildSdohRequestBody(input: {
  taskId: string;
  personaId?: string;
  screener: SdohScreener | string;
  responses: SdohScreeningResponse["responses"];
  patientConsent: boolean;
}) {
  return {
    jsonrpc: "2.0" as const,
    id: input.taskId,
    method: "tasks/send" as const,
    params: {
      id: input.taskId,
      message: {
        role: "user" as const,
        parts: [
          {
            type: "data" as const,
            data: {
              screening: { screener: input.screener, responses: input.responses },
              patientConsent: input.patientConsent
            }
          }
        ]
      },
      metadata: { personaId: input.personaId ?? "demo" }
    }
  };
}

/**
 * POST a screening to the SDOH agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A
 * governance block comes back as HTTP 200 with a `failed` task — only a
 * malformed envelope / parse error is a non-OK response.
 */
export async function runSdohTask(
  input: {
    taskId: string;
    personaId?: string;
    screener: SdohScreener | string;
    responses: SdohScreeningResponse["responses"];
    patientConsent: boolean;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(SDOH_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSdohRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a completed
 * screening from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function sdohViewFromTask(task: A2ATask): SdohView {
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
        "The Agent Fabric blocked this SDOH screening.";
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
        : "The SDOH screening could not be scored.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result = (data.result ?? {}) as {
    domains?: SdohDomainResult[];
    positiveDomains?: string[];
    interpretation?: string;
  };
  const referrals = Array.isArray(data.referrals)
    ? (data.referrals as CommunityReferralDraft[])
    : [];

  return {
    kind: "screened",
    domains: Array.isArray(result.domains) ? result.domains : [],
    positiveDomains: Array.isArray(result.positiveDomains)
      ? result.positiveDomains
      : [],
    safetyEscalation: fabric.safetyEscalation === true,
    referrals,
    interpretation: typeof result.interpretation === "string" ? result.interpretation : "",
    nextAgent: typeof fabric.nextAgent === "string" ? fabric.nextAgent : undefined,
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
  | { status: "done"; view: SdohView }
  | { status: "error"; message: string };

export function SdohScreeningPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const run = async (preset: SdohPreset) => {
    setRunState({ status: "running", label: preset.label });
    try {
      const task = await runSdohTask({
        taskId: newTaskId("sdoh"),
        personaId: "demo",
        screener: preset.screener,
        responses: preset.responses,
        patientConsent: preset.patientConsent
      });
      setRunState({ status: "done", view: sdohViewFromTask(task) });
    } catch (err) {
      setRunState({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  };

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
        Whole-person care · social needs
      </p>
      <h3 style={{ margin: 0 }}>
        The SDOH agent that screens social needs and drafts referrals
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The SDOH Screening agent{" "}
        <strong>
          deterministically screens the patient with a validated instrument
        </strong>{" "}
        (the CMS AHC-HRSN core domains: housing, food, transportation, utilities,
        interpersonal safety), flags the positive social-need domains, escalates
        a positive interpersonal-safety screen to a human social worker, and
        drafts <strong>consent-gated</strong> community-resource referrals (211,
        food bank, housing/utility assistance, a domestic-violence hotline) —
        human-approval-gated, never an autonomous enrollment.{" "}
        <strong>
          The community-resource catalog is illustrative synthetic, not a live
          directory of real programs.
        </strong>{" "}
        SDOH is separate from clinical severity — it raises a care-coordination
        flag. Every run is governed by the Agent Fabric. Run a preset, then open
        the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {SDOH_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void run(preset)}
            title={`${preset.hint} ${preset.demonstrates}`}
            style={{ fontSize: "0.85rem" }}
          >
            {runState.status === "running" && runState.label === preset.label
              ? "Screening…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          SDOH screening failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <SdohResult view={runState.view} />}
    </section>
  );
}

function SdohResult({ view }: { view: SdohView }) {
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
        Screened social needs (validated instrument, deterministic)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <strong>{view.positiveDomains.length}</strong> positive social-need domain
        {view.positiveDomains.length === 1 ? "" : "s"} ·{" "}
        <strong>{view.referrals.length}</strong> community referral
        {view.referrals.length === 1 ? "" : "s"} drafted for human review, none
        sent.
      </p>

      {view.safetyEscalation && (
        <p
          role="alert"
          style={{
            margin: "0.5rem 0 0",
            padding: "0.5rem 0.7rem",
            borderRadius: "0.55rem",
            border: "1px solid #ffb6c8",
            color: "#ffb6c8",
            fontSize: "0.85rem",
            fontWeight: 600
          }}
        >
          Interpersonal-safety red flag — mandatory escalation to a human social
          worker.
        </p>
      )}

      <ul style={{ margin: "0.7rem 0 0", listStyle: "none", padding: 0 }}>
        {view.domains.map((domain) => (
          <li
            key={domain.id}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "0.55rem",
              border: "1px solid var(--line)",
              background: "rgba(255,255,255,0.03)",
              marginBottom: "0.4rem",
              display: "flex",
              justifyContent: "space-between",
              gap: "0.5rem",
              flexWrap: "wrap",
              alignItems: "baseline"
            }}
          >
            <div>
              <strong style={{ fontSize: "0.9rem" }}>{domain.label}</strong>
              <p
                style={{
                  margin: "0.2rem 0 0",
                  fontSize: "0.8rem",
                  color: "var(--muted)"
                }}
              >
                {domain.detail}
              </p>
            </div>
            <Pill
              label="Screen"
              value={domain.positive ? "positive" : "negative"}
              tone={domain.positive ? "#ffb6c8" : "#8fd6b0"}
            />
          </li>
        ))}
      </ul>

      {view.referrals.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
            Consent-gated community-resource referrals
          </p>
          <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
            {view.referrals.map((referral) => (
              <li
                key={referral.resourceId}
                style={{
                  padding: "0.6rem 0.75rem",
                  borderRadius: "0.55rem",
                  border: "1px solid var(--line)",
                  background: "rgba(255,255,255,0.03)",
                  marginBottom: "0.5rem"
                }}
              >
                <strong style={{ fontSize: "0.9rem" }}>{referral.resourceLabel}</strong>
                <p
                  style={{
                    margin: "0.3rem 0 0",
                    fontSize: "0.8rem",
                    color: "var(--text)",
                    fontStyle: "italic"
                  }}
                >
                  {referral.body}
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: "0.3rem",
                    flexWrap: "wrap",
                    marginTop: "0.35rem"
                  }}
                >
                  <Pill label="Hand-off" value={referral.handoffTo} tone="#8fd6b0" />
                  <Pill
                    label="Approval"
                    value={referral.requiresHumanApproval ? "human required" : "auto"}
                    tone="#ffd28a"
                  />
                  <Pill
                    label="Enrollment"
                    value={referral.autonomousEnrollment ? "autonomous" : "none"}
                    tone={referral.autonomousEnrollment ? "#ffb6c8" : "#8fd6b0"}
                  />
                  <Pill
                    label="Sent"
                    value={referral.sent ? "yes" : "no"}
                    tone={referral.sent ? "#ffb6c8" : "#8fd6b0"}
                  />
                  {referral.suppressedForNoConsent && (
                    <Pill label="Consent" value="suppressed" tone="#ffb6c8" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div
        role="note"
        aria-label="Screening provenance"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
          Screener &amp; referrals{" "}
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
          Screened with the validated CMS AHC-HRSN core-domain tool; every referral
          references a defined community-resource catalog id — illustrative
          synthetics, not a live directory of real programs.
        </p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          safetyEscalation = {String(view.safetyEscalation)}
          {view.nextAgent ? ` · nextAgent = ${view.nextAgent}` : ""}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
