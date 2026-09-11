import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Clinical List Reconciliation / Longest-Common-Subsequence (LCS) Diff agent — a
 * care-coordination reconciliation service on the patient-care plane.
 *
 *   GET /api/agents/list-reconciliation/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "list-reconciliation-agent";

const CARD: A2AAgentCard = {
  name: "Clinical List Reconciliation / Longest-Common-Subsequence (LCS) Diff Agent",
  description:
    "A care-coordination reconciliation service on the patient-care plane — a DETERMINISTIC (no-Claude) agent that, given TWO ordered clinical lists for one record — a PRIOR list (the medication list at admission, the problem list at last visit, the care-plan steps as last agreed) and a CURRENT list (the same list now) — reconciles them by finding the LONGEST COMMON SUBSEQUENCE (the items PRESERVED in both, in order) and derives what was RETAINED, ADDED, and REMOVED (disposition lists-match / changes-present). CRUCIALLY, this is NOT the Medication Name Safety agent's LEVENSHTEIN EDIT DISTANCE (which measures CHARACTER-level edit distance between two drug-name STRINGS to catch look-alike/sound-alike confusability) and NOT the Enrollment Reconciliation agent's KEYED SET RECONCILIATION (which joins two record sets on a key to find adds/drops/mismatches, order-independent). It is also UNLIKE the Timeline Merge agent's K-WAY MERGE (which interleaves already-sorted streams), the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, the Peak-Window agent's KADANE MAXIMUM-SUBARRAY, the Care Routing agent's DIJKSTRA'S SHORTEST PATH, the Outreach agent's 0/1 KNAPSACK, the Source Consensus agent's BOYER–MOORE MAJORITY VOTE, the Code Taxonomy agent's TRIE LONGEST-PREFIX MATCH, the Household Composition agent's UNION-FIND, the Care Pathway agent's TOPOLOGICAL ORDERING, or the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM — the heart of this service is the LONGEST COMMON SUBSEQUENCE: a dynamic-programming table over the two ORDERED lists finds the longest subsequence common to both (the items kept, in their shared order), and its complement in each list is what was removed (prior only) and added (current only). Order matters — LCS respects the sequence — which is exactly what set reconciliation throws away (a pure function of the two lists — no clock, no randomness — so the same request always yields the same diff). The diff is sourced + self-consistent (a fabricated / reordered retained item or a mis-stated add/remove is blocked — the sourced + self-consistency gate), LCS-optimal (a shorter-than-optimal common subsequence that over-reports change is blocked — the load-bearing correctness gate), and nothing is written back, chart-updated, or medication-changed autonomously (an autonomous update is blocked). It COMPLEMENTS — it does not duplicate — the Medication Name Safety agent (which measures character-level edit distance between two drug-name strings) and the Enrollment Reconciliation agent (which joins two record sets on a key, order-independent): this DIFFS two ORDERED lists respecting sequence. It IS PHI-bearing (the lists are one patient's clinical record) and so is on the HIPAA-audit policy. The lists are illustrative, clearly labeled — NOT a certified medication-reconciliation system (real medication / problem-list reconciliation normalizes to RxNorm / SNOMED and accounts for dose, route, frequency, therapeutic equivalence, and clinical intent). Enforces, via the Pause Agent Fabric, that every diff is sourced + self-consistent, the common subsequence is the longest, and the reconciled list is never written back autonomously.",
  url: `${HOST}/api/agents/list-reconciliation`,
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
      id: "reconcile-lists-longest-common-subsequence",
      name: "Reconcile two ordered clinical lists via the longest common subsequence",
      description:
        "Given two ordered clinical lists (a prior list and a current list), deterministically runs the longest-common-subsequence dynamic program to find the retained items (in shared order), then complements it to the removed (prior only) and added (current only) items. The diff is sourced + self-consistent; the common subsequence is the longest; the reconciled list is never written back autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "care-coordination",
        "reconciliation",
        "medication-reconciliation",
        "longest-common-subsequence",
        "diff",
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
