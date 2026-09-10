import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Medication Name Safety (LASA) agent — a clinical-decision service on the
 * patient / clinical plane.
 *
 *   GET /api/agents/medication-name-safety/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "medication-name-safety-agent";

const CARD: A2AAgentCard = {
  name: "Medication Name Safety (LASA) Agent",
  description:
    "A clinical-decision service on the patient / clinical plane — a DETERMINISTIC (no-Claude) agent that takes a prescribed / typed drug name plus a formulary catalog and, using edit distance, finds the nearest catalog name and flags a look-alike / sound-alike (LASA) confusion — a name dangerously close to a different drug, or a near-miss misspelling — for a pharmacist. UNLIKE the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the Drug–Drug Interaction agent's PAIRWISE KNOWLEDGE-BASE LOOKUP, the OIG Exclusion agent's EXACT identity MATCHING (explicitly no fuzzy matching), or the Audit Log Integrity agent's HASH CHAIN — and UNLIKE the date-deadline agents (Timely Filing, Right of Access, Amendment) that add N days to a single date — the heart of this service is STRING EDIT DISTANCE (the classic Levenshtein dynamic-programming algorithm: the minimum single-character insertions, deletions, and substitutions to turn one name into another). Time is data: the finding is a pure function of the name + catalog + threshold (no clock, no randomness), so the same input always yields the same finding. Every candidate is sourced from the catalog (a fabricated / mislabeled look-alike is blocked — the sourced gate), the distances recompute exactly (a miscomputed distance, a wrong nearest match, an omitted look-alike, or a bad disposition is blocked — the load-bearing correctness gate), and no drug is ever substituted / corrected / dispensed (an autonomous substitution is blocked). It COMPLEMENTS — it does not duplicate — the other medication agents: distinct from the Drug–Drug Interaction agent (whether two drugs INTERACT), the Formulary & DUR agent (whether a drug is COVERED), the Controlled-Substance / PDMP agent (opioid MME safety), and the Medication Adherence agent (refill nudges) — this catches a name confusable with a different drug before it becomes a wrong-drug error. It is PHI-bearing (the prescribed name is for a patient's medication order), so it is on the HIPAA-audit policy. The catalog + names are illustrative, clearly labeled — NOT a certified medication-safety system; real LASA safety uses the ISMP / FDA LASA lists, tall-man lettering, RxNorm / First Databank vocabularies, indication / dose context, and barcode scanning. Enforces, via the Pause Agent Fabric, that every candidate is sourced, the edit distances are exact, and no drug is substituted autonomously.",
  url: `${HOST}/api/agents/medication-name-safety`,
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
      id: "check-medication-name",
      name: "Flag look-alike / sound-alike drug-name confusion by edit distance",
      description:
        "Given a prescribed / typed drug name and a formulary catalog, deterministically computes the Levenshtein edit distance to every catalog drug, finds the nearest match, and flags the look-alikes within the confusability threshold (recognized-clear / lasa-warning / unrecognized). Every candidate is sourced; the distances recompute exactly; no drug is substituted autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "medication-safety",
        "lasa",
        "look-alike-sound-alike",
        "edit-distance",
        "levenshtein",
        "clinical-decision",
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
