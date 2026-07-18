"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_TRIAL_PATIENT,
  type PatientTrialContext,
  type StudyMatch,
  type TrialMatchResult,
  type TrialOutreach
} from "../lib/clinical-trials";

/**
 * Clinical Trials & Research Matching runner for the intake demo.
 *
 * Fires the real, server-side A2A Clinical Trials agent at
 * /api/agents/clinical-trials/tasks — the Salesforce "Agentforce for Health" /
 * Health Cloud clinical-trials / research-matching analog — which matches a
 * single patient's STRUCTURED context against a synthetic study catalog's
 * DEFINED eligibility criteria, ranks the matching studies with per-criterion
 * explanations, and drafts a CONSENT-GATED outreach that NEVER auto-enrolls. The
 * panel surfaces the eligible count, the per-study matched/failed criteria, the
 * recommended studies, the consent-gated outreach state, the honesty signals,
 * and a deep link into the parented Agent Fabric trace.
 *
 * The no-consent preset shows the agent WITHHOLDING an active outreach (a safe
 * answer, not a block). The off-catalog-eligibility preset asserts a fabricated
 * eligibility determination, the outreach-without-consent preset asserts an
 * active outreach lacking research consent, and the autonomous-enrollment preset
 * asserts an enrolled outreach — so all three trials governance blocks are
 * demonstrable in the UI rather than hidden.
 *
 * The catalog + sponsors + criteria + patientRef are ILLUSTRATIVE synthetics,
 * NOT a certified trial-eligibility engine. Structure, styling tokens, and tone
 * mirror <PopulationHealthPanel> and <ConsentManagementPanel> so this reads as a
 * native sibling on /demo/intake.
 */

const TRIALS_ROUTE = "/api/agents/clinical-trials/tasks";

/** A one-click demo scenario. */
export type ClinicalTrialsPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The patient the agent matches (the common case). */
  patient?: PatientTrialContext;
  /** Whether the patient's research consent is present. */
  researchConsent?: boolean;
  /** Caller-asserted matches (used only for the off-catalog-eligibility block). */
  assertedMatches?: Array<Record<string, unknown>>;
  /** Caller-asserted outreach (used only for the consent / enrollment blocks). */
  assertedOutreach?: Record<string, unknown>;
};

