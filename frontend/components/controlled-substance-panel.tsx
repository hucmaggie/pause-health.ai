"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type ControlledSubstanceDetermination,
  type ControlledSubstanceDisposition,
  type ControlledSubstanceRequest,
  type ControlledSubstanceRiskLevel,
  DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST,
  DEMO_CONTROLLED_SUBSTANCE_OPIOID_BENZO_REQUEST,
  DEMO_CONTROLLED_SUBSTANCE_REQUEST
} from "../lib/controlled-substance";

/**
 * Controlled Substance / PDMP Safety Check runner for the intake demo.
 *
 * Fires the real, server-side A2A Controlled Substance agent at
 * /api/agents/controlled-substance/tasks — the clinical-decision service that screens a proposed
 * controlled-substance prescription against the patient's PDMP history. The panel surfaces the
 * total MME/day, the risk level + factors, the disposition, the honesty signals, the synthetic
 * labels, and a deep link into the parented Agent Fabric trace.
 *
 * A determination — low OR high risk — is a SAFE, honest OUTPUT (it completes; an elevated /
 * high-risk finding carries requiresPrescriberReview:true). The un-sourced-guideline,
 * guessed-mme, and auto-decision presets assert offending DETERMINATIONS — so all three
 * governance blocks are demonstrable in the UI rather than hidden.
 *
 * The MME thresholds + figures are ILLUSTRATIVE, NOT a certified PDMP or clinical decision
 * support (real monitoring uses the state PDMP, the CDC MME conversion factors, and the CDC 2022
 * opioid-prescribing guideline). Structure, styling tokens, and tone mirror <TimelyFilingPanel>
 * and <ImmunizationPanel> so this reads as a native sibling on /demo/intake.
 */

const CONTROLLED_SUBSTANCE_ROUTE = "/api/agents/controlled-substance/tasks";

