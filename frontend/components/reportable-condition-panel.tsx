"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type ClassificationResult,
  type ReportableCaseDetermination,
  type ReportableCaseRequest,
  DEMO_CASE_DEFINITION,
  DEMO_REPORTABLE_CASE_NEGATIVE_REQUEST,
  DEMO_REPORTABLE_CASE_PROBABLE_REQUEST,
  DEMO_REPORTABLE_CASE_REQUEST,
  referencedFactsOf
} from "../lib/reportable-condition";

/**
 * Reportable / Notifiable Condition Case Classification runner for the intake demo.
 *
 * Fires the real, server-side A2A Reportable Condition agent at /api/agents/reportable-condition/tasks — a
 * care-coordination / public-health-compliance service that classifies a patient case against a nested
 * public-health CASE DEFINITION (confirmed / probable / suspect, each a boolean criteria tree of all-of /
 * any-of / not over leaf predicates) using RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION. The panel surfaces
 * the selected classification, whether it is reportable, each classification's met flag, the honesty
 * signals, the synthetic / PHI labels, and a deep link into the parented Agent Fabric trace.
 *
 * A classification — confirmed / probable / suspect / not-a-case — is a SAFE, honest OUTPUT (it completes; it
 * carries requiresEpiReview:true, autoReported:false). The phantom-criterion, mis-evaluated-tree, and
 * auto-reported presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable in
 * the UI rather than hidden.
 *
 * PHI-bearing — the case is a patient's clinical data. The condition + definition are ILLUSTRATIVE, NOT a
 * certified surveillance / case-reporting system. Structure, styling tokens, and tone mirror
 * <PcpMatchingPanel> so this reads as a native sibling on /demo/intake.
 */

const REPORTABLE_CONDITION_ROUTE = "/api/agents/reportable-condition/tasks";

/** A one-click demo scenario. */
export type ReportableConditionPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: ReportableCaseRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the probable demo — the block base. */
const VALID_DETERMINATION = {
  caseRef: "rc-case-002",
  condition: DEMO_CASE_DEFINITION.condition,
  facts: DEMO_REPORTABLE_CASE_PROBABLE_REQUEST.facts,
  definition: DEMO_CASE_DEFINITION,
  classificationResults: [
    { classification: "confirmed", met: false },
    { classification: "probable", met: true },
    { classification: "suspect", met: true }
  ],
  classification: "probable",
  reportable: true,
  referencedFacts: referencedFactsOf(DEMO_CASE_DEFINITION),
  requiresEpiReview: true,
  autoReported: false
};

export const REPORTABLE_CONDITION_PRESETS: ReportableConditionPreset[] = [
  {
    id: "confirmed",
    label: "Lab-positive, not chronic \u2192 confirmed",
    hint: "NAT positive and no chronic history.",
    request: DEMO_REPORTABLE_CASE_REQUEST,
    demonstrates:
      "Recursive boolean tree evaluation \u2014 (lab-positive OR antigen) AND NOT chronic \u2192 confirmed."
  },
  {
    id: "probable",
    label: "Clinical + epi-linked, no lab \u2192 probable",
    hint: "Compatible illness, epidemiologically linked, no lab confirmation.",
    request: DEMO_REPORTABLE_CASE_PROBABLE_REQUEST,
    demonstrates:
      "No confirmed tree holds; probable = clinically-compatible AND (epi-linked OR elevated-ALT) \u2014 highest-precedence match wins."
  },
  {
    id: "not-a-case",
    label: "Nothing holds \u2192 not-a-case",
    hint: "No lab, no clinical compatibility, no jaundice.",
    request: DEMO_REPORTABLE_CASE_NEGATIVE_REQUEST,
    demonstrates: "Every classification tree evaluates false \u2014 not a reportable case."
  },
  {
    id: "phantom-criterion-block",
    label: "Phantom classification \u2192 governance block",
    hint: "A classification result not in the case definition.",
    request: DEMO_REPORTABLE_CASE_PROBABLE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: a phantom classification ("phantom-tier") not in the submitted definition.
      classificationResults: [
        ...VALID_DETERMINATION.classificationResults,
        { classification: "phantom-tier", met: true }
      ]
    },
    demonstrates:
      "The Agent Fabric blocking a classification whose results don't match the submitted case definition (policy.reportable.facts-sourced)."
  },
  {
    id: "mis-evaluated-block",
    label: "Mis-evaluated tree \u2192 governance block",
    hint: "A confirmed flag that doesn't recompute.",
    request: DEMO_REPORTABLE_CASE_PROBABLE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: claim confirmed met (it isn't) \u2014 over-reports the case.
      classificationResults: [
        { classification: "confirmed", met: true },
        { classification: "probable", met: true },
        { classification: "suspect", met: true }
      ],
      classification: "confirmed",
      reportable: true
    },
    demonstrates:
      "The Agent Fabric blocking a mis-evaluated criteria tree \u2014 an over-reported condition (policy.reportable.classification-consistent)."
  },
  {
    id: "auto-reported-block",
    label: "Reported to public health autonomously \u2192 governance block",
    hint: "A classification that filed a report on its own.",
    request: DEMO_REPORTABLE_CASE_PROBABLE_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: the agent reported the case and skipped epi review.
      requiresEpiReview: false,
      autoReported: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous public-health report (policy.reportable.no-autonomous-report)."
  }
];

