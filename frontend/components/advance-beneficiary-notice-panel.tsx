"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type AbnDetermination,
  type AbnDisposition,
  type AbnModifier,
  type AbnServiceRequest,
  type CoverageAssessment,
  DEMO_ABN_EXCLUDED_REQUEST,
  DEMO_ABN_NONCOVERED_REQUEST,
  DEMO_ABN_REQUEST,
  DEMO_ABN_WITH_ABN_REQUEST
} from "../lib/advance-beneficiary-notice";

/**
 * Advance Beneficiary Notice (Medicare ABN) runner for the intake demo.
 *
 * Fires the real, server-side A2A ABN agent at /api/agents/advance-beneficiary-notice/tasks — the
 * patient-access service that decides whether a signed pre-service ABN is required before a
 * likely-denied Medicare service and whether the beneficiary may be billed. The panel surfaces the
 * coverage assessment, the ABN-required flag, the valid-ABN flag, the CMS liability modifier, the
 * disposition, the honesty signals, the synthetic labels, and a deep link into the parented Agent
 * Fabric trace.
 *
 * A determination — covered OR non-covered OR excluded — is a SAFE, honest OUTPUT (it completes; a
 * non-covered / excluded determination carries requiresHumanReview:true). The un-sourced-rule,
 * missing-ABN-requirement, and auto-liability presets assert offending DETERMINATIONS — so all
 * three governance blocks are demonstrable in the UI rather than hidden.
 *
 * The coverage rules + modifier logic are ILLUSTRATIVE, NOT a certified Medicare coverage engine
 * (real ABN decisions are governed by the Medicare NCD/LCD, the Social Security Act §1862(a), and
 * Form CMS-R-131). Structure, styling tokens, and tone mirror <TimelyFilingPanel> and
 * <GoodFaithEstimatePanel> so this reads as a native sibling on /demo/intake.
 */

const ABN_ROUTE = "/api/agents/advance-beneficiary-notice/tasks";

