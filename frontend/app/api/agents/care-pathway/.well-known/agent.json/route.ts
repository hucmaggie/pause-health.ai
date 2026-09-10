import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Care Pathway Sequencing agent — a clinical-decision service on the
 * patient / clinical plane.
 *
 *   GET /api/agents/care-pathway/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "care-pathway-agent";

const CARD: A2AAgentCard = {
  name: "Care Pathway Sequencing Agent",
  description:
    "A clinical-decision service on the patient / clinical plane — a DETERMINISTIC (no-Claude) agent that takes a clinical pathway's steps, each declaring the prerequisite steps that must precede it, and produces a valid execution order that respects every dependency, detecting dependency cycles (no valid order exists) and missing prerequisites (a step depends on a step absent from the pathway). UNLIKE the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the OIG Exclusion agent's identity MATCHING, the Drug Interaction agent's pairwise LOOKUP, or the MLR Rebate agent's RATIO + apportionment, the heart of this service is a TOPOLOGICAL ORDERING (Kahn's algorithm, ties broken by step id) over a dependency graph + CYCLE DETECTION. The determination is a pure function of the pathway's steps (no randomness, no clock), so the same pathway always yields the same order. Every step id in the output references a submitted step (a fabricated / dangling step id is blocked), the sequence respects every prerequisite (when sequenced, the ordered steps are a complete permutation of the pathway and every step appears after all its prerequisites — the load-bearing correctness gate; when un-sequenceable, no order is asserted), and no step is ever executed to the record (an autonomous execution is blocked). It COMPLEMENTS — it does not duplicate — the other clinical agents: distinct from the Care Plan agent (which AUTHORS a plan's goals / interventions / cadence from a template), the Transitions of Care and Care Coordination Handoff agents (moving a patient between settings / teams), the Prior Authorization agent (assembling a PA package), and the Drug Interaction / Controlled Substance agents (medication safety) — this ORDERS the steps of a pathway so no step is scheduled before its prerequisites. It is PHI-bearing (the pathway references the patient), so it is on the HIPAA-audit policy. The pathways + steps are illustrative, clearly labeled — NOT a certified clinical pathway engine; real pathway management uses evidence-based order sets, the patient's clinical context, scheduling / timing constraints, and the care team's judgment. Enforces, via the Pause Agent Fabric, that every step is sourced, the sequence respects every prerequisite, and no step is executed autonomously.",
  url: `${HOST}/api/agents/care-pathway`,
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
      id: "sequence-care-pathway",
      name: "Sequence a clinical pathway's steps by prerequisite dependencies",
      description:
        "Given a clinical pathway's steps and their prerequisites, deterministically produces a valid execution order (topological sort) that respects every dependency, detecting dependency cycles and missing prerequisites. Every step is sourced; the sequence respects every prerequisite; no step is executed autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-pathway",
        "clinical-pathway",
        "sequencing",
        "topological-sort",
        "clinical-decision",
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
