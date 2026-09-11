import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Commercial Peak-Window / Maximum Contiguous Net-Gain Detection agent — a
 * commercial-analytics service on the PHI-separated commercial plane.
 *
 *   GET /api/agents/peak-window/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "peak-window-agent";

const CARD: A2AAgentCard = {
  name: "Commercial Peak-Window / Maximum Contiguous Net-Gain Detection Agent",
  description:
    "A commercial-analytics service on the PHI-separated commercial plane — a DETERMINISTIC (no-Claude) agent that, given a time-ordered series of a business metric's SIGNED per-period NET CHANGE (net-new ARR = bookings − churn, net enrolled patients = adds − drops, net revenue delta), finds the single MAXIMUM-SUM CONTIGUOUS WINDOW — the strongest sustained net-gain STRETCH — reporting its start / end period, summed net gain, and length, or honestly reporting NO POSITIVE WINDOW when every contiguous stretch nets a loss (disposition positive-window / no-positive-window). CRUCIALLY, this is NOT the KPI Trend agent's ORDINARY LEAST-SQUARES LINEAR REGRESSION (which fits a best-fit line and PROJECTS it to a horizon — a fitted model + extrapolation), NOT the Quality Shift agent's CUSUM CHANGE-POINT DETECTION (a running deviation from a target to catch a SUSTAINED shift), NOT the Access Anomaly agent's SLIDING-WINDOW COUNTING (a FIXED-width window sliding over events), and NOT the Remote Patient Monitoring agent's WINDOW-VS-BASELINE trend classification. It is also UNLIKE the Resource Scheduling agent's WEIGHTED INTERVAL SCHEDULING, the Care Routing agent's DIJKSTRA'S SHORTEST PATH, the Outreach agent's 0/1 KNAPSACK, the Source Consensus agent's BOYER–MOORE MAJORITY VOTE, the Code Taxonomy agent's TRIE LONGEST-PREFIX MATCH, the Timeline Merge agent's K-WAY MERGE, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the Household Composition agent's UNION-FIND, or the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM — the heart of this service is KADANE'S MAXIMUM-SUBARRAY algorithm: a single linear scan carrying a running sum that RESETS whenever extending the previous stretch would do worse than starting fresh at the current period (curSum = max(x_i, curSum + x_i)), tracking the best window seen — the maximum-sum contiguous subarray in O(n), no fixed window width, no fitted model. A fixed-width or whole-series average hides the true peak run; Kadane finds the exact contiguous window that maximizes net gain (a pure function of the series — no clock, no randomness — so the same request always yields the same determination). The window is sourced + self-honest (a fabricated / out-of-range window or an overstated sum is blocked — the sourced + self-honesty gate), optimal (a sub-optimal window that under-reports the true peak run is blocked — the load-bearing correctness gate), and nothing is committed, no quota adjusted, and finance not notified autonomously (an autonomous action is blocked). It COMPLEMENTS — it does not duplicate — the KPI Trend agent (which fits a least-squares trend line and projects it) and the Pipeline Management agent (which rolls up CRM opportunity records): this finds the peak contiguous net-gain window. It operates ONLY on the commercial CRM plane — NO patient PHI, NOT on the HIPAA-audit policy. The series are illustrative aggregate business figures, clearly labeled — NOT a certified analytics / FP&A system (real commercial analytics weighs seasonality, cohort dynamics, pipeline mix, macro conditions, and human judgment). Enforces, via the Pause Agent Fabric, that every window is sourced + self-honest, the window is optimal, and no finding is ever acted on autonomously.",
  url: `${HOST}/api/agents/peak-window`,
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
      id: "detect-max-contiguous-net-gain-window",
      name: "Detect the maximum-sum contiguous net-gain window in a signed metric series via Kadane's maximum-subarray",
      description:
        "Given a time-ordered series of a business metric's signed per-period net change, deterministically runs Kadane's maximum-subarray to find the single maximum-sum contiguous window (the peak net-gain stretch), reporting its bounds, summed net gain, and length, or no positive window when every stretch nets a loss. The window is sourced + self-honest; the window is optimal; no finding is acted on autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "commercial-operations",
        "analytics",
        "momentum",
        "maximum-subarray",
        "kadane",
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
