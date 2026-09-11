import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Clinical Code Taxonomy / Longest-Prefix Classification agent — a terminology
 * / value-set service on the platform & data-substrate plane.
 *
 *   GET /api/agents/code-taxonomy/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "code-taxonomy-agent";

const CARD: A2AAgentCard = {
  name: "Clinical Code Taxonomy / Longest-Prefix Classification Agent",
  description:
    "A terminology / value-set service on the platform & data-substrate plane — a DETERMINISTIC (no-Claude) agent that, given a BATCH of clinical codes (ICD-10 diagnosis, HCPCS / CPT procedure) and a TAXONOMY of category PREFIXES (a code-group value-set), classifies each code to its MOST-SPECIFIC (longest) matching category prefix — or leaves it UNCLASSIFIED when no prefix matches — reporting one classification per code, the classified / unclassified counts, and the disposition (all-classified / unclassified-present). UNLIKE the Source Consensus agent's BOYER–MOORE MAJORITY VOTE, the Care Routing agent's DIJKSTRA'S WEIGHTED SHORTEST PATH, the KPI Trend agent's LEAST-SQUARES LINEAR REGRESSION, the Outreach Prioritization agent's 0/1 KNAPSACK DYNAMIC PROGRAMMING, the Quality Shift agent's CUSUM CHANGE-POINT DETECTION, the Timeline Merge agent's K-WAY MERGE OF SORTED STREAMS, the Reportable Condition agent's RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP Matching agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Audit Log Integrity agent's HASH CHAIN, or the Claim Lifecycle agent's BFS REACHABILITY — and, CRUCIALLY, UNLIKE the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM (character math on a single identifier's Luhn check digit), the Medication Name Safety agent's STRING EDIT DISTANCE (how far apart two drug NAMES are), and the HCC Risk Adjustment agent's HIERARCHY + COEFFICIENT SUM (rolling confirmed conditions up a clinical hierarchy and summing RAF coefficients) — the heart of this service is a TRIE (PREFIX TREE) LONGEST-PREFIX MATCH: the taxonomy prefixes are inserted into a trie, and each code is walked character-by-character down the trie, remembering the DEEPEST terminal node reached — the longest taxonomy prefix that is a prefix of the code (the most specific category). A shallow substring match (E28 when E28.3 also applies) mis-buckets a code into a less specific group; the longest-prefix rule picks the most specific category the taxonomy defines (a pure function of the taxonomy + codes — no clock, no randomness — so the same request always yields the same determination). The batch is sourced (a fabricated / dropped code or invented category is blocked — the sourced + completeness gate), the classification recomputes (a wrong bucket or a missed match is blocked — the load-bearing correctness gate), and no claim is re-coded, no codes submitted, and no coded record overwritten autonomously (an autonomous re-code is blocked). It COMPLEMENTS — it does not duplicate — the other terminology / coding agents: distinct from the Identifier Validation agent (which validates an NPI's check digit), the Medication Name Safety agent (which flags look-alike drug names by edit distance), and the HCC Risk Adjustment agent (which scores confirmed conditions up a hierarchy) — this maps codes to a value-set taxonomy by longest prefix. It is DELIBERATELY NOT PHI-bearing (a code is a terminology token, classified against a value-set taxonomy, not patient health information), so, like the Identifier Validation agent, it is NOT on the HIPAA-audit policy. The taxonomy + codes are illustrative, clearly labeled — NOT a certified terminology / code-set engine (real terminology services resolve full code systems — ICD-10-CM, SNOMED CT, LOINC, RxNorm — with versioned value sets, inclusion/exclusion logic, and semantic relationships, not a bare longest-prefix match). Enforces, via the Pause Agent Fabric, that every classification is sourced, the classification recomputes, and no claim is ever re-coded autonomously.",
  url: `${HOST}/api/agents/code-taxonomy`,
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
      id: "classify-codes-longest-prefix-trie",
      name: "Classify a batch of clinical codes to their most-specific category via a trie longest-prefix match",
      description:
        "Given a batch of clinical codes and a taxonomy of category prefixes, deterministically builds a trie and classifies each code to its most-specific (longest) matching category prefix, or leaves it unclassified when no prefix matches, and reports one classification per code, the classified / unclassified counts, and the disposition. The batch is sourced; the classification recomputes; no claim is re-coded autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "data-plane",
        "terminology",
        "value-set",
        "code-classification",
        "trie",
        "longest-prefix-match",
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
