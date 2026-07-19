"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_EQUITY_GAP_PATIENT,
  DEMO_LANGUAGE_PATIENT,
  type EquityGap,
  type InterpreterRequest,
  type LanguageAccessAssessment,
  type MaterialAvailability,
  type PatientLanguageContext
} from "../lib/language-access";

/**
 * Language Access & Health Equity runner for the intake demo.
 *
 * Fires the real, server-side A2A Language Access agent at
 * /api/agents/language-access/tasks — a patient-care EQUITY agent that ensures
 * limited-English-proficiency (LEP) patients can understand their care. It
 * determines the patient's preferred language, decides whether a QUALIFIED
 * medical interpreter is needed (and of which modality), checks approved
 * in-language materials, and flags equity / access gaps. The panel surfaces the
 * preferred language, the interpreter modality + qualified flag, the in-language
 * materials with translation provenance, the flagged equity gaps, the honesty
 * signals, and a deep link into the parented Agent Fabric trace.
 *
 * The equity-gap preset shows the agent ESCALATING to a human coordinator (a safe
 * answer, not a block) when no qualified interpreter is available. The
 * family-interpreter, unapproved-translation, and machine-translated-consent
 * presets assert offending plans — so all three governance blocks are
 * demonstrable in the UI rather than hidden.
 *
 * The languages, interpreter availability, materials, and translation provenance
 * are ILLUSTRATIVE synthetics, NOT a certified language-access system. Structure,
 * styling tokens, and tone mirror <ClinicalTrialsPanel> and <PopulationHealthPanel>
 * so this reads as a native sibling on /demo/intake.
 */

const LANGACCESS_ROUTE = "/api/agents/language-access/tasks";

/** A one-click demo scenario. */
export type LanguageAccessPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The patient the agent assesses (the common case). */
  patient?: PatientLanguageContext;
  /** Caller-asserted interpreter plan (used only for the qualified-interpreter block). */
  assertedInterpreterPlan?: Record<string, unknown>;
  /** Caller-asserted materials (used only for the source-integrity block). */
  assertedMaterials?: Array<Record<string, unknown>>;
  /** Caller-asserted consent-communication plan (used only for the machine-translation block). */
  assertedConsentPlan?: Record<string, unknown>;
};

export const LANGUAGE_ACCESS_PRESETS: LanguageAccessPreset[] = [
  {
    id: "spanish-qualified",
    label: "Spanish patient → qualified video interpreter",
    hint: "A Spanish-preferring patient with a clinical consent step.",
    patient: DEMO_LANGUAGE_PATIENT,
    demonstrates:
      "A Spanish-preferring patient matched to a QUALIFIED video interpreter with every needed material available in Spanish from the approved translated-materials catalog — no equity gaps."
  },
  {
    id: "equity-gap-escalation",
    label: "Rare language → no interpreter → escalation",
    hint: "A rare, unstaffed language with no approved materials.",
    patient: DEMO_EQUITY_GAP_PATIENT,
    demonstrates:
      "The agent flagging an equity gap — no qualified interpreter available for a rare language, and a consent form only in English — and ESCALATING to a human language-access coordinator (a safe answer, not a block); it never substitutes a family / ad-hoc / machine interpreter."
  },
  {
    id: "family-interpreter-block",
    label: "Family interpreter for clinical → governance block",
    hint: "A plan using an untrained family member for clinical communication.",
    patient: DEMO_LANGUAGE_PATIENT,
    assertedInterpreterPlan: { interpreterType: "family", qualified: false },
    demonstrates:
      "The Agent Fabric blocking a plan that would use an untrained / ad-hoc / family interpreter for clinical communication (policy.langaccess.qualified-interpreter-only)."
  },
  {
    id: "unapproved-translation-block",
    label: "Unapproved translation → governance block",
    hint: "An in-language document presented as official without an approved source.",
    patient: DEMO_LANGUAGE_PATIENT,
    assertedMaterials: [
      {
        materialId: "material.clinical-consent-form",
        materialLabel: "Clinical consent form",
        languageCode: "vi",
        available: true,
        isConsentDocument: true
      }
    ],
    demonstrates:
      "The Agent Fabric blocking an in-language material presented as official that doesn't trace to the approved translated-materials catalog — an unverified / ad-hoc translation (policy.langaccess.translated-material-source-integrity)."
  },
  {
    id: "machine-consent-block",
    label: "Machine-translated consent → governance block",
    hint: "Auto-translating a clinical consent form.",
    patient: DEMO_LANGUAGE_PATIENT,
    assertedConsentPlan: {
      translationMethod: "machine-translation",
      forClinicalConsent: true
    },
    demonstrates:
      "The Agent Fabric blocking machine / auto translation of clinical consent — clinical consent goes through a qualified human interpreter or an approved translation (policy.langaccess.no-machine-translation-for-consent)."
  }
];

