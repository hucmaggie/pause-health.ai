"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import type { IntakeRecord } from "../lib/care-router";
import type {
  EducationCoachingResult,
  EducationCurriculum,
  EducationModule
} from "../lib/patient-education";

/**
 * Patient Education & Health Coaching runner for the intake demo.
 *
 * Fires the real, server-side A2A Patient Education agent at
 * /api/agents/patient-education/tasks — a patient-facing ENGAGEMENT agent and
 * the FOURTH live-Claude agent (after the Care Router, Care Plan, and Clinical
 * Summary agents). It DETERMINISTICALLY selects education modules from a defined
 * evidence-sourced catalog based on the intake symptoms/severity + upstream Care
 * Plan focus areas + detected care gaps, then writes a warm, motivational
 * coaching message with live Anthropic Claude, falling back to a deterministic
 * scripted message (with a recorded fallbackReason) on a missing key or any SDK
 * error — exactly like the Care Plan agent. The panel surfaces the curriculum
 * and the coaching message, rendering `via` = claude-api or scripted-fallback
 * (and any fallbackReason) honestly.
 *
 * The off-catalog / scope / consent presets intentionally trip the three
 * education governance blocks (policy.education.evidence-sourced,
 * policy.education.no-medical-advice, policy.education.consent-before-outreach),
 * so they are demonstrable in the UI rather than hidden. The agent is also
 * governed by the model allow-list (like the Care Router).
 *
 * The education modules + source labels are ILLUSTRATIVE synthetics, NOT a
 * certified patient-education engine. Structure, styling tokens (.card,
 * .btn/.btn-primary, .eyebrow, .agentforce-voice-help-link,
 * .routing-live-result), and tone mirror <CarePlanPanel> so this reads as a
 * native sibling on /demo/intake.
 */

const PATIENT_EDUCATION_ROUTE = "/api/agents/patient-education/tasks";

/**
 * A one-click demo scenario. Most presets send an `intake` (+ optional
 * upstream signals) the agent curates from; the block presets send a
 * caller-asserted `curriculum` / scope / consent flag so a governance gate
 * trips.
 */
export type PatientEducationPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The intake record the curriculum is curated from. */
  intake?: IntakeRecord;
  /** Whether the patient is on hormone therapy. */
  onHrt?: boolean;
  /** Upstream Care Plan focus areas that steer selection. */
  carePlanFocusAreas?: string[];
  /** Detected care-gap measure ids/labels that steer selection. */
  careGapMeasures?: string[];
  /** A caller-asserted curriculum (used only for the evidence-sourced block). */
  assertedCurriculum?: Record<string, unknown>;
  /** Assert the content will give medical advice (trips the scope block). */
  deliversMedicalAdvice?: boolean;
  /** Withhold coaching consent (trips the consent-before-outreach block). */
  hasCoachingConsent?: boolean;
};

export const PATIENT_EDUCATION_PRESETS: PatientEducationPreset[] = [
  {
    id: "vasomotor-moderate",
    label: "Vasomotor · moderate",
    hint: "Perimenopausal, vasomotor-dominant → vasomotor + sleep education.",
    intake: {
      preferredName: "Ada",
      ageBand: "45-49",
      cycleStatus: "perimenopausal",
      primarySymptom: "vasomotor",
      severity: "moderate"
    },
    demonstrates:
      "A clean, deterministic curriculum from the evidence-sourced catalog plus a coaching message — rendered as live-Claude or scripted-fallback, whichever served."
  },
  {
    id: "postmenopausal-prevention",
    label: "Postmenopausal → bone + heart",
    hint: "Postmenopausal with a bone-density gap → bone + cardiovascular education.",
    intake: {
      preferredName: "Priya",
      ageBand: "51-55",
      cycleStatus: "stopped>=12mo",
      primarySymptom: "vasomotor",
      severity: "mild"
    },
    careGapMeasures: ["DEXA bone-density", "lipid panel"],
    demonstrates:
      "Deterministic selection — a postmenopausal status + a bone-density/lipid care gap steer the curriculum to bone-health and cardiovascular education."
  },
  {
    id: "mood-dominant",
    label: "Mood-dominant → mood & stress",
    hint: "Mood-dominant presentation → mood & stress education.",
    intake: {
      preferredName: "Maria",
      ageBand: "46-50",
      cycleStatus: "irregular",
      primarySymptom: "mood",
      severity: "moderate"
    },
    demonstrates:
      "A mood-dominant presentation → mood & stress education alongside the foundational nutrition + activity modules."
  },
  {
    id: "off-catalog-block",
    label: "Off-catalog topic → governance block",
    hint: "A caller-asserted, fabricated education topic not in the catalog.",
    assertedCurriculum: {
      moduleIds: ["education.totally-invented"],
      modules: [{ id: "education.totally-invented", source: "made up" }],
      patientDisplayName: "the patient",
      focusAreas: [],
      rationale: ["fabricated"],
      synthetic: true
    },
    demonstrates:
      "The Agent Fabric blocking a fabricated, off-catalog topic that doesn't trace to a defined evidence source (policy.education.evidence-sourced)."
  },
  {
    id: "medical-advice-block",
    label: "Medical advice → governance block",
    hint: "A task that asserts it will diagnose / dose / give individualized advice.",
    intake: { preferredName: "Ada", primarySymptom: "vasomotor", severity: "moderate" },
    deliversMedicalAdvice: true,
    demonstrates:
      "The Agent Fabric blocking content that strays beyond general education into diagnosis, medication dosing, or individualized medical advice (policy.education.no-medical-advice)."
  },
  {
    id: "no-consent-block",
    label: "No consent → governance block",
    hint: "A coaching push without the patient's outreach consent.",
    intake: { preferredName: "Ada", primarySymptom: "vasomotor", severity: "moderate" },
    hasCoachingConsent: false,
    demonstrates:
      "The Agent Fabric blocking a coaching push without the patient's consent — every outreach is consent-gated and human-approval-gated (policy.education.consent-before-outreach)."
  }
];

