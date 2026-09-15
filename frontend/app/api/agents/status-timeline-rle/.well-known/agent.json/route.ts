import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Status Timeline Compression / Run-Length Encoding (RLE) agent —
 * a platform / data-substrate stream-compression service.
 *
 *   GET /api/agents/status-timeline-rle/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "status-timeline-rle-agent";

const CARD: A2AAgentCard = {
  name: "Status Timeline Compression / Run-Length Encoding (RLE) Agent",
  description:
    "A platform / data-substrate stream-compression service — a DETERMINISTIC (no-Claude) agent that, given a long per-slot STATUS stream (a device state / bed-occupancy / monitoring status recorded once per time slot), compresses it into a sequence of RUNS — (value, length) pairs, one per maximal block of identical consecutive statuses — reporting the run count, the compression ratio, the longest run, and the dominant status (disposition compressible / incompressible). The heart of this service is RUN-LENGTH ENCODING: a single left-to-right pass that coalesces each maximal block of identical consecutive values into one (value, length) run — the canonical, provably-unique RLE of the stream, losslessly REVERSIBLE (decoding the runs reproduces the exact original). CRUCIALLY it is a genuinely NEW computation pattern for the fabric: NOT the Huffman agent's OPTIMAL PREFIX CODING (a FREQUENCY-based variable-length code over the alphabet — this is CONSECUTIVE-RUN coalescing, order-dependent, no frequency model), NOT the Coverage Heatmap agent's DIFFERENCE-ARRAY RANGE ACCUMULATION, NOT the Rolling Census Peak agent's SLIDING-WINDOW MAXIMUM, NOT the Timeline Merge agent's K-WAY MERGE (which interleaves multiple sorted streams — this compresses ONE stream), and NOT the List Reconciliation agent's LONGEST COMMON SUBSEQUENCE — it is run-length encoding (a pure function of the statuses — no clock, no randomness — so the same request always yields the same encoding). The exact, reversible run list is the invariant this service reports and defends. The encoding is sourced + self-consistent (decoding the runs reproduces the exact submitted stream, every run length ≥ 1, honest counts/ratio/longest-run/dominant-status — a fabricated run, a wrong length, or a reordered decode is blocked, the sourced + self-consistency gate), canonical (an over-split or mis-merged run list that isn't the unique maximal-run RLE is blocked — the load-bearing correctness gate; RLE has a unique canonical form so an over-split-but-decodable encoding still fails this gate), and nothing is written back to a source of record autonomously (an autonomous write-back is blocked). An incompressible disposition is a LEGITIMATE FINDING (no consecutive repeats to coalesce), NOT a governance block. It COMPLEMENTS the Huffman agent (frequency-based prefix coding) and the Timeline Merge agent (multi-source interleave): this run-length-compresses one status stream. It IS PHI-adjacent (the statuses reference a device / bed monitoring timeline) and so is on the HIPAA-audit policy. The stream is illustrative, clearly labeled — NOT a certified time-series / telemetry compression system (real telemetry compression uses delta / delta-of-delta encoding, dictionary methods, Gorilla-style float compression, and lossy downsampling — not a bare RLE over illustrative status labels). Enforces, via the Pause Agent Fabric, that every encoding is a sourced + self-consistent lossless run list, the runs are the canonical maximal-run RLE, and nothing is written back autonomously.",
  url: `${HOST}/api/agents/status-timeline-rle`,
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
      id: "compress-status-timeline-rle",
      name: "Run-length-encode a per-slot status stream into canonical (value, length) runs",
      description:
        "Given a per-slot status stream, deterministically run-length-encodes it into a canonical sequence of (value, length) runs and reports the run count, the compression ratio, the longest run, and the dominant status. The encoding is sourced + self-consistent (it decodes back exactly); the runs are the canonical maximal-run RLE; nothing is written back autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "platform",
        "data-substrate",
        "stream-compression",
        "run-length-encoding",
        "timeline",
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
