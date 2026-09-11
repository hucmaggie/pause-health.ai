import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Clinical Quality-Measure Shift Detection (Statistical Process Control)
 * agent — a care-coordination / quality-analytics service on the patient & clinical plane.
 *
 *   GET /api/agents/quality-shift/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "quality-shift-agent";

const CARD: A2AAgentCard = {
  name: "Clinical Quality-Measure Shift Detection (Statistical Process Control) Agent",
  description:
    "A care-coordination / quality-analytics service on the patient & clinical plane — a DETERMINISTIC (no-Claude) agent that watches a time-ordered series of a clinical QUALITY MEASURE (a weekly mammography-screening rate, a monthly HbA1c-control rate, a daily lab-QC value) and detects whether the measure has drifted into a SUSTAINED SHIFT away from its established TARGET — reporting the charted CUSUM points, the signal (in-control / shift-up-detected / shift-down-detected), the first-alarm index + direction, and the peak sums. UNLIKE the Timeline Merge agent's K-WAY MERGE OF SORTED STREAMS, the Reportable Condition agent's RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP Matching agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity agent's HASH CHAIN — and, CRUCIALLY, UNLIKE the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS (which ranks one value against a static peer distribution; this watches ONE series evolve over time) and the Access Anomaly agent's SLIDING-WINDOW COUNTING (which counts events in a fixed recent window to catch a spike; this accumulates a running deviation to catch a SUSTAINED small shift a window would miss) — the heart of this service is CHANGE-POINT DETECTION via a two-sided TABULAR CUSUM (cumulative-sum) control chart: it accumulates an upper sum SH_i = max(0, SH_{i-1} + (x_i − target) − k) and a lower sum SL_i = max(0, SL_{i-1} + (target − x_i) − k), where k is the slack, and signals the first observation whose SH or SL exceeds the decision threshold h. A missed shift lets a quality measure decay unnoticed; a false alarm sends a team chasing noise — so the chart signals DETERMINISTICALLY (a pure function of the observations' own values + the parameters — no clock, no randomness — so the same series always yields the same signal) and hands the finding to a human. Every charted point traces to a submitted observation (a fabricated / dropped point is blocked — the sourced + completeness gate), the CUSUM recomputes (a mis-charted chart is blocked — the load-bearing correctness gate), and no corrective action, recall campaign, or process change is ever launched autonomously (an autonomous intervention is blocked). It COMPLEMENTS — it does not duplicate — the other quality / clinical agents: distinct from the HEDIS agent (which COMPUTES a measure rate), the Population Health agent (which PRIORITIZES a panel by risk), the Provider Benchmarking agent (which RANKS a value against peers), and the Remote Monitoring agent (which checks ONE patient's vitals against a threshold) — this watches a quality-measure series for a sustained shift over time. It charts de-identified aggregate rate series, but because the measures are derived from patient clinical data it is on the HIPAA-audit policy. The measures are illustrative, clearly labeled — NOT a certified SPC / quality-surveillance platform (real statistical process control tunes k and h to a target ARL, combines CUSUM with Shewhart / EWMA charts, and accounts for autocorrelation and measure specifications). Enforces, via the Pause Agent Fabric, that every point is sourced, the CUSUM recomputes, and no corrective action is ever launched autonomously.",
  url: `${HOST}/api/agents/quality-shift`,
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
      id: "detect-quality-measure-shift",
      name: "Detect a sustained shift in a clinical quality-measure series via a two-sided CUSUM control chart",
      description:
        "Given a time-ordered series of a clinical quality measure plus a target, slack, and threshold, deterministically runs a two-sided tabular CUSUM control chart to detect whether the measure has drifted into a sustained shift, reporting the charted CUSUM points, the signal (in-control / shift-up-detected / shift-down-detected), the first-alarm index + direction, and the peak sums. Every point is sourced; the CUSUM recomputes; no corrective action is launched autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "quality-analytics",
        "statistical-process-control",
        "cusum",
        "change-point-detection",
        "care-coordination",
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
