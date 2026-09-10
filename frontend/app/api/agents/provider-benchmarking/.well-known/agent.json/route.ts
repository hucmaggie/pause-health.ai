import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Provider Cost & Quality Percentile Benchmarking agent — a
 * commercial-operations service on the commercial plane.
 *
 *   GET /api/agents/provider-benchmarking/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "provider-benchmarking-agent";

const CARD: A2AAgentCard = {
  name: "Provider Cost & Quality Percentile Benchmarking Agent",
  description:
    "A commercial-operations service on the commercial plane — a DETERMINISTIC (no-Claude) agent that takes a target provider's metric value plus a peer cohort of providers' values and computes WHERE the provider falls in the DISTRIBUTION: its percentile rank (the standard midpoint method), the direction-adjusted effective percentile (lower-is-better for cost, higher-is-better for quality — so a higher effective percentile always means better), the cohort median, and a performance band (top-quartile / above-median / below-median / bottom-quartile), flagging an unfavorable band for network review (benchmark-favorable / benchmark-review). UNLIKE the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the Drug–Drug Interaction agent's PAIRWISE KNOWLEDGE-BASE LOOKUP, the OIG Exclusion agent's EXACT identity MATCHING, or the Audit Log Integrity agent's HASH CHAIN — and UNLIKE the date-deadline agents (Timely Filing, Right of Access, Amendment) that add N days to a single date — the heart of this service is PERCENTILE / RANK STATISTICS over a numeric distribution: sort the cohort, compute the target's percentile rank, the median, and a quartile band. Time is data: the finding is a pure function of the value + cohort + direction (no clock, no randomness), so the same input always yields the same finding. The peer cohort is sourced and intact (a phantom / omitted peer that mis-sizes the denominator is blocked — the sourced gate), the rank statistics recompute exactly (a miscomputed percentile or a band that doesn't follow is blocked — the load-bearing correctness gate), and the provider is never tiered / penalized / de-networked (an autonomous tiering is blocked). It COMPLEMENTS — it does not duplicate — the other provider / quality agents: distinct from the Provider Contracting agent (a single VBC benchmark-DRIFT vs a contract threshold), the HEDIS Quality agent (the measure RATES), the Quality-Measure Attribution agent (the DENOMINATOR), and the Provider Credentialing agent (network integrity) — this ranks a provider within a peer DISTRIBUTION via percentile. It is DELIBERATELY NOT PHI-bearing — it operates on provider-level aggregate metrics, not patient health information — so, like the OIG Exclusion agent, it is NOT on the HIPAA-audit policy. The cohorts are illustrative, clearly labeled — NOT a certified benchmarking system; real provider benchmarking uses risk / case-mix adjustment, statistically valid peer grouping, minimum denominators, confidence intervals, and the network team's judgment. Enforces, via the Pause Agent Fabric, that the cohort is sourced, the statistics are exact, and no provider is tiered autonomously.",
  url: `${HOST}/api/agents/provider-benchmarking`,
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
      id: "benchmark-provider-percentile",
      name: "Rank a provider within a peer cohort by percentile",
      description:
        "Given a target provider's metric value and a peer cohort of values, deterministically computes the percentile rank (midpoint method), the direction-adjusted effective percentile, the cohort median, and a performance band (top-quartile / above-median / below-median / bottom-quartile), deriving a disposition (benchmark-favorable / benchmark-review). The cohort is sourced and intact; the rank statistics recompute exactly; no provider is tiered autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "commercial-operations",
        "provider-benchmarking",
        "percentile-rank",
        "distribution-statistics",
        "value-based-care",
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
