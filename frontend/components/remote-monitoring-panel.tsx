"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import type {
  MetricTrend,
  MetricTrendKind,
  MonitoringAssessment,
  MonitoringEscalation,
  MonitoringReading,
  OverallStatus
} from "../lib/remote-monitoring";

/**
 * Remote Patient Monitoring & Symptom-Trend Tracking runner for the intake demo.
 *
 * Fires the real, server-side A2A Remote Patient Monitoring agent at
 * /api/agents/remote-monitoring/tasks — the Salesforce "Agentforce for
 * Health" / Health Cloud remote-patient-monitoring analog — which ingests a
 * LONGITUDINAL (time-series) reading set, DETERMINISTICALLY detects each
 * metric's trend over the reading window (improving / stable / worsening),
 * applies (synthetic) red-flag thresholds, and ROUTES worsening / red-flag
 * trends to a human clinician for review — never taking an autonomous clinical
 * action. The panel surfaces the per-metric trends, the clinician-routed
 * escalations with their triggering rule, the honesty signals, and a deep link
 * into the parented Agent Fabric trace.
 *
 * The fabricated-reading preset asserts a reading with no valid source, the
 * autonomous-escalation preset asserts an escalation NOT routed to a clinician,
 * and the no-consent preset withholds monitoring consent — so all three RPM
 * governance blocks are demonstrable in the UI rather than hidden.
 *
 * The metrics + thresholds are ILLUSTRATIVE synthetics, NOT a certified
 * remote-monitoring device. Structure, styling tokens, and tone mirror
 * <CareGapPanel> and <MedicationAdherencePanel> so this reads as a native
 * sibling on /demo/intake.
 */

const RPM_ROUTE = "/api/agents/remote-monitoring/tasks";

/** A one-click demo scenario. */
export type RemoteMonitoringPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** A longitudinal reading set the agent ingests + trends (the common case). */
  readings?: MonitoringReading[];
  /** Monitoring preferences (consent gate). */
  monitoringPrefs?: { hasMonitoringConsent?: boolean };
  /** Caller-asserted escalations (used only for the autonomous-escalation block). */
  assertedEscalations?: Array<Record<string, unknown>>;
};

const S = (metricId: string, at: string, value: number, source: MonitoringReading["source"]) => ({
  metricId,
  at,
  value,
  source
});

const MULTI_METRIC_READINGS: MonitoringReading[] = [
  S("metric.hot-flash-frequency", "2026-01-05", 6, "self-report"),
  S("metric.hot-flash-frequency", "2026-01-12", 8, "self-report"),
  S("metric.hot-flash-frequency", "2026-01-19", 10, "self-report"),
  S("metric.hot-flash-frequency", "2026-01-26", 12, "self-report"),
  S("metric.sleep-hours", "2026-01-05", 7, "wearable"),
  S("metric.sleep-hours", "2026-01-12", 6.5, "wearable"),
  S("metric.sleep-hours", "2026-01-19", 5.5, "wearable"),
  S("metric.sleep-hours", "2026-01-26", 5, "wearable"),
  S("metric.mood-score", "2026-01-05", 4, "self-report"),
  S("metric.mood-score", "2026-01-12", 5, "self-report"),
  S("metric.mood-score", "2026-01-19", 6, "self-report"),
  S("metric.mood-score", "2026-01-26", 7, "self-report"),
  S("metric.resting-heart-rate", "2026-01-05", 68, "wearable"),
  S("metric.resting-heart-rate", "2026-01-12", 69, "wearable"),
  S("metric.resting-heart-rate", "2026-01-19", 70, "wearable"),
  S("metric.resting-heart-rate", "2026-01-26", 70, "wearable")
];

