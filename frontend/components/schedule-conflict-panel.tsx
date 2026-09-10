"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type ConflictingSlot,
  type EchoedInterval,
  type ScheduleConflictDetermination,
  type ScheduleConflictDisposition,
  type ScheduleConflictRequest,
  type ScheduledSlot,
  DEMO_SCHEDULE_CONFLICT_MAXIMIZE_REQUEST,
  DEMO_SCHEDULE_CONFLICT_REQUEST,
  DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST
} from "../lib/schedule-conflict";

/**
 * Scheduling Conflict / Double-Booking Guard runner for the intake demo.
 *
 * Fires the real, server-side A2A Schedule Conflict agent at /api/agents/schedule-conflict/tasks — a
 * care-coordination service that computes a resource's maximum conflict-free schedule and waitlists the
 * collisions. The panel surfaces the disposition, the scheduled appointments, the waitlist (with what
 * each conflicts with), the honesty signals, the synthetic / PHI labels, and a deep link into the
 * parented Agent Fabric trace.
 *
 * A schedule — fully conflict-free OR partial with a waitlist — is a SAFE, honest OUTPUT (it completes;
 * it carries requiresSchedulerReview:true, autoBooked:false). The fabricated-appointment, double-booked,
 * and auto-booked presets assert offending DETERMINATIONS — so all three governance blocks are
 * demonstrable in the UI rather than hidden.
 *
 * PHI-bearing — the requests reference the patients being scheduled. The panel is ILLUSTRATIVE, NOT a
 * certified scheduling system. Structure, styling tokens, and tone mirror <CaseloadBalancingPanel> so
 * this reads as a native sibling on /demo/intake.
 */

const SCHEDULE_CONFLICT_ROUTE = "/api/agents/schedule-conflict/tasks";

/** A one-click demo scenario. */
export type ScheduleConflictPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: ScheduleConflictRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

const D = "2026-03-03T";
const ms = (t: string) => Date.parse(`${D}${t}:00Z`);

/** A valid, produced determination over the waitlist demo — the base for the block presets. */
const VALID_DETERMINATION = {
  requestRef: "scr-002",
  resourceRef: "provider-mscp-day-2026-03-03",
  disposition: "conflicts-waitlisted",
  scheduled: [
    { requestId: "r1", memberId: "m1", startMs: ms("09:00"), endMs: ms("10:00") },
    { requestId: "r3", memberId: "m3", startMs: ms("10:00"), endMs: ms("11:00") }
  ],
  conflicts: [
    { requestId: "r2", memberId: "m2", startMs: ms("09:30"), endMs: ms("10:30"), conflictsWith: "r1" },
    { requestId: "r4", memberId: "m4", startMs: ms("09:45"), endMs: ms("10:15"), conflictsWith: "r1" }
  ],
  intervals: [
    { requestId: "r1", memberId: "m1", startMs: ms("09:00"), endMs: ms("10:00") },
    { requestId: "r2", memberId: "m2", startMs: ms("09:30"), endMs: ms("10:30") },
    { requestId: "r3", memberId: "m3", startMs: ms("10:00"), endMs: ms("11:00") },
    { requestId: "r4", memberId: "m4", startMs: ms("09:45"), endMs: ms("10:15") }
  ],
  invalidRequests: [],
  totalRequests: 4,
  scheduledCount: 2,
  conflictCount: 2,
  requiresSchedulerReview: true,
  autoBooked: false
};

