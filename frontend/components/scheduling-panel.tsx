"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type AppointmentBooking,
  type AppointmentSource,
  type Modality,
  type SchedulingRequest,
  getProviderAvailability
} from "../lib/scheduling";

/**
 * Appointment Scheduling runner for the intake demo.
 *
 * Fires the real, server-side A2A Appointment Scheduling agent at
 * /api/agents/appointment-scheduling/tasks — the Salesforce "Agentforce
 * for Health — Book/Reschedule/Update Appointment" analog — which books
 * (or reschedules) the MSCP menopause-specialist visit the Care Router
 * recommends against a DETERMINISTIC synthetic provider calendar (no LLM,
 * no real Salesforce Scheduler / ServiceAppointment write). The panel
 * surfaces the structured AppointmentBooking (synthetic ServiceAppointment
 * id, confirmed slot start/end, modality, provider, status) plus its
 * (mock) scheduling-system source provenance, the Engagement-Agent
 * reminder handoff, and a deep link into the parented Agent Fabric trace.
 *
 * Two governance-block presets intentionally target a taken slot and a
 * time outside published availability, so policy.scheduling.no-double-book
 * and policy.scheduling.honor-provider-availability are demonstrable in
 * the UI rather than hidden — the panel reports the failed state and which
 * policy blocked it honestly rather than faking a booking.
 *
 * Structure, styling tokens (.card, .btn/.btn-primary/.btn-secondary,
 * .eyebrow, .agentforce-voice-help-link, .routing-live-result), and tone
 * mirror <AssessmentPanel> and <BenefitsPanel> so this reads as a native
 * sibling on /demo/intake.
 */

const SCHEDULING_ROUTE = "/api/agents/appointment-scheduling/tasks";

/** A clearly-synthetic demo provider + anchor Monday the calendar keys on. */
const PROVIDER_ID = "1720394857";
const PROVIDER_NAME = "Dr. Elena Vasquez, MD, MSCP";
const ANCHOR_DATE = "2026-02-02";

// The calendar is deterministic, so we can derive concrete "already-taken"
// and "open" slots at module-eval time — the same values the agent will see
// server-side — which is what lets the double-book / reschedule presets be
// one-click yet honest (no randomness, no clock).
const ANCHOR_AVAILABILITY = getProviderAvailability(PROVIDER_ID, ANCHOR_DATE);
const FIRST_BOOKED_SLOT = ANCHOR_AVAILABILITY.slots.find((s) => s.status === "booked");
const FIRST_OPEN_SLOT = ANCHOR_AVAILABILITY.slots.find((s) => s.status === "open");

/** A one-click demo scenario. Each posts a `schedulingRequest`. */
export type SchedulingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  request: SchedulingRequest;
};

export const SCHEDULING_PRESETS: SchedulingPreset[] = [
  {
    id: "book-telehealth",
    label: "Book telehealth visit",
    hint: "Auto-picks the first open telehealth slot on the synthetic calendar.",
    request: {
      providerId: PROVIDER_ID,
      providerName: PROVIDER_NAME,
      modality: "telehealth",
      requestedDate: ANCHOR_DATE
    },
    demonstrates:
      "A clean booking — the first open telehealth slot is confirmed with a synthetic ServiceAppointment id and handed to the Engagement Agent for reminders."
  },
  {
    id: "reschedule",
    label: "Reschedule to an open slot",
    hint: "Moves a prior visit onto an open slot (status → rescheduled).",
    request: {
      providerId: PROVIDER_ID,
      providerName: PROVIDER_NAME,
      modality: (FIRST_OPEN_SLOT?.modalities[0] ?? "telehealth") as Modality,
      requestedSlotStart: FIRST_OPEN_SLOT?.start,
      intent: "reschedule",
      rescheduleFrom: { serviceAppointmentId: "sa-prior-visit" }
    },
    demonstrates:
      "A reschedule onto an open slot — the confirmed booking records the prior appointment it replaced."
  },
  {
    id: "double-book",
    label: "Double-book a taken slot → block",
    hint: "Targets a slot already taken on the provider's synthetic calendar.",
    request: {
      providerId: PROVIDER_ID,
      providerName: PROVIDER_NAME,
      modality: (FIRST_BOOKED_SLOT?.modalities[0] ?? "telehealth") as Modality,
      requestedSlotStart: FIRST_BOOKED_SLOT?.start ?? `${ANCHOR_DATE}T09:00:00`
    },
    demonstrates:
      "The Agent Fabric refusing to double-book an already-taken slot (policy.scheduling.no-double-book) before any ServiceAppointment is written."
  },
  {
    id: "out-of-availability",
    label: "Time outside availability → block",
    hint: "Requests 03:00 — never a published business-hours slot.",
    request: {
      providerId: PROVIDER_ID,
      providerName: PROVIDER_NAME,
      modality: "telehealth",
      // 03:00 is never a published business-hours slot (09:00–16:30).
      requestedSlotStart: `${ANCHOR_DATE}T03:00:00`
    },
    demonstrates:
      "The Agent Fabric refusing a time outside the provider's published availability (policy.scheduling.honor-provider-availability)."
  }
];

