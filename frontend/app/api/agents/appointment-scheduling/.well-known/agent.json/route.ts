import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Agentforce Appointment Scheduling agent —
 * the Salesforce "Agentforce for Health — Book/Reschedule/Update
 * Appointment" analog.
 *
 *   GET /api/agents/appointment-scheduling/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric
 * registry (appliesTo) rather than hand-listed, so the discovery
 * document can't drift from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "appointment-scheduling-agent";

const CARD: A2AAgentCard = {
  name: "Agentforce Appointment Scheduling Agent",
  description:
    "Books (and reschedules) the MSCP menopause-specialist visit the Care Router recommends, honoring the requested modality (telehealth / in-person) against a provider availability calendar, and returns a structured booking — a Salesforce ServiceAppointment id, the confirmed slot start/end, modality, provider, and status (booked / rescheduled) — with the (mock) scheduling-system source it traces to. In the prototype the calendar is a DETERMINISTIC synthetic (hashed provider + date → stable open slots, 30-minute business-hours visits), clearly labeled synthetic — NOT a real Salesforce Scheduler / ServiceAppointment write. Enforces, via the Pause Agent Fabric, that the scheduler never double-books an already-taken slot and only books within the provider's published availability. Hands the booked appointment to the Engagement Agent for visit reminders, closing the intake → routing → booking → engagement loop.",
  url: `${HOST}/api/agents/appointment-scheduling`,
  provider: {
    organization: "Salesforce Agentforce (via Pause-Health.ai)",
    url: "https://pause-health.ai"
  },
  version: "1.0.0",
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true
  },
  defaultInputModes: ["data"],
  defaultOutputModes: ["text", "data"],
  skills: [
    {
      id: "book-appointment",
      name: "Book or reschedule an MSCP visit",
      description:
        "Given a scheduling request (provider + modality + a requested date/window or an explicit slot start), returns a deterministic synthetic booking: a synthetic ServiceAppointment id, the confirmed slot start/end, modality, provider, status, and the mock scheduling-system source it traces to. Never double-books and only books within published availability.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["scheduling", "appointment", "booking", "care-coordination", "mscp"]
    }
  ],
  pauseGovernance: {
    fabricRegisteredAs: FABRIC_AGENT_ID,
    policies: getPoliciesForAgent(FABRIC_AGENT_ID).map((p) => p.id)
  }
};

export async function GET() {
  return NextResponse.json(CARD, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
    }
  });
}
