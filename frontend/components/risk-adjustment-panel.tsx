"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_RISK_ADJUSTMENT_CONTEXT,
  type RiskAdjustmentAssessment,
  type RiskAdjustmentContext,
  type SuspectedHcc
} from "../lib/risk-adjustment";

/**
 * Risk Adjustment & HCC Coding runner for the intake demo.
 *
 * Fires the real, server-side A2A Risk Adjustment agent at
 * /api/agents/risk-adjustment/tasks — a patient-care clinical-documentation-
 * integrity agent for value-based care. It reviews a patient's (synthetic)
 * clinical context, DETERMINISTICALLY identifies suspected / confirmed
 * HIERARCHICAL CONDITION CATEGORIES (HCCs) for risk adjustment (each mapped to
 * the documented clinical evidence that supports it), computes a RAF-style risk
 * score from the confirmed set, and flags coding gaps (suspected-but-unconfirmed)
 * and unsupported / over-coded entries. The panel surfaces the confirmed /
 * suspected / unsupported HCCs with their supporting evidence, the RAF score, the
 * coding gaps, the clinician-validation-required flag, the honesty signals, and a
 * deep link into the parented Agent Fabric trace.
 *
 * A CODING GAP (a suspected HCC) and an UNSUPPORTED / OVER-CODED FLAG are SAFE,
 * honest OUTPUTS surfaced for a clinician to validate / correct — NOT blocks. The
 * upcoding, skip-clinician-validation, and autonomous-submission presets assert
 * offending sets / actions — so all three governance blocks are demonstrable in
 * the UI rather than hidden.
 *
 * The HCC catalog, RAF weights, and supporting evidence are ILLUSTRATIVE
 * synthetics, NOT the certified CMS-HCC model, real RAF coefficients, or a
 * certified coding engine. Structure, styling tokens, and tone mirror
 * <LanguageAccessPanel> and <ClinicalTrialsPanel> so this reads as a native
 * sibling on /demo/intake.
 */

const RISKADJ_ROUTE = "/api/agents/risk-adjustment/tasks";

/** A one-click demo scenario. */
export type RiskAdjustmentPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The clinical context the agent assesses (the common case). */
  context?: RiskAdjustmentContext;
  /** Caller-asserted HCC set (used only for the evidence-supported-coding block). */
  assertedHccs?: Array<Record<string, unknown>>;
  /** Caller-asserted code action (used for the clinician-validation / no-submission blocks). */
  assertedAction?: Record<string, unknown>;
};

