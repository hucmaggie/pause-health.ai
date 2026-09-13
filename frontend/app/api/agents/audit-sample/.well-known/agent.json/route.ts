import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Audit Sample Selection / Reservoir Sampling (Algorithm R, Seeded) agent —
 * a payer-operations compliance-sampling service.
 *
 *   GET /api/agents/audit-sample/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "audit-sample-agent";

const CARD: A2AAgentCard = {
  name: "Audit Sample Selection / Reservoir Sampling (Algorithm R, Seeded) Agent",
  description:
    "A payer-operations compliance-sampling service — a DETERMINISTIC (no-Claude) agent that, given a large STREAM of record ids (claims / charts flagged for a compliance audit) and a target sample size k plus an explicit SEED, draws a statistically-defensible k-record SAMPLE in a SINGLE PASS — every record having an equal k/n chance of selection (disposition sampled / full-population). The heart of this service is RESERVOIR SAMPLING (Vitter's Algorithm R): fill a reservoir with the first k items, then for each subsequent item at position i draw j in [0, i] and replace reservoir[j] if j < k; after one pass every item has been retained with uniform probability k/n, without holding the whole population in memory. The randomness is a SEEDED PRNG (mulberry32), so the sample is fully REPRODUCIBLE — the same stream + k + seed always yields the same records, which is what makes an audit sample defensible (an auditor or regulator can re-run it and get the identical set). CRUCIALLY it is a genuinely NEW computation pattern for the fabric: NOT the Duplicate-Claim Screen agent's BLOOM FILTER (a membership test, not a uniform draw), NOT the Outreach Prioritization agent's 0/1 KNAPSACK (a value-maximizing subset, not an equal-probability sample), NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, NOT the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, NOT the Contact Rate Limit agent's TOKEN BUCKET, and NOT the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE — it is single-pass uniform reservoir sampling (a pure function of the ids + k + seed — no clock, no OS randomness). The uniform inclusion probability and the reproducibility of the seeded draw are the invariants this service reports and defends. The sample is sourced + self-consistent (a fabricated id, a duplicate pick, or a mis-sized sample is blocked — the sourced + self-consistency gate), selection-reproducible (a cherry-picked or otherwise unreproducible draw is blocked — the load-bearing correctness gate), and nothing is opened, adjudicated, or acted on autonomously (an autonomous audit action is blocked). A full-population disposition is a LEGITIMATE FINDING (the population is at most k), NOT a governance block. It COMPLEMENTS the Fraud-Waste-Abuse and Duplicate-Claim Screen agents: they flag records, this selects a defensible sample of records to audit. It IS PHI-adjacent (record ids are PHI-adjacent) and so is on the HIPAA-audit policy. The ids are illustrative, clearly labeled — NOT a certified statistical-sampling / audit system (real audit sampling weighs stratification, RAT-STATS / OIG methodology, confidence intervals, and dollar-unit / probability-proportional-to-size designs — not a bare uniform reservoir over illustrative ids). Enforces, via the Pause Agent Fabric, that every sample is a sourced + self-consistent subset, the selection is reproducible from its seed, and nothing is audited autonomously.",
  url: `${HOST}/api/agents/audit-sample`,
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
      id: "select-audit-sample-reservoir",
      name: "Draw a reproducible, uniform k-record audit sample from a stream in one pass",
      description:
        "Given a stream of record ids, a sample size k, and a seed, deterministically runs reservoir sampling (Algorithm R) with a seeded PRNG to draw a uniform k-record sample in a single pass, then reports the selected ids, the population size, the inclusion probability, and the seed. The sample is sourced + self-consistent; the selection is reproducible from its seed; nothing is audited autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "payer-operations",
        "compliance-sampling",
        "reservoir-sampling",
        "algorithm-r",
        "audit",
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
