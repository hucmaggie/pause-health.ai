"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_PANEL,
  type PanelStratification,
  type PatientPanelSignals,
  type PatientRiskProfile,
  type RiskTier,
  type TierCareAction
} from "../lib/population-health";

/**
 * Population Health & Risk Stratification runner for the intake demo.
 *
 * Fires the real, server-side A2A Population Health agent at
 * /api/agents/population-health/tasks — the Salesforce "Agentforce for Health" /
 * Health Cloud population-health / risk-stratification analog — which ingests a
 * PANEL (cohort) of already-produced per-patient signals, DETERMINISTICALLY
 * scores each patient with a TRANSPARENT additive/weighted risk model, assigns a
 * risk tier (low / rising / high), and emits a prioritized outreach worklist for
 * a human care manager. The panel surfaces the tier counts, the per-patient tiers
 * with their contributing factors, the ordered worklist, the honesty signals, and
 * a deep link into the parented Agent Fabric trace.
 *
 * The opaque-score preset asserts an off-spec profile whose tier doesn't trace to
 * the factor spec, the protected-class preset asserts a protected-class attribute
 * as a scoring factor, and the autonomous-decision preset asserts a tier→action
 * NOT routed to a human — so all three population-health governance blocks are
 * demonstrable in the UI rather than hidden.
 *
 * The factors + weights + cutoffs + patientRefs are ILLUSTRATIVE synthetics, NOT
 * a certified risk-stratification model. Structure, styling tokens, and tone
 * mirror <RemoteMonitoringPanel> and <CareGapPanel> so this reads as a native
 * sibling on /demo/intake.
 */

const POPHEALTH_ROUTE = "/api/agents/population-health/tasks";

/** A one-click demo scenario. */
export type PopulationHealthPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The patient panel the agent stratifies (the common case). */
  panel?: PatientPanelSignals[];
  /** Caller-asserted scoring factors (used only for the protected-class block). */
  scoringFactors?: string[];
  /** Caller-asserted tier→actions (used only for the autonomous-decision block). */
  careActions?: TierCareAction[];
  /** Caller-asserted profiles (used only for the transparent-risk-model block). */
  assertedProfiles?: Array<Record<string, unknown>>;
};

const SMALL_HIGH_RISK_PANEL: PatientPanelSignals[] = [
  {
    patientRef: "panel-patient-a",
    intakeSeverity: "high",
    assessmentBand: "severe",
    openCareGaps: 2,
    medicationAdherence: "lapsed",
    monitoringTrend: "worsening"
  },
  {
    patientRef: "panel-patient-b",
    intakeSeverity: "high",
    assessmentBand: "moderate",
    sdohPositiveDomains: 2
  },
  {
    patientRef: "panel-patient-c",
    intakeSeverity: "moderate",
    medicationAdherence: "at-risk"
  }
];

