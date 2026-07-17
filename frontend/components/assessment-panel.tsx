"use client";

import { useMemo, useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  ALLOWLISTED_INSTRUMENTS,
  getInstrumentSpec,
  type AssessmentInstrument,
  type AssessmentRedFlag,
  type AssessmentSubscore,
  type IntakeSeverity
} from "../lib/assessments";

/**
 * Assessment-agent runner for the intake demo.
 *
 * Fires the real, server-side A2A Assessment agent at
 * /api/agents/assessment/tasks — a validated instrument (MRS, Greene,
 * PHQ-9, ISI) is DETERMINISTICALLY scored (no LLM: real cutoff math) and
 * the panel surfaces the structured result (subscores + bands, total /
 * maxTotal → band → normalized intake severity, red flags) plus a deep
 * link into the parented Agent Fabric trace on /demo/agent-fabric.
 *
 * The off-allow-list preset intentionally requests an instrument the
 * agent is NOT permitted to administer, so the governance block
 * (policy.assessment.validated-instrument-only) is demonstrable in the
 * UI rather than hidden — the panel reports the failed state and which
 * policy blocked it honestly rather than faking a score.
 *
 * Structure, styling tokens (.card, .btn/.btn-primary/.btn-secondary,
 * .eyebrow, .agentforce-voice-help-link, .routing-live-result), and tone
 * mirror <AcquisitionFunnelPanel> and <ChatToCareRouterHandoff> so this
 * reads as native to /demo/intake.
 */

const ASSESSMENT_ROUTE = "/api/agents/assessment/tasks";
const CARE_ROUTER_ROUTE = "/api/intake/route-to-care-router";

/** Short picker labels for the allow-listed instruments. */
const INSTRUMENT_LABELS: Record<AssessmentInstrument, string> = {
  mrs: "MRS",
  greene: "Greene",
  "phq-9": "PHQ-9",
  isi: "ISI"
};

/** A one-click demo scenario. `instrument` may be off the allow-list. */
export type AssessmentPreset = {
  id: string;
  label: string;
  hint: string;
  /** May be an off-allow-list id (e.g. "gad-7") to demo the block. */
  instrument: string;
  responses: number[];
  demonstrates: string;
};

export const ASSESSMENT_PRESETS: AssessmentPreset[] = [
  {
    id: "phq9-moderate",
    label: "PHQ-9 → moderate",
    hint: "A moderate PHQ-9 (total 11) with no self-harm item endorsed.",
    instrument: "phq-9",
    // 9 items, 0-3. Item 9 (index 8) = 0 → no red flag. Total 11 → moderate.
    responses: [2, 2, 2, 1, 1, 1, 1, 1, 0],
    demonstrates: "A clean moderate depression band → moderate intake severity."
  },
  {
    id: "phq9-red-flag",
    label: "PHQ-9 → red flag",
    hint: "Item 9 endorsed — mandatory self-harm safety escalation.",
    instrument: "phq-9",
    // Item 9 (index 8) = 2. Total 11 (moderate band) but the red flag
    // forces the intake severity to severe.
    responses: [2, 2, 2, 1, 1, 1, 0, 0, 2],
    demonstrates:
      "A moderate band that the item-9 red flag escalates to severe intake severity."
  },
  {
    id: "mrs-severe",
    label: "MRS → severe (multi-domain)",
    hint: "High burden across somatic, psychological, and urogenital domains.",
    instrument: "mrs",
    // 11 items, 0-4. Total 30 → severe; every subscale lands severe.
    responses: [4, 3, 3, 4, 3, 3, 2, 2, 2, 1, 3],
    demonstrates:
      "A severe total with per-domain subscore bands (somatic / psychological / urogenital)."
  },
  {
    id: "gad7-blocked",
    label: "GAD-7 → governance block",
    hint: "GAD-7 is not on the validated allow-list — blocked by policy.",
    instrument: "gad-7",
    // 7 items, 0-3 for a real GAD-7, but the agent never scores it: the
    // allow-list gate blocks it before any scoring runs.
    responses: [2, 2, 2, 2, 2, 2, 2],
    demonstrates:
      "The Agent Fabric blocking an off-allow-list instrument before it is ever scored."
  }
];

