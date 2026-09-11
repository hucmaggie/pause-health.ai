import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Reportable / Notifiable Condition Case Classification agent — a
 * care-coordination / public-health-compliance service on the patient-care plane.
 *
 *   GET /api/agents/reportable-condition/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "reportable-condition-agent";

const CARD: A2AAgentCard = {
  name: "Reportable / Notifiable Condition Case Classification Agent",
  description:
    "A care-coordination / public-health-compliance service on the patient-care plane — a DETERMINISTIC (no-Claude) agent that takes a patient CASE's structured facts plus a public-health CASE DEFINITION (an ordered list of classifications — confirmed / probable / suspect — each a nested boolean CRITERIA TREE of all-of (AND) / any-of (OR) / not (NOT) over leaf predicates, 'confirmed = lab-positive OR (clinically-compatible AND epi-linked)') and DETERMINISTICALLY classifies the case — reporting the selected classification, whether it is reportable, each classification's met flag, the referenced facts, and the reason. UNLIKE the PCP Matching agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity agent's HASH CHAIN — the heart of this service is RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION: the recursive walk of a nested all-of / any-of / not tree whose leaves are predicates over the case's facts (the exact shape a public-health case definition takes), plus a documented classification precedence (the highest-precedence met tree wins). A mis-evaluated tree over-reports a notifiable condition (a false alarm to public health) or under-reports it (a missed case) — so the agent evaluates the tree DETERMINISTICALLY (a pure function of the facts + definition — no clock, no randomness — so the same case always yields the same classification) and hands the classification to a human. Every leaf predicate references a submitted fact (a fabricated criterion is blocked — the sourced + completeness gate), the classification recomputes (a mis-evaluated tree is blocked — the load-bearing correctness gate), and no case is ever reported to a public-health authority autonomously (an autonomous report is blocked). It COMPLEMENTS — it does not duplicate — the other compliance / clinical agents: distinct from the Adverse-Event Reporting agent (which DRAFTS a MedWatch / VAERS report for a drug / vaccine event), the Utilization Review agent (medical-necessity criteria for a service), and the Lab Result agent (a single analyte vs a reference range) — this classifies a case against a nested public-health CASE DEFINITION. It is PHI-bearing (the case is a patient's clinical data), so it is on the HIPAA-audit policy. The condition + definition + facts are illustrative, clearly labeled — NOT a certified surveillance / case-reporting system (real notifiable-condition reporting uses the jurisdiction's official CSTE / CDC case definitions, eCR / eICR electronic case reporting, and an epidemiologist's judgment). Enforces, via the Pause Agent Fabric, that every criterion is sourced, the classification recomputes, and no case is ever reported autonomously.",
  url: `${HOST}/api/agents/reportable-condition`,
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
      id: "classify-reportable-condition-case",
      name: "Classify a case against a nested public-health case definition via recursive boolean tree evaluation",
      description:
        "Given a patient case's structured facts and a public-health case definition (an ordered list of classifications, each a nested boolean criteria tree of all-of / any-of / not over leaf predicates), deterministically evaluates each classification's tree recursively and selects the highest-precedence one that holds (else not-a-case), reporting the classification, the reportable flag, and each classification's met flag. Every criterion is sourced; the classification recomputes; no case is reported autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "public-health",
        "reportable-condition",
        "case-classification",
        "boolean-expression-tree",
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
