"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_ACP_PATIENT,
  DEMO_LEP_ACP_PATIENT,
  type AcpAssessment,
  type AcpFlag,
  type ConversationPrompt,
  type DirectiveAssessment,
  type DirectiveChangeProposal,
  type DirectiveOnFile,
  type PatientAcpContext
} from "../lib/advance-care-planning";

/**
 * Advance Care Planning runner for the intake demo.
 *
 * Fires the real, server-side A2A ACP agent at
 * /api/agents/advance-care-planning/tasks — a whole-person-care ACP touchpoint
 * agent that surfaces which advance directives are on file for a midlife/
 * menopause patient, flags missing / stale / language-access gaps, and drafts
 * a consent-gated conversation prompt. The panel surfaces the per-directive
 * status, the completeness percentage, the flagged gaps, the consent-gated
 * conversation prompt (or the WITHHELD LEP path), the honesty signals, and a
 * deep link into the parented Agent Fabric trace.
 *
 * The LEP-withheld, verbal-source, autonomous-apply, and LEP-active
 * governance-block presets assert offending plans — so all three governance
 * blocks are demonstrable in the UI rather than hidden.
 *
 * The directive catalog, approved-source labels, and staleness threshold are
 * ILLUSTRATIVE synthetics, NOT a certified advance-directives registry.
 * Structure, styling tokens, and tone mirror <HedisQualityPanel> and
 * <LanguageAccessPanel> so this reads as a native sibling on /demo/intake.
 */

const ACP_ROUTE = "/api/agents/advance-care-planning/tasks";

/** A one-click demo scenario. */
export type AdvanceCarePlanningPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The patient the agent assesses. */
  patient?: PatientAcpContext;
  /** Caller-asserted on-file directives (used only for the source-integrity block). */
  assertedOnFile?: Array<Record<string, unknown>>;
  /** Caller-asserted directive-change proposals (used only for the no-autonomous-change block). */
  assertedProposals?: Array<Record<string, unknown>>;
  /** Caller-asserted language-access plan (used only for the language-access-integrity block). */
  assertedPlan?: Record<string, unknown>;
};