/** Render-ready view of a confirmed booking lifted from the A2A task. */
export type BookingView = {
  kind: "booked";
  serviceAppointmentId: string;
  providerId: string;
  providerName: string;
  modality: Modality;
  slotStart: string;
  slotEnd: string;
  durationMinutes: number;
  status: string;
  serviceType: string;
  rescheduledFrom?: { serviceAppointmentId?: string; slotStart?: string };
  source: AppointmentSource;
  nextAgent?: string;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked booking. */
export type SchedulingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be booked. */
export type SchedulingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type SchedulingView = BookingView | SchedulingBlockedView | SchedulingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  nextAgent?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept
 * pure (no fetch, no hooks) so it can be unit-tested without a DOM,
 * mirroring buildBenefitsRequestBody. The scheduling request is carried
 * under a `schedulingRequest` data part.
 */
export function buildSchedulingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request: SchedulingRequest;
}) {
  return {
    jsonrpc: "2.0" as const,
    id: input.taskId,
    method: "tasks/send" as const,
    params: {
      id: input.taskId,
      message: {
        role: "user" as const,
        parts: [{ type: "data" as const, data: { schedulingRequest: input.request } }]
      },
      metadata: { personaId: input.personaId ?? "demo" }
    }
  };
}

/**
 * POST a scheduling request to the Appointment Scheduling agent and return
 * the resulting A2A task. `fetchImpl` is injectable so tests can stub the
 * network boundary. A governance block comes back as HTTP 200 with a
 * `failed` task — only a malformed envelope / parse error is a non-OK
 * response.
 */
export async function runSchedulingTask(
  input: { taskId: string; personaId?: string; request: SchedulingRequest },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(SCHEDULING_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSchedulingRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a confirmed
 * booking (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function schedulingViewFromTask(task: A2ATask): SchedulingView {
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
        "The Agent Fabric blocked this appointment booking.";
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
        : "The appointment could not be booked.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const booking = (data.booking ?? {}) as Partial<AppointmentBooking>;

  return {
    kind: "booked",
    serviceAppointmentId: booking.serviceAppointmentId ?? "",
    providerId: booking.providerId ?? "",
    providerName: booking.providerName ?? "",
    modality: (booking.modality ?? "telehealth") as Modality,
    slotStart: booking.slotStart ?? "",
    slotEnd: booking.slotEnd ?? "",
    durationMinutes: booking.durationMinutes ?? 0,
    status: booking.status ?? "booked",
    serviceType: booking.serviceType ?? "",
    ...(booking.rescheduledFrom ? { rescheduledFrom: booking.rescheduledFrom } : {}),
    source: booking.source as AppointmentSource,
    nextAgent: typeof fabric.nextAgent === "string" ? fabric.nextAgent : undefined,
    traceTaskId
  };
}

const MODALITY_TONE: Record<string, string> = {
  telehealth: "#8fd6b0",
  "in-person": "#ffd28a"
};

function Pill({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const color = tone ?? MODALITY_TONE[value] ?? "var(--muted)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.1rem 0.5rem",
        borderRadius: "999px",
        border: `1px solid ${color}`,
        color,
        fontSize: "0.78rem",
        fontWeight: 600
      }}
    >
      {label}: {value}
    </span>
  );
}

/** Render an ISO-ish local timestamp as a readable date + time (no tz math). */
function fmtSlot(iso: string): string {
  if (!iso) return "—";
  const [date, time] = iso.split("T");
  return `${date} ${time ? time.slice(0, 5) : ""}`.trim();
}

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: SchedulingView }
  | { status: "error"; message: string };

