import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Scheduling Conflict / Double-Booking Guard agent — a care-coordination
 * service on the patient / clinical plane.
 *
 *   GET /api/agents/schedule-conflict/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "schedule-conflict-agent";

const CARD: A2AAgentCard = {
  name: "Scheduling Conflict / Double-Booking Guard Agent",
  description:
    "A care-coordination service on the patient / clinical plane — a DETERMINISTIC (no-Claude) agent that takes a resource (a provider's clinic day, an infusion chair, an imaging machine) and a batch of requested appointment intervals (each a start/end time for a patient) and computes the maximum conflict-free schedule that fits without double-booking, waitlisting the requests that collide. UNLIKE the Caseload Balancing agent's GREEDY BIN-PACKING under a capacity constraint, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING + GAP DETECTION (that one MERGES overlapping intervals; this one SELECTS a maximum NON-overlapping subset), the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the OIG Exclusion agent's identity MATCHING, or the Audit Log Integrity agent's HASH CHAIN — and UNLIKE the date-deadline agents (Timely Filing, Right of Access, Amendment) that add N days to a single date — the heart of this service is GREEDY INTERVAL SELECTION (the classic activity-selection algorithm: sort by earliest finish time and admit each interval that doesn't overlap the last admitted, provably maximizing the number of non-overlapping appointments). Time is data: the schedule is a pure function of the requested intervals (ISO strings or epoch-ms, no real clock), so the same batch always yields the same schedule. Every appointment is sourced + accounted for exactly once (a fabricated / dropped / double-counted appointment is blocked — the sourced + completeness gate), the scheduled set is conflict-free and every waitlist is justified (a double-booking or an unjust waitlist is blocked — the load-bearing correctness gate), and no appointment is ever booked / cancelled / bumped (an autonomous booking is blocked). It COMPLEMENTS — it does not duplicate — the Appointment Scheduling agent (which BOOKS a SINGLE slot and never double-books THAT slot): this validates a WHOLE BATCH for a resource, computes the conflict-free schedule + the waitlist, and hands it to a scheduler. It is PHI-bearing (the requests reference the patients being scheduled), so it is on the HIPAA-audit policy. The resource + intervals are illustrative, clearly labeled — NOT a certified scheduling system; real scheduling uses provider availability calendars, appointment-type durations, buffer / turnover times, and room / equipment constraints. Enforces, via the Pause Agent Fabric, that every appointment is sourced + accounted for once, the schedule is conflict-free, and no appointment is booked autonomously.",
  url: `${HOST}/api/agents/schedule-conflict`,
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
      id: "resolve-schedule-conflicts",
      name: "Compute a resource's maximum conflict-free schedule and waitlist the collisions",
      description:
        "Given a resource and a batch of requested appointment intervals, deterministically computes the maximum conflict-free schedule (the classic earliest-finish activity-selection greedy) and waitlists the requests that overlap a scheduled appointment. Every appointment is sourced + accounted for once; the scheduled set is conflict-free; no appointment is booked autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "scheduling",
        "double-booking",
        "conflict-free",
        "interval-selection",
        "care-coordination",
        "governance"
      ]
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