const BENIGN_READINGS: MonitoringReading[] = [
  S("metric.mood-score", "2026-01-05", 4, "self-report"),
  S("metric.mood-score", "2026-01-12", 5, "self-report"),
  S("metric.mood-score", "2026-01-19", 6, "self-report"),
  S("metric.mood-score", "2026-01-26", 7, "self-report"),
  S("metric.resting-heart-rate", "2026-01-05", 68, "wearable"),
  S("metric.resting-heart-rate", "2026-01-12", 69, "wearable"),
  S("metric.resting-heart-rate", "2026-01-19", 70, "wearable"),
  S("metric.resting-heart-rate", "2026-01-26", 70, "wearable")
];

const RED_FLAG_READINGS: MonitoringReading[] = [
  S("metric.hot-flash-frequency", "2026-01-05", 10, "self-report"),
  S("metric.hot-flash-frequency", "2026-01-12", 12, "self-report"),
  S("metric.hot-flash-frequency", "2026-01-19", 14, "self-report"),
  S("metric.hot-flash-frequency", "2026-01-26", 16, "self-report"),
  S("metric.resting-heart-rate", "2026-01-05", 78, "wearable"),
  S("metric.resting-heart-rate", "2026-01-12", 88, "wearable"),
  S("metric.resting-heart-rate", "2026-01-19", 96, "wearable"),
  S("metric.resting-heart-rate", "2026-01-26", 104, "wearable")
];

export const REMOTE_MONITORING_PRESETS: RemoteMonitoringPreset[] = [
  {
    id: "multi-metric-window",
    label: "Multi-metric window → escalate",
    hint: "Hot-flash frequency climbing, sleep declining, mood improving, HR stable.",
    readings: MULTI_METRIC_READINGS,
    monitoringPrefs: { hasMonitoringConsent: true },
    demonstrates:
      "A representative longitudinal window — worsening (hot-flash, sleep), improving (mood), and stable (resting HR) trends detected deterministically, with the two worsening trends routed to clinician review."
  },
  {
    id: "benign-window",
    label: "Improving / stable → no escalation",
    hint: "Mood improving and resting HR stable — nothing to escalate.",
    readings: BENIGN_READINGS,
    monitoringPrefs: { hasMonitoringConsent: true },
    demonstrates:
      "A benign window where an improving mood trend and a stable resting-HR trend produce no clinician escalation (overallStatus improving)."
  },
  {
    id: "red-flag-window",
    label: "Red-flag threshold → urgent escalation",
    hint: "Hot-flash frequency reaching 16/day and resting HR crossing 100 bpm.",
    readings: RED_FLAG_READINGS,
    monitoringPrefs: { hasMonitoringConsent: true },
    demonstrates:
      "A most-recent value crossing a (synthetic) red-flag threshold — an urgent escalation routed to clinician review, citing the red-flag rule."
  },
  {
    id: "no-consent-block",
    label: "No monitoring consent → block",
    hint: "Readings exist but the patient hasn't consented to monitoring.",
    readings: MULTI_METRIC_READINGS,
    monitoringPrefs: { hasMonitoringConsent: false },
    demonstrates:
      "The Agent Fabric refusing to monitor a patient who hasn't consented (policy.rpm.consent-to-monitor)."
  },
  {
    id: "fabricated-reading-block",
    label: "Fabricated reading → governance block",
    hint: "A reading with no device/self-report source.",
    readings: [
      { metricId: "metric.sleep-hours", at: "2026-01-26", value: 5, source: "fabricated" as never }
    ],
    monitoringPrefs: { hasMonitoringConsent: true },
    demonstrates:
      "The Agent Fabric blocking a fabricated reading that doesn't trace to a device/self-report source (policy.rpm.reading-source-integrity)."
  },
  {
    id: "autonomous-escalation-block",
    label: "Autonomous escalation → governance block",
    hint: "A caller-asserted escalation acted on autonomously (not routed to a clinician).",
    readings: MULTI_METRIC_READINGS,
    monitoringPrefs: { hasMonitoringConsent: true },
    assertedEscalations: [
      {
        metricId: "metric.hot-flash-frequency",
        metricLabel: "Hot-flash frequency",
        triggeringRule: "rule.worsening-trend",
        ruleDescription: "worsening trend",
        severity: "elevated",
        routedTo: "auto-order",
        rationale: "attempted autonomous action"
      }
    ],
    demonstrates:
      "The Agent Fabric blocking an escalation acted on autonomously instead of routed to a human clinician (policy.rpm.no-autonomous-escalation)."
  }
];

