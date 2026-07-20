import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "trial-payments-agent";

const CARD: A2AAgentCard = {
  name: "Clinical Trial Payments & Stipends Agent",
  description:
    "Deterministic clinical-trial payments pipeline: for each participant visit, looks up the IRB-approved compensation schedule, verifies research-payment informed consent is on file, computes the stipend + travel reimbursement, and routes non-standard payments (missed visit, out-of-range travel, extra procedure) to the study coordinator for cosign. Pairs with the Clinical Trials Matching agent (which selects candidates) — this handles the reimbursable/regulated payments side. It NEVER autonomously deviates from an IRB-approved schedule; every non-standard payment is DRAFTED for study-coordinator cosign. It NEVER issues a payment to a non-consented participant — the safe answer when consent is missing is blocked-no-consent with zero payment (Common Rule / 45 CFR 46 requirement). Every payment traces to the catalog (trial + visit type + rule + reason code). The trial catalog, IRB payment schedules, visit types, rules, and travel rates are illustrative/synthetic, NOT IRBNet, WCG IRB, Advarra IRB, or an actual sponsor's payment protocol.",
  url: `${HOST}/api/agents/trial-payments`,
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
      id: "evaluate-trial-payment",
      name: "Evaluate a clinical-trial payment against the IRB-approved schedule",
      description:
        "Given a payment request (participantRef, trialId, visitTypeId, visitOutcome, travel miles, consent flag, extra-procedure flag, ISO asOfDate), returns a deterministic decision — schedule-approved / pend-coordinator-review / blocked-no-consent — with the computed stipend + travel amounts, applied catalog rules, primary reason code, routing target, and cosign flags (NEVER autonomously cosigned).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["clinical-trials", "irb", "participant-payments", "menopause", "45-CFR-46"]
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
