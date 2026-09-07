import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the OIG Exclusion / Sanctions Screening agent — a claims /
 * payer-operations service on the payer & plan operations plane.
 *
 *   GET /api/agents/exclusion-screening/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "exclusion-screening-agent";

const CARD: A2AAgentCard = {
  name: "OIG Exclusion / Sanctions Screening Agent",
  description:
    "A claims / payer-operations service on the payer & plan operations plane — a DETERMINISTIC (no-Claude) agent that screens a party (a provider, a vendor, an employee) against the OIG List of Excluded Individuals / Entities (LEIE) BEFORE a health plan pays or contracts with them, computing an HONEST match strength from explicit identifier signals. Federal law (Social Security Act §1128 / §1128A(a)(6); 42 CFR §1001) prohibits federal-program payment for items or services furnished, ordered, or prescribed by an OIG-excluded party. Given a screening request (a party reference and the party's identifiers — last name, first name, and optionally an NPI and a date of birth), it DETERMINISTICALLY matches the party against the recorded exclusion list and reports a match STRENGTH grounded in which identifiers actually matched: a confirmed match requires an NPI match OR a full-name AND date-of-birth match; a full-name match with no DOB / NPI is probable; a last-name coincidence the first name / DOB doesn't corroborate is possible; otherwise no-match. The match is a pure function of the request's own fields + the catalog (no randomness, no clock), so the same party always yields the same match strength. A reported match traces to a recorded LEIE record (an unsourced match is blocked), the match strength is never overstated (a name coincidence dressed up as a confirmed exclusion is blocked — the load-bearing correctness gate), and a payment is never autonomously blocked / a party never autonomously cleared (an autonomous block / clear is blocked). It COMPLEMENTS — it does not duplicate — the other agents: distinct from the Provider Credentialing agent (whether a provider is QUALIFIED — license, board certification, education), the Claims Adjudication agent (the allowed amount), and the FWA agent (suspected fraud on a claim) — this screens a party's IDENTITY against the OIG exclusion list to prevent an improper PAYMENT to a sanctioned party. It is deliberately NOT PHI-bearing — it screens a provider / vendor's identity against a public exclusion list, not a patient's health information, so it is NOT on the HIPAA-audit policy. The exclusion catalog + match rules are illustrative, clearly labeled (no fuzzy / phonetic matching, no monthly LEIE reload, no SAM.gov / state Medicaid exclusion lists, no reinstatement handling) — NOT a certified exclusion-screening system; real screening is governed by the OIG LEIE, the OIG Special Advisory Bulletin on the effect of exclusion, and the payer's screening policy. Enforces, via the Pause Agent Fabric, that a match is sourced, the strength is not overstated, and no payment is blocked / party cleared autonomously.",
  url: `${HOST}/api/agents/exclusion-screening`,
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
      id: "screen-party-against-exclusion-list",
      name: "Screen a party against the OIG LEIE and report an honest match strength",
      description:
        "Given a party's identifiers (last name, first name, and optionally an NPI and a date of birth), deterministically matches the party against the recorded LEIE catalog and reports a match strength grounded in which identifiers matched (no-match / possible / probable / confirmed) plus a recommended disposition. A match is sourced to a recorded record; the strength is never overstated; a payment is never autonomously blocked and a party never autonomously cleared.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "exclusion-screening",
        "oig-leie",
        "sanctions-screening",
        "payment-integrity",
        "payer-operations",
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
