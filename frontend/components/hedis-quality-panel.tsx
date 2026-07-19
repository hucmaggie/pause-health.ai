"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_AS_OF_PERIOD,
  DEMO_PANEL,
  type MeasureReport,
  type PanelQualityReport,
  type PatientQualitySignals,
  type SubmissionPackage
} from "../lib/hedis-quality";

/**
 * HEDIS & Quality Reporting runner for the intake demo.
 *
 * Fires the real, server-side A2A HEDIS agent at
 * /api/agents/hedis-quality/tasks — a panel-level QUALITY-REPORTING agent that
 * rolls up per-patient signals across a menopause/midlife panel into HEDIS /
 * Star measure compliance (numerator / denominator / catalog-sourced exclusions
 * / rate) for value-based-care contracts, and assembles a submission package
 * for human quality-team review. The panel surfaces the per-measure rates, the
 * gap list per measure, the submission-package state, the honesty signals, and
 * a deep link into the parented Agent Fabric trace.
 *
 * The off-catalog-measure, ad-hoc-exclusion, and autonomous-submission presets
 * assert offending plans — so all three governance blocks are demonstrable in
 * the UI rather than hidden.
 *
 * The HEDIS measure catalog, denominator windows, numerator thresholds, and
 * exclusion lists are ILLUSTRATIVE synthetics, NOT an NCQA-certified HEDIS
 * engine. Structure, styling tokens, and tone mirror
 * <LanguageAccessPanel> and <PopulationHealthPanel> so this reads as a native
 * sibling on /demo/intake.
 */

const HEDIS_ROUTE = "/api/agents/hedis-quality/tasks";

/** A one-click demo scenario. */
export type HedisQualityPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The panel the agent rolls up (defaults to DEMO_PANEL on the server). */
  panel?: PatientQualitySignals[];
  /** The measurement period accepted as data (defaults to DEMO_AS_OF_PERIOD). */
  asOfPeriod?: string;
  /** Caller-asserted per-measure set (used only for the measure-catalog block). */
  assertedPerMeasure?: Array<Record<string, unknown>>;
  /** Caller-asserted applied exclusions (used only for the exclusion-integrity block). */
  assertedAppliedExclusions?: Array<Record<string, unknown>>;
  /** Caller-asserted submission plan (used only for the no-autonomous-submission block). */
  assertedSubmissionPlan?: Record<string, unknown>;
};

