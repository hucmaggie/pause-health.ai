import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Household / Family-Unit Composition agent — a claims / payer-operations
 * service on the payer & plan operations plane.
 *
 *   GET /api/agents/household-composition/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "household-composition-agent";

const CARD: A2AAgentCard = {
  name: "Household / Family-Unit Composition Agent",
  description:
    "A claims / payer-operations service on the payer & plan operations plane — a DETERMINISTIC (no-Claude) agent that takes a batch of plan MEMBERS plus a set of PAIRWISE relationship LINKS (shared subscriber, shared address, a tax-dependent tie) and groups the members into HOUSEHOLDS by computing the CONNECTED COMPONENTS of the relationship graph — so a member linked to a member linked to a third all land in ONE household even when the first and third are not directly linked (transitivity) — reporting the households, the household count, the largest-household size, and the disposition (all-singletons / households-formed). UNLIKE the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the Drug–Drug Interaction agent's PAIRWISE KNOWLEDGE-BASE LOOKUP, or the Audit Log Integrity agent's HASH CHAIN — and CRUCIALLY distinct from the Master-Patient-Index agent's identity MATCHING (which links records of the SAME person across systems) — the heart of this service is UNION-FIND / DISJOINT-SET CONNECTED COMPONENTS: it clusters DIFFERENT people who share a household by taking the transitive closure of the relationship links. A household drives a family deductible / out-of-pocket maximum, household-level outreach, and consent scoping; a wrong grouping mis-applies a family accumulator or leaks one member's data to another, so the agent surfaces the grouping DETERMINISTICALLY (a pure function of the members + links — no clock, no randomness — so the same input always yields the same households, with deterministic household ids assigned by each component's minimum member) and hands it to a human. Every link connects two submitted members and the households partition exactly the submitted members (a phantom link or a dropped / invented member is blocked — the sourced + completeness gate), the partition is the correct connected components (a wrong grouping that merges two unlinked members or splits two linked ones is blocked — the load-bearing correctness gate), and no member records are merged, enrollment changed, or family accumulator applied autonomously (an autonomous merge is blocked). It COMPLEMENTS — it does not duplicate — the other member / enrollment agents: distinct from the Master-Patient-Index agent (same-person matching), the Enrollment Reconciliation agent (WHO is enrolled between employer and carrier via a keyed set-difference), and the Coordination of Benefits agent (the ORDER of a member's coverages) — this GROUPS distinct members into family units. It is PHI-bearing (the members are patients), so it is on the HIPAA-audit policy. The members + links are illustrative, clearly labeled — NOT a certified enrollment / MDM system; real household / family-unit composition uses the 834 subscriber / dependent structure, address normalization, tax-household rules, and a master-data-management steward's judgment. Enforces, via the Pause Agent Fabric, that every link + household is sourced, the partition is exact, and no records are merged autonomously.",
  url: `${HOST}/api/agents/household-composition`,
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
      id: "compose-households",
      name: "Group members into households by connected components",
      description:
        "Given a batch of members and pairwise relationship links, deterministically computes the connected components of the relationship graph via union-find (the transitive closure of the links), and derives the disposition (all-singletons / households-formed). Every link + household is sourced and the batch is partitioned exactly; the partition recomputes exactly; no member records are merged autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "payer-operations",
        "household-composition",
        "family-unit",
        "union-find",
        "connected-components",
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
