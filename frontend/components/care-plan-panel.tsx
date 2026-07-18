"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import type { CarePathway, IntakeRecord } from "../lib/care-router";
import type {
  CarePlanGoal,
  CarePlanIntervention,
  CarePlanSummaryResult,
  FollowUpCadence,
  InstantiatedCarePlan
} from "../lib/care-plan";

/**
 * Care Plan runner for the intake demo.
 *
 * Fires the real, server-side A2A Care Plan agent at
 * /api/agents/care-plan/tasks — the Salesforce "Agentforce for Health" /
 * Health Cloud CarePlan + care-plan-summarization analog and the SECOND
 * live-Claude agent after the Care Router. It DETERMINISTICALLY instantiates
 * a menopause care plan from a defined template (goals, interventions,
 * follow-up cadence) based on the Care Router pathway/severity + intake, then
 * generates a NON-PRESCRIPTIVE progress summary with live Anthropic Claude,
 * falling back to a deterministic scripted summary (with a recorded
 * fallbackReason) on a missing key or any SDK error — exactly like the Care
 * Router. The panel surfaces the instantiated plan and the summary, rendering
 * `via` = claude-api or scripted-fallback (and any fallbackReason) honestly.
 *
 * The off-catalog preset intentionally asserts a fabricated (off-catalog)
 * plan, so policy.careplan.template-sourced is demonstrable in the UI rather
 * than hidden. The agent is also governed by the model allow-list (like the
 * Care Router) and never commits a clinical action without a clinician.
 *
 * The templates + their goals/interventions/cadences are ILLUSTRATIVE
 * synthetics, NOT a certified care-plan engine. Structure, styling tokens
 * (.card, .btn/.btn-primary/.btn-secondary, .eyebrow,
 * .agentforce-voice-help-link, .routing-live-result), and tone mirror
 * <AssessmentPanel> and <BenefitsPanel> so this reads as a native sibling on
 * /demo/intake.
 */

const CARE_PLAN_ROUTE = "/api/agents/care-plan/tasks";

/**
 * A one-click demo scenario. Most presets send an `intake` + `pathway` the
 * agent instantiates from; the off-catalog preset sends a caller-asserted
 * `plan` (with an off-catalog templateId) so the integrity gate trips.
 */
export type CarePlanPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The Care Router pathway that seeds template selection. */
  pathway?: CarePathway;
  /** The intake record the plan is instantiated from. */
  intake?: IntakeRecord;
  /** Whether the patient is on hormone therapy (steers template selection). */
  onHrt?: boolean;
  /** A caller-asserted plan (used only for the template-sourced block). */
  assertedPlan?: Record<string, unknown>;
};

export const CARE_PLAN_PRESETS: CarePlanPreset[] = [
  {
    id: "vasomotor-moderate",
    label: "Vasomotor · moderate",
    hint: "Perimenopausal, vasomotor-dominant → the vasomotor/lifestyle plan.",
    pathway: "mscp-virtual-visit",
    intake: {
      preferredName: "Ada",
      ageBand: "45-49",
      cycleStatus: "perimenopausal",
      primarySymptom: "vasomotor",
      severity: "moderate"
    },
    demonstrates:
      "A clean instantiation from a defined template (goals, interventions, cadence) plus a progress summary — rendered as live-Claude or scripted-fallback, whichever served."
  },
  {
    id: "on-hrt",
    label: "On HRT → HRT plan",
    hint: "Patient on hormone therapy → the HRT-management plan.",
    pathway: "mscp-virtual-visit",
    intake: {
      preferredName: "Priya",
      ageBand: "51-55",
      cycleStatus: "stopped>=12mo",
      primarySymptom: "vasomotor",
      severity: "moderate"
    },
    onHrt: true,
    demonstrates:
      "Deterministic template selection — being on hormone therapy steers the plan to HRT management with a benefit/risk reassessment cadence."
  },
  {
    id: "behavioral-health",
    label: "Behavioral-health → mood plan",
    hint: "Behavioral-health handoff / mood-dominant → the mood plan.",
    pathway: "behavioral-health-handoff",
    intake: {
      preferredName: "Maria",
      ageBand: "46-50",
      cycleStatus: "irregular",
      primarySymptom: "mood",
      severity: "severe"
    },
    demonstrates:
      "A severe, mood-dominant presentation → the mood/behavioral plan with a tightened follow-up cadence for a severe presentation."
  },
  {
    id: "off-catalog-block",
    label: "Off-catalog plan → governance block",
    hint: "A caller-asserted, fabricated plan that isn't in the template catalog.",
    assertedPlan: {
      templateId: "careplan.totally-invented",
      templateLabel: "Invented plan",
      patientDisplayName: "the patient",
      pathway: "mscp-virtual-visit",
      severity: "moderate",
      goals: [],
      interventions: [],
      followUp: { intervalDays: 30, modality: "telehealth", description: "x" },
      rationale: ["fabricated"],
      synthetic: true
    },
    demonstrates:
      "The Agent Fabric blocking a fabricated, off-catalog plan that doesn't trace to a defined template (policy.careplan.template-sourced)."
  }
];