export const POPULATION_HEALTH_PRESETS: PopulationHealthPreset[] = [
  {
    id: "mixed-panel",
    label: "Mixed panel → low / rising / high",
    hint: "Five synthetic patients spanning the tiers.",
    panel: DEMO_PANEL,
    demonstrates:
      "A representative panel stratified into a mix of low, rising, and high tiers — each tier explainable by its contributing factors — with a prioritized outreach worklist (highest-risk patient first) for care-manager review."
  },
  {
    id: "high-risk-cohort",
    label: "High-risk cohort → prioritized worklist",
    hint: "A small, higher-acuity cohort.",
    panel: SMALL_HIGH_RISK_PANEL,
    demonstrates:
      "A smaller, higher-acuity cohort where two patients rise into the high/rising tiers and the worklist orders them by risk for the care manager."
  },
  {
    id: "opaque-score-block",
    label: "Opaque score → governance block",
    hint: "A tier asserted from an off-spec, black-box score.",
    panel: DEMO_PANEL,
    assertedProfiles: [
      {
        patientRef: "panel-patient-001",
        score: 9,
        tier: "high",
        contributingFactors: [
          {
            factorId: "factor.opaque-blackbox",
            factorLabel: "Opaque model output",
            points: 9,
            detail: "black-box score"
          }
        ]
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a tier that doesn't trace to the documented risk-factor spec — an opaque / off-spec / black-box score (policy.pophealth.transparent-risk-model)."
  },
  {
    id: "protected-class-block",
    label: "Protected-class factor → governance block",
    hint: "A protected-class attribute asserted as a scoring factor.",
    panel: DEMO_PANEL,
    scoringFactors: ["factor.intake-severity", "factor.care-gaps", "attr.race"],
    demonstrates:
      "The Agent Fabric blocking a risk model that scores on a protected-class attribute (race) — a fairness / responsible-AI requirement (policy.pophealth.no-protected-class-factors)."
  },
  {
    id: "autonomous-decision-block",
    label: "Autonomous care decision → governance block",
    hint: "A tier that auto-triggers a care action (not routed to a human).",
    panel: DEMO_PANEL,
    careActions: [
      {
        patientRef: "panel-patient-001",
        tier: "high",
        action: "auto-enroll in disease-management program",
        routedTo: "auto-enroll" as never
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a tier that autonomously triggers a care action instead of routing it for human / care-manager review (policy.pophealth.no-autonomous-care-decision)."
  }
];

/** Render-ready view of a produced stratification lifted from the task. */
export type PopulationHealthStratifiedView = {
  kind: "stratified";
  perPatient: PatientRiskProfile[];
  worklist: string[];
  tierCounts: Record<RiskTier, number>;
  note: string;
  riskScoreTracesToFactors: boolean;
  excludesProtectedAttributes: boolean;
  tierReviewedByHuman: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked stratification run. */
export type PopulationHealthBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type PopulationHealthInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type PopulationHealthView =
  | PopulationHealthStratifiedView
  | PopulationHealthBlockedView
  | PopulationHealthInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  riskScoreTracesToFactors?: unknown;
  excludesProtectedAttributes?: unknown;
  tierReviewedByHuman?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildRemoteMonitoringRequestBody.
 */
export function buildPopulationHealthRequestBody(input: {
  taskId: string;
  personaId?: string;
  panel?: PatientPanelSignals[];
  scoringFactors?: string[];
  careActions?: Array<Record<string, unknown>>;
  assertedProfiles?: Array<Record<string, unknown>>;
}) {
  const data: Record<string, unknown> = {};
  if (input.panel !== undefined) data.panel = input.panel;
  if (input.scoringFactors !== undefined) data.scoringFactors = input.scoringFactors;
  if (input.careActions !== undefined) data.careActions = input.careActions;
  if (input.assertedProfiles !== undefined) data.profiles = input.assertedProfiles;
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
 * POST a panel (or asserted factors / actions / profiles) to the Population
 * Health agent and return the resulting A2A task. `fetchImpl` is injectable so
 * tests can stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a non-OK
 * response.
 */
export async function runPopulationHealthTask(
  input: {
    taskId: string;
    personaId?: string;
    panel?: PatientPanelSignals[];
    scoringFactors?: string[];
    careActions?: Array<Record<string, unknown>>;
    assertedProfiles?: Array<Record<string, unknown>>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(POPHEALTH_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPopulationHealthRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * stratification (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function populationHealthViewFromTask(task: A2ATask): PopulationHealthView {
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
        "The Agent Fabric blocked this population-health run.";
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
        : "The panel stratification could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const stratification = (data.stratification as PanelStratification | undefined) ?? undefined;

  return {
    kind: "stratified",
    perPatient: stratification?.perPatient ?? [],
    worklist: stratification?.worklist ?? [],
    tierCounts: stratification?.tierCounts ?? { low: 0, rising: 0, high: 0 },
    note: stratification?.note ?? "",
    riskScoreTracesToFactors: fabric.riskScoreTracesToFactors === true,
    excludesProtectedAttributes: fabric.excludesProtectedAttributes === true,
    tierReviewedByHuman: fabric.tierReviewedByHuman === true,
    traceTaskId
  };
}

const TIER_TONE: Record<RiskTier, string> = {
  low: "#8fd6b0",
  rising: "#ffd28a",
  high: "#ffb6c8"
};

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
  | { status: "done"; view: PopulationHealthView }
  | { status: "error"; message: string };

export function PopulationHealthPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: PopulationHealthPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runPopulationHealthTask({
          taskId: newTaskId("pophealth"),
          personaId: "demo",
          panel: preset.panel,
          scoringFactors: preset.scoringFactors,
          careActions: preset.careActions as
            | Array<Record<string, unknown>>
            | undefined,
          assertedProfiles: preset.assertedProfiles
        });
        setRunState({ status: "done", view: populationHealthViewFromTask(task) });
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
        Population health &amp; risk stratification
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that stratifies a whole panel and prioritizes outreach
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Population Health agent reasons over a whole{" "}
        <strong>panel of patients at once</strong>, taking already-produced
        per-patient signals (intake severity, assessment band, care gaps, SDOH
        domains, medication adherence, monitored trend) and{" "}
        <strong>
          deterministically scoring each patient with a transparent, additive
          risk model
        </strong>{" "}
        into a risk tier (low / rising / high), then building a prioritized
        outreach worklist for a human care manager. Every tier is{" "}
        <strong>explainable by its contributing factors</strong>, the model uses{" "}
        <strong>no protected-class attributes</strong>, and a tier{" "}
        <strong>never triggers an autonomous care decision</strong>.{" "}
        <strong>
          The factors, weights, cutoffs, and patient references are illustrative
          synthetics, not a certified risk-stratification model.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {POPULATION_HEALTH_PRESETS.map((preset) => (
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
              ? "Stratifying…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Population-health run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <PopulationHealthResult view={runState.view} />}
    </section>
  );
}

function PopulationHealthResult({ view }: { view: PopulationHealthView }) {
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

  const rank = new Map(view.worklist.map((ref, i) => [ref, i + 1]));

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Panel stratification (deterministic, synthetic risk model)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <strong>{view.perPatient.length}</strong> patient
        {view.perPatient.length === 1 ? "" : "s"} stratified ·{" "}
        <Pill label="High" value={String(view.tierCounts.high)} tone={TIER_TONE.high} />{" "}
        <Pill label="Rising" value={String(view.tierCounts.rising)} tone={TIER_TONE.rising} />{" "}
        <Pill label="Low" value={String(view.tierCounts.low)} tone={TIER_TONE.low} />
      </p>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Per-patient tiers (ordered by outreach priority)
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {[...view.perPatient]
          .sort(
            (a, b) =>
              (rank.get(a.patientRef) ?? 999) - (rank.get(b.patientRef) ?? 999)
          )
          .map((p) => (
            <li
              key={p.patientRef}
              style={{
                padding: "0.6rem 0.75rem",
                borderRadius: "0.55rem",
                border: "1px solid var(--line)",
                background: "rgba(255,255,255,0.03)",
                marginBottom: "0.5rem"
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
                <strong style={{ fontSize: "0.92rem" }}>
                  #{rank.get(p.patientRef) ?? "—"} · {p.patientRef}
                </strong>
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                  <Pill label="Tier" value={p.tier} tone={TIER_TONE[p.tier]} />
                  <Pill label="Score" value={String(p.score)} tone="#9fb3c8" />
                </div>
              </div>
              {p.contributingFactors.length > 0 ? (
                <p
                  style={{
                    margin: "0.35rem 0 0",
                    fontSize: "0.8rem",
                    color: "var(--muted)"
                  }}
                >
                  {p.contributingFactors
                    .map((c) => `${c.factorLabel} +${c.points} (${c.detail})`)
                    .join(" · ")}
                </p>
              ) : (
                <p
                  style={{
                    margin: "0.35rem 0 0",
                    fontSize: "0.8rem",
                    color: "var(--muted)"
                  }}
                >
                  No contributing risk factors — baseline low tier.
                </p>
              )}
            </li>
          ))}
      </ul>

      <div
        role="note"
        aria-label="Risk-model integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
          Transparency, fairness &amp; review{" "}
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
          riskScoreTracesToFactors = {String(view.riskScoreTracesToFactors)} ·
          excludesProtectedAttributes = {String(view.excludesProtectedAttributes)} ·
          tierReviewedByHuman = {String(view.tierReviewedByHuman)}
        </p>
      </div>

      {view.worklist.length > 0 && (
        <p style={{ margin: "0.6rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
          Prioritized outreach worklist of {view.worklist.length} patient
          {view.worklist.length === 1 ? "" : "s"} routed to a care manager for
          review — no autonomous care decision was taken.
        </p>
      )}

      {traceLink}
    </div>
  );
}