export const CLINICAL_TRIALS_PRESETS: ClinicalTrialsPreset[] = [
  {
    id: "match-with-consent",
    label: "Match + research consent → outreach drafted",
    hint: "A synthetic patient matching several studies, with consent.",
    patient: DEMO_TRIAL_PATIENT,
    researchConsent: true,
    demonstrates:
      "A patient matched against the synthetic study catalog with per-criterion explanations, eligible studies ranked, and a consent-gated outreach drafted (research consent present) — never an enrollment."
  },
  {
    id: "match-no-consent",
    label: "Match, no research consent → outreach withheld",
    hint: "Eligible studies, but the research consent scope is absent.",
    patient: DEMO_TRIAL_PATIENT,
    researchConsent: false,
    demonstrates:
      "The agent matching eligible studies but WITHHOLDING outreach because the patient's research consent is not present (a safe answer, not a block) — it defers to the `research` consent scope the Consent & Preferences Management agent holds."
  },
  {
    id: "off-catalog-eligibility-block",
    label: "Fabricated eligibility → governance block",
    hint: "An eligibility determination that isn't a defined criterion.",
    patient: DEMO_TRIAL_PATIENT,
    assertedMatches: [
      {
        studyId: "study.vms-nonhormonal-rct",
        title: "Off-catalog eligibility",
        eligible: true,
        matchedCriteria: [{ criterionId: "crit.fabricated-ad-hoc" }],
        failedCriteria: [],
        matchScore: 1
      }
    ],
    demonstrates:
      "The Agent Fabric blocking an eligibility determination that doesn't trace to a defined study criterion — a fabricated / ad-hoc eligibility (policy.trials.eligibility-criteria-sourced)."
  },
  {
    id: "outreach-without-consent-block",
    label: "Outreach without consent → governance block",
    hint: "An active outreach asserted with no research consent.",
    patient: DEMO_TRIAL_PATIENT,
    assertedOutreach: {
      state: "drafted",
      invitedStudyIds: ["study.vms-nonhormonal-rct"],
      body: "override",
      researchConsentPresent: false,
      requiresInformedConsent: true,
      requiresHuman: true,
      enrolled: false
    },
    demonstrates:
      "The Agent Fabric blocking an active trial outreach drafted without the patient's research consent (policy.trials.research-consent-required)."
  },
  {
    id: "autonomous-enrollment-block",
    label: "Autonomous enrollment → governance block",
    hint: "An outreach asserted as enrolled / not human-gated.",
    patient: DEMO_TRIAL_PATIENT,
    assertedOutreach: {
      state: "drafted",
      invitedStudyIds: ["study.vms-nonhormonal-rct"],
      body: "override",
      researchConsentPresent: true,
      requiresInformedConsent: true,
      requiresHuman: false,
      enrolled: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous enrollment — the agent may never enroll a patient on its own; enrollment requires informed consent + a human (policy.trials.no-autonomous-enrollment)."
  }
];

/** Render-ready view of a produced match lifted from the task. */
export type ClinicalTrialsMatchedView = {
  kind: "matched";
  patientRef: string;
  matches: StudyMatch[];
  eligibleCount: number;
  recommendedStudyIds: string[];
  outreach: TrialOutreach | null;
  note: string;
  eligibilityTracesToCriteria: boolean;
  researchConsentPresent: boolean;
  enrollmentRequiresHuman: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ClinicalTrialsBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ClinicalTrialsInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ClinicalTrialsView =
  | ClinicalTrialsMatchedView
  | ClinicalTrialsBlockedView
  | ClinicalTrialsInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  eligibilityTracesToCriteria?: unknown;
  researchConsentPresent?: unknown;
  enrollmentRequiresHuman?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildPopulationHealthRequestBody.
 */
export function buildClinicalTrialsRequestBody(input: {
  taskId: string;
  personaId?: string;
  patient?: PatientTrialContext;
  researchConsent?: boolean;
  assertedMatches?: Array<Record<string, unknown>>;
  assertedOutreach?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (input.patient !== undefined) data.patient = input.patient;
  if (input.researchConsent !== undefined) data.researchConsent = input.researchConsent;
  if (input.assertedMatches !== undefined) data.matches = input.assertedMatches;
  if (input.assertedOutreach !== undefined) data.outreach = input.assertedOutreach;
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
 * POST a patient (or asserted matches / outreach) to the Clinical Trials agent
 * and return the resulting A2A task. `fetchImpl` is injectable so tests can stub
 * the network boundary. A governance block comes back as HTTP 200 with a
 * `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runClinicalTrialsTask(
  input: {
    taskId: string;
    personaId?: string;
    patient?: PatientTrialContext;
    researchConsent?: boolean;
    assertedMatches?: Array<Record<string, unknown>>;
    assertedOutreach?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(TRIALS_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildClinicalTrialsRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced match
 * (completed) from a governance block vs. an invalid request (both `failed`,
 * told apart by metadata.agentFabric.decision).
 */
export function clinicalTrialsViewFromTask(task: A2ATask): ClinicalTrialsView {
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
        "The Agent Fabric blocked this clinical-trials run.";
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
        : "The trial match could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result = (data.result as TrialMatchResult | undefined) ?? undefined;

  return {
    kind: "matched",
    patientRef: result?.patientRef ?? "",
    matches: result?.matches ?? [],
    eligibleCount: result?.eligibleCount ?? 0,
    recommendedStudyIds: result?.recommendedStudyIds ?? [],
    outreach: result?.outreach ?? null,
    note: result?.note ?? "",
    eligibilityTracesToCriteria: fabric.eligibilityTracesToCriteria === true,
    researchConsentPresent: fabric.researchConsentPresent === true,
    enrollmentRequiresHuman: fabric.enrollmentRequiresHuman === true,
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

const OUTREACH_TONE: Record<string, string> = {
  drafted: "#8fd6b0",
  "consent-required": "#ffd28a",
  "no-eligible-studies": "#9fb3c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ClinicalTrialsView }
  | { status: "error"; message: string };

export function ClinicalTrialsPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ClinicalTrialsPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runClinicalTrialsTask({
          taskId: newTaskId("trials"),
          personaId: "demo",
          patient: preset.patient,
          researchConsent: preset.researchConsent,
          assertedMatches: preset.assertedMatches,
          assertedOutreach: preset.assertedOutreach
        });
        setRunState({ status: "done", view: clinicalTrialsViewFromTask(task) });
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
        Clinical trials &amp; research matching
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that matches a patient to research studies — consent-gated,
        never auto-enrolled
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Clinical Trials agent matches a single patient against a{" "}
        <strong>synthetic study catalog</strong> using{" "}
        <strong>structured eligibility criteria</strong> (age band, symptom
        profile, comorbidities, geography, prior therapy), returns the matching
        studies <strong>ranked with per-criterion explanations</strong>, and
        drafts a <strong>consent-gated outreach</strong>. Every eligibility
        determination <strong>traces to a defined criterion</strong>, outreach is{" "}
        <strong>gated on the patient&apos;s research consent</strong> (it defers
        to the Consent &amp; Preferences Management agent&apos;s{" "}
        <code>research</code> scope), and the agent{" "}
        <strong>never auto-enrolls</strong> — enrollment requires informed
        consent and a human.{" "}
        <strong>
          The study catalog, sponsors, and criteria are illustrative synthetics,
          not real studies or a certified eligibility engine.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CLINICAL_TRIALS_PRESETS.map((preset) => (
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
              ? "Matching…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Clinical-trials run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ClinicalTrialsResult view={runState.view} />}
    </section>
  );
}

function ClinicalTrialsResult({ view }: { view: ClinicalTrialsView }) {
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

  const outreach = view.outreach;
  const outreachTone = outreach ? OUTREACH_TONE[outreach.state] ?? "#9fb3c8" : "#9fb3c8";
  const recommended = new Set(view.recommendedStudyIds);

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Trial match (deterministic, synthetic study catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <strong>{view.matches.length}</strong> stud
        {view.matches.length === 1 ? "y" : "ies"} evaluated ·{" "}
        <Pill label="Eligible" value={String(view.eligibleCount)} tone="#8fd6b0" />{" "}
        {outreach && (
          <Pill label="Outreach" value={outreach.state} tone={outreachTone} />
        )}
      </p>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Per-study matches (eligible first)
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {view.matches.map((m) => (
          <li
            key={m.studyId}
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
                {m.title}
                {recommended.has(m.studyId) ? " · recommended" : ""}
              </strong>
              <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                <Pill
                  label="Eligible"
                  value={m.eligible ? "yes" : "no"}
                  tone={m.eligible ? "#8fd6b0" : "#ffb6c8"}
                />
                <Pill label="Score" value={String(m.matchScore)} tone="#9fb3c8" />
              </div>
            </div>
            {m.matchedCriteria.length > 0 && (
              <p
                style={{
                  margin: "0.35rem 0 0",
                  fontSize: "0.8rem",
                  color: "var(--muted)"
                }}
              >
                ✓ {m.matchedCriteria.map((c) => `${c.label} (${c.detail})`).join(" · ")}
              </p>
            )}
            {m.failedCriteria.length > 0 && (
              <p
                style={{
                  margin: "0.2rem 0 0",
                  fontSize: "0.8rem",
                  color: "#ffb6c8"
                }}
              >
                ✗ {m.failedCriteria.map((c) => `${c.label} (${c.detail})`).join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>

      {outreach && (
        <div
          role="note"
          aria-label="Consent-gated outreach"
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Consent-gated outreach ·{" "}
            <span style={{ color: outreachTone }}>{outreach.state}</span>{" "}
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
            {outreach.body}
          </p>
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            researchConsentPresent = {String(outreach.researchConsentPresent)} ·
            requiresHuman = {String(outreach.requiresHuman)} · enrolled ={" "}
            {String(outreach.enrolled)}
          </p>
        </div>
      )}

      <div
        role="note"
        aria-label="Match integrity"
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
          eligibilityTracesToCriteria = {String(view.eligibilityTracesToCriteria)} ·
          researchConsentPresent = {String(view.researchConsentPresent)} ·
          enrollmentRequiresHuman = {String(view.enrollmentRequiresHuman)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
