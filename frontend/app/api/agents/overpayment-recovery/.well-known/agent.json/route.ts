import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Claims Overpayment & Recovery agent — the plan-side
 * payer & plan operations service that decides whether a PAID claim was overpaid and,
 * if so, whether the overpayment is still recoverable.
 *
 *   GET /api/agents/overpayment-recovery/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "overpayment-recovery-agent";

const CARD: A2AAgentCard = {
  name: "Claims Overpayment & Recovery Agent",
  description:
    "The post-payment integrity layer of the Pause payer & plan operations plane — a plan-side (health-plan / TPA) claims-overpayment-recovery service. Given a PAID claim (what was paid, what should have been paid, the recovery reason, and the paid date evaluated against a provided asOfDate), it DETERMINISTICALLY computes the overpayment (paid − correct), cites the governing recovery reason, derives the recovery deadline from the paid date + the reason's statutory lookback window, and classifies the claim as recoverable / not-recoverable-within-window / no-overpayment. The determination is a pure function of the claim's amounts + dates + the request's own asOfDate (no randomness, no clock), so the same claim always yields the same overpayment + cited reason + recoverability. It NEVER autonomously claws back or offsets a payment: a recoverable overpayment is a RECOMMENDATION requiring human review with member/provider notice, and a claim past its statutory lookback window is NEVER recoverable (recouping beyond the lookback is an unlawful recoupment). It COMPLEMENTS — it does not duplicate — the other payer & plan operations agents: distinct from the Claims Adjudication Assistant (first-pass PRE-payment adjudication), the Fraud, Waste & Abuse Detection agent (suspected fraud patterns), and the Coordination of Benefits agent (which decides payer ORDER), this is POST-payment recovery of a legitimate overpayment already made. It is a plan-side payer-operations service (payer & plan operations plane), PHI-bearing (on the HIPAA audit policy), NOT a live-Claude agent. The recovery reason catalog + lookback windows + reason ids are illustrative/synthetic, clearly labeled — NOT a certified payment-integrity system; real overpayment recovery is governed by the ACA §6402 60-day overpayment rule, CMS recovery rules, ERISA, and state insurance code. Enforces, via the Pause Agent Fabric, that a recovery stays within its statutory lookback window, that every recovery cites a recorded recovery reason, and that a clawback is never executed autonomously (it is human-review-gated).",
  url: `${HOST}/api/agents/overpayment-recovery`,
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
      id: "evaluate-overpayment-recovery",
      name: "Evaluate a paid claim for a recoverable overpayment",
      description:
        "Given a PAID claim (paid amount, correct amount, recovery reason, and paid date evaluated against a provided asOfDate), deterministically computes the overpayment, cites the governing recovery reason (duplicate-payment, cob-primary-elsewhere, retroactive-termination, pricing-error, or services-not-rendered), derives the recovery deadline from the paid date + the reason's statutory lookback window, and classifies the claim as recoverable / not-recoverable-within-window / no-overpayment. A claim past its lookback window is never recoverable; a recoverable overpayment sets a recommendation requiring human review with member/provider notice — the agent never autonomously claws back or offsets a payment.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "overpayment-recovery",
        "post-payment-integrity",
        "clawback",
        "lookback-window",
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