/** Render-ready view of a detected assessment lifted from the task. */
export type RemoteMonitoringAssessedView = {
  kind: "assessed";
  perMetricTrends: MetricTrend[];
  escalations: MonitoringEscalation[];
  overallStatus: OverallStatus;
  note: string;
  readingsTraceToSource: boolean;
  escalationRoutedToHuman: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked monitoring run. */
export type RemoteMonitoringBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type RemoteMonitoringInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type RemoteMonitoringView =
  | RemoteMonitoringAssessedView
  | RemoteMonitoringBlockedView
  | RemoteMonitoringInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  readingsTraceToSource?: unknown;
  escalationRoutedToHuman?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildCareGapRequestBody.
 */
export function buildRemoteMonitoringRequestBody(input: {
  taskId: string;
  personaId?: string;
  readings?: MonitoringReading[];
  monitoringPrefs?: { hasMonitoringConsent?: boolean };
  assertedEscalations?: Array<Record<string, unknown>>;
}) {
  const data: Record<string, unknown> = {};
  if (input.readings !== undefined) data.readings = input.readings;
  if (input.monitoringPrefs !== undefined) data.monitoringPrefs = input.monitoringPrefs;
  if (input.assertedEscalations !== undefined) data.escalations = input.assertedEscalations;
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
 * POST a reading set (or asserted escalations) to the Remote Patient Monitoring
 * agent and return the resulting A2A task. `fetchImpl` is injectable so tests
 * can stub the network boundary. A governance block comes back as HTTP 200 with
 * a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runRemoteMonitoringTask(
  input: {
    taskId: string;
    personaId?: string;
    readings?: MonitoringReading[];
    monitoringPrefs?: { hasMonitoringConsent?: boolean };
    assertedEscalations?: Array<Record<string, unknown>>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(RPM_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRemoteMonitoringRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a detected
 * assessment (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function remoteMonitoringViewFromTask(task: A2ATask): RemoteMonitoringView {
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
        "The Agent Fabric blocked this remote-monitoring run.";
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
        : "The monitoring assessment could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const assessment = (data.assessment as MonitoringAssessment | undefined) ?? undefined;

  return {
    kind: "assessed",
    perMetricTrends: assessment?.perMetricTrends ?? [],
    escalations: assessment?.escalations ?? [],
    overallStatus: assessment?.overallStatus ?? "stable",
    note: assessment?.note ?? "",
    readingsTraceToSource: fabric.readingsTraceToSource === true,
    escalationRoutedToHuman: fabric.escalationRoutedToHuman === true,
    traceTaskId
  };
}

const TREND_TONE: Record<MetricTrendKind, string> = {
  improving: "#8fd6b0",
  stable: "#9fb3c8",
  worsening: "#ffb6c8"
};
const SEVERITY_TONE: Record<MonitoringEscalation["severity"], string> = {
  elevated: "#ffd28a",
  urgent: "#ffb6c8"
};
const STATUS_TONE: Record<OverallStatus, string> = {
  stable: "#9fb3c8",
  improving: "#8fd6b0",
  escalate: "#ffb6c8"
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
  | { status: "done"; view: RemoteMonitoringView }
  | { status: "error"; message: string };

export function RemoteMonitoringPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: RemoteMonitoringPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runRemoteMonitoringTask({
          taskId: newTaskId("rpm"),
          personaId: "demo",
          readings: preset.readings,
          monitoringPrefs: preset.monitoringPrefs,
          assertedEscalations: preset.assertedEscalations
        });
        setRunState({ status: "done", view: remoteMonitoringViewFromTask(task) });
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
        Remote patient monitoring &amp; symptom-trend tracking
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that tracks longitudinal trends and routes them to a clinician
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Remote Patient Monitoring agent ingests longitudinal, self-reported
        and wearable/device readings (hot-flash frequency, sleep, mood, resting
        heart rate, weight) and{" "}
        <strong>
          deterministically detects each metric&apos;s trend
        </strong>{" "}
        (improving / stable / worsening) over the reading window, applying
        synthetic red-flag thresholds. Worsening or red-flag trends are{" "}
        <strong>routed to a human clinician for review</strong> — the agent never
        takes an autonomous clinical action.{" "}
        <strong>
          The metrics + thresholds are illustrative synthetics, not a certified
          remote-monitoring device.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {REMOTE_MONITORING_PRESETS.map((preset) => (
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
          Remote-monitoring run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <RemoteMonitoringResult view={runState.view} />}
    </section>
  );
}

function RemoteMonitoringResult({ view }: { view: RemoteMonitoringView }) {
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

  const escByMetric = new Map(view.escalations.map((e) => [e.metricId, e]));

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Per-metric trends (deterministic, synthetic thresholds)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <strong>{view.perMetricTrends.length}</strong> metric
        {view.perMetricTrends.length === 1 ? "" : "s"} monitored ·{" "}
        <Pill label="Overall" value={view.overallStatus} tone={STATUS_TONE[view.overallStatus]} />
      </p>

      <ul style={{ margin: "0.7rem 0 0", listStyle: "none", padding: 0 }}>
        {view.perMetricTrends.map((t) => {
          const esc = escByMetric.get(t.metricId);
          return (
            <li
              key={t.metricId}
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
                <strong style={{ fontSize: "0.92rem" }}>{t.metricLabel}</strong>
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                  <Pill label="Trend" value={t.trend} tone={TREND_TONE[t.trend]} />
                  {t.redFlag && <Pill label="Red flag" value="yes" tone="#ffb6c8" />}
                </div>
              </div>
              <p
                style={{
                  margin: "0.3rem 0 0",
                  fontSize: "0.8rem",
                  color: "var(--muted)"
                }}
              >
                baseline {t.baselineMean}
                {t.unit} → recent {t.recentMean}
                {t.unit} · latest {t.latestValue}
                {t.unit} ({t.latestAt})
              </p>
              <p
                style={{
                  margin: "0.3rem 0 0",
                  fontSize: "0.72rem",
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                }}
              >
                {t.metricId}
              </p>
              {esc && (
                <div
                  style={{
                    marginTop: "0.5rem",
                    paddingTop: "0.5rem",
                    borderTop: "1px solid var(--line)"
                  }}
                >
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text)" }}>
                    Escalation ({esc.triggeringRule}): {esc.rationale}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.3rem",
                      flexWrap: "wrap",
                      marginTop: "0.35rem"
                    }}
                  >
                    <Pill label="Severity" value={esc.severity} tone={SEVERITY_TONE[esc.severity]} />
                    <Pill label="Routed to" value="clinician review" tone="#8fd6b0" />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div
        role="note"
        aria-label="Monitoring integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
          Integrity &amp; escalation{" "}
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
          readingsTraceToSource = {String(view.readingsTraceToSource)} ·
          escalationRoutedToHuman = {String(view.escalationRoutedToHuman)}
        </p>
      </div>

      {view.escalations.length > 0 && (
        <p style={{ margin: "0.6rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
          {view.escalations.length} escalation
          {view.escalations.length === 1 ? "" : "s"} routed to a clinician for
          review — no autonomous clinical action was taken.
        </p>
      )}

      {traceLink}
    </div>
  );
}
