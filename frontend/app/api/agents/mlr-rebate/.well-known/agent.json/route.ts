import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Medical Loss Ratio (MLR) Rebate Calculation agent — a claims /
 * payer-operations service on the payer & plan operations plane.
 *
 *   GET /api/agents/mlr-rebate/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "mlr-rebate-agent";

const CARD: A2AAgentCard = {
  name: "Medical Loss Ratio (MLR) Rebate Calculation Agent",
  description:
    "A claims / payer-operations service on the payer & plan operations plane — a DETERMINISTIC (no-Claude) agent that computes a plan's Medical Loss Ratio for a market, decides whether it meets the ACA standard (80% individual / small-group, 85% large-group; 45 CFR Part 158), and — when it falls short — APPORTIONS the total rebate owed across the plan's subscribers penny-exactly (largest-remainder / Hamilton method). UNLIKE the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the OIG Exclusion agent's identity MATCHING, or the Drug Interaction agent's pairwise LOOKUP, the heart of this service is a RATIO-vs-THRESHOLD test + an EXACT PROPORTIONAL APPORTIONMENT (the allocated cents sum EXACTLY to the total — no penny lost or invented). The determination is a pure function of the request's own fields (no randomness, no clock), so the same plan year always yields the same MLR + rebate + apportionment. The applied standard traces to the recorded market catalog (an off-catalog market or mis-stated standard is blocked), the MLR equals (claims + quality improvement) / (earned premium − taxes & fees), the total rebate equals max(0, standard − MLR) × earned premium, and the allocations sum exactly to the total (a rebate that doesn't add up or an apportionment that loses / invents pennies is blocked — the load-bearing correctness gate), and the rebate is never autonomously disbursed (an autonomous disbursement is blocked). It COMPLEMENTS — it does not duplicate — the other payer-operations agents: distinct from the Claims Adjudication agent (the allowed amount), the Member Cost-Share agent (splitting one claim's allowed amount into member vs. plan), the Coordination of Benefits agent (the order of coverages), the Overpayment & Recovery agent (clawing back an overpayment), and the Subrogation agent (recovery from a liable third party) — this computes a PLAN-YEAR-level rebate owed to subscribers under the ACA MLR rule and apportions it fairly. It is NOT PHI-bearing — it works on aggregate plan-year financials + a subscriber premium roster, no patient health information, so it is NOT on the HIPAA-audit policy. The market standards + simplified MLR formula are illustrative, clearly labeled — NOT a certified MLR filing system; real MLR reporting uses the NAIC MLR Annual Reporting Form, credibility adjustments, multi-year averaging, permitted claim / premium adjustments, and the applicable federal / state regulations (45 CFR Part 158). Enforces, via the Pause Agent Fabric, that the standard is sourced, the MLR + apportionment are exact, and the rebate is never autonomously disbursed.",
  url: `${HOST}/api/agents/mlr-rebate`,
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
      id: "calculate-mlr-rebate",
      name: "Compute a plan's MLR and apportion any rebate owed across subscribers",
      description:
        "Given a plan's market + plan-year financials + a subscriber premium roster, deterministically computes the Medical Loss Ratio, decides whether the ACA standard is met, computes the total rebate owed, and apportions it penny-exactly across subscribers (largest-remainder method). The standard is sourced; the MLR + apportionment are exact; the rebate is never autonomously disbursed.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "mlr",
        "medical-loss-ratio",
        "aca-rebate",
        "45-cfr-158",
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
