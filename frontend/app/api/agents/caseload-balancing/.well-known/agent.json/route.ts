import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Caseload Balancing (Care-Manager Panel Assignment) agent — a
 * care-coordination service on the patient / clinical plane.
 *
 *   GET /api/agents/caseload-balancing/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "caseload-balancing-agent";

const CARD: A2AAgentCard = {
  name: "Caseload Balancing (Care-Manager Panel Assignment) Agent",
  description:
    "A care-coordination service on the patient / clinical plane — a DETERMINISTIC (no-Claude) agent that takes a panel of members (each with an acuity weight) and a set of care managers (each with a weighted-slot capacity) and allocates the members across the managers without exceeding any manager's capacity — balancing the load and waitlisting the overflow. UNLIKE the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING + GAP DETECTION, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the OIG Exclusion agent's identity MATCHING, or the Audit Log Integrity agent's HASH CHAIN — and UNLIKE the date-deadline agents (Timely Filing, Right of Access, Amendment) that add N days to a single date — the heart of this service is GREEDY ALLOCATION UNDER A CAPACITY CONSTRAINT (a bin-packing / worst-fit-decreasing assignment of weighted items into capacity-limited bins). Time is data: the allocation is a pure function of the members + managers (no real clock), so the same panel always yields the same assignment. Every member is accounted for exactly once (a dropped / double-counted member is blocked — the completeness gate), no manager is over capacity and every waitlist is justified (an over-loaded manager, a miscounted load, or an unjust waitlist is blocked — the load-bearing correctness gate), and no assignment is ever committed (an autonomous commit is blocked). It COMPLEMENTS — it does not duplicate — the other care-coordination agents: distinct from the Care Team & Case Management agent (which assembles the team around ONE patient and picks that patient's case manager), the Complex Care Management agent (CCM time-tracking for ONE patient), the Transitions of Care agent (moving ONE patient), and the Population Health agent (which prioritizes a panel) — this allocates a whole panel across the managers' finite capacity. It is PHI-bearing (the members reference the patients on the panel), so it is on the HIPAA-audit policy. The members + managers + acuity + capacity are illustrative, clearly labeled — NOT a certified caseload / staffing system; real panel assignment uses validated acuity instruments, care-manager licensure / specialty / language fit, geographic match, and continuity of an existing relationship. Enforces, via the Pause Agent Fabric, that every member is accounted for exactly once, no manager is over capacity, and no assignment is committed autonomously.",
  url: `${HOST}/api/agents/caseload-balancing`,
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
      id: "balance-caseload",
      name: "Allocate a panel of members across care managers within capacity",
      description:
        "Given a panel of members (each with an acuity weight) and a set of care managers (each with a capacity), deterministically allocates the members across the managers without exceeding capacity — a worst-fit-decreasing greedy bin-packing — waitlisting the overflow. Every member is accounted for exactly once; no manager is over capacity; no assignment is committed autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "caseload",
        "panel-assignment",
        "capacity",
        "bin-packing",
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