/** Render-ready view of a scored instrument lifted from the A2A task. */
export type ScoredView = {
  kind: "scored";
  instrument: string;
  instrumentName: string;
  total: number;
  maxTotal: number;
  severityBand: string;
  normalizedSeverity: IntakeSeverity;
  subscores: AssessmentSubscore[];
  redFlags: AssessmentRedFlag[];
  interpretation: string;
  intakeSeverity: string;
  redFlagsAcknowledged: string;
  nextAgent?: string;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked assessment. */
export type BlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be scored. */
export type InvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type AssessmentView = ScoredView | BlockedView | InvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  intakeSeverity?: unknown;
  nextAgent?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept
 * pure (no fetch, no hooks) so it can be unit-tested without a DOM,
 * mirroring buildChatHandoffRequestBody in chat-to-care-router-handoff.
 */
export function buildAssessmentRequestBody(input: {
  instrument: string;
  responses: number[];
  taskId: string;
  personaId?: string;
}) {
  return {
    jsonrpc: "2.0" as const,
    id: input.taskId,
    method: "tasks/send" as const,
    params: {
      id: input.taskId,
      message: {
        role: "user" as const,
        parts: [
          {
            type: "data" as const,
            data: {
              instrument: input.instrument,
              responses: input.responses
            }
          }
        ]
      },
      metadata: { personaId: input.personaId ?? "demo" }
    }
  };
}

/**
 * POST an assessment to the Assessment agent and return the resulting
 * A2A task. `fetchImpl` is injectable so tests can stub the network
 * boundary the same way the route tests stub global fetch. A governance
 * block / invalid vector comes back as HTTP 200 with a `failed` task —
 * only a malformed envelope / parse error is a non-OK response.
 */
export async function runAssessmentTask(
  input: {
    instrument: string;
    responses: number[];
    taskId: string;
    personaId?: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(ASSESSMENT_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAssessmentRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a scored
 * result (completed) from a governance block vs. an invalid vector (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function assessmentViewFromTask(task: A2ATask): AssessmentView {
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
        "The Agent Fabric blocked this assessment.";
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
        : "The assessment could not be scored.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result = (data.result ?? {}) as {
    instrument?: string;
    instrumentName?: string;
    total?: number;
    maxTotal?: number;
    severityBand?: string;
    normalizedSeverity?: IntakeSeverity;
    subscores?: AssessmentSubscore[];
    redFlags?: AssessmentRedFlag[];
    interpretation?: string;
  };
  const intakeSignal = (data.intakeSignal ?? {}) as {
    severity?: string;
    redFlagsAcknowledged?: string;
  };

  return {
    kind: "scored",
    instrument: result.instrument ?? "",
    instrumentName: result.instrumentName ?? result.instrument ?? "",
    total: result.total ?? 0,
    maxTotal: result.maxTotal ?? 0,
    severityBand: result.severityBand ?? "",
    normalizedSeverity: result.normalizedSeverity ?? "mild",
    subscores: result.subscores ?? [],
    redFlags: result.redFlags ?? [],
    interpretation: result.interpretation ?? "",
    intakeSeverity:
      intakeSignal.severity ??
      (typeof fabric.intakeSeverity === "string"
        ? fabric.intakeSeverity
        : result.normalizedSeverity ?? "mild"),
    redFlagsAcknowledged: intakeSignal.redFlagsAcknowledged ?? "no",
    nextAgent: typeof fabric.nextAgent === "string" ? fabric.nextAgent : undefined,
    traceTaskId
  };
}

/** Lifted Care Router follow-on decision. */
export type CareRouterFollowOn = {
  taskId: string;
  pathway?: string;
  pathwayLabel?: string;
  acuity?: string;
  severityDrivenByAssessment: boolean;
};

/**
 * Optional follow-on: carry the just-scored instrument into the full
 * intake → Care Router hop with the assessment attached, so the routing
 * decision is backed by the validated score. Additive on the server; the
 * response's `decision` + `taskId` thread one continuous trace.
 */
export async function carryIntoCareRouter(
  input: { instrument: string; responses: number[]; personaId?: string },
  fetchImpl: typeof fetch = fetch
): Promise<CareRouterFollowOn> {
  const res = await fetchImpl(CARE_ROUTER_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assessment: { instrument: input.instrument, responses: input.responses },
      personaId: input.personaId ?? "demo",
      origin: "assessment-agent"
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as {
    taskId?: string;
    decision?: { pathway?: string; pathwayLabel?: string; acuity?: string } | null;
    assessment?: { severityDrivenByAssessment?: boolean } | null;
  };
  return {
    taskId: payload.taskId ?? "",
    pathway: payload.decision?.pathway,
    pathwayLabel: payload.decision?.pathwayLabel,
    acuity: payload.decision?.acuity,
    severityDrivenByAssessment:
      payload.assessment?.severityDrivenByAssessment ?? false
  };
}

const SEVERITY_TONE: Record<string, string> = {
  mild: "#8fd6b0",
  moderate: "#ffd28a",
  severe: "#ffb6c8"
};

function SeverityPill({ label, value }: { label: string; value: string }) {
  const tone = SEVERITY_TONE[value] ?? "var(--muted)";
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
  | { status: "done"; view: AssessmentView; lastRun: { instrument: string; responses: number[] } }
  | { status: "error"; message: string };

type FollowOnState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: CareRouterFollowOn }
  | { status: "error"; message: string };

export function AssessmentPanel() {
  const [instrument, setInstrument] = useState<AssessmentInstrument>("phq-9");
  const [showCustom, setShowCustom] = useState(false);
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const [followOn, setFollowOn] = useState<FollowOnState>({ status: "idle" });

  const spec = useMemo(() => getInstrumentSpec(instrument), [instrument]);
  const [custom, setCustom] = useState<number[]>(() =>
    new Array(getInstrumentSpec("phq-9").itemCount).fill(0)
  );

  const busy = runState.status === "running";

  const reset = () => {
    setRunState({ status: "idle" });
    setFollowOn({ status: "idle" });
  };

  const selectInstrument = (next: AssessmentInstrument) => {
    setInstrument(next);
    setCustom(new Array(getInstrumentSpec(next).itemCount).fill(0));
    reset();
  };

  const run = async (input: {
    instrument: string;
    responses: number[];
    label: string;
  }) => {
    setRunState({ status: "running", label: input.label });
    setFollowOn({ status: "idle" });
    try {
      const task = await runAssessmentTask({
        instrument: input.instrument,
        responses: input.responses,
        taskId: newTaskId("assessment"),
        personaId: "demo"
      });
      setRunState({
        status: "done",
        view: assessmentViewFromTask(task),
        lastRun: { instrument: input.instrument, responses: input.responses }
      });
    } catch (err) {
      setRunState({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  };

  const runPreset = (preset: AssessmentPreset) => {
    if (ALLOWLISTED_INSTRUMENTS.includes(preset.instrument as AssessmentInstrument)) {
      setInstrument(preset.instrument as AssessmentInstrument);
    }
    void run({
      instrument: preset.instrument,
      responses: preset.responses,
      label: preset.label
    });
  };

  const runCustom = () => {
    void run({
      instrument,
      responses: custom,
      label: `Custom ${INSTRUMENT_LABELS[instrument]}`
    });
  };

  const runFollowOn = async () => {
    if (runState.status !== "done" || runState.view.kind !== "scored") return;
    const { lastRun } = runState;
    setFollowOn({ status: "running" });
    try {
      const result = await carryIntoCareRouter({
        instrument: lastRun.instrument,
        responses: lastRun.responses,
        personaId: "demo"
      });
      setFollowOn({ status: "done", result });
    } catch (err) {
      setFollowOn({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  };

  const setCustomItem = (index: number, value: number) => {
    setCustom((prev) => {
      const next = prev.slice();
      next[index] = value;
      return next;
    });
  };

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
        Validated-instrument scoring
      </p>
      <h3 style={{ margin: 0 }}>The Assessment agent that grades intake severity</h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Assessment agent administers a validated instrument (MRS, Greene,
        PHQ-9, ISI) over Google A2A and{" "}
        <strong>scores it deterministically — real cutoff math, no LLM</strong>.
        The score maps onto the intake severity the Care Router consumes, and
        every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {ASSESSMENT_PRESETS.map((preset) => (
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
              ? "Scoring…"
              : preset.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: "0.9rem" }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setShowCustom((v) => !v)}
          aria-expanded={showCustom}
          style={{ fontSize: "0.82rem" }}
        >
          {showCustom ? "Hide custom entry" : "Build your own responses"}
        </button>
      </div>

      {showCustom && (
        <div
          style={{
            marginTop: "0.8rem",
            padding: "0.85rem 0.95rem",
            border: "1px solid var(--line)",
            borderRadius: "0.7rem",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow" style={{ marginBottom: "0.4rem" }}>
              Instrument
            </legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {ALLOWLISTED_INSTRUMENTS.map((id) => {
                const active = id === instrument;
                return (
                  <button
                    key={id}
                    type="button"
                    className={active ? "btn btn-primary" : "btn btn-secondary"}
                    onClick={() => selectInstrument(id)}
                    aria-pressed={active}
                    style={{ fontSize: "0.8rem" }}
                  >
                    {INSTRUMENT_LABELS[id]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <p
            style={{
              margin: "0.6rem 0 0.2rem",
              color: "var(--muted)",
              fontSize: "0.82rem"
            }}
          >
            {spec.name} — {spec.itemCount} items, each 0–{spec.itemMax}.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))",
              gap: "0.5rem",
              marginTop: "0.5rem"
            }}
          >
            {custom.map((value, index) => (
              <fieldset
                key={`${instrument}-${index}`}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: "0.5rem",
                  padding: "0.35rem 0.5rem",
                  margin: 0,
                  minWidth: 0
                }}
              >
                <legend
                  style={{
                    fontSize: "0.72rem",
                    color: "var(--muted)",
                    padding: "0 0.3rem"
                  }}
                >
                  Item {index + 1}
                </legend>
                <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                  {Array.from({ length: spec.itemMax + 1 }, (_, v) => {
                    const active = value === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setCustomItem(index, v)}
                        aria-pressed={active}
                        aria-label={`Item ${index + 1} response ${v}`}
                        style={{
                          minWidth: "1.8rem",
                          padding: "0.15rem 0",
                          borderRadius: "0.35rem",
                          border: `1px solid ${active ? "var(--brand)" : "var(--line)"}`,
                          background: active ? "var(--brand-soft)" : "transparent",
                          color: active ? "var(--text)" : "var(--muted)",
                          fontSize: "0.78rem",
                          cursor: "pointer"
                        }}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={runCustom}
            disabled={busy}
            style={{ marginTop: "0.7rem", fontSize: "0.82rem" }}
          >
            {runState.status === "running" &&
            runState.label === `Custom ${INSTRUMENT_LABELS[instrument]}`
              ? "Scoring…"
              : `Score this ${INSTRUMENT_LABELS[instrument]} vector`}
          </button>
        </div>
      )}

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Assessment failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && (
        <AssessmentResult
          view={runState.view}
          followOn={followOn}
          onFollowOn={runFollowOn}
        />
      )}
    </section>
  );
}

function AssessmentResult({
  view,
  followOn,
  onFollowOn
}: {
  view: AssessmentView;
  followOn: FollowOnState;
  onFollowOn: () => void;
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
          Not scored
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>{view.message}</p>
        {traceLink}
      </div>
    );
  }

  const hasRedFlag = view.redFlags.length > 0;

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Deterministic score (no LLM)
      </p>
      <p style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "var(--text)" }}>
        {view.instrumentName}
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.95rem" }}>
        Total <strong>{view.total}</strong> / {view.maxTotal} · band{" "}
        <strong>{view.severityBand}</strong>
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          margin: "0.5rem 0 0"
        }}
      >
        <SeverityPill label="Normalized" value={view.normalizedSeverity} />
        <SeverityPill label="Intake severity" value={view.intakeSeverity} />
      </div>

      {view.subscores.length > 0 && (
        <ul
          className="metric-list"
          style={{ margin: "0.7rem 0 0", listStyle: "none", padding: 0 }}
        >
          {view.subscores.map((s) => (
            <li
              key={s.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.5rem",
                fontSize: "0.86rem",
                padding: "0.15rem 0"
              }}
            >
              <span style={{ color: "var(--muted)" }}>{s.label}</span>
              <strong>
                {s.score}/{s.maxScore}
                {s.band ? ` · ${s.band}` : ""}
              </strong>
            </li>
          ))}
        </ul>
      )}

      {hasRedFlag && (
        <div
          role="note"
          aria-label="Safety escalation"
          style={{
            marginTop: "0.7rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid #ffd28a",
            background: "rgba(255, 210, 138, 0.08)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, color: "#ffd28a", fontSize: "0.88rem" }}>
            Safety escalation
          </p>
          {view.redFlags.map((f) => (
            <p
              key={f.code}
              style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--text)" }}
            >
              {f.description}
            </p>
          ))}
          <p style={{ margin: "0.3rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
            Intake severity is held at <strong>severe</strong> and the red-flag
            screen is acknowledged, so this routes to same-day support regardless
            of the total-score band.
          </p>
        </div>
      )}

      <p
        style={{
          margin: "0.6rem 0 0",
          fontSize: "0.78rem",
          color: "var(--muted)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
        }}
      >
        redFlagsAcknowledged = {view.redFlagsAcknowledged}
        {view.nextAgent ? ` · nextAgent = ${view.nextAgent}` : ""}
      </p>

      <div
        style={{
          marginTop: "0.7rem",
          display: "flex",
          gap: "0.5rem",
          flexWrap: "wrap",
          alignItems: "center"
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onFollowOn}
          disabled={followOn.status === "running"}
          style={{ fontSize: "0.82rem" }}
        >
          {followOn.status === "running"
            ? "Routing to Care Router…"
            : "Carry this score into the Care Router →"}
        </button>
      </div>

      {followOn.status === "error" && (
        <p role="alert" style={{ margin: "0.5rem 0 0", color: "#ffb6c8", fontSize: "0.85rem" }}>
          Care Router handoff failed: {followOn.message}.
        </p>
      )}

      {followOn.status === "done" && (
        <div
          style={{
            marginTop: "0.6rem",
            paddingTop: "0.6rem",
            borderTop: "1px solid var(--line)"
          }}
        >
          <p style={{ margin: 0, fontSize: "0.9rem" }}>
            Care Router pathway:{" "}
            <strong>
              {followOn.result.pathwayLabel ?? followOn.result.pathway ?? "—"}
            </strong>
            {followOn.result.acuity ? ` · acuity ${followOn.result.acuity}` : ""}
          </p>
          {followOn.result.severityDrivenByAssessment && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
              The routing decision was driven by this validated instrument score.
            </p>
          )}
          {followOn.result.taskId && (
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.86rem" }}>
              <a
                href={`/demo/agent-fabric?taskId=${encodeURIComponent(
                  followOn.result.taskId
                )}`}
                className="agentforce-voice-help-link"
              >
                Open the intake → Care Router trace →
              </a>
            </p>
          )}
        </div>
      )}

      {followOn.status !== "done" && traceLink}
    </div>
  );
}
