import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "data-sharing-tefca-agent";

const CARD: A2AAgentCard = {
  name: "Data-Sharing / TEFCA Interoperability Agent",
  description:
    "Deterministic cross-organization data-sharing pipeline (TEFCA / Carequality / CommonWell / Direct Secure Messaging analog): for each cross-org PHI exchange request, classifies the exchange purpose (treatment / payment / operations / patient-request / public-health / research), verifies the counterparty is a Trusted Exchange Framework participant, applies the patient's data-sharing consent scopes from the Consent agent, and classifies as release-authorized / pend-purpose-verification / blocked-non-catalog-purpose / blocked-participant-unverified / blocked-consent-required-non-tpo. It NEVER autonomously releases PHI for a non-TPO purpose without an active consent scope (HIPAA §164.506). It NEVER releases to a counterparty whose identity is not attested against the participant registry (45 CFR 171 / TEFCA Common Agreement). Every classified exchange traces to the catalog. The exchange-network catalog, exchange-purpose catalog, rules, and reason codes are illustrative/synthetic, NOT an actual TEFCA QHIN implementation, the Carequality Interoperability Framework, the CommonWell Health Alliance node stack, or a certified ONC data-sharing gateway.",
  url: `${HOST}/api/agents/data-sharing-tefca`,
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
      id: "evaluate-data-sharing",
      name: "Evaluate a cross-org data-sharing request against the TEFCA / Carequality / CommonWell exchange purpose and consent catalog",
      description:
        "Given a data-sharing request (patientRef, requesterRef, networkId, purposeId, requesterIdentityVerified flag, consentedPurposeIds list, ISO asOfDate), returns a deterministic decision — release-authorized / pend-purpose-verification / blocked-non-catalog-purpose / blocked-participant-unverified / blocked-consent-required-non-tpo — with applied catalog rules, HIPAA §164.506 TPO flag, primary reason code, routing target, and cosign flags (NEVER autonomously cosigned).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["interoperability", "tefca", "carequality", "commonwell", "hipaa-164-506", "45-cfr-171"]
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
