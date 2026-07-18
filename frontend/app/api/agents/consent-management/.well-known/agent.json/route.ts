import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Consent & Preferences Management agent — the
 * MuleSoft control-plane / data-substrate consent service, the authoritative
 * consent ledger the rest of the fabric's consent gates defer to.
 *
 *   GET /api/agents/consent-management/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "consent-management-agent";

const CARD: A2AAgentCard = {
  name: "Consent & Preferences Management Agent",
  description:
    "The AUTHORITATIVE, cross-cutting consent & communication-preferences service the rest of the Pause Agent Fabric's consent-before-outreach / consent-before-referral / consent-to-monitor gates logically defer to — the MuleSoft control-plane / data-substrate analog. Unlike every other agent (which CONSUMES consent), this one is the SOURCE OF TRUTH FOR consent: it holds, per patient, a consent LEDGER (a set of consent scopes — contact-outreach, data-sharing, remote-monitoring, research, marketing — each with a status: granted / withheld / revoked, a recorded basis/source, a timestamp, and an optional expiry) plus communication PREFERENCES (allowed channels sms/email/voice, quiet hours, preferred language, frequency cap), and answers one DETERMINISTIC question via evaluateConsent — 'may this patient be contacted / have data used for this scope over this channel at this time?' — denying a withheld / revoked / expired / unrecorded scope, an unpermitted channel, a quiet-hours touch, or a frequency-cap breach, and otherwise allowing, citing the consent record it relied on. The decision is a pure function of the ledger + the query's own atTime + priorTouches (no randomness, no clock), so the same inputs always yield the same decision. It is a control-plane / data-substrate service (platform plane), NOT a live-Claude agent. The scopes + recorded sources + preferences + patient references are illustrative/synthetic, clearly labeled — NOT a certified consent-management system. Enforces, via the Pause Agent Fabric, that every consent state traces to a recorded consent event/basis (no asserted-but-unrecorded consent), that a revoked / expired consent is honored immediately (a decision may never allow against it), and that a decision never overrides a withheld scope or borrows consent across scopes.",
  url: `${HOST}/api/agents/consent-management`,
  provider: {
    organization: "MuleSoft Anypoint (via Pause-Health.ai)",
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
      id: "evaluate-consent",
      name: "Evaluate a consent decision from the authoritative consent ledger",
      description:
        "Given a patient's consent ledger (scopes + statuses + recorded bases + optional expiries) and communication preferences (allowed channels, quiet hours, preferred language, frequency cap), plus a query (scope, channel, atTime, priorTouches), returns a deterministic consent decision — allowed/denied with a reason, citing the consent record it relied on. Denies a withheld / revoked / expired / unrecorded scope, an unpermitted channel, a quiet-hours touch, or a frequency-cap breach; a revocation / expiry is honored immediately and no scope is overridden.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["consent", "preferences", "governance", "control-plane", "data-substrate", "privacy"]
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
