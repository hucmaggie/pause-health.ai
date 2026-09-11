import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the SLA Worklist Sequencing / Earliest-Deadline-First (EDF) Scheduling agent — a
 * payer-operations work-sequencing service on the payer & plan-operations plane.
 *
 *   GET /api/agents/sla-worklist/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "sla-worklist-agent";

const CARD: A2AAgentCard = {
  name: "SLA Worklist Sequencing / Earliest-Deadline-First (EDF) Scheduling Agent",
  description:
    "A payer-operations work-sequencing service on the payer & plan-operations plane — a DETERMINISTIC (no-Claude) agent that, given a single WORKLIST of pending cases for one processor (a UM nurse's queue, an appeals analyst's desk, a claims-review bench) — each case a unit of work with a processing DURATION and an SLA DEADLINE — sequences them EARLIEST-DEADLINE-FIRST, computes each case's cumulative completion time, and flags which cases will BREACH their SLA if worked in that order (disposition all-on-time / breaches-present). CRUCIALLY, this is NOT the Resource Scheduling agent's WEIGHTED INTERVAL SCHEDULING (which SELECTS a max-weight non-overlapping SUBSET of time-windowed requests for one resource — a subset, with dropped requests) and NOT the Scheduling Conflict agent's GREEDY INTERVAL SELECTION (which admits the max COUNT of non-overlapping appointments). It is also UNLIKE the Peak-Window agent's KADANE MAXIMUM-SUBARRAY, the Care Routing agent's DIJKSTRA'S SHORTEST PATH, the Outreach agent's 0/1 KNAPSACK, the Source Consensus agent's BOYER–MOORE MAJORITY VOTE, the Code Taxonomy agent's TRIE LONGEST-PREFIX MATCH, the Timeline Merge agent's K-WAY MERGE, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the Household Composition agent's UNION-FIND, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, or the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM — the heart of this service is EARLIEST-DEADLINE-FIRST (EDF) SCHEDULING: ORDER the entire worklist by deadline ascending (documented tie-break: earlier deadline first, then lexical case id), then process the cases sequentially from time zero — each case starts when the previous finishes, its completion time is the running cumulative duration, and it breaches when its completion time exceeds its deadline. EDF is the classic optimal single-processor discipline: if any ordering can meet every deadline, EDF does (a pure function of the tasks — no clock, no randomness — so the same worklist always yields the same schedule). The schedule is sourced + self-consistent (a fabricated case or a mis-chained completion time is blocked — the sourced + self-consistency gate), EDF-ordered (a non-EDF order that needlessly breaches deadlines is blocked — the load-bearing correctness gate), and nothing is dispatched, started, or reassigned autonomously (an autonomous dispatch is blocked). It COMPLEMENTS — it does not duplicate — the Resource Scheduling agent (which selects a max-value non-overlapping subset for one resource) and the Caseload Balancing agent (which bin-packs patients across care managers): this ORDERS a whole worklist for one processor by SLA deadline and flags the breaches. It IS PHI-bearing (each case references the member / claim being worked) and so is on the HIPAA-audit policy. The worklist is illustrative, clearly labeled — NOT a certified workforce / queueing system (real worklist management uses staffing levels, skills-based routing, case arrival times, preemption, priority tiers, and shift schedules). Enforces, via the Pause Agent Fabric, that every schedule is sourced + self-consistent, the order is earliest-deadline-first, and no case is ever dispatched autonomously.",
  url: `${HOST}/api/agents/sla-worklist`,
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
      id: "sequence-worklist-earliest-deadline-first",
      name: "Sequence a worklist earliest-deadline-first and flag the SLA breaches",
      description:
        "Given a worklist of pending cases each with a processing duration and an SLA deadline, deterministically runs earliest-deadline-first scheduling to order the cases by deadline, compute each case's cumulative completion time, and flag which will breach their SLA. The schedule is sourced + self-consistent; the order is EDF; no case is dispatched autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "payer-operations",
        "worklist",
        "sla",
        "earliest-deadline-first",
        "scheduling",
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
