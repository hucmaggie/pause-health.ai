import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Rolling Census Peak / Sliding-Window Maximum (Monotonic Deque) agent —
 * a care-coordination capacity-monitoring service.
 *
 *   GET /api/agents/rolling-census-peak/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "rolling-census-peak-agent";

const CARD: A2AAgentCard = {
  name: "Rolling Census Peak / Sliding-Window Maximum (Monotonic Deque) Agent",
  description:
    "A care-coordination capacity-monitoring service — a DETERMINISTIC (no-Claude) agent that, given a series of per-slot CENSUS readings (occupancy counts over time) and a trailing WINDOW width k, computes the PEAK census in every trailing window and flags the windows whose peak exceeds a CAPACITY threshold (disposition within-capacity / over-capacity). The heart of this service is the MONOTONIC DEQUE sliding-window maximum: maintain a double-ended queue of candidate indices whose readings are decreasing, pop from the back every index whose reading is ≤ the incoming reading, push the new index, and drop the front once it falls out of the window — the front is always the window's maximum, giving O(1) amortized per window and O(n) overall. CRUCIALLY it is a genuinely NEW computation pattern for the fabric: NOT the Access Anomaly agent's SLIDING-WINDOW COUNTING (a fixed-window EVENT COUNT — this is the sliding-window EXTREMUM via a monotonic deque), NOT the Coverage Heatmap agent's DIFFERENCE-ARRAY RANGE ACCUMULATION (per-slot occupancy from range-adds — this is the rolling MAX over a window of an existing series), NOT the Peak-Window agent's KADANE MAXIMUM-SUBARRAY (a max contiguous SUM — this is a max VALUE per fixed-width window), NOT the Fenwick / Benefit Accumulator agent's PREFIX SUMS, and NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING — it is the sliding-window maximum (a pure function of the readings + window size — no clock, no randomness — so the same request always yields the same report). The per-window peak is the invariant this service reports and defends. The windows are sourced + self-consistent (each window max cross-checked by DIRECT per-window scanning independent of the deque method; the over-capacity windows exactly the breaching windows; honest peak/counts — a fabricated window max, a mis-listed over-capacity window, or a dishonest peak is blocked, the sourced + self-consistency gate), deque-exact (a maxima array the monotonic deque wouldn't produce is blocked — the load-bearing correctness gate, cross-checking the same per-window truth by two independent methods), and nothing is diverted, surged, or acted on autonomously (an autonomous diversion is blocked). An over-capacity disposition is a LEGITIMATE FINDING (a capacity breach), NOT a governance block. It COMPLEMENTS the Coverage Heatmap agent (per-slot concurrent coverage) and the Access Anomaly agent (windowed event counts): this reports the rolling peak occupancy. It IS PHI-adjacent (the census references a care unit's occupancy) and so is on the HIPAA-audit policy. The readings are illustrative, clearly labeled — NOT a certified capacity-management / patient-flow system (real census management weighs acuity, staffed vs licensed beds, isolation & telemetry needs, anticipated discharges, and boarding — not a bare rolling max over illustrative counts). Enforces, via the Pause Agent Fabric, that every report is a sourced + self-consistent per-window peak, the deque is exact (the monotonic deque re-derives), and nothing is diverted autonomously.",
  url: `${HOST}/api/agents/rolling-census-peak`,
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
      id: "rolling-census-peak-sliding-window-max",
      name: "Compute the peak census in every trailing window and flag over-capacity windows via a monotonic deque",
      description:
        "Given per-slot census readings, a trailing window width, and a capacity threshold, deterministically computes the peak census in every window via a monotonic-deque sliding-window maximum and flags the windows over capacity, then reports the per-window maxima, the over-capacity windows, and the overall peak. The windows are sourced + self-consistent (cross-checked by direct scanning); the deque is exact (the monotonic deque re-derives); nothing is diverted autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "capacity-monitoring",
        "sliding-window-maximum",
        "monotonic-deque",
        "census-peak",
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
