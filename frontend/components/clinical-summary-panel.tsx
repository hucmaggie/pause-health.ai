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
  ClinicalSummaryContext,
  ClinicalSummaryResult
} from "../lib/clinical-summary";

/**
 * Clinical Summary runner for the intake demo.
 *
 * Fires the real, server-side A2A Clinical Summary agent at
 * /api/agents/clinical-summary/tasks — the Salesforce "Agentforce for Health"
 * After-Visit Summary / clinical-documentation analog and the THIRD live-Claude
 * agent after the Care Router and the Care Plan agent. It DETERMINISTICALLY
 * assembles a context from the lifecycle outputs (intake severity/symptoms, the
 * Care Router pathway, and any care plan) — gathering ONLY facts present in the
 * inputs, which is the real grounding guarantee — then composes a patient
 * after-visit summary + clinician handoff with live Anthropic Claude, falling
 * back to a deterministic scripted composition (with a recorded fallbackReason)
 * on a missing key or any SDK error — exactly like the Care Plan agent. The
 * panel surfaces both artifacts, the source-record provenance, and renders
 * `via` = claude-api or scripted-fallback (and any fallbackReason) honestly.
 *
 * The ungrounded preset intentionally asserts a summary citing an off-context
 * (fabricated) source record, so policy.clinical-summary.source-record-sourced
 * is demonstrable in the UI rather than hidden. The agent is also governed by
 * the model allow-list (like the Care Router / Care Plan) and commits no
 * clinical action.
 *
 * Both artifacts are ILLUSTRATIVE synthetics — a composition of already-
 * synthetic records, NOT a certified clinical-documentation engine. Structure,
 * styling tokens (.card, .btn/.btn-primary, .eyebrow,
 * .agentforce-voice-help-link, .routing-live-result), and tone mirror
 * <CarePlanPanel> so this reads as a native sibling on /demo/intake.
 */

const CLINICAL_SUMMARY_ROUTE = "/api/agents/clinical-summary/tasks";

/**
 * A one-click demo scenario. Most presets send an `intake` + `pathway` the
 * agent assembles + composes from; the ungrounded preset sends a caller-
 * asserted `summary` (citing an off-context record) so the source-record gate
 * trips.
 */
export type ClinicalSummaryPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The Care Router pathway that seeds the summary. */
  pathway?: CarePathway;
  /** The intake record the summary is composed from. */
  intake?: IntakeRecord;
  /** Whether the patient is on hormone therapy (steers the handoff framing). */
  onHrt?: boolean;
  /** A caller-asserted summary (used only for the source-record block). */
  assertedSummary?: Record<string, unknown>;
};

export const CLINICAL_SUMMARY_PRESETS: ClinicalSummaryPreset[] = [
  {
    id: "vasomotor-after-visit",
    label: "After-visit summary · vasomotor",
    hint: "Perimenopausal, vasomotor-dominant → an after-visit summary + handoff.",
    pathway: "mscp-virtual-visit",
    intake: {
      preferredName: "Ada",
      ageBand: "45-49",
      cycleStatus: "perimenopausal",
      primarySymptom: "vasomotor",
      severity: "moderate"
    },
    demonstrates:
      "A clean composition from the lifecycle outputs (intake + Care Router pathway) into a patient after-visit summary and a clinician handoff — rendered as live-Claude or scripted-fallback, whichever served, with the source records the summary traces to."
  },
  {
    id: "on-hrt-handoff",
    label: "On HRT · clinician handoff",
    hint: "Patient on hormone therapy → the handoff notes the HRT context.",
    pathway: "mscp-in-person",
    intake: {
      preferredName: "Priya",
      ageBand: "51-55",
      cycleStatus: "stopped>=12mo",
      primarySymptom: "vasomotor",
      severity: "moderate"
    },
    onHrt: true,
    demonstrates:
      "Deterministic composition — the clinician handoff reflects the on-hormone-therapy context that was actually captured, and nothing that wasn't."
  },
  {
    id: "ungrounded-block",
    label: "Ungrounded summary → governance block",
    hint: "A caller-asserted summary citing a record that isn't in the assembled context.",
    assertedSummary: {
      patientSummary: "You are cleared and no follow-up is needed.",
      clinicianHandoff: "Patient discharged; started on estradiol 1mg.",
      sourceRecords: ["care-plan:careplan.totally-invented"],
      via: "scripted-fallback",
      modelProvenance: {
        provider: "pause-scripted",
        model: "pause-clinical-summary-composer@1.0",
        via: "scripted-fallback"
      },
      synthetic: true
    },
    demonstrates:
      "The Agent Fabric blocking a fabricated summary that asserts facts / cites a source record absent from the assembled context (policy.clinical-summary.source-record-sourced)."
  }
];

