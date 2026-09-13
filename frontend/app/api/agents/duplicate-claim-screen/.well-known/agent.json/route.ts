import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Duplicate-Claim Pre-Screen / Bloom-Filter Membership Test agent —
 * a payer-operations claims pre-screen service.
 *
 *   GET /api/agents/duplicate-claim-screen/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "duplicate-claim-screen-agent";

const CARD: A2AAgentCard = {
  name: "Duplicate-Claim Pre-Screen / Bloom-Filter Membership Test Agent",
  description:
    "A payer-operations claims pre-screen service — a DETERMINISTIC (no-Claude) agent that, given a set of already-PROCESSED claim ids and a batch of INCOMING claim ids, builds a BLOOM FILTER over the processed ids (a fixed bit array of size m, probed by k seeded hash functions) and screens each incoming id: a query whose k bits are all set is a POSSIBLE-DUPLICATE (route to the authoritative exact check), and a query with ANY zero bit is DEFINITELY-NEW (provably never processed — a Bloom filter has NO false negatives) — so the expensive exact duplicate lookup runs only on the small suspected set and a genuinely-new claim is never held up (disposition all-clear / possible-duplicates). The heart of this service is the BLOOM FILTER: a space-efficient PROBABILISTIC set-membership structure — insert by setting the k bits at the id's hash slots, query by testing them (all set ⇒ possibly present, any clear ⇒ definitely absent). CRUCIALLY it is a genuinely NEW computation pattern for the fabric: NOT the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE (an exact two-roster diff — this is a probabilistic one-sided membership pre-screen with a tunable false-positive rate and no per-key storage), NOT the Source Consensus agent's BOYER–MOORE MAJORITY VOTE, NOT the Timeline Merge agent's K-WAY MERGE, NOT the Audit Log Integrity agent's HASH CHAIN, NOT the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, and NOT the Code Taxonomy agent's TRIE LONGEST-PREFIX MATCH — it is Bloom-filter membership (a pure function of the ids + config with a fixed seeded hash — no clock, no randomness — so the same request always yields the same screen). The one-sided guarantee (no false negatives) and the honest false-positive rate are the invariants this service reports and defends. The filter is sourced + self-consistent (a fabricated bit, a mis-tallied count, or a verdict that contradicts the array is blocked — the sourced + self-consistency gate), membership-exact (a mislabeled verdict — especially a FALSE NEGATIVE reporting a known duplicate as definitely-new — or a wrong false-positive-rate estimate is blocked — the load-bearing correctness gate), and nothing is rejected, denied, or paid autonomously (an autonomous rejection is blocked). A possible-duplicates disposition is a LEGITIMATE FINDING (some ids need the authoritative check) and ALWAYS defers to it, NOT a governance block. It COMPLEMENTS the Enrollment Reconciliation agent: that does an exact diff, this is a fast probabilistic pre-filter. It IS PHI-adjacent (claim ids are PHI-adjacent) and so is on the HIPAA-audit policy. The ids are illustrative, clearly labeled — NOT a certified claims-dedup / payment-integrity system (real duplicate-claim detection weighs the full claim key (member, provider, DOS, procedure, units), adjustment / void logic, and an authoritative claims store — not a bare Bloom pre-screen over illustrative ids). Enforces, via the Pause Agent Fabric, that every screen is a sourced + self-consistent filter, membership is exact with no false negatives, and nothing is rejected autonomously.",
  url: `${HOST}/api/agents/duplicate-claim-screen`,
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
      id: "pre-screen-duplicate-claims-bloom-filter",
      name: "Pre-screen incoming claim ids against processed ids with a Bloom filter (no false negatives)",
      description:
        "Given a set of processed claim ids and a batch of incoming claim ids plus a Bloom config (bit size + hash count), deterministically builds a Bloom filter and screens each incoming id as definitely-new (provably never processed) or possibly-duplicate (route to the authoritative check), then reports the per-id verdicts, the tallies, the set-bit count, and the estimated false-positive rate. The filter is sourced + self-consistent; membership is exact with no false negatives; nothing is rejected autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "payer-operations",
        "claims-dedup",
        "bloom-filter",
        "membership-test",
        "pre-screen",
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
