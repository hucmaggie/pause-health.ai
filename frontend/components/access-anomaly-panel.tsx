"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type AccessAnomalyDetermination,
  type AccessAnomalyDisposition,
  type AccessAnomalyRequest,
  type PeakWindow,
  DEMO_ACCESS_ANOMALY_BURST_REQUEST,
  DEMO_ACCESS_ANOMALY_NORMAL_REQUEST,
  DEMO_ACCESS_ANOMALY_REQUEST
} from "../lib/access-anomaly";

/**
 * Access Anomaly Detection runner for the intake demo.
 *
 * Fires the real, server-side A2A Access Anomaly agent at /api/agents/access-anomaly/tasks — a
 * data-substrate service that counts an actor's PHI-access events within a rolling time window and
 * flags an anomalous access volume. The panel surfaces the disposition, the peak window, the honesty
 * signals, the synthetic / PHI labels, and a deep link into the parented Agent Fabric trace.
 *
 * A finding — normal activity OR an anomalous spike — is a SAFE, honest OUTPUT (it completes; it
 * carries requiresPrivacyReview:true, autoLockedAccount:false, autoRevokedAccess:false). The
 * fabricated-peak, bad-count, and auto-action presets assert offending FINDINGS — so all three
 * governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-bearing — the events reference the patients whose records were accessed. The events are
 * ILLUSTRATIVE, NOT a certified breach-detection / SIEM system. Structure, styling tokens, and tone
 * mirror <CoverageContinuityPanel> so this reads as a native sibling on /demo/intake.
 */

const ACCESS_ANOMALY_ROUTE = "/api/agents/access-anomaly/tasks";

/** A one-click demo scenario. */
export type AccessAnomalyPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: AccessAnomalyRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A shared, valid trio of events for the governance-block presets (3 accesses within 4 minutes). */
const BLOCK_EVENTS = [
  {
    eventId: "evt-1",
    patientRef: "patient-1",
    action: "view",
    timestamp: "2025-01-15T09:00:00Z",
    epochMs: 1736931600000
  },
  {
    eventId: "evt-2",
    patientRef: "patient-2",
    action: "view",
    timestamp: "2025-01-15T09:02:00Z",
    epochMs: 1736931720000
  },
  {
    eventId: "evt-3",
    patientRef: "patient-3",
    action: "view",
    timestamp: "2025-01-15T09:04:00Z",
    epochMs: 1736931840000
  }
];

/** A valid peak window over BLOCK_EVENTS (all 3 events, 3 distinct patients). */
const BLOCK_PEAK = {
  startTime: "2025-01-15T09:00:00Z",
  endTime: "2025-01-15T09:04:00Z",
  startEpochMs: 1736931600000,
  endEpochMs: 1736931840000,
  count: 3,
  distinctPatients: 3,
  eventIds: ["evt-1", "evt-2", "evt-3"]
};