/** Render-ready view of a produced assessment lifted from the task. */
export type LanguageAccessAssessedView = {
  kind: "assessed";
  patientRef: string;
  preferredLanguage: { code: string; label: string; supported: boolean } | null;
  interpreterNeeded: boolean;
  recommendedModality: string | null;
  qualifiedInterpreterAvailable: boolean;
  interpreterRequest: InterpreterRequest | null;
  materialsInLanguage: MaterialAvailability[];
  equityGaps: EquityGap[];
  note: string;
  usesQualifiedInterpreter: boolean;
  materialsTraceToApprovedSource: boolean;
  noMachineTranslationForConsent: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type LanguageAccessBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type LanguageAccessInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type LanguageAccessView =
  | LanguageAccessAssessedView
  | LanguageAccessBlockedView
  | LanguageAccessInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  usesQualifiedInterpreter?: unknown;
  materialsTraceToApprovedSource?: unknown;
  noMachineTranslationForConsent?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildClinicalTrialsRequestBody.
 */
export function buildLanguageAccessRequestBody(input: {
  taskId: string;
  personaId?: string;
  patient?: PatientLanguageContext;
  assertedInterpreterPlan?: Record<string, unknown>;
  assertedMaterials?: Array<Record<string, unknown>>;
  assertedConsentPlan?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (input.patient !== undefined) data.patient = input.patient;
  if (input.assertedInterpreterPlan !== undefined) {
    data.interpreterPlan = input.assertedInterpreterPlan;
  }
  if (input.assertedMaterials !== undefined) data.materials = input.assertedMaterials;
  if (input.assertedConsentPlan !== undefined) data.consentPlan = input.assertedConsentPlan;
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
 * POST a patient (or asserted plan / materials) to the Language Access agent and
 * return the resulting A2A task. `fetchImpl` is injectable so tests can stub the
 * network boundary. A governance block comes back as HTTP 200 with a `failed`
 * task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runLanguageAccessTask(
  input: {
    taskId: string;
    personaId?: string;
    patient?: PatientLanguageContext;
    assertedInterpreterPlan?: Record<string, unknown>;
    assertedMaterials?: Array<Record<string, unknown>>;
    assertedConsentPlan?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(LANGACCESS_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildLanguageAccessRequestBody(input))
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
export function languageAccessViewFromTask(task: A2ATask): LanguageAccessView {
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
        "The Agent Fabric blocked this language-access run.";
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
        : "The language-access assessment could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { assessment?: LanguageAccessAssessment; interpreterRequest?: InterpreterRequest }
      | undefined) ?? undefined;
  const assessment = result?.assessment;

  return {
    kind: "assessed",
    patientRef: assessment?.patientRef ?? "",
    preferredLanguage: assessment?.preferredLanguage ?? null,
    interpreterNeeded: assessment?.interpreterNeeded ?? false,
    recommendedModality: assessment?.recommendedModality ?? null,
    qualifiedInterpreterAvailable: assessment?.qualifiedInterpreterAvailable ?? false,
    interpreterRequest: result?.interpreterRequest ?? null,
    materialsInLanguage: assessment?.materialsInLanguage ?? [],
    equityGaps: assessment?.equityGaps ?? [],
    note: assessment?.note ?? "",
    usesQualifiedInterpreter: fabric.usesQualifiedInterpreter === true,
    materialsTraceToApprovedSource: fabric.materialsTraceToApprovedSource === true,
    noMachineTranslationForConsent: fabric.noMachineTranslationForConsent === true,
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

const INTERPRETER_TONE: Record<string, string> = {
  arranged: "#8fd6b0",
  "not-needed": "#9fb3c8",
  "equity-gap-escalation": "#ffd28a"
};

const SEVERITY_TONE: Record<string, string> = {
  urgent: "#ffb6c8",
  elevated: "#ffd28a",
  routine: "#9fb3c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: LanguageAccessView }
  | { status: "error"; message: string };

export function LanguageAccessPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: LanguageAccessPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runLanguageAccessTask({
          taskId: newTaskId("langaccess"),
          personaId: "demo",
          patient: preset.patient,
          assertedInterpreterPlan: preset.assertedInterpreterPlan,
          assertedMaterials: preset.assertedMaterials,
          assertedConsentPlan: preset.assertedConsentPlan
        });
        setRunState({ status: "done", view: languageAccessViewFromTask(task) });
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
        Language access &amp; health equity
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that ensures LEP patients understand their care — qualified
        interpreters, approved translations, no machine-translated consent
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Language Access agent determines a patient&apos;s{" "}
        <strong>preferred language</strong> (deferring to the Consent &amp;
        Preferences Management agent&apos;s{" "}
        <code>preferred-language</code> preference), decides whether a{" "}
        <strong>qualified medical interpreter</strong> is needed and of which
        modality, checks whether needed materials are{" "}
        <strong>available in that language</strong> from an approved
        translated-materials catalog, and <strong>flags equity gaps</strong>.
        Clinical interpretation uses a{" "}
        <strong>qualified medical interpreter only</strong> (never a family /
        ad-hoc / machine interpreter), in-language materials{" "}
        <strong>trace to an approved source</strong>, and{" "}
        <strong>machine translation is never used for clinical consent</strong>.
        When no qualified interpreter is available it{" "}
        <strong>escalates to a human coordinator</strong> — never an unqualified
        fallback.{" "}
        <strong>
          The languages, interpreter availability, materials, and provenance are
          illustrative synthetics, not a certified language-access system.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {LANGUAGE_ACCESS_PRESETS.map((preset) => (
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
          Language-access run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <LanguageAccessResult view={runState.view} />}
    </section>
  );
}

function LanguageAccessResult({ view }: { view: LanguageAccessView }) {
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

  const req = view.interpreterRequest;
  const interpreterTone = req ? INTERPRETER_TONE[req.state] ?? "#9fb3c8" : "#9fb3c8";

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Language-access assessment (deterministic, synthetic catalogs)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="Preferred language"
          value={
            view.preferredLanguage
              ? `${view.preferredLanguage.label} (${view.preferredLanguage.code})`
              : "unknown"
          }
          tone="#9fb3c8"
        />{" "}
        {req && (
          <Pill label="Interpreter" value={req.state} tone={interpreterTone} />
        )}{" "}
        <Pill
          label="Qualified interpreter available"
          value={view.qualifiedInterpreterAvailable ? "yes" : "no"}
          tone={view.qualifiedInterpreterAvailable ? "#8fd6b0" : "#ffb6c8"}
        />
      </p>

      {req && (
        <div
          role="note"
          aria-label="Interpreter arrangement"
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Interpreter ·{" "}
            <span style={{ color: interpreterTone }}>{req.state}</span>
            {req.modality ? ` · ${req.modality}` : ""}{" "}
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
            {req.body}
          </p>
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            qualified = {String(req.qualified)} · escalated ={" "}
            {String(req.escalated)}
            {req.routedTo ? ` · routedTo = ${req.routedTo}` : ""}
          </p>
        </div>
      )}

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        In-language materials (approved catalog)
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {view.materialsInLanguage.map((m) => (
          <li
            key={m.materialId}
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
                {m.materialLabel}
                {m.isConsentDocument ? " · consent" : ""}
              </strong>
              <Pill
                label="Available"
                value={m.available ? "yes" : "English only"}
                tone={m.available ? "#8fd6b0" : "#ffb6c8"}
              />
            </div>
            {m.available && m.source && (
              <p
                style={{
                  margin: "0.25rem 0 0",
                  fontSize: "0.78rem",
                  color: "var(--muted)"
                }}
              >
                provenance: {m.source}
              </p>
            )}
          </li>
        ))}
      </ul>

      {view.equityGaps.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem", color: "#ffd28a" }}>
            Equity / access gaps (escalated to a human — a safe answer, not a block)
          </p>
          <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
            {view.equityGaps.map((g) => (
              <li
                key={`${g.kind}-${g.label}`}
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
                  <strong style={{ fontSize: "0.88rem" }}>{g.label}</strong>
                  <Pill
                    label="Severity"
                    value={g.severity}
                    tone={SEVERITY_TONE[g.severity] ?? "#9fb3c8"}
                  />
                </div>
                <p
                  style={{
                    margin: "0.25rem 0 0",
                    fontSize: "0.78rem",
                    color: "var(--muted)"
                  }}
                >
                  {g.detail}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <div
        role="note"
        aria-label="Access integrity"
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
          usesQualifiedInterpreter = {String(view.usesQualifiedInterpreter)} ·
          materialsTraceToApprovedSource ={" "}
          {String(view.materialsTraceToApprovedSource)} ·
          noMachineTranslationForConsent ={" "}
          {String(view.noMachineTranslationForConsent)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
