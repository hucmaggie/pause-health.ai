import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Good Faith Estimate (No Surprises Act) agent — the
 * patient-access service that assembles an itemized Good Faith Estimate of expected
 * charges for a self-pay / uninsured patient BEFORE care, from a charge master.
 *
 *   GET /api/agents/good-faith-estimate/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "good-faith-estimate-agent";

const CARD: A2AAgentCard = {
  name: "Good Faith Estimate (No Surprises Act) Agent",
  description:
    "The self-pay / uninsured price-transparency layer of the Pause patient & clinical plane — a DETERMINISTIC (no-Claude) patient-access service, a sibling to the Benefits & Coverage Verification (EBV) and Patient Financial Assistance & Charity Care agents on the patient-access tier. Given a scheduled primary service + the expected line items (each a charge-master service id + quantity, with the patient + rendering-provider references), it DETERMINISTICALLY prices each line item from the charge master (citing the charge-master id at the catalog amount), verifies the estimate includes the primary service AND every reasonably-expected co-item, sums the total expected charge, and returns a Good Faith Estimate that is an ESTIMATE (binding:false) requiring patient confirmation, with the No Surprises Act $400 dispute threshold recorded. The estimate is a pure function of the request's line items + the charge master (no randomness, no clock), so the same request always yields the same total + completeness + sourcing flags. Every priced line item must be charge-master-sourced (no ad-hoc / off-schedule charges), the estimate must be COMPLETE (an omitted expected item understates the total and misleads the patient — 45 CFR 149.610), and a GFE is NEVER a binding / final bill (the agent recommends, a human confirms). It COMPLEMENTS — it does not duplicate — the patient-access siblings: the EBV agent verifies what the PLAN covers (eligibility + the estimated COVERED visit cost), and the Financial Assistance agent screens the patient-responsibility remainder for CHARITY CARE; this assembles the itemized SELF-PAY / uninsured estimate required BEFORE care. Together they are the patient-access triad: plan eligibility → itemized self-pay estimate → charity screening. It is a patient-access service (patient & clinical plane), PHI-bearing (on the HIPAA audit policy). The charge master, categories, amounts, and expected-co-item rules are illustrative/synthetic, clearly labeled — NOT a certified hospital chargemaster, machine-readable price-transparency file, or a real provider's charges; a real GFE is governed by the No Surprises Act (45 CFR 149.610), the provider's actual charges, and HHS guidance. Enforces, via the Pause Agent Fabric, that every line item is charge-master-sourced, that the estimate is complete, and that a GFE is an estimate (never a binding bill).",
  url: `${HOST}/api/agents/good-faith-estimate`,
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
      id: "assemble-good-faith-estimate",
      name: "Assemble an itemized Good Faith Estimate before care",
      description:
        "Given a scheduled primary service + the expected line items (each a charge-master service id + quantity), deterministically prices each line item from the charge master, verifies every reasonably-expected co-item for the primary service is included, sums the total, and returns an ESTIMATE (never a binding bill) requiring patient confirmation, with the NSA $400 dispute threshold recorded. Every line item is charge-master-sourced; the estimate is complete; a GFE is never a binding bill.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "good-faith-estimate",
        "no-surprises-act",
        "price-transparency",
        "self-pay",
        "patient-access",
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
