import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Break-the-Glass / Emergency Access Governance
 * agent — the MuleSoft control-plane / data-substrate security service, the
 * emergency-access governance layer of the data substrate.
 *
 *   GET /api/agents/break-the-glass/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "break-the-glass-agent";

const CARD: A2AAgentCard = {
  name: "Break-the-Glass / Emergency Access Governance Agent",
  description:
    "The emergency-access governance layer of the Pause data substrate — the MuleSoft control-plane / data-substrate security service. Governs emergency 'break-the-glass' override access to PHI: given an ACCESS REQUEST (requester role, target patient, stated purpose, an emergency flag, and a free-text clinical justification), it DETERMINISTICALLY decides whether to grant emergency access, and if so returns a TIME-BOXED, MINIMUM-NECESSARY grant — a scoped field set (never the full chart) plus an expiry derived from the request's own time — ALWAYS emitting a mandatory audit event and flagging the grant for mandatory post-access review. The decision is a pure function of the request + its own atTime (no randomness, no clock), so the same request always yields the same grant/deny + scope + expiry + audit id. It NEVER grants standing / broad / full-record access and never grants without a recorded justification. A DENY (no emergency declared, no recorded justification, or an off-catalog purpose with no derivable scope) is a SAFE, completed answer — NOT a block. It COMPLEMENTS — it does not duplicate — the other platform agents: distinct from the Consent & Preferences Management agent (patient consent scopes for outreach / data-sharing) and the Master Patient Index (identity / dedup), this governs EMERGENCY clinician access to PHI under the HIPAA minimum-necessary + audit requirements. It is a control-plane / data-substrate service (platform plane), NOT a live-Claude agent. The purpose catalog + minimum-necessary scopes + access durations + audit ids are illustrative/synthetic, clearly labeled — NOT a certified break-the-glass / emergency-access system. Enforces, via the Pause Agent Fabric, that no emergency access is granted without a recorded clinical justification, that every grant is minimum-necessary and time-boxed (never standing / full-record / non-expiring), and that every emergency access is logged and flagged for mandatory post-access review.",
  url: `${HOST}/api/agents/break-the-glass`,
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
      id: "evaluate-emergency-access",
      name: "Evaluate an emergency break-the-glass access request",
      description:
        "Given an emergency-access request (requester role, target patient, stated purpose, emergency flag, and a free-text clinical justification), deterministically decides whether to grant break-the-glass access, and if so returns a time-boxed, minimum-necessary grant (a scoped field set + a derived expiry) — always emitting a mandatory audit event and flagging the grant for mandatory post-access review. It never grants standing / broad / full-record access and never grants without a recorded justification; a deny is a safe, completed answer.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["break-the-glass", "emergency-access", "minimum-necessary", "hipaa", "audit", "governance", "control-plane", "data-substrate"]
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