export const ADVANCE_CARE_PLANNING_PRESETS: AdvanceCarePlanningPreset[] = [
  {
    id: "english-happy-path",
    label: "English patient → drafted conversation prompt",
    hint: "DPOA-HC on file, living will missing (midlife touchpoint).",
    patient: DEMO_ACP_PATIENT,
    demonstrates:
      "An English-speaking midlife patient with a DPOA-HC on file but no living will — the agent drafts a consent-gated conversation prompt for the care team to deliver, with a missing-universal-directive flag; every directive on file traces to the catalog + an approved source, and no directive change is autonomously applied."
  },
  {
    id: "lep-withheld",
    label: "LEP patient → withheld prompt → escalation",
    hint: "Spanish-preferring patient with no interpreter plan.",
    patient: DEMO_LEP_ACP_PATIENT,
    demonstrates:
      "The agent WITHHOLDING the active ACP conversation for an LEP patient with no qualified-interpreter plan and flagging a language-access-required gap — a safe completed answer (not a governance block); the agent defers to the Language Access & Health Equity agent."
  },
  {
    id: "verbal-source-block",
    label: "Verbal-only directive → governance block",
    hint: "Claiming a directive with a verbal / undocumented source.",
    patient: DEMO_ACP_PATIENT,
    assertedOnFile: [
      {
        directiveId: "directive.dpoahc",
        source: "verbal-not-documented",
        executedDate: "2024-01-01"
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a claimed directive on file that doesn't trace to the catalog + an approved source (a verbal / ad-hoc source) — the guard against fabricating a directive to inflate ACP completeness (policy.acp.directive-source-integrity)."
  },
  {
    id: "auto-apply-block",
    label: "Autonomous directive change → governance block",
    hint: "A plan that would apply a directive change without clinician + patient sign-off.",
    patient: DEMO_ACP_PATIENT,
    assertedProposals: [
      {
        directiveId: "directive.living-will",
        proposedChange: "auto-execute",
        requiresClinicianAndPatientSignoff: false,
        applied: true,
        state: "applied"
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a directive change that bypasses the clinician + patient sign-off gate — a directive is a legal / clinical instrument, and the agent NEVER autonomously creates, updates, or overrides one (policy.acp.no-autonomous-directive-change)."
  },
  {
    id: "lep-active-block",
    label: "LEP + no interpreter + active prompt → governance block",
    hint: "A plan claiming an active ACP conversation for an LEP patient with no interpreter.",
    patient: DEMO_LEP_ACP_PATIENT,
    assertedPlan: {
      preferredLanguageCode: "es",
      qualifiedInterpreterPlanned: false,
      conversationPromptState: "drafted"
    },
    demonstrates:
      "The Agent Fabric blocking an active ACP conversation drafted for an LEP patient with no documented qualified-interpreter plan — a legally-consequential conversation must not be held in a language the patient cannot participate in (policy.acp.language-access-integrity)."
  }
];

/** Render-ready view of a produced assessment lifted from the task. */
export type AcpAssessedView = {
  kind: "assessed";
  patientRef: string;
  asOfDate: string;
  preferredLanguageCode: string;
  qualifiedInterpreterPlanned: boolean;
  perDirective: DirectiveAssessment[];
  completeness: number;
  flags: AcpFlag[];
  conversationPrompt: ConversationPrompt;
  proposal: DirectiveChangeProposal | null;
  note: string;
  directivesTraceToCatalog: boolean;
  directiveChangeRequiresHumanSignoff: boolean;
  languageAccessSatisfied: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type AcpBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type AcpInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type AdvanceCarePlanningView =
  | AcpAssessedView
  | AcpBlockedView
  | AcpInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  directivesTraceToCatalog?: unknown;
  directiveChangeRequiresHumanSignoff?: unknown;
  languageAccessSatisfied?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure
 * (no fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildAdvanceCarePlanningRequestBody(input: {
  taskId: string;
  personaId?: string;
  patient?: PatientAcpContext;
  assertedOnFile?: Array<Record<string, unknown>>;
  assertedProposals?: Array<Record<string, unknown>>;
  assertedPlan?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (input.patient !== undefined) data.patient = input.patient;
  if (input.assertedOnFile !== undefined) data.onFile = input.assertedOnFile;
  if (input.assertedProposals !== undefined) data.proposal = input.assertedProposals;
  if (input.assertedPlan !== undefined) data.plan = input.assertedPlan;
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
 * POST a patient (or an asserted plan) to the ACP agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the
 * network boundary. A governance block comes back as HTTP 200 with a `failed`
 * task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runAdvanceCarePlanningTask(
  input: {
    taskId: string;
    personaId?: string;
    patient?: PatientAcpContext;
    assertedOnFile?: Array<Record<string, unknown>>;
    assertedProposals?: Array<Record<string, unknown>>;
    assertedPlan?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(ACP_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAdvanceCarePlanningRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * assessment (completed) from a governance block vs. an invalid request.
 */
export function advanceCarePlanningViewFromTask(
  task: A2ATask
): AdvanceCarePlanningView {
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
        "The Agent Fabric blocked this advance-care-planning run.";
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
        : "The advance-care-planning assessment could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { assessment?: AcpAssessment; proposal?: DirectiveChangeProposal }
      | undefined) ?? undefined;
  const assessment = result?.assessment;

  return {
    kind: "assessed",
    patientRef: assessment?.patientRef ?? "",
    asOfDate: assessment?.asOfDate ?? "",
    preferredLanguageCode: assessment?.preferredLanguageCode ?? "en",
    qualifiedInterpreterPlanned:
      assessment?.qualifiedInterpreterPlanned ?? false,
    perDirective: assessment?.perDirective ?? [],
    completeness: assessment?.completeness ?? 0,
    flags: assessment?.flags ?? [],
    conversationPrompt:
      assessment?.conversationPrompt ?? {
        state: "drafted",
        actionable: false,
        languageCode: "en",
        qualifiedInterpreterPlanned: false,
        body: ""
      },
    proposal: result?.proposal ?? null,
    note: assessment?.note ?? "",
    directivesTraceToCatalog: fabric.directivesTraceToCatalog === true,
    directiveChangeRequiresHumanSignoff:
      fabric.directiveChangeRequiresHumanSignoff === true,
    languageAccessSatisfied: fabric.languageAccessSatisfied === true,
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
  "on-file": "#8fd6b0",
  "on-file-stale": "#ffd28a",
  missing: "#ffb6c8",
  "not-applicable": "#9fb3c8"
};

const SEVERITY_TONE: Record<string, string> = {
  urgent: "#ffb6c8",
  elevated: "#ffd28a",
  routine: "#9fb3c8"
};

const PROMPT_TONE: Record<string, string> = {
  drafted: "#8fd6b0",
  "withheld-language-access-required": "#ffd28a"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: AdvanceCarePlanningView }
  | { status: "error"; message: string };

export function AdvanceCarePlanningPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: AdvanceCarePlanningPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runAdvanceCarePlanningTask({
          taskId: newTaskId("acp"),
          personaId: "demo",
          patient: preset.patient,
          assertedOnFile: preset.assertedOnFile,
          assertedProposals: preset.assertedProposals,
          assertedPlan: preset.assertedPlan
        });
        setRunState({
          status: "done",
          view: advanceCarePlanningViewFromTask(task)
        });
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
        Advance care planning (midlife touchpoint)
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that surfaces a patient&apos;s advance directives — never
        applies a change autonomously
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The ACP agent uses perimenopause / menopause as a natural{" "}
        <strong>midlife touchpoint</strong> to surface which advance directives
        are on file (living will, DPOA-HC; POLST only for serious-illness),
        flag missing / stale / language-access gaps, and{" "}
        <strong>draft a consent-gated conversation prompt</strong> for the
        care team to deliver. Every directive on file must{" "}
        <strong>trace to the catalog + an approved source</strong>, every
        directive change is{" "}
        <strong>clinician + patient sign-off gated</strong> — the agent NEVER
        autonomously creates, updates, or overrides a directive — and for a
        limited-English-proficiency (LEP) patient the active prompt is{" "}
        <strong>withheld</strong> until a qualified-interpreter plan is
        documented (a safe answer, not a governance block).{" "}
        <strong>
          The directive catalog, source labels, and staleness threshold are
          illustrative synthetics, not a certified advance-directives registry.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {ADVANCE_CARE_PLANNING_PRESETS.map((preset) => (
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
          Advance-care-planning run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && (
        <AdvanceCarePlanningResult view={runState.view} />
      )}
    </section>
  );
}

function AdvanceCarePlanningResult({
  view
}: {
  view: AdvanceCarePlanningView;
}) {
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

  const prompt = view.conversationPrompt;
  const promptTone = PROMPT_TONE[prompt.state] ?? "#9fb3c8";

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        ACP assessment (deterministic, synthetic catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="Preferred language"
          value={view.preferredLanguageCode}
          tone="#9fb3c8"
        />{" "}
        <Pill label="As of" value={view.asOfDate} tone="#9fb3c8" />{" "}
        <Pill
          label="Completeness"
          value={`${Math.round(view.completeness * 100)}%`}
          tone={
            view.completeness >= 0.8
              ? "#8fd6b0"
              : view.completeness >= 0.5
              ? "#ffd28a"
              : "#ffb6c8"
          }
        />{" "}
        <Pill label="Prompt" value={prompt.state} tone={promptTone} />
      </p>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Directives on file
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {view.perDirective.map((d) => (
          <li
            key={d.directiveId}
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
                {d.directiveLabel}
                {d.recommended ? "" : " · not applicable"}
              </strong>
              <Pill
                label="Status"
                value={d.status}
                tone={STATUS_TONE[d.status] ?? "#9fb3c8"}
              />
            </div>
            {(d.status === "on-file" || d.status === "on-file-stale") && (
              <p
                style={{
                  margin: "0.25rem 0 0",
                  fontSize: "0.78rem",
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                }}
              >
                executedDate = {d.executedDate} · ageInDays = {d.ageInDays} ·
                source = {d.source}
                {d.languageCode ? ` · languageCode = ${d.languageCode}` : ""}
              </p>
            )}
          </li>
        ))}
      </ul>

      {view.flags.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem", color: "#ffd28a" }}>
            ACP flags (a safe output, not a governance block)
          </p>
          <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
            {view.flags.map((f) => (
              <li
                key={`${f.kind}-${f.label}`}
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
                  <strong style={{ fontSize: "0.88rem" }}>{f.label}</strong>
                  <Pill
                    label="Severity"
                    value={f.severity}
                    tone={SEVERITY_TONE[f.severity] ?? "#9fb3c8"}
                  />
                </div>
                <p
                  style={{
                    margin: "0.25rem 0 0",
                    fontSize: "0.78rem",
                    color: "var(--muted)"
                  }}
                >
                  {f.detail}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <div
        role="note"
        aria-label="Conversation prompt"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
          Conversation prompt ·{" "}
          <span style={{ color: promptTone }}>{prompt.state}</span>{" "}
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
          {prompt.body}
        </p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          languageCode = {prompt.languageCode} · qualifiedInterpreterPlanned ={" "}
          {String(prompt.qualifiedInterpreterPlanned)} · actionable ={" "}
          {String(prompt.actionable)}
        </p>
      </div>

      {view.proposal && (
        <div
          role="note"
          aria-label="Directive change proposal"
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Directive change proposal ·{" "}
            <span style={{ color: "#ffd28a" }}>{view.proposal.state}</span>
          </p>
          <p style={{ margin: "0.3rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
            {view.proposal.body}
          </p>
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            requiresClinicianAndPatientSignoff ={" "}
            {String(view.proposal.requiresClinicianAndPatientSignoff)} · applied ={" "}
            {String(view.proposal.applied)}
          </p>
        </div>
      )}

      <div
        role="note"
        aria-label="ACP integrity"
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
          directivesTraceToCatalog = {String(view.directivesTraceToCatalog)} ·
          directiveChangeRequiresHumanSignoff ={" "}
          {String(view.directiveChangeRequiresHumanSignoff)} ·
          languageAccessSatisfied = {String(view.languageAccessSatisfied)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