/** Render-ready view of an instantiated plan + summary lifted from the task. */
export type CarePlanInstantiatedView = {
  kind: "instantiated";
  templateId: string;
  templateLabel: string;
  patientDisplayName: string;
  pathway: string;
  severity: string;
  goals: CarePlanGoal[];
  interventions: CarePlanIntervention[];
  followUp: FollowUpCadence;
  rationale: string[];
  summary: string;
  via: CarePlanSummaryResult["via"];
  modelProvider: string;
  model: string;
  fallbackReason?: string;
  planTracesToTemplate: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked care-plan task. */
export type CarePlanBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type CarePlanInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type CarePlanView =
  | CarePlanInstantiatedView
  | CarePlanBlockedView
  | CarePlanInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  planTracesToTemplate?: unknown;
  summaryVia?: unknown;
  fallbackReason?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept
 * pure (no fetch, no hooks) so it can be unit-tested without a DOM,
 * mirroring buildBenefitsRequestBody. An `intake` + `pathway` (+ optional
 * onHrt) asks the agent to instantiate + summarize; an `assertedPlan` posts
 * a caller-supplied plan as-is (used to demonstrate the template-sourced
 * block).
 */
export function buildCarePlanRequestBody(input: {
  taskId: string;
  personaId?: string;
  pathway?: CarePathway;
  intake?: IntakeRecord;
  onHrt?: boolean;
  assertedPlan?: Record<string, unknown>;
}) {
  const data =
    input.assertedPlan !== undefined
      ? { plan: input.assertedPlan }
      : {
          ...(input.pathway ? { pathway: input.pathway } : {}),
          intake: input.intake ?? {},
          ...(input.onHrt !== undefined ? { onHrt: input.onHrt } : {})
        };
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
 * POST an intake/pathway (or asserted plan) to the Care Plan agent and
 * return the resulting A2A task. `fetchImpl` is injectable so tests can stub
 * the network boundary. A governance block comes back as HTTP 200 with a
 * `failed` task — only a malformed envelope / parse error is a non-OK
 * response.
 */
export async function runCarePlanTask(
  input: {
    taskId: string;
    personaId?: string;
    pathway?: CarePathway;
    intake?: IntakeRecord;
    onHrt?: boolean;
    assertedPlan?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CARE_PLAN_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCarePlanRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes an
 * instantiated plan (completed) from a governance block vs. an invalid
 * request (both `failed`, told apart by metadata.agentFabric.decision).
 */
export function carePlanViewFromTask(task: A2ATask): CarePlanView {
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
        "The Agent Fabric blocked this care-plan task.";
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
        : "The care plan could not be instantiated.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const plan = (data.plan ?? {}) as Partial<InstantiatedCarePlan>;
  const summary = (data.summary ?? {}) as Partial<CarePlanSummaryResult>;

  const via = (summary.via ??
    (typeof fabric.summaryVia === "string"
      ? (fabric.summaryVia as CarePlanSummaryResult["via"])
      : "scripted-fallback")) as CarePlanSummaryResult["via"];
  const fallbackReason =
    summary.fallbackReason ??
    (typeof fabric.fallbackReason === "string" ? fabric.fallbackReason : undefined);

  return {
    kind: "instantiated",
    templateId: plan.templateId ?? "",
    templateLabel: plan.templateLabel ?? "",
    patientDisplayName: plan.patientDisplayName ?? "the patient",
    pathway: plan.pathway ?? "",
    severity: plan.severity ?? "unspecified",
    goals: plan.goals ?? [],
    interventions: plan.interventions ?? [],
    followUp:
      plan.followUp ??
      ({ intervalDays: 0, modality: "telehealth", description: "" } as FollowUpCadence),
    rationale: plan.rationale ?? [],
    summary: summary.summary ?? "",
    via,
    modelProvider: summary.modelProvenance?.provider ?? "",
    model: summary.modelProvenance?.model ?? "",
    ...(fallbackReason ? { fallbackReason } : {}),
    planTracesToTemplate: fabric.planTracesToTemplate === true,
    traceTaskId
  };
}

const SEVERITY_TONE: Record<string, string> = {
  mild: "#8fd6b0",
  moderate: "#ffd28a",
  severe: "#ffb6c8"
};

function Pill({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const color = tone ?? SEVERITY_TONE[value] ?? "var(--muted)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.1rem 0.5rem",
        borderRadius: "999px",
        border: `1px solid ${color}`,
        color,
        fontSize: "0.78rem",
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
  | { status: "done"; view: CarePlanView }
  | { status: "error"; message: string };

export function CarePlanPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const run = async (input: {
    label: string;
    pathway?: CarePathway;
    intake?: IntakeRecord;
    onHrt?: boolean;
    assertedPlan?: Record<string, unknown>;
  }) => {
    setRunState({ status: "running", label: input.label });
    try {
      const task = await runCarePlanTask({
        taskId: newTaskId("careplan"),
        personaId: "demo",
        pathway: input.pathway,
        intake: input.intake,
        onHrt: input.onHrt,
        assertedPlan: input.assertedPlan
      });
      setRunState({ status: "done", view: carePlanViewFromTask(task) });
    } catch (err) {
      setRunState({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  };

  const runPreset = (preset: CarePlanPreset) => {
    void run({
      label: preset.label,
      pathway: preset.pathway,
      intake: preset.intake,
      onHrt: preset.onHrt,
      assertedPlan: preset.assertedPlan
    });
  };

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
        Care-plan instantiation &amp; summary (live Claude)
      </p>
      <h3 style={{ margin: 0 }}>The Care Plan agent — the second live-Claude agent</h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Care Plan agent{" "}
        <strong>deterministically instantiates a menopause care plan</strong>{" "}
        from a defined template (goals, interventions, follow-up cadence) based
        on the Care Router pathway/severity + intake, then writes a{" "}
        <strong>non-prescriptive progress summary with live Anthropic Claude</strong>
        , falling back to a deterministic scripted summary (with a recorded
        reason) on a missing key or any SDK error — just like the Care Router.
        It is governed by the same model allow-list and never commits a clinical
        action without a clinician.{" "}
        <strong>The templates are illustrative synthetics, not a certified care-plan engine.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CARE_PLAN_PRESETS.map((preset) => (
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
              ? "Instantiating…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Care-plan instantiation failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <CarePlanResult view={runState.view} />}
    </section>
  );
}

const metricRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "0.5rem",
  fontSize: "0.86rem",
  padding: "0.15rem 0"
};

function CarePlanResult({ view }: { view: CarePlanView }) {
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
          Not instantiated
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>{view.message}</p>
        {traceLink}
      </div>
    );
  }

  const viaClaude = view.via === "claude-api";

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Instantiated care plan (deterministic template)
      </p>
      <p style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "var(--text)" }}>
        {view.templateLabel || view.templateId}
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          margin: "0.5rem 0 0"
        }}
      >
        <Pill label="Severity" value={view.severity} />
        <Pill label="Pathway" value={view.pathway} tone="var(--muted)" />
      </div>

      {view.goals.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.7rem 0 0.2rem" }}>
            Goals
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: "1.1rem",
              color: "var(--muted)",
              fontSize: "0.85rem"
            }}
          >
            {view.goals.map((g) => (
              <li key={g.id}>
                {g.description} — <em>{g.target}</em>
              </li>
            ))}
          </ul>
        </>
      )}

      {view.interventions.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.7rem 0 0.2rem" }}>
            Interventions
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: "1.1rem",
              color: "var(--muted)",
              fontSize: "0.85rem"
            }}
          >
            {view.interventions.map((i) => (
              <li key={i.id}>
                {i.description}{" "}
                <span
                  style={{
                    fontSize: "0.72rem",
                    color: "var(--muted)",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                  }}
                >
                  [{i.category}]
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <ul
        className="metric-list"
        style={{ margin: "0.7rem 0 0", listStyle: "none", padding: 0 }}
      >
        <li style={metricRow}>
          <span style={{ color: "var(--muted)" }}>Follow-up cadence</span>
          <strong>
            every ~{view.followUp.intervalDays} days · {view.followUp.modality}
          </strong>
        </li>
      </ul>
      {view.followUp.description && (
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
          {view.followUp.description}
        </p>
      )}

      <div
        role="note"
        aria-label="Progress summary"
        style={{
          marginTop: "0.7rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
          Progress summary{" "}
          <span
            style={{
              fontSize: "0.72rem",
              fontWeight: 600,
              color: viaClaude ? "#8fd6b0" : "#ffd28a",
              border: `1px solid ${viaClaude ? "#8fd6b0" : "#ffd28a"}`,
              borderRadius: "999px",
              padding: "0.05rem 0.4rem",
              marginLeft: "0.35rem"
            }}
          >
            {viaClaude ? "live Claude" : "scripted fallback"}
          </span>
        </p>
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem", color: "var(--text)" }}>
          {view.summary}
        </p>
        <p
          style={{
            margin: "0.4rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          via = {view.via}
          {view.model ? ` · model = ${view.model}` : ""}
        </p>
        {view.fallbackReason && (
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.78rem",
              color: "#ffd28a"
            }}
          >
            Fell back to the deterministic scripted summarizer: {view.fallbackReason}
          </p>
        )}
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
          Non-prescriptive — a progress summary only; it never adds or changes a
          medication, dose, order, or prescription.
        </p>
      </div>

      <p
        style={{
          margin: "0.6rem 0 0",
          fontSize: "0.78rem",
          color: "var(--muted)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
        }}
      >
        planTracesToTemplate = {String(view.planTracesToTemplate)}
      </p>

      {traceLink}
    </div>
  );
}
