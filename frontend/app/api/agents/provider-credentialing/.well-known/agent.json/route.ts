import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Provider Credentialing & Directory agent —
 * a network-integrity agent that verifies a provider's credentialing status
 * and gates every referral / scheduling attempt at the network boundary.
 *
 *   GET /api/agents/provider-credentialing/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "provider-credentialing-agent";

const CARD: A2AAgentCard = {
  name: "Provider Credentialing & Directory Agent",
  description:
    "Verifies a provider's credentialing status (state license, DEA, board certification, sanctions clearance, NPI) against approved verification sources, maintains the (illustrative) directory profile, and gates every referral / scheduling attempt at the network boundary — a referral to an expired / incomplete / sanctioned provider is blocked here, and a directory response past the No-Surprises-Act 90-day accuracy window is not returned as authoritative. It sits alongside the data substrate (MuleSoft integration + Data 360 grounding) — the Referral Management, Appointment Scheduling, and Transitions of Care agents can consult this agent for a deterministic yes/no before they hand off. It is a DETERMINISTIC (no-Claude) agent: verification is a pure function of the credentials + directory profile + caller-provided asOfDate (no randomness, no clock; timestamps are accepted as data), so the same context always yields the same status + gate flags with a stable, documented precedence (sanctioned > incomplete > expired > verified). Fabricating a 'verified' status from a verbal / self-reported / undocumented source is impossible — every credential must trace to an approved source, and a sanctioned provider is caught even when other credentials look complete. The catalog, verification sources, NSA freshness window (90 days), and directory schema are illustrative/synthetic, clearly labeled — NOT NCQA / CAQH credentialing, a real state-medical-board API, an OIG-LEIE sanction feed, or a live directory. Enforces, via the Pause Agent Fabric, that every credential cites an approved verification source (no fabricated 'verified' status), that the fabric never hands a referral or booking to an expired / incomplete / sanctioned provider (no ghost network), and that a directory response returned as authoritative satisfies the No-Surprises-Act 90-day freshness window.",
  url: `${HOST}/api/agents/provider-credentialing`,
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
      id: "verify-provider-credentialing-and-directory",
      name: "Verify a provider's credentialing status and gate every referral / scheduling attempt",
      description:
        "Given a provider verification request (a synthetic providerRef, an ISO asOfDate accepted as data, an optional intent flag — directory-lookup / referral / scheduling — the credentials on file each citing an approved verification source, and the directory-side profile), returns the verified record with per-credential expiry / source flags, the directory freshness flag, an overall status (verified / incomplete / expired / sanctioned), and gate flags (canReferPatient / canBookAppointment / canReturnInDirectoryResponse) other agents can consult before handing off.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["credentialing", "provider-directory", "network-integrity", "no-surprises-act", "menopause"]
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