/** A one-click demo scenario. */
export type AbnPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The proposed service the agent evaluates (the common case). */
  request?: AbnServiceRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const ABN_PRESETS: AbnPreset[] = [
  {
    id: "covered",
    label: "Meets criteria → covered, no ABN",
    hint: "A vitamin-D lab that meets its coverage criteria.",
    request: DEMO_ABN_REQUEST,
    demonstrates:
      "Likely covered → no ABN required; proceed and bill Medicare, no patient liability."
  },
  {
    id: "noncovered",
    label: "Fails criteria, no ABN → issue ABN",
    hint: "A vitamin-D lab that fails its coverage criteria with no ABN on file.",
    request: DEMO_ABN_NONCOVERED_REQUEST,
    demonstrates:
      "Likely non-covered with no valid ABN → issue an ABN before the service; provider liable (GZ), beneficiary not billed; human review."
  },
  {
    id: "with-abn",
    label: "Fails criteria, valid ABN → bill beneficiary",
    hint: "A DEXA past its 24-month frequency limit with a valid pre-service ABN.",
    request: DEMO_ABN_WITH_ABN_REQUEST,
    demonstrates:
      "Likely non-covered with a valid pre-service ABN → beneficiary may be billed (GA); human review."
  },
  {
    id: "excluded",
    label: "Statutorily excluded → GY",
    hint: "A cosmetic procedure Medicare statutorily excludes.",
    request: DEMO_ABN_EXCLUDED_REQUEST,
    demonstrates:
      "Statutorily excluded → beneficiary liable (GY), voluntary ABN recommended; human review."
  },
  {
    id: "unsourced-rule-block",
    label: "Un-sourced coverage rule → governance block",
    hint: "A determination citing a made-up coverage rule id.",
    request: DEMO_ABN_REQUEST,
    determination: {
      requestRef: "abn-req-001",
      coverageRuleId: "rule.abn.we-made-up",
      serviceType: "Vitamin D screening lab",
      coverageCategory: "reasonable-necessary",
      coverageAssessment: "likely-covered",
      abnRequired: false,
      abnIssued: false,
      abnValid: false,
      patientMayBeBilled: false,
      modifier: "none",
      disposition: "proceed-covered",
      requiresHumanReview: false,
      autoAssignedLiability: false
    },
    demonstrates:
      "The Agent Fabric blocking a coverage decision with no recorded Medicare coverage rule (policy.abn.coverage-rule-sourced)."
  },
  {
    id: "missing-abn-requirement-block",
    label: "Non-covered, no ABN required → governance block",
    hint: "A determination that a likely-denied service needs no ABN.",
    request: DEMO_ABN_NONCOVERED_REQUEST,
    determination: {
      requestRef: "abn-req-002",
      coverageRuleId: "rule.abn.vitamin-d-testing",
      serviceType: "Vitamin D screening lab",
      coverageCategory: "reasonable-necessary",
      coverageAssessment: "likely-non-covered",
      // Wrong: a likely-non-covered service MUST require a pre-service ABN.
      abnRequired: false,
      abnIssued: false,
      abnValid: false,
      patientMayBeBilled: false,
      modifier: "GZ",
      disposition: "issue-abn-before-service",
      requiresHumanReview: true,
      autoAssignedLiability: false
    },
    demonstrates:
      "The Agent Fabric blocking a likely-non-covered service marked as needing no ABN (policy.abn.abn-required-when-noncovered)."
  },
  {
    id: "auto-liability-block",
    label: "Billed with no valid ABN → governance block",
    hint: "A determination that bills the beneficiary for a non-covered service with no ABN.",
    request: DEMO_ABN_NONCOVERED_REQUEST,
    determination: {
      requestRef: "abn-req-002",
      coverageRuleId: "rule.abn.vitamin-d-testing",
      serviceType: "Vitamin D screening lab",
      coverageCategory: "reasonable-necessary",
      coverageAssessment: "likely-non-covered",
      abnRequired: true,
      abnIssued: false,
      abnValid: false,
      // Wrong: billing the beneficiary for a non-covered service with no valid ABN.
      patientMayBeBilled: true,
      modifier: "GA",
      disposition: "bill-beneficiary-with-abn",
      requiresHumanReview: false,
      autoAssignedLiability: true
    },
    demonstrates:
      "The Agent Fabric blocking a beneficiary billed with no valid pre-service ABN / an auto-assigned liability (policy.abn.no-autonomous-beneficiary-liability)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type AbnResolvedView = {
  kind: "resolved";
  requestRef: string;
  coverageRuleId: string;
  serviceType: string;
  coverageAssessment: CoverageAssessment;
  abnRequired: boolean;
  abnValid: boolean;
  patientMayBeBilled: boolean;
  modifier: AbnModifier;
  disposition: AbnDisposition;
  requiresHumanReview: boolean;
  reason: string;
  note: string;
  abnCoverageRuleSourced: boolean;
  abnRequiredWhenNoncovered: boolean;
  abnNoAutonomousBeneficiaryLiability: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type AbnBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type AbnInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type AbnView = AbnResolvedView | AbnBlockedView | AbnInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  abnCoverageRuleSourced?: unknown;
  abnRequiredWhenNoncovered?: unknown;
  abnNoAutonomousBeneficiaryLiability?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildTimelyFilingRequestBody.
 */
export function buildAbnRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: AbnServiceRequest;
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
 * POST a proposed service (or an asserted determination) to the ABN agent and return the resulting
 * A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A governance block
 * comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse error is a
 * non-OK response.
 */
export async function runAbnTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: AbnServiceRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(ABN_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAbnRequestBody(input))
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
export function abnViewFromTask(task: A2ATask): AbnView {
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
        "The Agent Fabric blocked this ABN run.";
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
        : "The ABN determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: AbnDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    coverageRuleId: det?.coverageRuleId ?? "",
    serviceType: det?.serviceType ?? "",
    coverageAssessment: det?.coverageAssessment ?? "likely-non-covered",
    abnRequired: det?.abnRequired ?? false,
    abnValid: det?.abnValid ?? false,
    patientMayBeBilled: det?.patientMayBeBilled ?? false,
    modifier: det?.modifier ?? "none",
    disposition: det?.disposition ?? "issue-abn-before-service",
    requiresHumanReview: det?.requiresHumanReview ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    abnCoverageRuleSourced: fabric.abnCoverageRuleSourced === true,
    abnRequiredWhenNoncovered: fabric.abnRequiredWhenNoncovered === true,
    abnNoAutonomousBeneficiaryLiability: fabric.abnNoAutonomousBeneficiaryLiability === true,
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
  | { status: "done"; view: AbnView }
  | { status: "error"; message: string };

export function AdvanceBeneficiaryNoticePanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: AbnPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runAbnTask({
          taskId: newTaskId("advance-beneficiary-notice"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: abnViewFromTask(task) });
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
        Advance beneficiary notice · Medicare ABN · patient access
      </p>
      <h3 style={{ margin: 0 }}>
        Medicare ABN — a sourced coverage call, never an autonomous patient bill
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given a <strong>proposed service</strong> (the cited Medicare <strong>coverage rule</strong>,
        whether it meets its coverage criteria or exceeds a frequency limit, and whether an{" "}
        <strong>ABN</strong> was issued and signed <strong>before</strong> the service), this agent{" "}
        <strong>deterministically</strong> assesses coverage, decides whether a signed pre-service
        ABN (Form CMS-R-131) is <strong>required</strong>, assigns the CMS liability{" "}
        <strong>modifier</strong> (GA / GZ / GY), and decides the <strong>disposition</strong>. A
        non-covered service is a <strong>recommendation requiring human review</strong> — patient
        liability is <strong>never</strong> assigned autonomously.{" "}
        <strong>
          The coverage rules and modifier logic are illustrative, not a certified Medicare coverage
          engine — real ABN decisions come from the Medicare NCD/LCD, the Social Security Act
          §1862(a), and Form CMS-R-131.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {ABN_PRESETS.map((preset) => (
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
              ? "Checking…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          ABN run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <AbnResult view={runState.view} />}
    </section>
  );
}

function AbnResult({ view }: { view: AbnView }) {
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

  const assessmentTone =
    view.coverageAssessment === "likely-covered"
      ? "#8fd6b0"
      : view.coverageAssessment === "statutorily-excluded"
        ? "#ff9db1"
        : "#ffd28a";

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Medicare ABN (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""} · {view.serviceType || "—"}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Coverage" value={view.coverageAssessment} tone={assessmentTone} />{" "}
        <Pill
          label="ABN required"
          value={String(view.abnRequired)}
          tone={view.abnRequired ? "#ffd28a" : "#8fd6b0"}
        />{" "}
        <Pill
          label="Valid ABN"
          value={String(view.abnValid)}
          tone={view.abnValid ? "#8fd6b0" : "#9db8ff"}
        />{" "}
        <Pill label="Modifier" value={view.modifier} tone="#9db8ff" />{" "}
        <Pill
          label="Patient billable"
          value={String(view.patientMayBeBilled)}
          tone={view.patientMayBeBilled ? "#ffd28a" : "#8fd6b0"}
        />{" "}
        <Pill
          label="Requires human review"
          value={String(view.requiresHumanReview)}
          tone={view.requiresHumanReview ? "#ffd28a" : "#8fd6b0"}
        />
      </p>

      <p style={{ margin: "0.6rem 0 0", fontSize: "0.86rem", color: "var(--muted)" }}>
        {view.coverageRuleId || "—"} · disposition {view.disposition}
      </p>

      <div
        role="note"
        aria-label="Medicare ABN compliance"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Coverage-rule sourced · ABN required when non-covered · never an autonomous patient bill{" "}
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
          abnCoverageRuleSourced = {String(view.abnCoverageRuleSourced)} ·
          abnRequiredWhenNoncovered = {String(view.abnRequiredWhenNoncovered)} ·
          abnNoAutonomousBeneficiaryLiability = {String(view.abnNoAutonomousBeneficiaryLiability)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