export function SchedulingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const run = async (input: { label: string; request: SchedulingRequest }) => {
    setRunState({ status: "running", label: input.label });
    try {
      const task = await runSchedulingTask({
        taskId: newTaskId("scheduling"),
        personaId: "demo",
        request: input.request
      });
      setRunState({ status: "done", view: schedulingViewFromTask(task) });
    } catch (err) {
      setRunState({
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  };

  const runPreset = (preset: SchedulingPreset) => {
    void run({ label: preset.label, request: preset.request });
  };

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
        Appointment scheduling (book / reschedule)
      </p>
      <h3 style={{ margin: 0 }}>The Scheduling agent that books the recommended visit</h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Appointment Scheduling agent books (or reschedules) the MSCP
        menopause-specialist visit the Care Router recommends over Google A2A,
        honoring the requested modality against a{" "}
        <strong>deterministic synthetic provider calendar</strong> and returning
        a confirmed slot with a synthetic ServiceAppointment id + source
        provenance, then handing the booking to the Engagement Agent for
        reminders.{" "}
        <strong>
          This is a labeled demo mock — not a real Salesforce Scheduler /
          ServiceAppointment write.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {SCHEDULING_PRESETS.map((preset) => (
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
              ? "Booking…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Appointment booking failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <SchedulingResult view={runState.view} />}
    </section>
  );
}

const metricRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "0.5rem",
  fontSize: "0.86rem",
  padding: "0.15rem 0"
};

function SchedulingResult({ view }: { view: SchedulingView }) {
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
          Not booked
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>{view.message}</p>
        {traceLink}
      </div>
    );
  }

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Synthetic booking (deterministic mock calendar)
      </p>
      <p style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "var(--text)" }}>
        {view.providerName || view.providerId}
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          margin: "0.5rem 0 0"
        }}
      >
        <Pill label="Modality" value={view.modality} />
        <Pill
          label="Status"
          value={view.status}
          tone={view.status === "rescheduled" ? "#ffd28a" : "#8fd6b0"}
        />
      </div>

      <ul
        className="metric-list"
        style={{ margin: "0.7rem 0 0", listStyle: "none", padding: 0 }}
      >
        <li style={metricRow}>
          <span style={{ color: "var(--muted)" }}>Confirmed slot</span>
          <strong>
            {fmtSlot(view.slotStart)} → {view.slotEnd ? view.slotEnd.split("T")[1]?.slice(0, 5) : ""}
          </strong>
        </li>
        <li style={metricRow}>
          <span style={{ color: "var(--muted)" }}>Duration</span>
          <strong>{view.durationMinutes} min</strong>
        </li>
        <li style={metricRow}>
          <span style={{ color: "var(--muted)" }}>Service type</span>
          <strong>{view.serviceType}</strong>
        </li>
        <li style={metricRow}>
          <span style={{ color: "var(--muted)" }}>ServiceAppointment id (synthetic)</span>
          <strong
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            {view.serviceAppointmentId}
          </strong>
        </li>
      </ul>

      {view.rescheduledFrom && (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
          Replaces prior appointment{" "}
          <code>{view.rescheduledFrom.serviceAppointmentId ?? "—"}</code>
          {view.rescheduledFrom.slotStart
            ? ` (was ${fmtSlot(view.rescheduledFrom.slotStart)})`
            : ""}
          .
        </p>
      )}

      {view.source && (
        <div
          role="note"
          aria-label="Synthetic scheduling source provenance"
          style={{
            marginTop: "0.7rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Source provenance{" "}
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
          <ul
            style={{
              margin: "0.4rem 0 0",
              paddingLeft: "1.1rem",
              color: "var(--muted)",
              fontSize: "0.82rem"
            }}
          >
            <li>System: {view.source.system}</li>
            <li>Calendar: {view.source.calendarId}</li>
            <li>Booking reference: {view.source.bookingReference}</li>
          </ul>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
            {view.source.note}
          </p>
        </div>
      )}

      {view.nextAgent && (
        <div
          role="note"
          aria-label="Engagement handoff"
          style={{
            marginTop: "0.7rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Handed to the Engagement Agent
          </p>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
            The booked appointment is handed to the Engagement Agent for visit
            reminders (drafted 24h + 1h before the visit, quiet-hours-aware,
            human-approval-gated — never auto-sent).
          </p>
          <p
            style={{
              margin: "0.4rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            nextAgent = {view.nextAgent}
          </p>
        </div>
      )}

      {traceLink}
    </div>
  );
}
