import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Primary Care Provider (PCP) Assignment / Member–Provider Matching agent — a
 * care-coordination service on the patient-care plane.
 *
 *   GET /api/agents/pcp-matching/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "pcp-matching-agent";

const CARD: A2AAgentCard = {
  name: "Primary Care Provider (PCP) Assignment / Member–Provider Matching Agent",
  description:
    "A care-coordination service on the patient-care plane — a DETERMINISTIC (no-Claude) agent that takes a panel of unassigned MEMBERS (each with a ranked list of preferred primary care providers) plus a set of PROVIDERS (each with a panel CAPACITY and a ranked list of acceptable members) and produces a STABLE assignment of members to providers: a matching in which no member and provider who both prefer each other over their current assignment are left apart (no BLOCKING pair) and no provider is over capacity — reporting each member's assigned provider + preference rank, the provider loads, the matched / unmatched tallies, and the disposition (all-matched / partial-match). UNLIKE the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity agent's HASH CHAIN — and, CRUCIALLY, UNLIKE the Caseload Balancing agent's GREEDY BIN-PACKING (worst-fit allocation of a panel across managers' capacity by acuity, with NO preferences and NO stability guarantee) — the heart of this service is TWO-SIDED STABLE MATCHING: the Gale–Shapley DEFERRED-ACCEPTANCE algorithm (the member-proposing, many-to-one 'hospitals/residents' variant) that, from both sides' preference lists + provider capacities, produces the member-optimal STABLE matching — the unique assignment with no blocking pair. An assignment that leaves a member and a provider who each prefer the other over their current lot (a blocking pair) is UNSTABLE — it unravels as the pair defects, leaving a patient without a real PCP — so the agent computes a provably stable matching DETERMINISTICALLY (a pure function of the preferences + capacities — no clock, no randomness — so the same panel always yields the same matching) and hands it to a human. Every assignment pairs a submitted member with a submitted provider (a phantom member / provider is blocked — the sourced + completeness gate), the matching is stable (an unstable / mis-recomputed matching with a blocking pair or capacity violation is blocked — the load-bearing correctness gate), and no assignment is ever committed, no patient reassigned, and no provider panel overridden autonomously (an autonomous commit is blocked). It COMPLEMENTS — it does not duplicate — the other care-coordination agents: distinct from the Caseload Balancing agent (which BIN-PACKS a panel across managers' capacity to balance load, no preferences), the Care Team & Case Management agent (the team around ONE patient), and the Population Health agent (prioritizing a panel) — this produces a STABLE two-sided matching of members to PCPs. It is PHI-bearing (the members are patients), so it is on the HIPAA-audit policy. The panel is illustrative, clearly labeled — NOT a certified panel-management system (real PCP assignment also weighs geography, language, continuity of care, plan-network rules, and member choice). Enforces, via the Pause Agent Fabric, that every assignment is sourced, the matching is stable, and no assignment is ever committed autonomously.",
  url: `${HOST}/api/agents/pcp-matching`,
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
      id: "assign-members-to-pcps",
      name: "Assign members to primary care providers via stable two-sided matching",
      description:
        "Given a panel of members with ranked provider preferences and providers with capacities + ranked member preferences, deterministically runs the member-proposing Gale–Shapley deferred acceptance to produce the member-optimal stable matching (no blocking pair, no capacity violation), with each member's assigned provider + preference rank and the disposition (all-matched / partial-match). Every assignment is sourced; the matching is stable; no assignment is committed autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "pcp-assignment",
        "stable-matching",
        "gale-shapley",
        "deferred-acceptance",
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
