import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Provider Identifier (NPI) Validation & Integrity agent — a data-substrate
 * integrity service on the platform plane.
 *
 *   GET /api/agents/identifier-validation/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "identifier-validation-agent";

const CARD: A2AAgentCard = {
  name: "Provider Identifier (NPI) Validation & Integrity Agent",
  description:
    "A data-substrate integrity service on the platform plane — a DETERMINISTIC (no-Claude) agent that takes a BATCH of National Provider Identifiers and validates each one with the CMS check-digit algorithm: the Luhn (mod-10) checksum computed over the '80840' prefix + the 9-digit base — classifying each as valid, invalid-format (not 10 digits beginning with 1 or 2), or invalid-checksum (a well-formed NPI whose 10th digit does not match the recomputed Luhn check digit, a likely transposition / typo), and reporting the per-kind counts and the batch disposition (all-valid / invalids-flagged). UNLIKE the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the Master-Patient-Index agent's WEIGHTED identity MATCHING, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity agent's HASH CHAIN — the heart of this service is a MODULAR-ARITHMETIC CHECKSUM: the Luhn (mod-10) check-digit computation the NPI standard uses. An NPI with a transposed or mistyped digit fails the checksum; catching it before it lands on a claim or in a provider directory prevents a claim rejection or a ghost-directory entry, so the agent validates the check digit DETERMINISTICALLY (a pure function of the identifiers — no clock, no randomness — so the same batch always yields the same result) and hands the invalid ones to a human. Every result corresponds to a submitted identifier and the per-kind counts sum to the total (a fabricated or dropped identifier is blocked — the sourced + completeness gate), the checksums recompute exactly (a miscomputed Luhn check digit that waves through a mistyped NPI or fails a correct one is blocked — the load-bearing correctness gate), and no claim is rejected, no provider removed, and no number corrected autonomously (an autonomous reject is blocked). It COMPLEMENTS — it does not duplicate — the other provider-data agents: distinct from the Provider Credentialing agent (which cites an npi-registry as a verification SOURCE but does not validate the check digit) and the OIG Exclusion agent (which MATCHES an NPI against the sanctions list) — this validates that the NPI itself is well-formed and its check digit is correct. It is DELIBERATELY NOT PHI-bearing — an NPI is a provider identifier, not patient health information — so, like the OIG Exclusion agent, it is NOT on the HIPAA-audit policy. It validates STRUCTURE + check digit only — it does NOT confirm the NPI is assigned, active, or belongs to a particular provider (that requires an NPPES / registry lookup); the identifiers are illustrative, clearly labeled. Enforces, via the Pause Agent Fabric, that every result is sourced, the checksums recompute, and no claim / provider is rejected autonomously.",
  url: `${HOST}/api/agents/identifier-validation`,
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
      id: "validate-npi-checksums",
      name: "Validate NPIs with the CMS Luhn check-digit algorithm",
      description:
        "Given a batch of National Provider Identifiers, deterministically validates each one's format and Luhn (mod-10, over the 80840 prefix) check digit, classifying each as valid / invalid-format / invalid-checksum, and derives the disposition (all-valid / invalids-flagged). Every result is sourced and the counts sum to the total; the checksums recompute exactly; no claim / provider is rejected autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "data-plane",
        "identifier-validation",
        "npi",
        "luhn",
        "check-digit",
        "checksum",
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
