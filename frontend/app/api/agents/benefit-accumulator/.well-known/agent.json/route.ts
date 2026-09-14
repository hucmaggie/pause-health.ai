import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Benefit Accumulator Ledger / Fenwick-Tree Prefix Sums agent —
 * a payer-operations accumulator-ledger service.
 *
 *   GET /api/agents/benefit-accumulator/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "benefit-accumulator-agent";

const CARD: A2AAgentCard = {
  name: "Benefit Accumulator Ledger / Fenwick-Tree Prefix Sums Agent",
  description:
    "A payer-operations accumulator-ledger service — a DETERMINISTIC (no-Claude) agent that, given an ORDERED sequence of applied claim amounts (dollars applied to a member's benefit accumulator) and an OUT-OF-POCKET MAXIMUM, maintains a running accumulator and answers two questions fast: the CUMULATIVE amount applied through each claim, and the CROSSOVER claim — the first at which the running total reaches or exceeds the OOP maximum (after which the plan pays 100%) — disposition under-oop-max / oop-max-met. The heart of this service is the FENWICK TREE (Binary Indexed Tree): a cumulative-frequency data structure supporting point updates and prefix-sum queries in O(log n), plus a binary lower-bound descent that finds the first index whose prefix sum reaches a threshold in O(log n). CRUCIALLY it is a genuinely NEW computation pattern for the fabric: NOT the Member Cost-Share agent's COST-SHARING WATERFALL (which splits a SINGLE claim across deductible / coinsurance / OOP for one date of service — this is a CUMULATIVE data structure over a SEQUENCE of claims with prefix-sum + find-by-threshold queries), NOT the Audit Sample agent's RESERVOIR SAMPLING, NOT the Duplicate-Claim Screen agent's BLOOM FILTER, NOT the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, NOT the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, and NOT the Peak-Window agent's KADANE MAXIMUM-SUBARRAY — it is Fenwick-tree prefix sums with a lower-bound descent (a pure function of the amounts + OOP max — no clock, no randomness — so the same request always yields the same ledger). The running prefix sums and the crossover index are the invariants this service reports and defends. The ledger is sourced + self-consistent (a fabricated running total, a mis-summed ledger, or an out-of-range crossover is blocked — the sourced + self-consistency gate), accumulator-exact (a mislocated crossover — the claim after which the plan pays 100% — or a prefix sum that disagrees with the Fenwick re-derivation is blocked — the load-bearing correctness gate), and nothing is posted, adjusted, or paid against a member's real accumulator autonomously (an autonomous adjustment is blocked). An oop-max-met disposition is a LEGITIMATE FINDING (the member reached their OOP maximum), NOT a governance block. It COMPLEMENTS the Member Cost-Share agent: that splits one claim, this tallies the running accumulator across many. It IS PHI-adjacent (the ledger references a member's claims) and so is on the HIPAA-audit policy. The amounts are illustrative, clearly labeled — NOT a certified benefits-accumulator / claims-payment system (real accumulator processing weighs the full benefit design — embedded vs aggregate family deductibles, network tiers, carve-outs, EOB reversals — plan-year resets, and an authoritative accumulator store — not a bare prefix-sum over illustrative amounts). Enforces, via the Pause Agent Fabric, that every ledger is a sourced + self-consistent accounting, the accumulator is exact (the Fenwick tree re-derives the prefix sums and crossover), and nothing is adjusted autonomously.",
  url: `${HOST}/api/agents/benefit-accumulator`,
  provider: {
    organization: "Salesforce (via Pause-Health.ai)",
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
      id: "accumulate-benefit-ledger-fenwick",
      name: "Tally a running benefit accumulator and locate the OOP-max crossover claim via a Fenwick tree",
      description:
        "Given an ordered sequence of applied claim amounts and an out-of-pocket maximum, deterministically computes the running cumulative totals and locates the crossover claim (the first that meets the OOP max) via a Fenwick-tree lower-bound descent, then reports the running totals, the total applied, the crossover index, and the remaining-before-OOP-max. The ledger is sourced + self-consistent; the accumulator is exact (the Fenwick tree re-derives); nothing is adjusted autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "payer-operations",
        "benefit-accumulator",
        "fenwick-tree",
        "prefix-sums",
        "out-of-pocket-maximum",
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
