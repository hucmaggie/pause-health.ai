import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Care-Transition Routing / Least-Burden Path agent — a care-coordination /
 * transition-planning service on the patient & clinical plane.
 *
 *   GET /api/agents/care-routing/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "care-routing-agent";

const CARD: A2AAgentCard = {
  name: "Agentforce Care-Transition Routing (Least-Burden Path)",
  description:
    "A care-coordination / transition-planning service on the patient & clinical plane — a DETERMINISTIC (no-Claude) agent that, given a patient's current care SETTING (a start node), a goal setting, and a directed graph of PERMITTED transitions between settings each carrying a non-negative BURDEN weight (wait days + travel + cost proxy + risk), finds the MINIMUM-TOTAL-BURDEN path from start to goal — or reports the goal unreachable — reporting the path, the total burden, the hop count, and the disposition (route-found / no-route). UNLIKE the KPI Trend agent's LEAST-SQUARES LINEAR REGRESSION, the Outreach Prioritization agent's 0/1 KNAPSACK DYNAMIC PROGRAMMING, the Quality Shift agent's CUSUM CHANGE-POINT DETECTION, the Timeline Merge agent's K-WAY MERGE OF SORTED STREAMS, the Reportable Condition agent's RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP Matching agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity agent's HASH CHAIN — and, CRUCIALLY, UNLIKE the Care Pathway agent's TOPOLOGICAL ORDERING (which sequences ALL the required steps of ONE protocol into a dependency order — no weights, no source/target, no choosing among alternative routes), the Claim Lifecycle agent's BFS REACHABILITY (which finds the fewest-HOPS path across an UNWEIGHTED status state machine — edge count, not edge weight), and the Transitions of Care agent's MEDICATION RECONCILIATION (which reconciles meds across ONE encounter — it routes nothing) — the heart of this service is DIJKSTRA'S WEIGHTED SHORTEST PATH: the classic single-source shortest-path over a graph with non-negative edge weights, settling the nearest unsettled node and relaxing its out-edges (dist[v] = min(dist[v], dist[u] + w(u,v))), then reconstructing the minimum-total-weight path by walking predecessors back. A greedy or hand-picked route sends a patient the long way round — more waiting, more travel, more cost — so the agent optimizes DETERMINISTICALLY (a pure function of the graph's own edges + weights — no clock, no randomness — so the same graph always yields the same route) and hands the route to a human. The reported path is a real walk of the submitted graph (a fabricated transition or malformed path is blocked — the sourced + well-formedness gate), the route is optimal (a sub-optimal route or a false 'unreachable' is blocked — the load-bearing correctness gate), and no transition is initiated, no setting booked, and no patient moved autonomously (an autonomous routing is blocked). It COMPLEMENTS — it does not duplicate — the other care-coordination agents: distinct from the Care Pathway agent (which topologically orders one protocol's steps), the Transitions of Care agent (medication reconciliation), and the Schedule Conflict agent (double-booking guard) — this finds the least-burden path through a weighted graph of care settings. It is PHI-bearing (the route is a patient's care plan), so it is on the HIPAA-audit policy. The settings + transitions are illustrative, clearly labeled — NOT a certified care-transition / discharge-planning system (real transition planning weighs clinical appropriateness, bed availability, payer authorization, patient preference, and caregiver capacity — not a single scalar burden per edge). Enforces, via the Pause Agent Fabric, that the reported path is sourced, the route is optimal, and no transition is ever initiated autonomously.",
  url: `${HOST}/api/agents/care-routing`,
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
      id: "route-care-transition-least-burden",
      name: "Find the least-burden path through a weighted graph of care settings via Dijkstra's shortest path",
      description:
        "Given a patient's current care setting, a goal setting, and a directed graph of permitted transitions each carrying a non-negative burden weight, deterministically runs Dijkstra's weighted shortest path to find the minimum-total-burden route (route-found) or reports the goal unreachable (no-route), and reports the path, the total burden, the hop count, and the disposition. The path is sourced; the route is optimal; no transition is initiated autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "transition-planning",
        "care-routing",
        "dijkstra",
        "shortest-path",
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
