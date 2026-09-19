import { NextResponse } from "next/server";
import {
  bookAppointment,
  bookingSummary,
  evaluateSchedulingRequest,
  type Modality,
  type SchedulingRequest
} from "../../../../lib/scheduling";
import { evaluateGovernance } from "../../../../lib/agent-fabric";

/**
 * Agentforce-facing REST alias for the Appointment Scheduling agent.
 *
 *   GET /api/agentforce/appointment-scheduling?providerId=npi-123&modality=telehealth&requestedDate=2026-02-10
 *
 * The fabric agent proper speaks Google A2A (`POST /api/agents/
 * appointment-scheduling/tasks`, a JSON-RPC `tasks/send` envelope). Salesforce
 * Agentforce External Services map a flat REST request/response, not an A2A
 * envelope — so this thin alias exposes the SAME deterministic booking
 * (`evaluateSchedulingRequest` + `bookAppointment`) and the SAME Agent Fabric
 * governance gate (no double-book, honor published availability) as a plain GET
 * that returns the flat booking summary (or {blocked, violations}).
 *
 * It is a pure re-use of lib/scheduling.ts — no new business logic — so the
 * Agentforce action and the A2A agent can never diverge. Synthetic data only:
 * bookings are against a deterministic synthetic provider calendar; the
 * ServiceAppointment id is a mock, NOT a real Salesforce record.
 *
 * Registered in Salesforce as the External Service `PauseAppointmentScheduling`
 * (see salesforce/external-services/pause-appointment-scheduling.oas.yaml).
 */

const FABRIC_AGENT_ID = "appointment-scheduling-agent";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const providerId = (searchParams.get("providerId") ?? "").trim();
  const modalityRaw = (searchParams.get("modality") ?? "telehealth").trim().toLowerCase();
  const modality: Modality = modalityRaw === "in-person" ? "in-person" : "telehealth";
  const providerName = searchParams.get("providerName") ?? undefined;
  const requestedDate = searchParams.get("requestedDate") ?? undefined;
  const requestedSlotStart = searchParams.get("requestedSlotStart") ?? undefined;
  const patientZip = searchParams.get("patientZip") ?? undefined;
  const intentRaw = (searchParams.get("intent") ?? "book").trim().toLowerCase();
  const intent: "book" | "reschedule" = intentRaw === "reschedule" ? "reschedule" : "book";

  if (!providerId) {
    return NextResponse.json(
      {
        error: "missing-providerId",
        _note:
          "Provide ?providerId=<the provider to book with> (e.g. the Care Router's recommended NPI) and modality=telehealth|in-person. Synthetic appointment-scheduling alias for the A2A agent."
      },
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  const request: SchedulingRequest = {
    providerId,
    providerName,
    modality,
    requestedDate,
    requestedSlotStart,
    patientZip,
    intent
  };

  // Same governance signals the A2A route enforces, evaluated against the
  // deterministic synthetic calendar: the requested slot must be free (no
  // double-book) and within the provider's published availability for the
  // modality. A block returns the flat blocked shape.
  const evalResult = evaluateSchedulingRequest(request);
  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      requestedSlotIsFree: evalResult.requestedSlotIsFree,
      slotWithinProviderAvailability: evalResult.slotWithinProviderAvailability
    }
  });

  if (governance.decision === "block") {
    return NextResponse.json(
      {
        blocked: true,
        decision: "block",
        violations: governance.blockingViolations.map((v) => ({
          policyId: v.policyId,
          reason: v.reason
        })),
        _note:
          "Pause Agent Fabric blocked this booking (e.g. slot not free or outside the provider's published availability). Synthetic; see the A2A agent at /api/agents/appointment-scheduling."
      },
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  const booking = bookAppointment(request);
  const summary = bookingSummary(booking);

  return NextResponse.json(
    {
      ...summary,
      _note:
        "Synthetic deterministic booking against a mock provider calendar — the ServiceAppointment id is a mock, NOT a real Salesforce record. Agentforce alias for the A2A appointment-scheduling agent."
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
      }
    }
  );
}