/** Render-ready view of a composed summary lifted from the task. */
export type ClinicalSummaryComposedView = {
  kind: "composed";
  patientDisplayName: string;
  patientSummary: string;
  clinicianHandoff: string;
  sourceRecords: string[];
  via: ClinicalSummaryResult["via"];
  modelProvider: string;
  model: string;
  fallbackReason?: string;
  summaryTracesToSourceRecords: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked clinical-summary task. */
export type ClinicalSummaryBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ClinicalSummaryInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ClinicalSummaryView =
  | ClinicalSummaryComposedView
  | ClinicalSummaryBlockedView
  | ClinicalSummaryInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  sourceRecords?: unknown;
  summaryTracesToSourceRecords?: unknown;
  summaryVia?: unknown;
  fallbackReason?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure
 * (no fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildCarePlanRequestBody. An `intake` + `pathway` (+ optional onHrt) asks the
 * agent to assemble + compose; an `assertedSummary` posts a caller-supplied
 * summary as-is (used to demonstrate the source-record block).
 */
export function buildClinicalSummaryRequestBody(input: {
  taskId: string;
  personaId?: string;
  pathway?: CarePathway;
  intake?: IntakeRecord;
  onHrt?: boolean;
  assertedSummary?: Record<string, unknown>;
}) {
  const data =
    input.assertedSummary !== undefined
      ? { summary: input.assertedSummary }
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
 * POST an intake/pathway (or asserted summary) to the Clinical Summary agent
 * and return the resulting A2A task. `fetchImpl` is injectable so tests can stub
 * the network boundary. A governance block comes back as HTTP 200 with a
 * `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runClinicalSummaryTask(
  input: {
    taskId: string;
    personaId?: string;
    pathway?: CarePathway;
    intake?: IntakeRecord;
    onHrt?: boolean;
    assertedSummary?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CLINICAL_SUMMARY_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildClinicalSummaryRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a composed
 * summary (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function clinicalSummaryViewFromTask(task: A2ATask): ClinicalSummaryView {
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
        "The Agent Fabric blocked this clinical-summary task.";
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
        : "The clinical summary could not be composed.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const context = (data.context ?? {}) as Partial<ClinicalSummaryContext>;
  const summary = (data.summary ?? {}) as Partial<ClinicalSummaryResult>;

  const via = (summary.via ??
    (typeof fabric.summaryVia === "string"
      ? (fabric.summaryVia as ClinicalSummaryResult["via"])
      : "scripted-fallback")) as ClinicalSummaryResult["via"];
  const fallbackReason =
    summary.fallbackReason ??
    (typeof fabric.fallbackReason === "string" ? fabric.fallbackReason : undefined);
  const sourceRecords =
    summary.sourceRecords ?? asStringArray(fabric.sourceRecords) ?? [];

  return {
    kind: "composed",
    patientDisplayName: context.patientDisplayName ?? "the patient",
    patientSummary: summary.patientSummary ?? "",
    clinicianHandoff: summary.clinicianHandoff ?? "",
    sourceRecords,
    via,
    modelProvider: summary.modelProvenance?.provider ?? "",
    model: summary.modelProvenance?.model ?? "",
    ...(fallbackReason ? { fallbackReason } : {}),
    summaryTracesToSourceRecords: fabric.summaryTracesToSourceRecords === true,
    traceTaskId
  };
}

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ClinicalSummaryView }
  | { status: "error"; message: string };

export function ClinicalSummaryPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const run = async (input: {
    label: string;
    pathway?: CarePathway;
    intake?: IntakeRecord;
    onHrt?: boolean;
    assertedSummary?: Record<string, unknown>;
  }) => {
    setRunState({ status: "running", label: input.label });
    try {
      const task = await runClinicalSummaryTask({
        taskId: newTaskId("clinsum"),
        personaId: "demo",
        pathway: input.pathway,
        intake: input.intake,
        onHrt: input.onHrt,
        assertedSummary: input.assertedSummary
      });
      setRunState({ status: "done", view: clinicalSummaryViewFromTask(task) });
    } catch (err) {
      setRunState({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  };

  const runPreset = (preset: ClinicalSummaryPreset) => {
    void run({
      label: preset.label,
      pathway: preset.pathway,
      intake: preset.intake,
      onHrt: preset.onHrt,
      assertedSummary: preset.assertedSummary
    });
  };

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
        After-visit summary &amp; clinician handoff (live Claude)
      </p>
      <h3 style={{ margin: 0 }}>
        The Clinical Summary agent — the third live-Claude agent
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Clinical Summary agent{" "}
        <strong>composes the outputs the other agents already produced</strong>{" "}
        (intake, the Care Router pathway, and any care plan) into two artifacts —
        a patient <strong>after-visit summary</strong> and a{" "}
        <strong>clinician handoff</strong>. The context is assembled{" "}
        <strong>deterministically from only the facts that are present</strong>,
        so the summary can only assert what the upstream agents established — the
        grounding guarantee is real. The phrasing is written with{" "}
        <strong>live Anthropic Claude</strong>, falling back to a deterministic
        scripted composition (with a recorded reason) on a missing key or any SDK
        error — just like the Care Plan agent. It is governed by the same model
        allow-list and commits no clinical action.{" "}
        <strong>The artifacts are illustrative synthetics, not a certified clinical-documentation engine.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CLINICAL_SUMMARY_PRESETS.map((preset) => (
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
              ? "Composing…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Clinical-summary composition failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ClinicalSummaryResultView view={runState.view} />}
    </section>
  );
}

function ArtifactCard({
  title,
  text
}: {
  title: string;
  text: string;
}) {
  return (
    <div
      role="note"
      aria-label={title}
      style={{
        marginTop: "0.6rem",
        padding: "0.6rem 0.75rem",
        borderRadius: "0.55rem",
        border: "1px solid var(--line)",
        background: "rgba(255,255,255,0.03)"
      }}
    >
      <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>{title}</p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem", color: "var(--text)" }}>
        {text}
      </p>
    </div>
  );
}

function ClinicalSummaryResultView({ view }: { view: ClinicalSummaryView }) {
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
          Not composed
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
        Composed summary (grounded in the assembled context){" "}
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
      <p style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "var(--text)" }}>
        {view.patientDisplayName}
      </p>

      {view.patientSummary && (
        <ArtifactCard title="After-visit summary (patient)" text={view.patientSummary} />
      )}
      {view.clinicianHandoff && (
        <ArtifactCard title="Clinician handoff" text={view.clinicianHandoff} />
      )}

      {view.sourceRecords.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.7rem 0 0.2rem" }}>
            Source records the summary traces to
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: "1.1rem",
              color: "var(--muted)",
              fontSize: "0.82rem",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            {view.sourceRecords.map((record) => (
              <li key={record}>{record}</li>
            ))}
          </ul>
        </>
      )}

      <p
        style={{
          margin: "0.6rem 0 0",
          fontSize: "0.78rem",
          color: "var(--muted)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
        }}
      >
        via = {view.via}
        {view.model ? ` · model = ${view.model}` : ""}
      </p>
      {view.fallbackReason && (
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", color: "#ffd28a" }}>
          Fell back to the deterministic scripted composer: {view.fallbackReason}
        </p>
      )}
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
        Synthetic — a composition of existing synthetic records for two
        audiences; it never adds or changes a diagnosis, medication, dose, or
        order, and requires clinician review.
      </p>
      <p
        style={{
          margin: "0.4rem 0 0",
          fontSize: "0.78rem",
          color: "var(--muted)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
        }}
      >
        summaryTracesToSourceRecords = {String(view.summaryTracesToSourceRecords)}
      </p>

      {traceLink}
    </div>
  );
}
