import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Coverage Heatmap / Difference-Array Range Accumulation agent —
 * a care-coordination capacity-visibility service.
 *
 *   GET /api/agents/coverage-heatmap/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "coverage-heatmap-agent";

const CARD: A2AAgentCard = {
  name: "Coverage Heatmap / Difference-Array Range Accumulation Agent",
  description:
    "A care-coordination capacity-visibility service — a DETERMINISTIC (no-Claude) agent that, given a set of staffing COVERAGE INTERVALS (each adding some number of staff over a contiguous window of time slots) and a REQUIRED MINIMUM staffing level, computes the CONCURRENT coverage at every slot and flags the UNDER-STAFFED slots (disposition fully-covered / understaffed). The heart of this service is the DIFFERENCE ARRAY (the imos / range-update technique): to add staff to every slot in [start, end), increment diff[start] and decrement diff[end] — an O(1) range update — then a single PREFIX-SUM pass materializes the concurrent coverage at every slot in O(T), so applying m overlapping intervals costs O(m + T), not O(m·T). CRUCIALLY it is a genuinely NEW computation pattern for the fabric: NOT the Fenwick / Benefit Accumulator agent's POINT-UPDATE + PREFIX-QUERY tree (the dual problem — this is RANGE-UPDATE + full MATERIALIZE), NOT the Schedule Conflict agent's GREEDY INTERVAL SELECTION (which picks a max non-overlapping subset — this COUNTS overlaps per slot), NOT the Peak-Window agent's KADANE MAXIMUM-SUBARRAY (a max contiguous sum — this is per-slot occupancy), NOT the Caseload Balancing agent's BIN-PACKING, and NOT the Batch Partition agent's LINEAR PARTITION — it is difference-array range accumulation (a pure function of the intervals + slot count — no clock, no randomness — so the same request always yields the same heatmap). The per-slot concurrent coverage is the invariant this service reports and defends. The coverage is sourced + self-consistent (each coverage value cross-checked by DIRECT interval counting, independent of the difference-array method; the under-staffed slots exactly the below-min slots; honest min/max — a fabricated coverage value, a mis-listed slot, or a dishonest min/max is blocked, the sourced + self-consistency gate), accumulation-exact (a coverage array the difference array wouldn't produce is blocked — the load-bearing correctness gate, cross-checking the same per-slot truth by two independent methods), and nothing is scheduled, adjusted, or dispatched autonomously (an autonomous staffing action is blocked). An understaffed disposition is a LEGITIMATE FINDING (a coverage gap), NOT a governance block. It COMPLEMENTS the Schedule Conflict agent (double-booking guard) and the Caseload Balancing agent (panel capacity fill): this visualizes concurrent coverage across a schedule. It IS PHI-adjacent (the intervals reference care-unit staffing) and so is on the HIPAA-audit policy. The intervals are illustrative, clearly labeled — NOT a certified workforce-management / staffing system (real staffing weighs skill mix, acuity-adjusted ratios, licensure, breaks & meal relief, union rules, and float pools — not a bare count of overlapping intervals). Enforces, via the Pause Agent Fabric, that every heatmap is a sourced + self-consistent coverage count, the accumulation is exact (the difference array re-materializes), and nothing is scheduled autonomously.",
  url: `${HOST}/api/agents/coverage-heatmap`,
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
      id: "compute-coverage-heatmap-difference-array",
      name: "Compute per-slot concurrent staffing coverage and flag under-staffed slots via a difference array",
      description:
        "Given staffing coverage intervals over a set of time slots and a required minimum, deterministically materializes the concurrent coverage at every slot via a difference array + prefix sum and flags the under-staffed slots, then reports the coverage array, the under-staffed slots, and the min/max. The coverage is sourced + self-consistent (cross-checked by direct counting); the accumulation is exact (the difference array re-materializes); nothing is scheduled autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "capacity-visibility",
        "difference-array",
        "range-accumulation",
        "staffing-coverage",
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
