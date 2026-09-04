import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Balance Billing Protection (No Surprises Act) agent — the
 * payer-side service that decides whether the NSA prohibits balance-billing an
 * out-of-network claim, and on what basis a protected patient's cost-share is computed.
 *
 *   GET /api/agents/balance-billing/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "balance-billing-agent";

const CARD: A2AAgentCard = {
  name: "Balance Billing Protection (No Surprises Act) Agent",
  description:
    "The claim-time No Surprises Act layer of the Pause payer & plan operations plane — a DETERMINISTIC (no-Claude) payer-side service, the CLAIM-time complement to the patient-access Good Faith Estimate agent (the two sides of the No Surprises Act). Given a claim (its protection basis — the service setting / provider network status — plus the service type, whether it is an ancillary service, the billed charge, the in-network allowed amount / Qualifying Payment Amount, and whether a valid notice-and-consent waiver was obtained), it DETERMINISTICALLY decides whether the NSA PROHIBITS balance-billing the patient, computes the patient's cost-share BASIS (the in-network QPA for a protected claim, never the out-of-network billed charge), and computes the balance-bill amount (0 + prohibited for a protected claim; billedCharge − allowed for a permitted one requiring human review). Protection applies to emergency services, an out-of-network provider at an in-network facility (waivable via notice-and-consent EXCEPT for ancillary services), and air ambulance; an out-of-network ground ambulance is NOT protected (a known NSA gap). The determination is a pure function of the request + the basis catalog (no randomness, no clock), so the same claim always yields the same protection + cost-share basis + balance-bill flags. Every determination must cite a recorded protection basis (no ad-hoc protection call), a PROTECTED patient's cost-share must be on the in-network (QPA) basis (basing it on the billed charge over-charges the patient — 45 CFR 149.110–149.130), and a PROTECTED claim can NEVER be balance-billed. It COMPLEMENTS — it does not duplicate — the other payer agents (Claims Adjudication per-claim edits, Coordination of Benefits payer order, Overpayment & Recovery post-payment clawback, Utilization Review medical necessity, FWA fraud). It is a payer & plan operations service, PHI-bearing (on the HIPAA audit policy). The protection bases, waiver rules, ancillary handling, and QPA amounts are illustrative/synthetic, clearly labeled — NOT a certified No Surprises Act engine; a real determination uses the actual Qualifying Payment Amount, the federal Independent Dispute Resolution process, the notice-and-consent requirements, and the provider's network contracts under 45 CFR 149. Enforces, via the Pause Agent Fabric, that every determination cites a recorded protection basis, that a protected patient's cost-share is on the in-network basis, and that a protected claim is never balance-billed.",
  url: `${HOST}/api/agents/balance-billing`,
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
      id: "evaluate-balance-billing",
      name: "Decide NSA balance-billing protection + cost-share basis for a claim",
      description:
        "Given a claim (its protection basis + service type, whether ancillary, the billed charge, the in-network allowed / QPA, and whether a valid notice-and-consent waiver was obtained), deterministically decides whether the No Surprises Act prohibits balance billing, computes the patient's cost-share basis (in-network QPA for a protected claim), and computes the balance-bill amount. Every determination cites a recorded protection basis; a protected patient's cost-share is on the in-network basis; a protected claim is never balance-billed.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "balance-billing",
        "no-surprises-act",
        "qualifying-payment-amount",
        "out-of-network",
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
