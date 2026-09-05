import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Timely Filing Compliance agent — the payer-operations service
 * that decides whether a claim was filed within its payer's timely-filing limit.
 *
 *   GET /api/agents/timely-filing/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "timely-filing-agent";

const CARD: A2AAgentCard = {
  name: "Timely Filing Compliance Agent",
  description:
    "The timely-filing layer of the Pause payer & plan-operations plane — a DETERMINISTIC (no-Claude) claims service for a health-plan / TPA / provider billing office. Given a claim (a date of service, a submission date, and the cited payer filing-limit rule), it DETERMINISTICALLY computes the filing DEADLINE (date of service + the rule's limit in days), compares the submission date to it, computes how many days late an untimely claim is, honors a recognized filing-limit EXCEPTION when one is claimed, and decides the disposition (accept / appeal-with-exception / write-off-review). The decision is a pure function of the claim's dates + the cited rule (no randomness, no clock), so the same claim always yields the same deadline / timely flag / disposition. Every decision cites a recorded filing-limit rule (an ad-hoc / un-sourced limit is blocked), the deadline is computed and never guessed (a deadline that does not match the computed date of service + limit is blocked — the load-bearing correctness gate), and an untimely claim is NEVER autonomously written off — it is a recommendation (appeal with an exception, or a write-off decision) requiring human review (a written-off / unreviewed untimely claim is blocked). It COMPLEMENTS — it does not duplicate — the other payer-operations agents: distinct from the Claims Adjudication Assistant (per-claim edits / medical-necessity adjudication), the Coordination of Benefits agent (payer ORDER across coverages), the Claims Overpayment & Recovery agent (POST-payment clawback), the FWA Detection agent (suspected fraud), and the Utilization Review agent (medical necessity) — this decides one narrow, purely temporal question: was the claim FILED IN TIME. It is PHI-bearing (on the HIPAA audit policy — claims reference patient care). The filing limits + exceptions are illustrative, clearly labeled — NOT a certified timely-filing engine; real limits are governed by each payer's provider contract, Medicare (generally 12 months / 42 CFR 424.44), state Medicaid rules, and state prompt-pay law. Enforces, via the Pause Agent Fabric, that every decision cites a recorded filing-limit rule, the deadline is computed not guessed, and an untimely claim is never autonomously written off.",
  url: `${HOST}/api/agents/timely-filing`,
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
      id: "check-timely-filing",
      name: "Check whether a claim was filed in time",
      description:
        "Given a claim (a date of service, a submission date, and the cited payer filing-limit rule), deterministically computes the filing deadline (date of service + the rule's limit days), compares the submission date, honors a recognized exception when claimed, and decides the disposition. Every decision cites a recorded rule and a computed deadline; an untimely claim requires human review and is never autonomously written off.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "timely-filing",
        "claims",
        "payer-operations",
        "filing-deadline",
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