/** A one-click demo scenario. */
export type ControlledSubstancePreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The screening request the agent evaluates (the common case). */
  request?: ControlledSubstanceRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const CONTROLLED_SUBSTANCE_PRESETS: ControlledSubstancePreset[] = [
  {
    id: "low",
    label: "Modest opioid, no history → low risk",
    hint: "30 MME/day with no concurrent controlled substances.",
    request: DEMO_CONTROLLED_SUBSTANCE_REQUEST,
    demonstrates:
      "Total below the 50 MME/day caution threshold, single prescriber → low risk, informational (no autonomous approval)."
  },
  {
    id: "high-mme",
    label: "Stacked opioids → high MME",
    hint: "Proposed 60 MME/day on top of a concurrent 40 MME/day opioid.",
    request: DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST,
    demonstrates:
      "Total 100 MME/day ≥ the 90 high-risk threshold → high risk, prescriber review (never auto-decided)."
  },
  {
    id: "opioid-benzo",
    label: "Opioid + benzodiazepine → high risk",
    hint: "A proposed opioid with a concurrent benzodiazepine from another prescriber.",
    request: DEMO_CONTROLLED_SUBSTANCE_OPIOID_BENZO_REQUEST,
    demonstrates:
      "The concurrent opioid+benzo combination (respiratory-depression risk) → high risk, prescriber review."
  },
  {
    id: "unsourced-guideline-block",
    label: "Un-sourced guideline → governance block",
    hint: "A determination citing a made-up guideline id.",
    request: DEMO_CONTROLLED_SUBSTANCE_REQUEST,
    determination: {
      requestRef: "cs-request-001",
      guidelineId: "guideline.we-made-up",
      proposedOpioidMmePerDay: 30,
      concurrentOpioidMmePerDay: 0,
      totalMmePerDay: 30,
      riskLevel: "low",
      requiresPrescriberReview: false,
      autoDecision: false
    },
    demonstrates:
      "The Agent Fabric blocking a risk finding with no recorded guideline (policy.controlledsubstance.guideline-sourced)."
  },
  {
    id: "guessed-mme-block",
    label: "Guessed MME total → governance block",
    hint: "A determination whose total doesn't equal proposed + concurrent.",
    request: DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST,
    determination: {
      requestRef: "cs-request-002",
      guidelineId: "guideline.cdc-2022-mme",
      proposedOpioidMmePerDay: 60,
      concurrentOpioidMmePerDay: 40,
      // Wrong: 60 + 40 is 100, not 30.
      totalMmePerDay: 30,
      riskLevel: "low",
      requiresPrescriberReview: false,
      autoDecision: false
    },
    demonstrates:
      "The Agent Fabric blocking a guessed MME total that does not match the computed proposed + concurrent sum (policy.controlledsubstance.mme-computed)."
  },
  {
    id: "auto-decision-block",
    label: "Auto-approved high risk → governance block",
    hint: "A determination that auto-decides a high-risk finding.",
    request: DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST,
    determination: {
      requestRef: "cs-request-002",
      guidelineId: "guideline.cdc-2022-mme",
      proposedOpioidMmePerDay: 60,
      concurrentOpioidMmePerDay: 40,
      totalMmePerDay: 100,
      riskLevel: "high",
      requiresPrescriberReview: false,
      autoDecision: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous prescribing decision on a high-risk finding (policy.controlledsubstance.no-autonomous-prescribing-decision)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type ControlledSubstanceResolvedView = {
  kind: "resolved";
  requestRef: string;
  guidelineId: string;
  proposedOpioidMmePerDay: number;
  concurrentOpioidMmePerDay: number;
  totalMmePerDay: number;
  cautionMme: number;
  highRiskMme: number;
  concurrentOpioidBenzo: boolean;
  distinctPrescribers: number;
  distinctPharmacies: number;
  riskLevel: ControlledSubstanceRiskLevel;
  riskFactors: string[];
  disposition: ControlledSubstanceDisposition;
  requiresPrescriberReview: boolean;
  reason: string;
  note: string;
  controlledSubstanceGuidelineSourced: boolean;
  controlledSubstanceMmeComputed: boolean;
  controlledSubstanceNoAutonomousDecision: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ControlledSubstanceBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ControlledSubstanceInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ControlledSubstanceView =
  | ControlledSubstanceResolvedView
  | ControlledSubstanceBlockedView
  | ControlledSubstanceInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  controlledSubstanceGuidelineSourced?: unknown;
  controlledSubstanceMmeComputed?: unknown;
  controlledSubstanceNoAutonomousDecision?: unknown;
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
export function buildControlledSubstanceRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ControlledSubstanceRequest;
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
 * POST a screening request (or an asserted determination) to the Controlled Substance agent and
 * return the resulting A2A task. `fetchImpl` is injectable so tests can stub the network
 * boundary. A governance block comes back as HTTP 200 with a `failed` task — only a malformed
 * envelope / parse error is a non-OK response.
 */
export async function runControlledSubstanceTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ControlledSubstanceRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CONTROLLED_SUBSTANCE_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildControlledSubstanceRequestBody(input))
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
export function controlledSubstanceViewFromTask(task: A2ATask): ControlledSubstanceView {
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
        "The Agent Fabric blocked this controlled-substance run.";
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
        : "The controlled-substance determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: ControlledSubstanceDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    guidelineId: det?.guidelineId ?? "",
    proposedOpioidMmePerDay: det?.proposedOpioidMmePerDay ?? 0,
    concurrentOpioidMmePerDay: det?.concurrentOpioidMmePerDay ?? 0,
    totalMmePerDay: det?.totalMmePerDay ?? 0,
    cautionMme: det?.cautionMme ?? 0,
    highRiskMme: det?.highRiskMme ?? 0,
    concurrentOpioidBenzo: det?.concurrentOpioidBenzo ?? false,
    distinctPrescribers: det?.distinctPrescribers ?? 0,
    distinctPharmacies: det?.distinctPharmacies ?? 0,
    riskLevel: det?.riskLevel ?? "low",
    riskFactors: det?.riskFactors ?? [],
    disposition: det?.disposition ?? "proceed-low-risk",
    requiresPrescriberReview: det?.requiresPrescriberReview ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    controlledSubstanceGuidelineSourced: fabric.controlledSubstanceGuidelineSourced === true,
    controlledSubstanceMmeComputed: fabric.controlledSubstanceMmeComputed === true,
    controlledSubstanceNoAutonomousDecision:
      fabric.controlledSubstanceNoAutonomousDecision === true,
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
  | { status: "done"; view: ControlledSubstanceView }
  | { status: "error"; message: string };

export function ControlledSubstancePanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ControlledSubstancePreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runControlledSubstanceTask({
          taskId: newTaskId("controlled-substance"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: controlledSubstanceViewFromTask(task) });
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
        Controlled substance · PDMP · clinical decision
      </p>
      <h3 style={{ margin: 0 }}>
        Controlled Substance — a computed MME total, never an autonomous prescribing decision
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given a proposed <strong>controlled-substance prescription</strong> and the patient&rsquo;s
        active <strong>PDMP history</strong>, this agent <strong>deterministically</strong> sums
        the total opioid <strong>MME/day</strong> (proposed + concurrent), flags a concurrent{" "}
        <strong>opioid + benzodiazepine</strong> combination and multi-prescriber / multi-pharmacy
        patterns, compares the total against the guideline&rsquo;s caution (50) and high-risk (90)
        thresholds, and classifies the <strong>risk</strong>. An elevated / high finding is a{" "}
        <strong>recommendation requiring prescriber review</strong> — the agent{" "}
        <strong>never</strong> autonomously approves, denies, or writes the prescription.{" "}
        <strong>
          The MME thresholds and figures are illustrative, not a certified PDMP or clinical advice
          — real monitoring uses the state PDMP, the CDC MME conversion factors, and the CDC 2022
          opioid-prescribing guideline.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CONTROLLED_SUBSTANCE_PRESETS.map((preset) => (
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
              ? "Screening…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Controlled-substance run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ControlledSubstanceResult view={runState.view} />}
    </section>
  );
}

function ControlledSubstanceResult({ view }: { view: ControlledSubstanceView }) {
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

  const riskTone =
    view.riskLevel === "low" ? "#8fd6b0" : view.riskLevel === "elevated" ? "#ffd28a" : "#ff9db1";

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Controlled-substance PDMP screen (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Risk" value={view.riskLevel} tone={riskTone} />{" "}
        <Pill label="Total MME/day" value={String(view.totalMmePerDay)} tone="#9db8ff" />{" "}
        <Pill
          label="Opioid+benzo"
          value={String(view.concurrentOpioidBenzo)}
          tone={view.concurrentOpioidBenzo ? "#ff9db1" : "#8fd6b0"}
        />{" "}
        <Pill
          label="Requires prescriber review"
          value={String(view.requiresPrescriberReview)}
          tone={view.requiresPrescriberReview ? "#ffd28a" : "#8fd6b0"}
        />
      </p>

      <p style={{ margin: "0.6rem 0 0", fontSize: "0.86rem", color: "var(--muted)" }}>
        Proposed {view.proposedOpioidMmePerDay} + concurrent {view.concurrentOpioidMmePerDay} ={" "}
        {view.totalMmePerDay} MME/day · caution {view.cautionMme} / high-risk {view.highRiskMme} ·{" "}
        {view.distinctPrescribers} prescriber(s) / {view.distinctPharmacies} pharmacy(ies)
      </p>

      {view.riskFactors.length > 0 && (
        <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem", fontSize: "0.86rem" }}>
          {view.riskFactors.map((f) => (
            <li key={f} style={{ color: "#ff9db1", marginBottom: "0.15rem" }}>
              {f}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Controlled-substance safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Guideline sourced · MME computed · never an autonomous prescribing decision{" "}
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
          controlledSubstanceGuidelineSourced = {String(view.controlledSubstanceGuidelineSourced)} ·
          controlledSubstanceMmeComputed = {String(view.controlledSubstanceMmeComputed)} ·
          controlledSubstanceNoAutonomousDecision ={" "}
          {String(view.controlledSubstanceNoAutonomousDecision)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
