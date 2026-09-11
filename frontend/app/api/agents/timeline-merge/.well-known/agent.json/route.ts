import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Clinical Event Timeline Merge / Multi-Source Record Reconciliation agent — a
 * platform / data-substrate service on the platform & data-substrate plane.
 *
 *   GET /api/agents/timeline-merge/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "timeline-merge-agent";

const CARD: A2AAgentCard = {
  name: "Clinical Event Timeline Merge / Multi-Source Record Reconciliation Agent",
  description:
    "A platform / data-substrate service on the platform & data-substrate plane — a DETERMINISTIC (no-Claude) agent that takes a patient's clinical EVENTS as they arrive in several already-sorted source STREAMS (an EHR, another EHR, a pharmacy, a claims feed — each stream in ascending time order) and merges them into ONE chronologically-ordered unified TIMELINE, flagging the DUPLICATES (the SAME clinical event reported by more than one source) — reporting the merged timeline (each entry with a duplicate-of link), the per-source contributions, the kept / duplicate / total tallies, and the disposition (clean-merge / duplicates-found). UNLIKE the Reportable Condition agent's RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP Matching agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity agent's HASH CHAIN — and, CRUCIALLY, UNLIKE the Coverage Continuity agent's INTERVAL MERGING (which merges OVERLAPPING date SPANS into continuous coverage; this merges POINT events from many streams into one order) and the Master-Patient-Index agent's WEIGHTED identity MATCHING (which resolves WHO a record belongs to; this runs AFTER identity is known) — the heart of this service is the K-WAY MERGE OF SORTED STREAMS: the classic 'merge k sorted lists' / external-sort merge phase that repeatedly takes the earliest head across the k stream cursors to produce one globally-ordered sequence in linear time, plus a content-key DEDUPLICATION pass that flags the second-and-later report of the same clinical event. A mis-ordered or mis-deduplicated timeline corrupts the record — a duplicated med looks like a double dose, an out-of-order lab hides a trend — so the agent merges DETERMINISTICALLY (a pure function of the streams' own timestamps — no clock, no randomness — so the same streams always yield the same timeline) and hands the timeline to a human. Every timeline entry traces to a submitted stream event (a fabricated / dropped event is blocked — the sourced + completeness gate), the merge recomputes (a mis-ordered / mis-deduplicated timeline is blocked — the load-bearing correctness gate), and no timeline is ever written back to a source of record, no duplicate purged, and no chart overwritten autonomously (an autonomous write is blocked). It COMPLEMENTS — it does not duplicate — the other data / provider agents: distinct from the Master Patient Index agent (which RESOLVES identity across systems), the Enrollment Reconciliation agent (a keyed set-difference between two rosters), and the Transitions of Care agent (medication reconciliation for ONE encounter) — this MERGES a patient's already-resolved event streams into one timeline. It is PHI-bearing (the events are the patient's clinical data), so it is on the HIPAA-audit policy. The events are illustrative, clearly labeled — NOT a certified record-reconciliation / EMPI system (real reconciliation resolves identity first via an EMPI, reconciles with FHIR resource provenance, and applies source-of-truth precedence rules). Enforces, via the Pause Agent Fabric, that every event is sourced, the merge recomputes, and no timeline is ever written back autonomously.",
  url: `${HOST}/api/agents/timeline-merge`,
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
      id: "merge-clinical-event-timeline",
      name: "Merge multi-source clinical event streams into one deduplicated timeline via k-way merge",
      description:
        "Given a patient's clinical events in several already-sorted source streams, deterministically runs the k-way merge of sorted streams to produce one chronologically-ordered unified timeline and flags cross-source duplicates by content key, reporting each event's duplicate-of link, the per-source contributions, and the disposition (clean-merge / duplicates-found). Every event is sourced; the merge recomputes; no timeline is written back autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "data-substrate",
        "record-reconciliation",
        "timeline-merge",
        "k-way-merge",
        "deduplication",
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