export const HEDIS_QUALITY_PRESETS: HedisQualityPreset[] = [
  {
    id: "demo-panel-rollup",
    label: "Roll up the demo panel (MY2026)",
    hint: "Six-patient synthetic panel across five HEDIS measures.",
    panel: DEMO_PANEL,
    asOfPeriod: DEMO_AS_OF_PERIOD,
    demonstrates:
      "The agent rolling up a synthetic six-patient panel against five illustrative HEDIS measures — per-measure eligible / excluded / denominator / numerator / rate + a gap list, and a submission package assembled for HUMAN QUALITY-TEAM REVIEW (never autonomously filed)."
  },
  {
    id: "offcatalog-measure-block",
    label: "Off-catalog measure → governance block",
    hint: "Report claiming a measure that isn't on the catalog.",
    assertedPerMeasure: [{ measureId: "measure.made-up-quality-metric" }],
    demonstrates:
      "The Agent Fabric blocking a HEDIS report that scores a measure outside the defined HEDIS measure catalog (policy.hedis.measure-catalog-sourced)."
  },
  {
    id: "adhoc-exclusion-block",
    label: "Ad-hoc exclusion → governance block",
    hint: "A denominator exclusion that isn't on the measure's catalog spec.",
    assertedAppliedExclusions: [
      {
        measureId: "measure.breast-cancer-screening",
        exclusionId: "exclusion.we-just-didnt-feel-like-it"
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a denominator exclusion that isn't on the measure's catalog spec — the load-bearing rate-integrity guard against inflating a rate by shrinking the denominator with an unlisted exclusion (policy.hedis.exclusion-integrity)."
  },
  {
    id: "autonomous-submission-block",
    label: "Autonomous submission → governance block",
    hint: "A plan that would file the package without human quality-team approval.",
    assertedSubmissionPlan: {
      requiresQualityTeamApproval: false,
      submitted: true,
      state: "submitted"
    },
    demonstrates:
      "The Agent Fabric blocking a submission that bypasses the human quality-team approval — the agent may never autonomously file to a payer / CMS / quality registry (policy.hedis.no-autonomous-submission)."
  }
];

/** Render-ready view of a produced report lifted from the task. */
export type HedisReportedView = {
  kind: "reported";
  asOfPeriod: string;
  panelSize: number;
  perMeasure: MeasureReport[];
  submission: SubmissionPackage | null;
  note: string;
  measuresTraceToCatalog: boolean;
  exclusionsTraceToCatalog: boolean;
  submissionRequiresHumanApproval: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type HedisBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type HedisInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type HedisQualityView =
  | HedisReportedView
  | HedisBlockedView
  | HedisInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  measuresTraceToCatalog?: unknown;
  exclusionsTraceToCatalog?: unknown;
  submissionRequiresHumanApproval?: unknown;
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
export function buildHedisQualityRequestBody(input: {
  taskId: string;
  personaId?: string;
  panel?: PatientQualitySignals[];
  asOfPeriod?: string;
  assertedPerMeasure?: Array<Record<string, unknown>>;
  assertedAppliedExclusions?: Array<Record<string, unknown>>;
  assertedSubmissionPlan?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (input.panel !== undefined) data.panel = input.panel;
  if (input.asOfPeriod !== undefined) data.asOfPeriod = input.asOfPeriod;
  if (input.assertedPerMeasure !== undefined) data.perMeasure = input.assertedPerMeasure;
  if (input.assertedAppliedExclusions !== undefined) {
    data.appliedExclusions = input.assertedAppliedExclusions;
  }
  if (input.assertedSubmissionPlan !== undefined) {
    data.submissionPlan = input.assertedSubmissionPlan;
  }
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
 * POST a panel (or an asserted plan) to the HEDIS agent and return the resulting
 * A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A
 * governance block comes back as HTTP 200 with a `failed` task — only a
 * malformed envelope / parse error is a non-OK response.
 */
export async function runHedisQualityTask(
  input: {
    taskId: string;
    personaId?: string;
    panel?: PatientQualitySignals[];
    asOfPeriod?: string;
    assertedPerMeasure?: Array<Record<string, unknown>>;
    assertedAppliedExclusions?: Array<Record<string, unknown>>;
    assertedSubmissionPlan?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(HEDIS_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildHedisQualityRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced report
 * (completed) from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function hedisQualityViewFromTask(task: A2ATask): HedisQualityView {
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
        "The Agent Fabric blocked this HEDIS quality-reporting run.";
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
        : "The HEDIS quality report could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { report?: PanelQualityReport; submission?: SubmissionPackage }
      | undefined) ?? undefined;
  const report = result?.report;

  return {
    kind: "reported",
    asOfPeriod: report?.asOfPeriod ?? "",
    panelSize: report?.panelSize ?? 0,
    perMeasure: report?.perMeasure ?? [],
    submission: result?.submission ?? null,
    note: report?.note ?? "",
    measuresTraceToCatalog: fabric.measuresTraceToCatalog === true,
    exclusionsTraceToCatalog: fabric.exclusionsTraceToCatalog === true,
    submissionRequiresHumanApproval: fabric.submissionRequiresHumanApproval === true,
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

/** Green ≥ 80%, amber ≥ 50%, red below, muted when n/a. Illustrative thresholds. */
function rateTone(rate: number | null): string {
  if (rate === null) return "#9fb3c8";
  if (rate >= 0.8) return "#8fd6b0";
  if (rate >= 0.5) return "#ffd28a";
  return "#ffb6c8";
}

function ratePercent(rate: number | null): string {
  if (rate === null) return "n/a";
  return `${Math.round(rate * 100)}%`;
}

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: HedisQualityView }
  | { status: "error"; message: string };

export function HedisQualityPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: HedisQualityPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runHedisQualityTask({
          taskId: newTaskId("hedis"),
          personaId: "demo",
          panel: preset.panel,
          asOfPeriod: preset.asOfPeriod,
          assertedPerMeasure: preset.assertedPerMeasure,
          assertedAppliedExclusions: preset.assertedAppliedExclusions,
          assertedSubmissionPlan: preset.assertedSubmissionPlan
        });
        setRunState({ status: "done", view: hedisQualityViewFromTask(task) });
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
        HEDIS &amp; quality reporting
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that rolls a panel of patients into HEDIS quality-measure
        compliance — never autonomously submitted
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The HEDIS agent ingests already-produced per-patient signals across a
        panel and <strong>deterministically rolls them up</strong> into HEDIS
        quality-measure compliance — <strong>numerator</strong>,{" "}
        <strong>denominator</strong>, catalog-sourced <strong>exclusions</strong>
        , and <strong>compliance rate</strong> per measure — the artifact
        provider organizations owe payers under value-based-care contracts.
        Every measure must trace to the{" "}
        <strong>defined HEDIS measure catalog</strong>, every applied denominator
        exclusion must trace to a{" "}
        <strong>defined catalog exclusion</strong> on that measure, and every
        submission package requires{" "}
        <strong>human quality-team approval</strong> — the agent NEVER
        autonomously files to a payer / CMS / quality registry.{" "}
        <strong>
          The HEDIS measure catalog, denominator windows, numerator thresholds,
          and exclusion lists are illustrative synthetics, not NCQA-certified
          specifications.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {HEDIS_QUALITY_PRESETS.map((preset) => (
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
              ? "Rolling up…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          HEDIS quality-reporting run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <HedisQualityResult view={runState.view} />}
    </section>
  );
}

function HedisQualityResult({ view }: { view: HedisQualityView }) {
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

  const sub = view.submission;

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        HEDIS quality report (deterministic, synthetic catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="As of" value={view.asOfPeriod} tone="#9fb3c8" />{" "}
        <Pill label="Panel size" value={String(view.panelSize)} tone="#9fb3c8" />{" "}
        {sub && (
          <Pill
            label="Submission"
            value={sub.state}
            tone={sub.submitted ? "#ffb6c8" : "#ffd28a"}
          />
        )}
      </p>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Per-measure compliance
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {view.perMeasure.map((m) => (
          <li
            key={m.measureId}
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
              <strong style={{ fontSize: "0.9rem" }}>
                {m.measureCode} · {m.measureLabel}
              </strong>
              <Pill label="Rate" value={ratePercent(m.rate)} tone={rateTone(m.rate)} />
            </div>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.78rem",
                color: "var(--muted)",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
              }}
            >
              eligible = {m.eligible} · excluded = {m.excluded} · denominator ={" "}
              {m.denominator} · numerator = {m.numerator}
            </p>
            {m.gapPatientRefs.length > 0 && (
              <p
                style={{
                  margin: "0.25rem 0 0",
                  fontSize: "0.78rem",
                  color: "var(--muted)"
                }}
              >
                gap list: {m.gapPatientRefs.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>

      {sub && (
        <div
          role="note"
          aria-label="Submission package"
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Submission ·{" "}
            <span style={{ color: sub.submitted ? "#ffb6c8" : "#ffd28a" }}>
              {sub.state}
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
            {sub.body}
          </p>
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            packageId = {sub.packageId} · requiresQualityTeamApproval ={" "}
            {String(sub.requiresQualityTeamApproval)} · submitted ={" "}
            {String(sub.submitted)}
          </p>
        </div>
      )}

      <div
        role="note"
        aria-label="Quality integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
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
          measuresTraceToCatalog = {String(view.measuresTraceToCatalog)} ·
          exclusionsTraceToCatalog = {String(view.exclusionsTraceToCatalog)} ·
          submissionRequiresHumanApproval ={" "}
          {String(view.submissionRequiresHumanApproval)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
