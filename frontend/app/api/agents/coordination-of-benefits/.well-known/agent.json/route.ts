import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Coordination of Benefits agent — the plan-side
 * payer & plan operations service that decides the order of benefits when a patient
 * carries more than one coverage.
 *
 *   GET /api/agents/coordination-of-benefits/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "coordination-of-benefits-agent";

const CARD: A2AAgentCard = {
  name: "Coordination of Benefits Agent",
  description:
    "The order-of-benefits layer of the Pause payer & plan operations plane — a plan-side (health-plan / TPA) coordination-of-benefits service. When a patient carries more than one coverage, given the patient's COVERAGES (how the patient is covered — as the subscriber/employee or as a dependent — the plan type, whether the coverage is through current active employment, the covering parent/subscriber's birthday for the birthday rule, and the coverage start date), it DETERMINISTICALLY ORDERS the coverages (primary → secondary → tertiary) by applying the NAIC-model order-of-benefits rules + Medicare Secondary Payer + the birthday rule, citing the governing COB rule for every ordering decision. The order is a pure function of the coverages + the request's own context (no randomness, no clock), so the same coverages always yield the same order + cited rules. It NEVER autonomously adjudicates or pays: an order-of-benefits determination sets payer ORDER only and is a RECOMMENDATION requiring human cosign, and an active custody / court decree ALWAYS overrides the birthday rule. It COMPLEMENTS — it does not duplicate — the other payer & plan operations agents: distinct from the Claims Adjudication Assistant (per-claim edits AFTER the payer order is known), the Benefits & Coverage Verification / EBV agent (single-plan eligibility), and the Utilization Review agent (medical necessity), this decides the ORDER OF BENEFITS ACROSS coverages BEFORE a claim is adjudicated. It is a plan-side payer-operations service (payer & plan operations plane), PHI-bearing (on the HIPAA audit policy), NOT a live-Claude agent. The COB rule catalog, plan types, and payer labels are illustrative/synthetic, clearly labeled — NOT a certified coordination-of-benefits engine; real COB is governed by the NAIC COB Model Regulation, Medicare Secondary Payer (42 CFR 411), Medicaid third-party liability (42 CFR 433.139), ERISA plan documents, and state insurance code. Enforces, via the Pause Agent Fabric, that a custody / court decree always overrides the birthday rule, that every ordering decision cites a recorded COB rule, and that a determination never autonomously adjudicates (it is human-cosign-gated).",
  url: `${HOST}/api/agents/coordination-of-benefits`,
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
      id: "coordinate-benefits",
      name: "Order a patient's multiple coverages (order of benefits)",
      description:
        "Given a patient's coverages (subscriber/dependent role, plan type, active-employment status, covering subscriber's birthday, and coverage start date) and whether the patient is a dependent child, deterministically orders the coverages primary → secondary → tertiary, citing the governing COB rule for every decision (custody-decree, Medicaid-payer-of-last-resort, Medicare-secondary-payer, subscriber-before-dependent, active-before-inactive, the birthday rule, or the longer-coverage tie-break). A custody / court decree always overrides the birthday rule; the determination sets payer order only and requires human cosign — the agent never autonomously adjudicates or pays.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "coordination-of-benefits",
        "order-of-benefits",
        "birthday-rule",
        "medicare-secondary-payer",
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
