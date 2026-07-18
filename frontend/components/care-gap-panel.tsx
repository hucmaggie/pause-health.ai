"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import type {
  CareGap,
  CareGapPriority,
  CareGapStatus,
  GapOutreachDraft,
  PatientOutreachPrefs
} from "../lib/care-gaps";

/**
 * Care Gap Closure runner for the intake demo.
 *
 * Fires the real, server-side A2A Care Gap Closure agent at
 * /api/agents/care-gap-closure/tasks — the Salesforce "Agentforce for
 * Health" / Health Cloud care-gap-closure analog — which grounds on the
 * patient's Data 360 context, DETERMINISTICALLY detects menopause-relevant
 * preventive-care gaps (bone-density/DEXA, lipid panel, mammogram, HRT
 * follow-up) against an explicit as-of date, drafts consent- and
 * quiet-hours-aware outreach for each gap, and hands the drafts to the
 * Engagement Agent. The panel surfaces the detected gaps (measure, status,
 * priority), the human-approval-gated drafts, the grounding provenance, the
 * engagement handoff, and a deep link into the parented Agent Fabric trace.
 *
 * The off-catalog preset intentionally asserts a fabricated (off-catalog)
 * gap, so policy.caregap.clinical-measure-sourced is demonstrable in the UI
 * rather than hidden; the no-consent preset trips the contact-consent gate.
 * The panel reports the failed state and which policy blocked it honestly
 * rather than fabricating a gap.
 *
 * The clinical measures + intervals are ILLUSTRATIVE synthetics, NOT a
 * certified guideline engine. Structure, styling tokens (.card,
 * .btn/.btn-primary/.btn-secondary, .eyebrow, .agentforce-voice-help-link,
 * .routing-live-result), and tone mirror <AssessmentPanel> and
 * <BenefitsPanel> so this reads as a native sibling on /demo/intake.
 */

const CARE_GAP_ROUTE = "/api/agents/care-gap-closure/tasks";

/** The detection context a preset asks the agent to ground + detect on. */
export type CareGapDetectionContext = {
  asOf?: string;
  ageBand?: string;
  cycleStatus?: string;
  primarySymptom?: string;
  onHrt?: boolean;
  riskFlags?: { osteoporosisRisk?: boolean; cardiovascularRisk?: boolean };
  measureHistory?: Record<string, string | null>;
};

/**
 * A one-click demo scenario. Most presets send a `detectionContext` the
 * agent grounds + detects on; the off-catalog preset sends caller-asserted
 * `gaps` (one off-catalog) so the integrity gate trips.
 */
export type CareGapPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** A detection context the agent grounds + detects on (the common case). */
  detectionContext?: CareGapDetectionContext;
  /** Outreach preferences the drafts are shaped to. */
  patientPrefs?: PatientOutreachPrefs;
  /** Caller-asserted gaps (used only for the off-catalog governance block). */
  assertedGaps?: Array<Record<string, unknown>>;
};

const AS_OF = "2026-02-02";