export const RISK_ADJUSTMENT_PRESETS: RiskAdjustmentPreset[] = [
  {
    id: "confirmed-plus-gap",
    label: "Documented patient → confirmed HCCs + coding gap",
    hint: "A midlife patient with documented, coded chronic conditions plus an uncoded one.",
    context: DEMO_RISK_ADJUSTMENT_CONTEXT,
    demonstrates:
      "Two confirmed HCCs (diabetes-with-complication + osteoporosis-with-fracture) driving a RAF score, each tracing to documented clinical evidence, plus one suspected coding gap (major depression — evidence documented but uncoded) surfaced for a clinician to validate — a safe answer, not a block."
  },
  {
    id: "upcoding-block",
    label: "Unsupported code asserted as supported → governance block",
    hint: "A confirmed HCC presented as supported with no documented evidence.",
    context: DEMO_RISK_ADJUSTMENT_CONTEXT,
    assertedHccs: [
      {
        hccId: "hcc.copd",
        hccLabel: "Chronic obstructive pulmonary disease",
        status: "confirmed",
        supportingEvidence: []
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a confirmed / suspected HCC presented as supported that does not trace to documented clinical evidence — upcoding (policy.riskadj.evidence-supported-coding)."
  },
  {
    id: "skip-validation-block",
    label: "Finalize suspected code without clinician → governance block",
    hint: "Submitting a suspected code without a clinician validating it.",
    context: DEMO_RISK_ADJUSTMENT_CONTEXT,
    assertedAction: { kind: "submit", clinicianValidated: false },
    demonstrates:
      "The Agent Fabric blocking a suspected code finalized without a clinician validating it — every suspected code is a recommendation requiring clinician validation (policy.riskadj.clinician-validation-required)."
  },
  {
    id: "autonomous-submission-block",
    label: "Autonomous code submission → governance block",
    hint: "The agent asserting it submitted codes / adjusted the claim on its own.",
    context: DEMO_RISK_ADJUSTMENT_CONTEXT,
    assertedAction: { kind: "assess", submitted: true },
    demonstrates:
      "The Agent Fabric blocking an autonomous code submission / claim adjustment — the agent is a recommender + integrity checker and never files codes or adjusts a RAF on its own (policy.riskadj.no-autonomous-submission)."
  }
];

/** Render-ready view of a produced assessment lifted from the task. */
export type RiskAdjustmentAssessedView = {
  kind: "assessed";
  patientRef: string;
  hccs: SuspectedHcc[];
  rafScore: number;
  codingGaps: SuspectedHcc[];
  unsupportedFlags: SuspectedHcc[];
  requiresClinicianValidation: boolean;
  submitted: boolean;
  note: string;
  codesTraceToClinicalEvidence: boolean;
  codingRequiresClinicianValidation: boolean;
  noAutonomousCodeSubmission: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type RiskAdjustmentBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type RiskAdjustmentInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type RiskAdjustmentView =
  | RiskAdjustmentAssessedView
  | RiskAdjustmentBlockedView
  | RiskAdjustmentInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  codesTraceToClinicalEvidence?: unknown;
  codingRequiresClinicianValidation?: unknown;
  noAutonomousCodeSubmission?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildLanguageAccessRequestBody.
 */
export function buildRiskAdjustmentRequestBody(input: {
  taskId: string;
  personaId?: string;
  context?: RiskAdjustmentContext;
  assertedHccs?: Array<Record<string, unknown>>;
  assertedAction?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (input.context !== undefined) data.context = input.context;
  if (input.assertedHccs !== undefined) data.hccs = input.assertedHccs;
  if (input.assertedAction !== undefined) data.action = input.assertedAction;
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
 * POST a clinical context (or asserted HCC set / code action) to the Risk
 * Adjustment agent and return the resulting A2A task. `fetchImpl` is injectable so
 * tests can stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a non-OK
 * response.
 */
export async function runRiskAdjustmentTask(
  input: {
    taskId: string;
    personaId?: string;
    context?: RiskAdjustmentContext;
    assertedHccs?: Array<Record<string, unknown>>;
    assertedAction?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(RISKADJ_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRiskAdjustmentRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * assessment (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function riskAdjustmentViewFromTask(task: A2ATask): RiskAdjustmentView {
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
        "The Agent Fabric blocked this risk-adjustment run.";
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
        : "The risk-adjustment assessment could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { assessment?: RiskAdjustmentAssessment } | undefined) ?? undefined;
  const assessment = result?.assessment;

  return {
    kind: "assessed",
    patientRef: assessment?.patientRef ?? "",
    hccs: assessment?.hccs ?? [],
    rafScore: assessment?.rafScore ?? 0,
    codingGaps: assessment?.codingGaps ?? [],
    unsupportedFlags: assessment?.unsupportedFlags ?? [],
    requiresClinicianValidation: assessment?.requiresClinicianValidation ?? true,
    submitted: assessment?.submitted ?? false,
    note: assessment?.note ?? "",
    codesTraceToClinicalEvidence: fabric.codesTraceToClinicalEvidence === true,
    codingRequiresClinicianValidation: fabric.codingRequiresClinicianValidation === true,
    noAutonomousCodeSubmission: fabric.noAutonomousCodeSubmission === true,
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
  confirmed: "#8fd6b0",
  suspected: "#ffd28a",
  unsupported: "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: RiskAdjustmentView }
  | { status: "error"; message: string };

export function RiskAdjustmentPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: RiskAdjustmentPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runRiskAdjustmentTask({
          taskId: newTaskId("riskadj"),
          personaId: "demo",
          context: preset.context,
          assertedHccs: preset.assertedHccs,
          assertedAction: preset.assertedAction
        });
        setRunState({ status: "done", view: riskAdjustmentViewFromTask(task) });
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
        Risk adjustment &amp; HCC coding
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that finds documented-but-uncoded conditions — evidence-supported
        HCCs, a RAF-style score, clinician-validated, never autonomously submitted
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Risk Adjustment agent reviews a patient&apos;s clinical context and
        identifies <strong>suspected / confirmed HCCs</strong> (Hierarchical
        Condition Categories) for value-based care, mapping each to the{" "}
        <strong>documented clinical evidence</strong> that supports it, computing a{" "}
        <strong>RAF-style risk score</strong> from the confirmed set, and flagging{" "}
        <strong>coding gaps</strong> (evidence documented but uncoded) and{" "}
        <strong>unsupported / over-coded entries</strong> (coded but not
        documented). It COMPLEMENTS — it does not duplicate — the quality agents:
        those score quality measures; this is risk-adjustment condition coding.
        Every confirmed / suspected HCC must{" "}
        <strong>trace to documented clinical evidence</strong> (no upcoding), every
        suspected code is a <strong>recommendation requiring clinician
        validation</strong>, and the agent <strong>never autonomously submits
        codes or adjusts a claim / RAF</strong>. A coding gap and an unsupported
        flag are safe, honest outputs surfaced for a clinician — not blocks.{" "}
        <strong>
          The HCC catalog, RAF weights, and evidence are illustrative synthetics,
          not the certified CMS-HCC model, real RAF coefficients, or a certified
          coding engine.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {RISK_ADJUSTMENT_PRESETS.map((preset) => (
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
              ? "Assessing…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Risk-adjustment run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <RiskAdjustmentResult view={runState.view} />}
    </section>
  );
}

function HccList({ title, hccs, note }: { title: string; hccs: SuspectedHcc[]; note?: string }) {
  if (hccs.length === 0) return null;
  return (
    <>
      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        {title}
      </p>
      {note && (
        <p style={{ margin: "0 0 0.4rem", fontSize: "0.78rem", color: "var(--muted)" }}>
          {note}
        </p>
      )}
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {hccs.map((h) => (
          <li
            key={h.hccId}
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
              <strong style={{ fontSize: "0.9rem" }}>{h.hccLabel}</strong>
              <span style={{ display: "inline-flex", gap: "0.35rem", flexWrap: "wrap" }}>
                <Pill
                  label="Status"
                  value={h.status}
                  tone={STATUS_TONE[h.status] ?? "#9fb3c8"}
                />
                <Pill label="RAF" value={h.rafWeight.toFixed(3)} tone="#9fb3c8" />
              </span>
            </div>
            {h.supportingEvidence.length > 0 && (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                supporting evidence:{" "}
                {h.supportingEvidence.map((e) => e.label).join(", ")}
              </p>
            )}
            {h.missingEvidence.length > 0 && (
              <p style={{ margin: "0.2rem 0 0", fontSize: "0.78rem", color: "#ffb6c8" }}>
                not documented: {h.missingEvidence.map((e) => e.label).join(", ")}
              </p>
            )}
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
              {h.rationale}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

function RiskAdjustmentResult({ view }: { view: RiskAdjustmentView }) {
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

  const confirmed = view.hccs.filter((h) => h.status === "confirmed");

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Risk-adjustment assessment (deterministic, synthetic catalogs)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="RAF score" value={view.rafScore.toFixed(3)} tone="#8fd6b0" />{" "}
        <Pill label="Confirmed HCCs" value={String(confirmed.length)} tone="#8fd6b0" />{" "}
        <Pill label="Coding gaps" value={String(view.codingGaps.length)} tone="#ffd28a" />{" "}
        <Pill
          label="Unsupported flags"
          value={String(view.unsupportedFlags.length)}
          tone={view.unsupportedFlags.length > 0 ? "#ffb6c8" : "#9fb3c8"}
        />
      </p>

      <HccList title="Confirmed HCCs (coded + evidence-supported)" hccs={confirmed} />
      <HccList
        title="Suspected HCCs · coding gaps (evidence documented, not yet coded — a clinician validates and codes them; a safe answer, not a block)"
        hccs={view.codingGaps}
      />
      <HccList
        title="Unsupported / over-coded flags (coded, but evidence not documented — a clinician corrects them; a safe answer, not a block)"
        hccs={view.unsupportedFlags}
      />

      <div
        role="note"
        aria-label="Coding integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Every suspected code is a recommendation requiring clinician validation ·
          the agent never autonomously submits codes or adjusts a claim / RAF
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
          requiresClinicianValidation = {String(view.requiresClinicianValidation)} ·
          submitted = {String(view.submitted)} · codesTraceToClinicalEvidence ={" "}
          {String(view.codesTraceToClinicalEvidence)} ·
          codingRequiresClinicianValidation ={" "}
          {String(view.codingRequiresClinicianValidation)} ·
          noAutonomousCodeSubmission = {String(view.noAutonomousCodeSubmission)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
