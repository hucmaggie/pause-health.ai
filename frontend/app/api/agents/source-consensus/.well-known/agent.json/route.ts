import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Source-of-Truth Consensus / Golden-Record Field Reconciliation agent — a
 * data-reconciliation / master-data service on the platform & data-substrate plane.
 *
 *   GET /api/agents/source-consensus/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "source-consensus-agent";

const CARD: A2AAgentCard = {
  name: "Source-of-Truth Consensus / Golden-Record Field Reconciliation Agent",
  description:
    "A data-reconciliation / master-data service on the platform & data-substrate plane — a DETERMINISTIC (no-Claude) agent that, given a single logical FIELD whose value is reported by several SOURCE SYSTEMS (an EHR feed, a claims feed, a credentialing feed, an HIE feed), decides whether those source votes have a STRICT MAJORITY — a consensus value more than half the sources agree on — reporting the winner, its count, and per-source agreement, or honestly reporting NO-CONSENSUS when no value carries a strict majority. UNLIKE the Care Routing agent's DIJKSTRA'S WEIGHTED SHORTEST PATH, the KPI Trend agent's LEAST-SQUARES LINEAR REGRESSION, the Outreach Prioritization agent's 0/1 KNAPSACK DYNAMIC PROGRAMMING, the Quality Shift agent's CUSUM CHANGE-POINT DETECTION, the Timeline Merge agent's K-WAY MERGE OF SORTED STREAMS, the Reportable Condition agent's RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP Matching agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Audit Log Integrity agent's HASH CHAIN, or the Claim Lifecycle agent's BFS REACHABILITY — and, CRUCIALLY, UNLIKE the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE (which diffs WHO is on two rosters) and the Master-Patient-Index agent's WEIGHTED identity MATCHING (which decides whether two RECORDS are the same person) — the heart of this service is the BOYER–MOORE MAJORITY VOTE: the classic linear-time, constant-space algorithm that finds a strict-majority element in a single cancellation pass (hold a candidate + a counter; increment on a match, decrement on a mismatch, reset the candidate when the counter hits zero), then one verification pass confirming the survivor occurs in more than half the votes. When two feeds disagree, a naive 'last write wins' or 'first source wins' silently picks a wrong value; a majority vote picks the value the SOURCES themselves corroborate (a pure function of the votes — no clock, no randomness — so the same votes always yield the same determination) and honestly declines when they don't. The per-source attribution is sourced (a fabricated or dropped source is blocked — the sourced + completeness gate), the consensus recomputes (a wrong winner or a false consensus is blocked — the load-bearing correctness gate), and no consensus value is written to the golden record, no source overwritten, and no value promoted to system-of-record autonomously (an autonomous write is blocked). It COMPLEMENTS — it does not duplicate — the other data-plane agents: distinct from the Enrollment Reconciliation agent (roster diff), the Master-Patient-Index agent (record identity matching), and the Timeline Merge agent (chronological event merge) — this reconciles ONE field's conflicting source values into a golden-record value. It is DELIBERATELY NOT PHI-bearing (a golden-record reference attribute — a provider's specialty, an org's tax id — not patient health information), so, like the Identifier Validation agent, it is NOT on the HIPAA-audit policy. The fields + sources + values are illustrative, clearly labeled — NOT a certified master-data-management / golden-record system (real MDM weights sources by trust and recency, resolves value semantics, and survives field-by-field with lineage — not a bare majority of raw string votes). Enforces, via the Pause Agent Fabric, that the per-source attribution is sourced, the consensus recomputes, and no golden-record value is ever written autonomously.",
  url: `${HOST}/api/agents/source-consensus`,
  provider: {
    organization: "MuleSoft Anypoint (via Pause-Health.ai)",
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
      id: "reconcile-golden-record-field-majority-vote",
      name: "Reconcile a field's conflicting source values into a golden-record consensus via Boyer–Moore majority vote",
      description:
        "Given a single logical field whose value is reported by several source systems, deterministically runs the Boyer–Moore majority vote to find the strict-majority consensus value (consensus) or reports that no value carries a strict majority (no-consensus), and reports the winner, its count, per-source agreement, and the disposition. The attribution is sourced; the consensus recomputes; no golden-record value is written autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "data-plane",
        "master-data",
        "golden-record",
        "reconciliation",
        "boyer-moore",
        "majority-vote",
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
