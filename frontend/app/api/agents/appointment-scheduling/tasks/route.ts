import { NextResponse } from "next/server";
import {
  type A2ATask,
  agentMessage,
  findDataPart,
  newTaskId,
  nowIso,
  parseTasksSendEnvelope
} from "../../../../../lib/a2a";
import {
  evaluateGovernance,
  recordInstantSpan
} from "../../../../../lib/agent-fabric";
import {
  bookAppointment,
  bookingSummary,
  evaluateSchedulingRequest,
  hasSchedulingSource,
  type AppointmentBooking,
  type SchedulingRequest
} from "../../../../../lib/scheduling";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "appointment-scheduling-agent";

/**
 * Google A2A `tasks/send` endpoint for the Agentforce Appointment
 * Scheduling agent — the Salesforce "Agentforce for Health —
 * Book/Reschedule/Update Appointment" analog.
 *
 *   POST /api/agents/appointment-scheduling/tasks
 *
 * Books (or reschedules) the MSCP menopause-specialist visit the Care
 * Router recommends, honoring the requested modality (telehealth /
 * in-person) against a DETERMINISTIC synthetic provider availability
 * calendar, and returns a structured AppointmentBooking (synthetic
 * ServiceAppointment id, confirmed slot start/end, modality, provider,
 * status) plus its (mock) scheduling-system source. The calendar is a
 * MOCK — NOT a real Salesforce Scheduler / ServiceAppointment write.
 *
 * Enforced-block policies checked before any slot is booked:
 *   - policy.scheduling.no-double-book (a slot already taken on the
 *     provider's synthetic calendar is refused)
 *   - policy.scheduling.honor-provider-availability (a time outside the
 *     provider's published availability for the modality is refused)
 * A block returns HTTP 200 with an A2A task in state `failed`.
 *
 * Input (data part), either:
 *   { schedulingRequest: SchedulingRequest } — the agent picks the first
 *      open slot (or the explicit requestedSlotStart) and books it
 *   { booking: AppointmentBooking } — a caller-asserted booking, only
 *      admissible if it carries scheduling source provenance (else blocked)
 * A bare data object is also accepted and read as the SchedulingRequest.
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  const parsed = parseTasksSendEnvelope(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: parsed.id, error: { code: parsed.code, message: parsed.message } },
      { status: 400 }
    );
  }

  const params = parsed.params;
  const taskId = params.id || newTaskId("scheduling");
  const sessionId = params.sessionId;
  const parentSpanId =
    typeof params.metadata?.parentSpanId === "string"
      ? (params.metadata.parentSpanId as string)
      : undefined;
  const personaId =
    typeof params.metadata?.personaId === "string"
      ? (params.metadata.personaId as string)
      : undefined;

  const data = findDataPart(params.message?.parts) ?? {};
  const asserted = data.booking as AppointmentBooking | undefined;
  const request = (data.schedulingRequest ?? data.request ?? data) as SchedulingRequest;
  const usingAsserted = asserted !== undefined && asserted !== null;
  const isReschedule =
    (usingAsserted ? asserted?.status === "rescheduled" : request?.intent === "reschedule");

  // Honest signals for the governance gate. For a caller-asserted booking we
  // can't re-derive calendar state, so we only vouch for the two invariants
  // when the asserted booking carries a valid scheduling source; otherwise we
  // report them as violated (a source-less caller-asserted booking is refused
  // by the same no-double-book / honor-availability gate). For a real
  // scheduling request we evaluate against the deterministic calendar.
  let requestedSlotIsFree: boolean;
  let slotWithinProviderAvailability: boolean;
  if (usingAsserted) {
    const sourced = hasSchedulingSource(asserted);
    requestedSlotIsFree = sourced;
    slotWithinProviderAvailability = sourced;
  } else {
    const evalResult = evaluateSchedulingRequest(request);
    requestedSlotIsFree = evalResult.requestedSlotIsFree;
    slotWithinProviderAvailability = evalResult.slotWithinProviderAvailability;
  }

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: { requestedSlotIsFree, slotWithinProviderAvailability }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "scheduling.book.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        providerId: String(request?.providerId ?? asserted?.providerId ?? "unknown"),
        modality: String(request?.modality ?? asserted?.modality ?? "unknown"),
        requestedSlotIsFree,
        slotWithinProviderAvailability,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        ...(personaId ? { personaId } : {})
      }
    });
    const failed: A2ATask = {
      id: taskId,
      sessionId,
      status: {
        state: "failed",
        timestamp: nowIso(),
        message: agentMessage(
          `Pause Agent Fabric blocked this appointment booking: ${governance.blockingViolations
            .map((v) => `${v.policyId} (${v.reason})`)
            .join("; ")}`,
          { blockingViolations: governance.blockingViolations }
        )
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
          violations: governance.blockingViolations
        }
      }
    };
    return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: failed });
  }

  // Book the slot. Defense in depth: bookAppointment() throws on a
  // double-book or out-of-availability slot even though the gate above
  // already blocks those, so an unexpected refusal surfaces as a failed
  // task rather than a bad booking. A caller-asserted (already-booked)
  // booking is passed through as-is.
  let booking: AppointmentBooking;
  try {
    booking = usingAsserted ? (asserted as AppointmentBooking) : bookAppointment(request);
  } catch (err) {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "scheduling.book.invalid",
      protocol: "a2a",
      status: "error",
      attributes: {
        providerId: String(request?.providerId ?? "unknown"),
        error: (err as Error).message,
        ...(personaId ? { personaId } : {})
      }
    });
    const failed: A2ATask = {
      id: taskId,
      sessionId,
      status: {
        state: "failed",
        timestamp: nowIso(),
        message: agentMessage(`Appointment could not be booked: ${(err as Error).message}`)
      },
      metadata: {
        agentFabric: {
          decision: "allow",
          policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
          error: (err as Error).message
        }
      }
    };
    return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: failed });
  }

  const summary = bookingSummary(booking);
  const operation = isReschedule ? "scheduling.reschedule" : "scheduling.book";

  const bookSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation,
    protocol: "rest",
    attributes: {
      providerId: summary.providerId,
      providerName: summary.providerName,
      modality: summary.modality,
      serviceAppointmentId: summary.serviceAppointmentId,
      slotStart: summary.slotStart,
      slotEnd: summary.slotEnd,
      status: summary.status,
      requestedSlotIsFree,
      slotWithinProviderAvailability,
      bookingReference: summary.bookingReference,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // The booked appointment is handed to the Engagement Agent for visit
  // reminders — the acquisition → intake → routing → booking → engagement
  // close. The reminder cadence is drafted human-approval-gated, never
  // auto-sent (mirroring the engagement agent's own governance).
  const handoffSpan = recordInstantSpan({
    taskId,
    parentSpanId: bookSpan.id,
    agentId: "engagement-agent",
    operation: "engagement.reminder.schedule",
    protocol: "a2a",
    attributes: {
      serviceAppointmentId: summary.serviceAppointmentId,
      remindersScheduled: 2,
      cadence: "24h + 1h before visit",
      channel: "sms",
      quietHoursRespected: true,
      humanApprovalRequired: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `${booking.providerName} · ${booking.modality} · ${booking.status}: ${booking.slotStart} → ${booking.slotEnd} for the ${booking.serviceType} (synthetic ServiceAppointment ${booking.serviceAppointmentId}).`,
        { booking, summary }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "AppointmentBooking",
        description:
          "Synthetic (deterministic) appointment booking for the MSCP visit: a synthetic Salesforce ServiceAppointment id, the confirmed slot start/end, modality, provider, status (booked / rescheduled), and the (mock) scheduling-system source the booking traces to. This is a MOCK calendar, not a real Salesforce Scheduler write.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { booking, summary } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: bookSpan.id,
        traceTaskId: taskId,
        serviceAppointmentId: summary.serviceAppointmentId,
        modality: summary.modality,
        slotStart: summary.slotStart,
        status: summary.status,
        handoffSpanId: handoffSpan.id,
        // Booked appointment handed to the Engagement Agent for reminders.
        nextAgent: "engagement-agent"
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
