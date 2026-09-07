import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Member Cost-Share / EOB Calculation agent — a claims /
 * payer-operations service on the payer & plan operations plane.
 *
 *   GET /api/agents/member-cost-share/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "member-cost-share-agent";

const CARD: A2AAgentCard = {
  name: "Member Cost-Share / EOB Calculation Agent",
  description:
    "A claims / payer-operations service on the payer & plan operations plane — a DETERMINISTIC (no-Claude) agent that splits an adjudicated in-network claim's ALLOWED AMOUNT into the member's cost-share (deductible + coinsurance) and the plan-paid portion, running the classic deductible → coinsurance → out-of-pocket-maximum WATERFALL against the member's plan benefit design + current accumulators. Given a cost-share request (a claim reference, a member reference, the member's plan id, the adjudicated allowed amount, and the member's current accumulators — deductible-met and out-of-pocket-met to date), it DETERMINISTICALLY loads the plan benefit design (deductible, coinsurance rate, out-of-pocket maximum) and runs the waterfall: the deductible is applied first (up to the remaining deductible), the remainder is split by the coinsurance rate (the member's share), and the member's total is capped at the remaining out-of-pocket maximum — the plan pays the rest. The split is a pure function of the claim's own fields + the plan (no randomness, no clock), so the same claim always yields the same member / plan split. The benefit design traces to the recorded plan catalog (an off-catalog plan is blocked), the split adds up and stays bounded (member + plan = allowed, member within the allowed / remaining OOP maximum — a split that doesn't add up is blocked, the load-bearing correctness gate), and the member is never autonomously charged — the EOB cost-share is an estimate the claims system / a human finalizes (an autonomously-posted member charge is blocked). It COMPLEMENTS — it does not duplicate — the other payer-operations agents: distinct from the Claims Adjudication agent (WHAT the allowed amount / medical necessity is — it produces the allowed amount this agent consumes), the Coordination of Benefits agent (the ORDER of coverages), the Subrogation agent (recovery from a liable third party), the Good Faith Estimate agent (the pre-service uninsured / self-pay estimate), and the Balance Billing agent (surprise-bill protection at claim time) — this splits the ALREADY-adjudicated allowed amount into member vs. plan responsibility. It is PHI-bearing (the claim references the patient's care), so it is on the HIPAA-audit policy. The plan catalog + deductible / coinsurance / OOP-max waterfall are illustrative, clearly labeled (no copays, tiering, family accumulators, or out-of-network penalties) — NOT a certified claims / adjudication system; real cost-share is governed by the member's certificate of coverage / SBC, the payer's adjudication system, and applicable state / federal law. Enforces, via the Pause Agent Fabric, that the benefit design is cataloged, the split adds up, and the member is never autonomously charged.",
  url: `${HOST}/api/agents/member-cost-share`,
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
      id: "calculate-member-cost-share",
      name: "Split an adjudicated claim into member vs. plan responsibility",
      description:
        "Given an adjudicated claim's allowed amount, the member's plan id, and the member's current accumulators (deductible-met, OOP-met), deterministically runs the deductible → coinsurance → out-of-pocket-maximum waterfall and splits the allowed amount into the member's cost-share and the plan-paid portion. The benefit design is cataloged; the split adds up and stays bounded; the member is never autonomously charged.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "member-cost-share",
        "eob",
        "cost-share",
        "deductible-coinsurance-oop",
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