/** Render-ready view of a produced classification lifted from the task. */
export type ReportableConditionResolvedView = {
  kind: "resolved";
  caseRef: string;
  condition: string;
  classification: string;
  reportable: boolean;
  classificationResults: ClassificationResult[];
  reason: string;
  note: string;
  caseFactsSourced: boolean;
  classificationConsistent: boolean;
  noAutonomousReport: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ReportableConditionBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ReportableConditionInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ReportableConditionView =
  | ReportableConditionResolvedView
  | ReportableConditionBlockedView
  | ReportableConditionInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  caseFactsSourced?: unknown;
  classificationConsistent?: unknown;
  noAutonomousReport?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildReportableConditionRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ReportableCaseRequest;
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
 * POST a reportable-case request (or an asserted classification) to the agent and return the resulting A2A
 * task. `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as
 * HTTP 200 with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runReportableConditionTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ReportableCaseRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(REPORTABLE_CONDITION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildReportableConditionRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * classification (completed) from a governance block vs. an invalid request
 * (both `failed`, told apart by metadata.agentFabric.decision).
 */
export function reportableConditionViewFromTask(task: A2ATask): ReportableConditionView {
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
        "The Agent Fabric blocked this reportable-condition classification.";
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
      (typeof fabric.error === "string" ? fabric.error : "The classification could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: ReportableCaseDetermination; caseRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    caseRef: result?.caseRef ?? det?.caseRef ?? "",
    condition: det?.condition ?? "",
    classification: det?.classification ?? "not-a-case",
    reportable: det?.reportable ?? false,
    classificationResults: det?.classificationResults ?? [],
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    caseFactsSourced: fabric.caseFactsSourced === true,
    classificationConsistent: fabric.classificationConsistent === true,
    noAutonomousReport: fabric.noAutonomousReport === true,
    traceTaskId
  };
}

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ReportableConditionView }
  | { status: "error"; message: string };

export function ReportableConditionPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ReportableConditionPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runReportableConditionTask({
          taskId: newTaskId("reportable-condition"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: reportableConditionViewFromTask(task) });
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
        Care coordination &middot; public-health compliance &middot; case classification
      </p>
      <h3 style={{ margin: 0 }}>
        Reportable Condition — criteria sourced, classification recomputes, never an autonomous report
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> classifies a patient <strong>case</strong> against a
        nested public-health <strong>case definition</strong> &mdash; confirmed / probable / suspect, each a
        boolean <strong>criteria tree</strong> of <strong>all-of / any-of / not</strong> over the case&rsquo;s
        facts (“confirmed = lab-positive OR (clinically-compatible AND epi-linked)”). Not a
        matching, not a distance, not a checksum &mdash; <strong>recursive boolean expression-tree
        evaluation</strong>, taking the highest-precedence tree that holds. Every criterion is{" "}
        <strong>sourced</strong>, the classification <strong>recomputes</strong>, and the result is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> reports the case to a public-health
        authority &mdash; an epidemiologist confirms.{" "}
        <strong>PHI-bearing &middot; illustrative, not a certified surveillance system.</strong> Run a preset,
        then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {REPORTABLE_CONDITION_PRESETS.map((preset) => (
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
              ? "Classifying\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Classification failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ReportableConditionResult view={runState.view} />}
    </section>
  );
}

function ReportableConditionResult({ view }: { view: ReportableConditionView }) {
  const traceLink = (
    <p style={{ margin: "0.6rem 0 0", fontSize: "0.86rem" }}>
      <a
        href={`/demo/agent-fabric?taskId=${encodeURIComponent(view.traceTaskId)}`}
        className="agentforce-voice-help-link"
      >
        Open the multi-agent trace &rarr;
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
                <code>{v.policyId}</code> &mdash; {v.reason}
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

  const tone = view.reportable ? "#ffd28a" : "#8fd6b0";
  const label = view.reportable
    ? `${view.classification.toUpperCase()} \u00b7 reportable \u00b7 epi review required`
    : "Not-a-case \u00b7 not reportable";

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Classification (deterministic, synthetic)
        {view.caseRef ? ` \u00b7 ${view.caseRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>{label}</p>

      {view.condition && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
          Condition: <code>{view.condition}</code>
        </p>
      )}

      {view.classificationResults.length > 0 && (
        <ul
          style={{
            margin: "0.4rem 0 0",
            paddingLeft: "1.1rem",
            fontSize: "0.84rem",
            color: "var(--muted)"
          }}
        >
          {view.classificationResults.map((r) => (
            <li key={r.classification}>
              <code>{r.classification}</code> &rarr; {r.met ? "met" : "not met"}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Classification safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; recomputes &middot; never an autonomous report{" "}
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
            synthetic &middot; PHI-bearing
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
          caseFactsSourced = {String(view.caseFactsSourced)} &middot; classificationConsistent ={" "}
          {String(view.classificationConsistent)} &middot; noAutonomousReport ={" "}
          {String(view.noAutonomousReport)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