export const ACCESS_ANOMALY_PRESETS: AccessAnomalyPreset[] = [
  {
    id: "anomalous",
    label: "24 accesses in ~46 min → anomalous",
    hint: "Over the 20-in-60-minutes threshold.",
    request: DEMO_ACCESS_ANOMALY_REQUEST,
    demonstrates:
      "A burst of 24 record views inside a single 60-minute window → the sliding-window peak exceeds the threshold of 20, an anomalous access volume flagged for privacy review."
  },
  {
    id: "normal",
    label: "Routine, spread-out access → normal",
    hint: "A few records over a full shift.",
    request: DEMO_ACCESS_ANOMALY_NORMAL_REQUEST,
    demonstrates:
      "A handful of accesses spread 90 minutes apart → the peak in any 60-minute window is 1, well within the threshold, normal activity."
  },
  {
    id: "burst",
    label: "High daily total, small bursts → normal",
    hint: "Windowed, not a naive total count.",
    request: DEMO_ACCESS_ANOMALY_BURST_REQUEST,
    demonstrates:
      "18 accesses across the day in bursts of 3 → no single 30-minute window exceeds the threshold of 5, so it is normal — the detection is WINDOWED, not a total count."
  },
  {
    id: "fabricated-peak-block",
    label: "Phantom access in the peak → governance block",
    hint: "Distinct-patient breadth not supported.",
    request: DEMO_ACCESS_ANOMALY_REQUEST,
    determination: {
      requestRef: "aad-001",
      actorRef: "actor-3391",
      disposition: "normal",
      windowMinutes: 60,
      threshold: 20,
      // Wrong: claims 9 distinct patients in the peak, but the 3 events touch only 3.
      peakWindow: { ...BLOCK_PEAK, distinctPatients: 9 },
      totalEvents: 3,
      distinctPatientsTotal: 3,
      hasAnomaly: false,
      events: BLOCK_EVENTS,
      invalidEvents: [],
      requiresPrivacyReview: true,
      autoLockedAccount: false,
      autoRevokedAccess: false
    },
    demonstrates:
      "The Agent Fabric blocking a peak window whose accesses don't trace to submitted events (policy.access.events-sourced)."
  },
  {
    id: "bad-count-block",
    label: "Mismatched anomaly flag → governance block",
    hint: "Flag doesn't match the threshold.",
    request: DEMO_ACCESS_ANOMALY_REQUEST,
    determination: {
      requestRef: "aad-001",
      actorRef: "actor-3391",
      disposition: "anomalous-access-volume",
      windowMinutes: 60,
      threshold: 20,
      peakWindow: BLOCK_PEAK,
      totalEvents: 3,
      distinctPatientsTotal: 3,
      // Wrong: says anomalous, but a peak of 3 does not exceed the threshold of 20.
      hasAnomaly: true,
      events: BLOCK_EVENTS,
      invalidEvents: [],
      requiresPrivacyReview: true,
      autoLockedAccount: false,
      autoRevokedAccess: false
    },
    demonstrates:
      "The Agent Fabric blocking an inconsistent window count / anomaly flag (policy.access.window-count-consistent)."
  },
  {
    id: "auto-action-block",
    label: "Account locked autonomously → governance block",
    hint: "An access action taken on its own.",
    request: DEMO_ACCESS_ANOMALY_REQUEST,
    determination: {
      requestRef: "aad-001",
      actorRef: "actor-3391",
      disposition: "normal",
      windowMinutes: 60,
      threshold: 20,
      peakWindow: BLOCK_PEAK,
      totalEvents: 3,
      distinctPatientsTotal: 3,
      hasAnomaly: false,
      events: BLOCK_EVENTS,
      invalidEvents: [],
      requiresPrivacyReview: true,
      // Wrong: the agent locked the actor's account instead of recommending review.
      autoLockedAccount: true,
      autoRevokedAccess: false
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous access action (policy.access.no-autonomous-action)."
  }
];

/** Render-ready view of a produced finding lifted from the task. */
export type AccessAnomalyResolvedView = {
  kind: "resolved";
  requestRef: string;
  actorRef: string;
  disposition: AccessAnomalyDisposition;
  peakWindow: PeakWindow;
  windowMinutes: number;
  threshold: number;
  totalEvents: number;
  distinctPatientsTotal: number;
  hasAnomaly: boolean;
  reason: string;
  note: string;
  accessEventsSourced: boolean;
  accessWindowCountConsistent: boolean;
  accessNoAutonomousAction: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type AccessAnomalyBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type AccessAnomalyInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type AccessAnomalyView =
  | AccessAnomalyResolvedView
  | AccessAnomalyBlockedView
  | AccessAnomalyInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  accessEventsSourced?: unknown;
  accessWindowCountConsistent?: unknown;
  accessNoAutonomousAction?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildAccessAnomalyRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: AccessAnomalyRequest;
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
 * POST an access-anomaly request (or an asserted finding) to the Access Anomaly agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A governance
 * block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse error is a
 * non-OK response.
 */
export async function runAccessAnomalyTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: AccessAnomalyRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(ACCESS_ANOMALY_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAccessAnomalyRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced finding
 * (completed) from a governance block vs. an invalid request (both `failed`, told
 * apart by metadata.agentFabric.decision).
 */
export function accessAnomalyViewFromTask(task: A2ATask): AccessAnomalyView {
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
        "The Agent Fabric blocked this access-anomaly run.";
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
        : "The access anomaly could not be analyzed.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: AccessAnomalyDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    actorRef: det?.actorRef ?? "",
    disposition: det?.disposition ?? "normal",
    peakWindow:
      det?.peakWindow ?? {
        startTime: "",
        endTime: "",
        startEpochMs: 0,
        endEpochMs: 0,
        count: 0,
        distinctPatients: 0,
        eventIds: []
      },
    windowMinutes: det?.windowMinutes ?? 60,
    threshold: det?.threshold ?? 20,
    totalEvents: det?.totalEvents ?? 0,
    distinctPatientsTotal: det?.distinctPatientsTotal ?? 0,
    hasAnomaly: det?.hasAnomaly ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    accessEventsSourced: fabric.accessEventsSourced === true,
    accessWindowCountConsistent: fabric.accessWindowCountConsistent === true,
    accessNoAutonomousAction: fabric.accessNoAutonomousAction === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<AccessAnomalyDisposition, string> = {
  normal: "#8fd6b0",
  "anomalous-access-volume": "#ffb6c8"
};

const DISPOSITION_LABEL: Record<AccessAnomalyDisposition, string> = {
  normal: "Normal activity",
  "anomalous-access-volume": "Anomalous access volume"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: AccessAnomalyView }
  | { status: "error"; message: string };

export function AccessAnomalyPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: AccessAnomalyPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runAccessAnomalyTask({
          taskId: newTaskId("access-anomaly"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: accessAnomalyViewFromTask(task) });
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
        HIPAA security · information system activity review · platform &amp; data substrate
      </p>
      <h3 style={{ margin: 0 }}>
        Access Anomaly — every access sourced, the window count is exact, never an autonomous action
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> counts an actor&rsquo;s{" "}
        <strong>PHI-access events</strong> within a <strong>rolling time window</strong>, finds the{" "}
        <strong>peak</strong> number of accesses in any window of the configured length, and flags an{" "}
        <strong>anomalous access volume</strong> when that peak exceeds the threshold (HIPAA
        §164.308(a)(1)(ii)(D)). No interval merge, no hash chain — a{" "}
        <strong>sliding-window count</strong>, and it is <strong>windowed</strong>, not a naive total.
        Every access is <strong>sourced</strong>, the count is <strong>exact</strong>, and the result
        is a <strong>recommendation</strong>: the agent <strong>never</strong> locks an account or
        revokes access — a privacy officer reviews every flag.{" "}
        <strong>PHI-bearing · illustrative events, not a certified system.</strong> Run a preset, then
        open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {ACCESS_ANOMALY_PRESETS.map((preset) => (
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
              ? "Scanning…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Anomaly run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <AccessAnomalyResult view={runState.view} />}
    </section>
  );
}

function AccessAnomalyResult({ view }: { view: AccessAnomalyView }) {
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

  const tone = DISPOSITION_TONE[view.disposition];

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Access anomaly (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""}
        {view.actorRef ? ` · ${view.actorRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]} · peak {view.peakWindow.count} in {view.windowMinutes}m ·
        threshold {view.threshold}
      </p>

      <p style={{ margin: "0.4rem 0 0", color: "var(--muted)", fontSize: "0.84rem" }}>
        {view.totalEvents} total event(s) · {view.distinctPatientsTotal} distinct patient(s)
        {view.peakWindow.count > 0 ? (
          <>
            {" "}
            · peak window <strong>{view.peakWindow.startTime}</strong> →{" "}
            <strong>{view.peakWindow.endTime}</strong> ({view.peakWindow.distinctPatients} distinct
            patient(s))
          </>
        ) : null}
      </p>

      <div
        role="note"
        aria-label="Anomaly safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced · exact count · never an autonomous action{" "}
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
            synthetic · PHI-bearing
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
          accessEventsSourced = {String(view.accessEventsSourced)} · accessWindowCountConsistent ={" "}
          {String(view.accessWindowCountConsistent)} · accessNoAutonomousAction ={" "}
          {String(view.accessNoAutonomousAction)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