export const SCHEDULE_CONFLICT_PRESETS: ScheduleConflictPreset[] = [
  {
    id: "conflict-free",
    label: "3 spaced requests → conflict-free",
    hint: "No overlaps — all fit.",
    request: DEMO_SCHEDULE_CONFLICT_REQUEST,
    demonstrates:
      "Three back-to-back / spaced requests on one resource all fit conflict-free — no double-booking."
  },
  {
    id: "waitlist",
    label: "Overlapping requests → partial + waitlist",
    hint: "Two overlap the 9-10 slot.",
    request: DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST,
    demonstrates:
      "The earliest-finish greedy admits the 9-10 and 10-11 appointments and waitlists the two that overlap."
  },
  {
    id: "maximize",
    label: "Greedy maximizes count (2 > 1)",
    hint: "Two short vs one long.",
    request: DEMO_SCHEDULE_CONFLICT_MAXIMIZE_REQUEST,
    demonstrates:
      "Earliest-finish admits the two short appointments (2) rather than the single long one (1) — it maximizes, it isn't 'first request wins'."
  },
  {
    id: "fabricated-appointment-block",
    label: "Fabricated appointment → governance block",
    hint: "A scheduled slot's patient doesn't match the request.",
    request: DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: r1 is scheduled for a patient who never requested it.
      scheduled: [
        { requestId: "r1", memberId: "m-ghost", startMs: ms("09:00"), endMs: ms("10:00") },
        { requestId: "r3", memberId: "m3", startMs: ms("10:00"), endMs: ms("11:00") }
      ]
    },
    demonstrates:
      "The Agent Fabric blocking a schedule whose appointment doesn't trace to a submitted request (policy.schedule.intervals-sourced)."
  },
  {
    id: "double-booked-block",
    label: "Double-booked resource → governance block",
    hint: "Two scheduled appointments overlap.",
    request: DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: r2 (9:30-10:30) is scheduled alongside r1 (9:00-10:00) — they overlap.
      scheduled: [
        { requestId: "r1", memberId: "m1", startMs: ms("09:00"), endMs: ms("10:00") },
        { requestId: "r2", memberId: "m2", startMs: ms("09:30"), endMs: ms("10:30") },
        { requestId: "r3", memberId: "m3", startMs: ms("10:00"), endMs: ms("11:00") }
      ],
      conflicts: [
        { requestId: "r4", memberId: "m4", startMs: ms("09:45"), endMs: ms("10:15"), conflictsWith: "r1" }
      ],
      scheduledCount: 3,
      conflictCount: 1
    },
    demonstrates:
      "The Agent Fabric blocking a double-booked resource (policy.schedule.conflict-free)."
  },
  {
    id: "auto-booked-block",
    label: "Appointment booked autonomously → governance block",
    hint: "A schedule that booked itself.",
    request: DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: the agent booked the appointments and skipped scheduler review.
      requiresSchedulerReview: false,
      autoBooked: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous booking (policy.schedule.no-autonomous-booking)."
  }
];

