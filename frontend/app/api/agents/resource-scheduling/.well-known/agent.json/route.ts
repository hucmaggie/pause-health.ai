import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Resource-Block Scheduling / Max-Value Non-Overlapping Selection agent — a
 * care-coordination capacity-optimization service on the patient & clinical-operations plane.
 *
 *   GET /api/agents/resource-scheduling/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "resource-scheduling-agent";

const CARD: A2AAgentCard = {
  name: "Resource-Block Scheduling / Max-Value Non-Overlapping Selection Agent",
  description:
    "A care-coordination capacity-optimization service on the patient & clinical-operations plane — a DETERMINISTIC (no-Claude) agent that, given a single SHARED SCARCE RESOURCE (an infusion chair, an OR block, a specialist's slot ladder, an imaging machine) and a batch of competing REQUESTS for it — each a time WINDOW with a priority WEIGHT (clinical value / acuity) — selects the MAXIMUM-TOTAL-WEIGHT set of NON-OVERLAPPING requests the resource can honor, reporting the rest as CONTENDED (disposition all-scheduled / contended). CRUCIALLY, this is NOT the Scheduling Conflict agent's GREEDY INTERVAL SELECTION (which maximizes the COUNT of non-overlapping appointments, WEIGHTLESS) and NOT the Caseload Balancing agent's GREEDY BIN-PACKING under a capacity constraint or the Outreach Prioritization agent's 0/1 KNAPSACK DYNAMIC PROGRAMMING (items with a value + a cost packed under a single capacity budget, no time / overlap structure). It is also UNLIKE the Care Routing agent's DIJKSTRA'S WEIGHTED SHORTEST PATH, the Source Consensus agent's BOYER–MOORE MAJORITY VOTE, the Code Taxonomy agent's TRIE LONGEST-PREFIX MATCH, the KPI Trend agent's LEAST-SQUARES REGRESSION, the Quality Shift agent's CUSUM CHANGE-POINT DETECTION, the Timeline Merge agent's K-WAY MERGE, the PCP Matching agent's STABLE MATCHING, the Network Adequacy agent's GREAT-CIRCLE DISTANCE, the Household Composition agent's UNION-FIND, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, or the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM — the heart of this service is WEIGHTED INTERVAL SCHEDULING via DYNAMIC PROGRAMMING: sort the requests by end time, compute for each request i the latest earlier request p(i) that does NOT overlap it, fill dp[i] = max(dp[i-1], weight_i + dp[p(i)]), and backtrack to recover the max-weight compatible subset. A greedy earliest-finish rule maximizes the COUNT of appointments but can leave clinical VALUE on the table (two short low-acuity blocks beat one long high-acuity block by count, but not by weight); the DP maximizes the total weight the resource actually delivers (a pure function of the requests — no clock, no randomness — so the same request always yields the same determination). The selection is sourced + feasible (a fabricated block or a double-booked resource is blocked — the sourced + feasibility gate), optimal (a sub-optimal schedule that leaves clinical value unbooked is blocked — the load-bearing correctness gate), and nothing is booked, bumped, or confirmed autonomously (an autonomous booking is blocked). It COMPLEMENTS — it does not duplicate — the Scheduling Conflict agent (which maximizes the COUNT of double-booking-free appointments) and the Caseload Balancing agent (which bin-packs patients across care managers): this picks the max-VALUE non-overlapping set for one contended resource. It IS PHI-bearing (each request references the patient being scheduled) and so is on the HIPAA-audit policy. The resource + requests are illustrative, clearly labeled — NOT a certified scheduling / capacity system (real resource scheduling uses provider availability calendars, appointment-type durations, buffer / turnover times, room / equipment constraints, and staffing ratios). Enforces, via the Pause Agent Fabric, that every selection is sourced + feasible, the selection is optimal, and no block is ever booked autonomously.",
  url: `${HOST}/api/agents/resource-scheduling`,
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
      id: "select-max-weight-non-overlapping-blocks",
      name: "Select the max-value non-overlapping set of requests for a contended resource via weighted interval scheduling",
      description:
        "Given a shared scarce resource and a batch of competing weighted time-window requests, deterministically runs weighted interval scheduling (dynamic programming) to select the maximum-total-weight non-overlapping subset the resource can honor, reporting the rest as contended and the disposition. The selection is sourced + feasible; the selection is optimal; no block is booked autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "scheduling",
        "capacity-optimization",
        "weighted-interval-scheduling",
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
