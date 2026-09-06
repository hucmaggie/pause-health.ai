import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Deal Desk / Quote Approval (CPQ) agent — Pause's OWN go-to-market
 * deal-desk service on the strictly PHI-separated commercial-operations plane.
 *
 *   GET /api/agents/deal-desk/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "deal-desk-agent";

const CARD: A2AAgentCard = {
  name: "Deal Desk / Quote Approval Agent",
  description:
    "Pause's OWN go-to-market deal-desk service on the strictly PHI-separated commercial-operations plane — a DETERMINISTIC (no-Claude) agent that validates a proposed B2B enterprise quote's pricing + discounting against the recorded pricing / discount-guardrail catalog. This is Pause's own quoting tooling (selling the platform to health systems / payers / employers), NOT a patient-facing agent: it runs on Sales Cloud commercial data only and never reads, joins, or derives patient PHI. Given a proposed quote (an account reference and a set of line items, each a product, its list price, a quantity, and a proposed discount %), it DETERMINISTICALLY prices each line, sums the list / net / discount totals, computes the effective blended discount, checks each line's discount against its product's max auto-approve guardrail, and decides whether the quote AUTO-APPROVES (every line within guardrail) or must ESCALATE to a human deal-desk owner (any line out of guardrail). The decision is a pure function of the quote's own line items (no randomness, no clock), so the same quote always yields the same totals / guardrail result / disposition. Every line prices from the recorded catalog (an off-catalog product is blocked), the quote totals equal the recomputed line sums (a guessed / hidden total is blocked — the load-bearing correctness gate), and an out-of-guardrail discount is never autonomously approved — it escalates to a human deal-desk owner (an out-of-guardrail auto-approval is blocked). It COMPLEMENTS — it does not duplicate — the other commercial-operations agents: distinct from the Pipeline Management agent (the B2B opportunity pipeline / forecast roll-up), the Account Management agent (post-close renewals / expansion / health), and the Provider Contracting agent (the payer↔provider network CONTRACT) — this validates a proposed SALES QUOTE's pricing + discounting. Because it operates on commercial quote data rather than patient PHI, it lives on the commercial plane and is on the commercial no-PHI policy, NOT the HIPAA-audit policy. The product catalog + guardrails are illustrative, clearly labeled — NOT a certified CPQ / pricing system; real quoting is governed by the company's CPQ (e.g. Salesforce Revenue Cloud), its approved price book, and its deal-desk / finance discount-approval matrix. Enforces, via the Pause Agent Fabric, that every line prices from the catalog, the totals add up, and no out-of-guardrail discount is autonomously approved.",
  url: `${HOST}/api/agents/deal-desk`,
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
      id: "validate-quote-approval",
      name: "Validate a quote against the deal-desk pricing guardrails",
      description:
        "Given a proposed quote (an account and a set of line items, each a product, list price, quantity, and proposed discount %), deterministically prices each line, sums the totals, computes the effective blended discount, checks each line's discount against its product's max auto-approve guardrail, and decides auto-approve vs. escalate to a human deal-desk owner. Every line prices from the catalog; the totals equal the computed sums; an out-of-guardrail discount is never auto-approved.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "deal-desk",
        "cpq",
        "quote-approval",
        "pricing",
        "commercial-operations",
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
