import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Advance Beneficiary Notice (Medicare ABN) agent — the
 * patient-access service that decides whether a signed pre-service ABN is required before a
 * likely-denied Medicare service and whether the beneficiary may be billed.
 *
 *   GET /api/agents/advance-beneficiary-notice/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "advance-beneficiary-notice-agent";

const CARD: A2AAgentCard = {
  name: "Advance Beneficiary Notice (Medicare ABN) Agent",
  description:
    "The Medicare ABN layer of the Pause patient-access plane — a DETERMINISTIC (no-Claude) benefits-verification service for a provider billing office. Given a proposed service (the cited Medicare coverage rule, whether the service meets its coverage criteria or exceeds a frequency limit, and whether an ABN was issued and signed BEFORE the service), it DETERMINISTICALLY assesses coverage (likely-covered / likely-non-covered / statutorily-excluded), decides whether a signed pre-service ABN (Form CMS-R-131) is required, computes whether a valid pre-service ABN is on file, decides whether the beneficiary may be billed, assigns the CMS liability modifier (GA / GZ / GY), and decides the disposition (proceed-covered / issue-abn-before-service / bill-beneficiary-with-abn / notify-statutory-exclusion). The decision is a pure function of the request's own fields + the cited rule (no randomness, no clock), so the same service always yields the same coverage assessment / ABN requirement / modifier / disposition. Every non-coverage decision cites a recorded Medicare coverage rule (an ad-hoc / un-sourced rule is blocked), a likely-non-covered service requires a signed pre-service ABN (a determination that marks it as needing no ABN is blocked — the load-bearing completeness gate), and patient financial liability is NEVER assigned autonomously — the beneficiary may be billed for a non-covered service ONLY with a valid pre-service ABN, otherwise the provider is liable, and every liability decision requires human review (a determination that bills the beneficiary without a valid ABN, or auto-assigns liability, is blocked). It COMPLEMENTS — it does not duplicate — the other patient-access / financial agents: distinct from the Good Faith Estimate agent (the No Surprises Act self-pay estimate), the Balance Billing agent (the No Surprises Act claim-time surprise-bill prohibition), the Benefits & Coverage Verification (EBV) agent (plan eligibility), and the Financial Assistance agent (501(r) charity care) — this decides one narrow Medicare question: is a signed pre-service ABN required before a likely-denied service, and may the beneficiary be billed. It is PHI-bearing (on the HIPAA audit policy — services reference patient care). The coverage rules + modifier logic are illustrative, clearly labeled — NOT a certified Medicare coverage engine; real ABN decisions are governed by the Medicare NCD/LCD, the Social Security Act §1862(a), the CMS Medicare Claims Processing Manual (Ch. 30), and Form CMS-R-131. Enforces, via the Pause Agent Fabric, that every non-coverage decision cites a recorded coverage rule, a likely-non-covered service requires a pre-service ABN, and patient liability is never assigned autonomously.",
  url: `${HOST}/api/agents/advance-beneficiary-notice`,
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
      id: "decide-advance-beneficiary-notice",
      name: "Decide whether a pre-service ABN is required and whether the beneficiary may be billed",
      description:
        "Given a proposed Medicare service (the cited coverage rule, whether it meets its coverage criteria or exceeds a frequency limit, and whether an ABN was issued and signed before the service), deterministically assesses coverage, decides whether a signed pre-service ABN is required, computes whether a valid ABN is on file, decides whether the beneficiary may be billed, and assigns the CMS liability modifier. Every non-coverage decision cites a recorded coverage rule; a likely-non-covered service requires a pre-service ABN; patient liability requires human review and is never assigned autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "advance-beneficiary-notice",
        "medicare",
        "abn",
        "patient-access",
        "revenue-cycle",
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
