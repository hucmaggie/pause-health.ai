import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Event-Stream Code Assignment / Huffman Optimal Prefix Coding agent — a
 * data-plane code-assignment service on the platform & data-substrate plane.
 *
 *   GET /api/agents/huffman-coding/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "huffman-coding-agent";

const CARD: A2AAgentCard = {
  name: "Event-Stream Code Assignment / Huffman Optimal Prefix Coding Agent",
  description:
    "A data-plane code-assignment service on the platform & data-substrate plane — a DETERMINISTIC (no-Claude) agent that, given a set of event / message TYPES flowing across the integration bus — each type with an observed FREQUENCY (its share of the stream volume) — assigns an OPTIMAL PREFIX-FREE binary code that minimizes the total encoded length (the sum over types of frequency × code length), so a high-volume telemetry / event stream (remote-monitoring device events, claim-event codes, sync / ack messages) can be transmitted as compactly as possible (disposition compressible / already-uniform). CRUCIALLY, this is NOT the Code Taxonomy agent's TRIE LONGEST-PREFIX MATCH (which walks a code down a prefix tree of taxonomy categories to bucket it — a lookup, not a code construction) and NOT the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM. It is also UNLIKE the Source Consensus agent's BOYER–MOORE MAJORITY VOTE, the Timeline Merge agent's K-WAY MERGE, the List Reconciliation agent's LONGEST COMMON SUBSEQUENCE, the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, the Peak-Window agent's KADANE MAXIMUM-SUBARRAY, the Care Routing agent's DIJKSTRA'S SHORTEST PATH, the Outreach agent's 0/1 KNAPSACK, the PCP Matching agent's GALE–SHAPLEY STABLE MATCHING, the Household Composition agent's UNION-FIND, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, or the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT — the heart of this service is HUFFMAN CODING: build the optimal prefix-free code by repeatedly merging the two lowest-frequency nodes into a subtree (a greedy priority-queue construction), then read each symbol's code off the root-to-leaf path. Huffman is provably optimal — no prefix-free code assigns a smaller total encoded length — and the total encoded length is the invariant this service reports and defends (a pure function of the frequencies — no clock, no randomness — so the same request always yields the same code length). The code is sourced + self-consistent (a fabricated symbol, a non-prefix-free code, or an overstated total is blocked — the sourced + self-consistency gate), optimal (a sub-optimal prefix code that wastes bandwidth is blocked — the load-bearing correctness gate), and nothing is deployed to the live bus or re-encoded autonomously (an autonomous deploy is blocked). It COMPLEMENTS — it does not duplicate — the Code Taxonomy agent (which walks a code down a prefix tree of taxonomy categories to bucket it) and the Identifier Validation agent (which validates an identifier's check digit): this CONSTRUCTS an optimal prefix-free code from frequencies. It is DELIBERATELY NOT PHI-bearing (an event-type frequency is aggregate integration telemetry, not patient health information) and so is NOT on the HIPAA-audit policy. The frequencies are illustrative, clearly labeled — NOT a certified codec / compression system (real stream compression uses context modeling, arithmetic / range coding, dictionary methods (LZ77 / LZMA), and adaptive codebooks). Enforces, via the Pause Agent Fabric, that every code is sourced + self-consistent, the code is the optimal minimal-length code, and the codec is never deployed autonomously.",
  url: `${HOST}/api/agents/huffman-coding`,
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
      id: "assign-optimal-prefix-code-huffman",
      name: "Assign an optimal prefix-free code to an event stream by frequency",
      description:
        "Given a set of event types each with an observed frequency, deterministically runs Huffman coding to build the optimal prefix-free binary code, then reports one code per type, the weighted total encoded length, and the fixed-width baseline. The code is sourced + self-consistent; the code is the optimal minimal-length code; the codec is never deployed autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "data-plane",
        "integration",
        "huffman-coding",
        "prefix-code",
        "compression",
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
