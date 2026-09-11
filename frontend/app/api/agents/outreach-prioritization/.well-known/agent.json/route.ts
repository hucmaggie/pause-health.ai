import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Care-Management Capacity Allocation / Outreach Prioritization agent — a
 * care-coordination / capacity-planning service on the patient & clinical plane.
 *
 *   GET /api/agents/outreach-prioritization/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "outreach-prioritization-agent";

const CARD: A2AAgentCard = {
  name: "Care-Management Capacity Allocation / Outreach Prioritization Agent",
  description:
    "A care-coordination / capacity-planning service on the patient & clinical plane — a DETERMINISTIC (no-Claude) agent that, given a care team's fixed CAPACITY for the cycle (its available outreach HOURS this week) and a set of candidate proactive INTERVENTIONS (each with an hours COST and a projected clinical BENEFIT), selects the subset that MAXIMIZES total projected benefit while fitting the capacity budget, deferring (never denying) the rest to the next cycle — reporting the selected + deferred sets, the total cost / benefit, the remaining capacity, and the disposition (all-scheduled / some-deferred). UNLIKE the Quality Shift agent's CUSUM CHANGE-POINT DETECTION, the Timeline Merge agent's K-WAY MERGE OF SORTED STREAMS, the Reportable Condition agent's RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP Matching agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity agent's HASH CHAIN — and, CRUCIALLY, UNLIKE the Caseload Balancing agent's GREEDY BIN-PACKING (which distributes EVERY member across managers' capacities by acuity — a partition) and the Population Health agent's RISK RANKING (which orders a panel; it selects no subset under a budget) — the heart of this service is the 0/1 KNAPSACK via DYNAMIC PROGRAMMING: the capacity-constrained maximum-value-subset optimization, filling a DP table dp[i][c] = max(dp[i-1][c], dp[i-1][c-cost_i] + benefit_i) and reconstructing the optimal set by walking the table back. A greedy or hand-picked allocation leaves benefit on the table — patients who could have been reached this cycle are not — so the agent optimizes DETERMINISTICALLY (a pure function of the candidates' costs + benefits + the capacity — no clock, no randomness — so the same request always yields the same plan) and hands the plan to a human. Every selected and deferred intervention traces to a submitted candidate (a fabricated / dropped intervention is blocked — the sourced + completeness gate), the allocation is optimal + feasible (a sub-optimal or over-capacity allocation is blocked — the load-bearing correctness gate), and no outreach is launched, no plan committed, and no intervention booked autonomously (an autonomous schedule is blocked). It COMPLEMENTS — it does not duplicate — the other care-coordination agents: distinct from the Caseload Balancing agent (which bin-packs a whole panel across managers), the Population Health agent (which ranks a panel by risk), and the Care Gap agent (which acts on a measure gap) — this selects a max-benefit subset of interventions under a capacity budget. It is PHI-bearing (the interventions reference patients), so it is on the HIPAA-audit policy. The interventions are illustrative, clearly labeled — NOT a certified care-management / capacity-planning system (real capacity planning weighs clinical urgency, member consent, staffing mix, regulatory timeliness, and equity — not a single benefit score under one hours budget; a deferred intervention is deferred, never denied). Enforces, via the Pause Agent Fabric, that every selection is sourced, the allocation is optimal + feasible, and no outreach is ever launched autonomously.",
  url: `${HOST}/api/agents/outreach-prioritization`,
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
      id: "prioritize-care-management-outreach",
      name: "Select the max-benefit subset of proactive interventions under a capacity budget via 0/1 knapsack DP",
      description:
        "Given a care team's fixed capacity (outreach hours) and a set of candidate interventions each with an hours cost and a projected benefit, deterministically runs the 0/1 knapsack dynamic-programming optimization to select the max-benefit subset that fits the capacity, deferring the rest, and reports the selected + deferred sets, the total cost / benefit, the remaining capacity, and the disposition (all-scheduled / some-deferred). Every selection is sourced; the allocation is optimal + feasible; no outreach is launched autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "capacity-planning",
        "outreach-prioritization",
        "knapsack",
        "dynamic-programming",
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
