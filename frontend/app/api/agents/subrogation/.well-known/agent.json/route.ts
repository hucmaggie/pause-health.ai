import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Subrogation / Third-Party Liability (TPL) agent — the claims /
 * payer-operations service that decides whether a plan has a subrogation interest in a liable third
 * party's settlement for injury claims it paid, computes a bounded recoverable amount, and routes
 * for specialist / counsel review.
 *
 *   GET /api/agents/subrogation/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "subrogation-agent";

const CARD: A2AAgentCard = {
  name: "Subrogation / Third-Party Liability Agent",
  description:
    "The subrogation / third-party-liability layer of the Pause payer & plan-operations plane — a DETERMINISTIC (no-Claude) claims service for a health-plan / TPA. When a plan pays claims for an injury caused by a LIABLE THIRD PARTY (an auto accident, a slip-and-fall, a defective product, a work injury), the plan generally has a subrogation / reimbursement RIGHT to recover its payments out of the third party's settlement. Given a subrogation case (whether the claim is injury-related, the accident type, whether a liable third party is identified, what the plan PAID, the cited subrogation basis, the settlement amount if known, and whether the made-whole / common-fund doctrines apply), it DETERMINISTICALLY decides eligibility, computes a BOUNDED recoverable amount (capped at the plan's paid amount, capped again at the settlement, barred by the made-whole doctrine, reduced by the common-fund attorney-fee share), and decides the disposition (no-subrogation-interest / notify-made-whole-bar / assert-lien-with-review). The determination is a pure function of the case's own fields (no randomness, no clock), so the same case always yields the same eligibility / recoverable / disposition. Every recovery decision cites a recorded legal basis (an off-catalog basis is blocked), the recoverable never exceeds what the plan paid or the settlement (a lien is reimbursement, not profit — blocked otherwise, the load-bearing correctness gate), and no lien is autonomously asserted — a subrogation interest is a recommendation requiring a subrogation specialist / plan counsel to review, and the agent never asserts or perfects a lien or reduces the member's settlement (a self-asserted / unreviewed lien is blocked). It COMPLEMENTS — it does not duplicate — the other payer-operations agents: distinct from the Claims Adjudication Assistant (per-claim edits / medical necessity), the Coordination of Benefits agent (the ORDER of coverages that both cover the member), the Claims Overpayment & Recovery agent (POST-payment clawback of the plan's OWN overpayment), the Timely Filing agent (was the claim filed in time), and the FWA agent (suspected fraud) — this recovers the plan's injury-claim payments from a LIABLE THIRD PARTY's settlement. It is PHI-bearing (on the HIPAA audit policy — injury claims reference patient care). The basis catalog + reductions are illustrative, clearly labeled — NOT a certified subrogation engine; real subrogation is governed by the plan document (for a self-funded ERISA plan, 29 U.S.C. §1132(a)(3) and cases such as US Airways v. McCutchen and Montanile), state subrogation / made-whole / common-fund law, and state workers-compensation statutes. Enforces, via the Pause Agent Fabric, that every recovery cites a recorded basis, the recoverable stays within what the plan paid, and no lien is autonomously asserted.",
  url: `${HOST}/api/agents/subrogation`,
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
      id: "assess-subrogation-interest",
      name: "Assess a plan's subrogation / third-party-liability interest",
      description:
        "Given a subrogation case (injury-related, accident type, a liable third party, what the plan paid, the cited basis, the settlement, and the made-whole / common-fund doctrines), deterministically decides eligibility, computes a bounded recoverable amount (≤ plan paid, ≤ settlement, reduced by the doctrines), and decides the disposition. Every recovery cites a recorded basis; the recoverable never exceeds what the plan paid or the settlement; an eligible case requires specialist / counsel review and no lien is autonomously asserted.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "subrogation",
        "third-party-liability",
        "tpl",
        "erisa",
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