export const CARE_GAP_PRESETS: CareGapPreset[] = [
  {
    id: "postmenopausal-on-hrt",
    label: "Postmenopausal on HRT → gaps",
    hint: "51-55, 12+ months amenorrhea, on HRT, no measures on record.",
    detectionContext: {
      asOf: AS_OF,
      ageBand: "51-55",
      cycleStatus: "stopped>=12mo",
      primarySymptom: "hot_flashes",
      onHrt: true,
      measureHistory: {}
    },
    patientPrefs: { channel: "email", hasContactConsent: true },
    demonstrates:
      "A representative grounded patient — multiple catalog-sourced preventive-care gaps (DEXA, lipid, mammogram, HRT follow-up) each with a drafted, consent-aware, human-approval-gated outreach message."
  },
  {
    id: "perimenopausal-partial-history",
    label: "Perimenopausal · partial history",
    hint: "46-50 with a recent mammogram but an overdue lipid panel.",
    detectionContext: {
      asOf: AS_OF,
      ageBand: "46-50",
      cycleStatus: "irregular",
      primarySymptom: "hot_flashes",
      onHrt: false,
      measureHistory: {
        // Recent mammogram (within interval) → NOT a gap.
        "measure.mammogram": "2025-06-01",
        // Lipid panel long overdue → an overdue gap.
        "measure.lipid-panel": "2018-01-01"
      }
    },
    patientPrefs: { channel: "sms", hasContactConsent: true },
    demonstrates:
      "Per-measure history in action — an up-to-date measure is skipped while an overdue one surfaces as a gap (deterministic on the as-of date)."
  },
  {
    id: "no-consent-block",
    label: "No contact consent → block",
    hint: "Gaps exist but the patient has no active contact consent.",
    detectionContext: {
      asOf: AS_OF,
      ageBand: "51-55",
      cycleStatus: "stopped>=12mo",
      onHrt: true,
      measureHistory: {}
    },
    patientPrefs: { hasContactConsent: false },
    demonstrates:
      "The Agent Fabric refusing to draft outreach for a patient with no active contact consent (policy.marketing.consent-to-contact-required)."
  },
  {
    id: "off-catalog-block",
    label: "Off-catalog gap → governance block",
    hint: "A caller-asserted, fabricated gap that isn't in the measure catalog.",
    assertedGaps: [
      {
        measureId: "measure.totally-invented",
        measureLabel: "Invented measure",
        status: "overdue",
        lastDone: null,
        priority: "urgent",
        rationale: "fabricated"
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a fabricated, off-catalog gap that doesn't trace to a defined clinical measure (policy.caregap.clinical-measure-sourced)."
  }
];

/** Render-ready view of detected gaps + drafted outreach lifted from the task. */
export type CareGapDetectedView = {
  kind: "detected";
  gaps: CareGap[];
  drafts: GapOutreachDraft[];
  gapsTraceToClinicalMeasure: boolean;
  nextAgent?: string;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked care-gap closure. */
export type CareGapBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type CareGapInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type CareGapView = CareGapDetectedView | CareGapBlockedView | CareGapInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  gapsTraceToClinicalMeasure?: unknown;
  nextAgent?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept
 * pure (no fetch, no hooks) so it can be unit-tested without a DOM,
 * mirroring buildBenefitsRequestBody. A `detectionContext` (+ optional
 * patientPrefs) asks the agent to ground + detect; `assertedGaps` posts a
 * caller-supplied gap set as-is (used to demonstrate the integrity block).
 */
export function buildCareGapRequestBody(input: {
  taskId: string;
  personaId?: string;
  detectionContext?: CareGapDetectionContext;
  patientPrefs?: PatientOutreachPrefs;
  assertedGaps?: Array<Record<string, unknown>>;
}) {
  const data =
    input.assertedGaps !== undefined
      ? { gaps: input.assertedGaps }
      : {
          detectionContext: input.detectionContext ?? {},
          ...(input.patientPrefs ? { patientPrefs: input.patientPrefs } : {})
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
 * POST a detection context (or asserted gaps) to the Care Gap Closure agent
 * and return the resulting A2A task. `fetchImpl` is injectable so tests can
 * stub the network boundary. A governance block comes back as HTTP 200 with
 * a `failed` task — only a malformed envelope / parse error is a non-OK
 * response.
 */
export async function runCareGapTask(
  input: {
    taskId: string;
    personaId?: string;
    detectionContext?: CareGapDetectionContext;
    patientPrefs?: PatientOutreachPrefs;
    assertedGaps?: Array<Record<string, unknown>>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CARE_GAP_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCareGapRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a detected
 * gap set (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function careGapViewFromTask(task: A2ATask): CareGapView {
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
        "The Agent Fabric blocked this care-gap closure.";
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
        : "The care gaps could not be detected.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const gaps = Array.isArray(data.gaps) ? (data.gaps as CareGap[]) : [];
  const drafts = Array.isArray(data.drafts) ? (data.drafts as GapOutreachDraft[]) : [];

  return {
    kind: "detected",
    gaps,
    drafts,
    gapsTraceToClinicalMeasure: fabric.gapsTraceToClinicalMeasure === true,
    nextAgent: typeof fabric.nextAgent === "string" ? fabric.nextAgent : undefined,
    traceTaskId
  };
}

const STATUS_TONE: Record<CareGapStatus, string> = {
  open: "#8fd6b0",
  overdue: "#ffb6c8"
};
const PRIORITY_TONE: Record<CareGapPriority, string> = {
  routine: "#8fd6b0",
  elevated: "#ffd28a",
  urgent: "#ffb6c8"
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
  | { status: "done"; view: CareGapView }
  | { status: "error"; message: string };

export function CareGapPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const run = async (input: {
    label: string;
    detectionContext?: CareGapDetectionContext;
    patientPrefs?: PatientOutreachPrefs;
    assertedGaps?: Array<Record<string, unknown>>;
  }) => {
    setRunState({ status: "running", label: input.label });
    try {
      const task = await runCareGapTask({
        taskId: newTaskId("caregap"),
        personaId: "demo",
        detectionContext: input.detectionContext,
        patientPrefs: input.patientPrefs,
        assertedGaps: input.assertedGaps
      });
      setRunState({ status: "done", view: careGapViewFromTask(task) });
    } catch (err) {
      setRunState({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  };

  const runPreset = (preset: CareGapPreset) => {
    void run({
      label: preset.label,
      detectionContext: preset.detectionContext,
      patientPrefs: preset.patientPrefs,
      assertedGaps: preset.assertedGaps
    });
  };

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
        Proactive care-gap closure
      </p>
      <h3 style={{ margin: 0 }}>The Care Gap agent that closes preventive-care gaps</h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Care Gap Closure agent grounds on the patient&apos;s Data 360 context
        and{" "}
        <strong>
          deterministically detects menopause-relevant preventive-care gaps
        </strong>{" "}
        (bone-density/DEXA, lipid panel, mammogram, HRT follow-up) against an
        explicit as-of date, then drafts consent- and quiet-hours-aware outreach
        — human-approval-gated, never auto-sent — and hands it to the Engagement
        Agent. Every gap references a defined clinical-measure catalog id.{" "}
        <strong>
          The measures + intervals are illustrative synthetics, not a certified
          guideline engine.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CARE_GAP_PRESETS.map((preset) => (
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
              ? "Detecting…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Care-gap detection failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <CareGapResult view={runState.view} />}
    </section>
  );
}

function CareGapResult({ view }: { view: CareGapView }) {
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

  if (view.gaps.length === 0) {
    return (
      <div className="routing-live-result">
        <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
          No open gaps
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>
          No open preventive-care gaps detected for this patient at the as-of
          date.
        </p>
        {traceLink}
      </div>
    );
  }

  const draftByMeasure = new Map(view.drafts.map((d) => [d.measureId, d]));

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Detected gaps (grounded on Data 360, catalog-sourced)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <strong>{view.gaps.length}</strong> preventive-care gap
        {view.gaps.length === 1 ? "" : "s"} detected · each drafted for human
        review, none sent.
      </p>

      <ul style={{ margin: "0.7rem 0 0", listStyle: "none", padding: 0 }}>
        {view.gaps.map((gap) => {
          const draft = draftByMeasure.get(gap.measureId);
          return (
            <li
              key={gap.measureId}
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
                <strong style={{ fontSize: "0.92rem" }}>{gap.measureLabel}</strong>
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                  <Pill label="Status" value={gap.status} tone={STATUS_TONE[gap.status]} />
                  <Pill
                    label="Priority"
                    value={gap.priority}
                    tone={PRIORITY_TONE[gap.priority]}
                  />
                </div>
              </div>
              <p
                style={{
                  margin: "0.3rem 0 0",
                  fontSize: "0.8rem",
                  color: "var(--muted)"
                }}
              >
                {gap.rationale}
              </p>
              <p
                style={{
                  margin: "0.3rem 0 0",
                  fontSize: "0.72rem",
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                }}
              >
                {gap.measureId}
              </p>
              {draft && (
                <div
                  style={{
                    marginTop: "0.5rem",
                    paddingTop: "0.5rem",
                    borderTop: "1px solid var(--line)"
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: "0.78rem",
                      color: "var(--text)",
                      fontStyle: "italic"
                    }}
                  >
                    Draft ({draft.channel}): {draft.body}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.3rem",
                      flexWrap: "wrap",
                      marginTop: "0.35rem"
                    }}
                  >
                    <Pill
                      label="Approval"
                      value={draft.requiresHumanApproval ? "human required" : "auto"}
                      tone="#ffd28a"
                    />
                    <Pill
                      label="Sent"
                      value={draft.sent ? "yes" : "no"}
                      tone={draft.sent ? "#ffb6c8" : "#8fd6b0"}
                    />
                    <Pill
                      label="Quiet hours"
                      value={draft.quietHoursRespected ? "respected" : "ignored"}
                      tone={draft.quietHoursRespected ? "#8fd6b0" : "#ffb6c8"}
                    />
                    {draft.suppressedForNoConsent && (
                      <Pill label="Consent" value="suppressed" tone="#ffb6c8" />
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div
        role="note"
        aria-label="Grounding provenance"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
          Grounding &amp; integrity{" "}
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
          Grounded on the patient&apos;s Salesforce Data 360 context; every
          detected gap traces to a defined clinical measure — illustrative
          synthetics, not a certified guideline engine.
        </p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          gapsTraceToClinicalMeasure = {String(view.gapsTraceToClinicalMeasure)}
          {view.nextAgent ? ` · nextAgent = ${view.nextAgent}` : ""}
        </p>
      </div>

      {view.nextAgent && (
        <p style={{ margin: "0.6rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
          Drafted outreach handed to the Engagement Agent for delivery — the
          drafts stay human-approval-gated and unsent.
        </p>
      )}

      {traceLink}
    </div>
  );
}