/** Render-ready view of a produced schedule lifted from the task. */
export type ScheduleConflictResolvedView = {
  kind: "resolved";
  requestRef: string;
  resourceRef: string;
  disposition: ScheduleConflictDisposition;
  scheduled: ScheduledSlot[];
  conflicts: ConflictingSlot[];
  intervals: EchoedInterval[];
  totalRequests: number;
  scheduledCount: number;
  conflictCount: number;
  reason: string;
  note: string;
  scheduleIntervalsSourced: boolean;
  scheduleConflictFree: boolean;
  scheduleNoAutonomousBooking: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type ScheduleConflictBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type ScheduleConflictInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type ScheduleConflictView =
  | ScheduleConflictResolvedView
  | ScheduleConflictBlockedView
  | ScheduleConflictInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  scheduleIntervalsSourced?: unknown;
  scheduleConflictFree?: unknown;
  scheduleNoAutonomousBooking?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/** Format an epoch-ms as an HH:MM UTC clock time for display. */
export function hhmm(msValue: number): string {
  return new Date(msValue).toISOString().slice(11, 16);
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildScheduleConflictRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ScheduleConflictRequest;
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
 * POST a scheduling-conflict request (or an asserted schedule) to the Schedule Conflict agent and return
 * the resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A governance
 * block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse error is a
 * non-OK response.
 */
export async function runScheduleConflictTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ScheduleConflictRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(SCHEDULE_CONFLICT_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildScheduleConflictRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * schedule (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function scheduleConflictViewFromTask(task: A2ATask): ScheduleConflictView {
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
        "The Agent Fabric blocked this scheduling-conflict run.";
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
      (typeof fabric.error === "string" ? fabric.error : "The schedule could not be computed.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: ScheduleConflictDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    resourceRef: det?.resourceRef ?? "",
    disposition: det?.disposition ?? "conflict-free",
    scheduled: det?.scheduled ?? [],
    conflicts: det?.conflicts ?? [],
    intervals: det?.intervals ?? [],
    totalRequests: det?.totalRequests ?? 0,
    scheduledCount: det?.scheduledCount ?? 0,
    conflictCount: det?.conflictCount ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    scheduleIntervalsSourced: fabric.scheduleIntervalsSourced === true,
    scheduleConflictFree: fabric.scheduleConflictFree === true,
    scheduleNoAutonomousBooking: fabric.scheduleNoAutonomousBooking === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<ScheduleConflictDisposition, string> = {
  "conflict-free": "#8fd6b0",
  "conflicts-waitlisted": "#ffd28a"
};

const DISPOSITION_LABEL: Record<ScheduleConflictDisposition, string> = {
  "conflict-free": "Conflict-free",
  "conflicts-waitlisted": "Partial · waitlist"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: ScheduleConflictView }
  | { status: "error"; message: string };

export function ScheduleConflictPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: ScheduleConflictPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runScheduleConflictTask({
          taskId: newTaskId("schedule-conflict"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: scheduleConflictViewFromTask(task) });
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
        Care coordination · double-booking guard · patient &amp; clinical
      </p>
      <h3 style={{ margin: 0 }}>
        Scheduling Conflict Guard — a conflict-free schedule, every appointment sourced, never an
        autonomous booking
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> takes a <strong>resource</strong> (a provider day,
        an infusion chair) and a batch of <strong>requested appointment intervals</strong> and computes
        the <strong>maximum conflict-free schedule</strong> — <strong>waitlisting</strong> the collisions.
        Not a bin-packing, not an interval merge — the classic{" "}
        <strong>earliest-finish interval selection</strong>. Every appointment is{" "}
        <strong>sourced &amp; accounted for once</strong>, the schedule is <strong>conflict-free</strong>,
        and the result is a <strong>recommendation</strong>: the agent <strong>never</strong> books,
        cancels, or bumps — a scheduler confirms.{" "}
        <strong>PHI-bearing · illustrative, not a certified system.</strong> Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {SCHEDULE_CONFLICT_PRESETS.map((preset) => (
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
              ? "Scheduling…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Scheduling run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <ScheduleConflictResult view={runState.view} />}
    </section>
  );
}

function ScheduleConflictResult({ view }: { view: ScheduleConflictView }) {
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
        Schedule (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""}
        {view.resourceRef ? ` · ${view.resourceRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]} · {view.scheduledCount}/{view.totalRequests} scheduled
      </p>

      {view.scheduled.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.scheduled.map((s) => (
            <li key={s.requestId}>
              <strong>{hhmm(s.startMs)}–{hhmm(s.endMs)}</strong> · {s.memberId} ({s.requestId})
            </li>
          ))}
        </ul>
      )}

      {view.conflicts.length > 0 && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "#ffb6c8" }}>
          Waitlisted:{" "}
          {view.conflicts
            .map(
              (c) =>
                `${hhmm(c.startMs)}–${hhmm(c.endMs)} ${c.memberId} (${c.requestId}, conflicts with ${c.conflictsWith})`
            )
            .join("; ")}
        </p>
      )}

      <div
        role="note"
        aria-label="Schedule safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced · conflict-free · never an autonomous booking{" "}
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
          scheduleIntervalsSourced = {String(view.scheduleIntervalsSourced)} · scheduleConflictFree ={" "}
          {String(view.scheduleConflictFree)} · scheduleNoAutonomousBooking ={" "}
          {String(view.scheduleNoAutonomousBooking)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