/** Render-ready view of a curated curriculum + coaching lifted from the task. */
export type PatientEducationCuratedView = {
  kind: "curated";
  patientDisplayName: string;
  moduleIds: string[];
  modules: EducationModule[];
  focusAreas: string[];
  coachingMessage: string;
  via: EducationCoachingResult["via"];
  modelProvider: string;
  model: string;
  fallbackReason?: string;
  educationTracesToEvidenceSource: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked patient-education task. */
export type PatientEducationBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type PatientEducationInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type PatientEducationView =
  | PatientEducationCuratedView
  | PatientEducationBlockedView
  | PatientEducationInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  educationTracesToEvidenceSource?: unknown;
  coachingVia?: unknown;
  fallbackReason?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildCarePlanRequestBody. An `intake` (+ optional upstream signals) asks the
 * agent to curate + coach; an `assertedCurriculum` posts a caller-supplied
 * curriculum as-is (used to demonstrate the evidence-sourced block).
 */
export function buildPatientEducationRequestBody(input: {
  taskId: string;
  personaId?: string;
  intake?: IntakeRecord;
  onHrt?: boolean;
  carePlanFocusAreas?: string[];
  careGapMeasures?: string[];
  assertedCurriculum?: Record<string, unknown>;
  deliversMedicalAdvice?: boolean;
  hasCoachingConsent?: boolean;
}) {
  const data =
    input.assertedCurriculum !== undefined
      ? { curriculum: input.assertedCurriculum }
      : {
          intake: input.intake ?? {},
          ...(input.onHrt !== undefined ? { onHrt: input.onHrt } : {}),
          ...(input.carePlanFocusAreas
            ? { carePlanFocusAreas: input.carePlanFocusAreas }
            : {}),
          ...(input.careGapMeasures ? { careGapMeasures: input.careGapMeasures } : {}),
          ...(input.deliversMedicalAdvice !== undefined
            ? { deliversMedicalAdvice: input.deliversMedicalAdvice }
            : {}),
          ...(input.hasCoachingConsent !== undefined
            ? { hasCoachingConsent: input.hasCoachingConsent }
            : {})
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
 * POST an intake (or asserted curriculum) to the Patient Education agent and
 * return the resulting A2A task. `fetchImpl` is injectable so tests can stub the
 * network boundary. A governance block comes back as HTTP 200 with a `failed`
 * task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runPatientEducationTask(
  input: {
    taskId: string;
    personaId?: string;
    intake?: IntakeRecord;
    onHrt?: boolean;
    carePlanFocusAreas?: string[];
    careGapMeasures?: string[];
    assertedCurriculum?: Record<string, unknown>;
    deliversMedicalAdvice?: boolean;
    hasCoachingConsent?: boolean;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(PATIENT_EDUCATION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPatientEducationRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a curated
 * curriculum (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function patientEducationViewFromTask(task: A2ATask): PatientEducationView {
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
        "The Agent Fabric blocked this patient-education task.";
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
        : "The education curriculum could not be curated.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const curriculum = (data.curriculum ?? {}) as Partial<EducationCurriculum>;
  const coaching = (data.coaching ?? {}) as Partial<EducationCoachingResult>;

  const via = (coaching.via ??
    (typeof fabric.coachingVia === "string"
      ? (fabric.coachingVia as EducationCoachingResult["via"])
      : "scripted-fallback")) as EducationCoachingResult["via"];
  const fallbackReason =
    coaching.fallbackReason ??
    (typeof fabric.fallbackReason === "string" ? fabric.fallbackReason : undefined);

  return {
    kind: "curated",
    patientDisplayName: curriculum.patientDisplayName ?? "the patient",
    moduleIds: curriculum.moduleIds ?? [],
    modules: curriculum.modules ?? [],
    focusAreas: curriculum.focusAreas ?? [],
    coachingMessage: coaching.coachingMessage ?? "",
    via,
    modelProvider: coaching.modelProvenance?.provider ?? "",
    model: coaching.modelProvenance?.model ?? "",
    ...(fallbackReason ? { fallbackReason } : {}),
    educationTracesToEvidenceSource:
      fabric.educationTracesToEvidenceSource === true,
    traceTaskId
  };
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.1rem 0.5rem",
        borderRadius: "999px",
        border: "1px solid var(--muted)",
        color: "var(--muted)",
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
  | { status: "done"; view: PatientEducationView }
  | { status: "error"; message: string };

export function PatientEducationPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const run = async (input: {
    label: string;
    intake?: IntakeRecord;
    onHrt?: boolean;
    carePlanFocusAreas?: string[];
    careGapMeasures?: string[];
    assertedCurriculum?: Record<string, unknown>;
    deliversMedicalAdvice?: boolean;
    hasCoachingConsent?: boolean;
  }) => {
    setRunState({ status: "running", label: input.label });
    try {
      const task = await runPatientEducationTask({
        taskId: newTaskId("patiented"),
        personaId: "demo",
        intake: input.intake,
        onHrt: input.onHrt,
        carePlanFocusAreas: input.carePlanFocusAreas,
        careGapMeasures: input.careGapMeasures,
        assertedCurriculum: input.assertedCurriculum,
        deliversMedicalAdvice: input.deliversMedicalAdvice,
        hasCoachingConsent: input.hasCoachingConsent
      });
      setRunState({ status: "done", view: patientEducationViewFromTask(task) });
    } catch (err) {
      setRunState({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  };

  const runPreset = (preset: PatientEducationPreset) => {
    void run({
      label: preset.label,
      intake: preset.intake,
      onHrt: preset.onHrt,
      carePlanFocusAreas: preset.carePlanFocusAreas,
      careGapMeasures: preset.careGapMeasures,
      assertedCurriculum: preset.assertedCurriculum,
      deliversMedicalAdvice: preset.deliversMedicalAdvice,
      hasCoachingConsent: preset.hasCoachingConsent
    });
  };

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
        Patient education &amp; health coaching (live Claude)
      </p>
      <h3 style={{ margin: 0 }}>
        The Patient Education agent — the fourth live-Claude agent
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Patient Education agent{" "}
        <strong>deterministically selects education modules</strong> from a
        defined evidence-sourced catalog (bone health, cardiovascular risk,
        sleep hygiene, vasomotor self-management, mood/stress, nutrition,
        physical activity) based on the intake symptoms/severity + upstream Care
        Plan focus areas + detected care gaps, then writes a{" "}
        <strong>warm, motivational coaching message with live Anthropic Claude</strong>
        , falling back to a deterministic scripted message (with a recorded
        reason) on a missing key or any SDK error — just like the Care Plan
        agent. It is <strong>general education only</strong> (no diagnosis,
        dosing, or individualized medical advice), every module traces to a
        defined evidence source, and any coaching outreach is consent-gated and
        human-approval-gated.{" "}
        <strong>
          The modules + source labels are illustrative synthetics, not a
          certified patient-education engine.
        </strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {PATIENT_EDUCATION_PRESETS.map((preset) => (
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
              ? "Coaching…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Patient-education run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <PatientEducationResult view={runState.view} />}
    </section>
  );
}

function PatientEducationResult({ view }: { view: PatientEducationView }) {
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
          Not curated
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
        Curated education curriculum (deterministic, evidence-sourced)
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          margin: "0.2rem 0 0"
        }}
      >
        <Pill label="Modules" value={String(view.moduleIds.length)} />
        {view.focusAreas.map((f) => (
          <Pill key={f} label="Focus" value={f} />
        ))}
      </div>

      {view.modules.length > 0 && (
        <ul
          style={{
            margin: "0.7rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.85rem"
          }}
        >
          {view.modules.map((m) => (
            <li key={m.id}>
              <strong style={{ color: "var(--text)" }}>{m.label}</strong>
              {m.keyPoints?.[0] ? ` — ${m.keyPoints[0]}` : ""}{" "}
              <span
                style={{
                  fontSize: "0.72rem",
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                }}
              >
                [{m.source}]
              </span>
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Coaching message"
        style={{
          marginTop: "0.7rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
          Coaching message{" "}
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
          {view.coachingMessage}
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
            Fell back to the deterministic scripted coach: {view.fallbackReason}
          </p>
        )}
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
          General education only — consent-gated, human-approval-gated; it never
          diagnoses, sets a medication dose, or replaces individualized advice
          from a clinician.
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
        educationTracesToEvidenceSource = {String(view.educationTracesToEvidenceSource)}
      </p>

      {traceLink}
    </div>
  );
}
