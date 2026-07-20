import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the FWA Detection Agent — pattern-based
 * screening of claims / prior-auths for the SIU, paired with Claims
 * Adjudication (immediate mechanical edits) and Prior Auth (pre-service).
 *
 *   GET /api/agents/fwa-detection/.well-known/agent.json
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "fwa-detection-agent";

const CARD: A2AAgentCard = {
  name: "Fraud, Waste & Abuse Detection Agent",
  description:
    "Screens claims and prior-auths against a defined FWA pattern catalog (unbundling, upcoding, duplicate billing, quantity outliers, impossible-day billing, phantom services), classifies each hit by severity, and routes to the SIU (Special Investigations Unit) for HUMAN review. It NEVER autonomously denies a claim, opens an investigation, or freezes payment — every flagged claim goes to human review with due-process protections. The pattern-detection engine may NOT use protected-class attributes (race, ethnicity, religion, national origin, disability status, gender identity, sexual orientation, marital status) or provider-demographic proxies as detection factors — bias in FWA is a well-documented compliance failure that leads to consent decrees. Distinct from the Claims Adjudication Assistant (which AUTO-denies routine mechanical edits like NCCI-PTP unbundling with a specific reason code): FWA is about SUSPICIOUS PATTERNS that need investigation, not mechanical catalog edits. It is a DETERMINISTIC (no-Claude) agent: screening is a pure function of the claim + provider peer-baseline + pattern catalog + caller-provided asOfDate (no randomness, no clock), so the same context always yields the same flags + primary pattern + severity, with a documented severity precedence (high > medium > low) and stable pattern-id ordering. The pattern catalog, peer baselines, severity thresholds, and detection windows are illustrative/synthetic, clearly labeled — NOT SAS Detection and Investigation, LexisNexis Provider Insight, an actual payer SIU rule set, or a certified fraud-detection engine. Enforces, via the Pause Agent Fabric, that every flag traces to the catalog (no fabricated 'we-just-don't-like-this-provider' flags), that flagged claims go to SIU human review (no autonomous denials / investigations / payment freezes), and that pattern detection avoids protected-class factors (no bias in FWA).",
  url: `${HOST}/api/agents/fwa-detection`,
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
      id: "screen-claim-for-fwa-patterns",
      name: "Screen a claim / prior-auth against the FWA pattern catalog",
      description:
        "Given a claim + provider baseline (a synthetic providerRef + claimRef + memberRef, ISO asOfDate + date-of-service, claim lines, E/M level, units, peer baselines, prior submissions, daily service-minute totals, matching-EHR-encounter flag), returns a deterministic screening report — clear / flag-for-siu-review — with sorted applied patterns, primary pattern + severity, routing target (SIU standard vs. priority), and the hard invariants (investigationOpened:false, paymentFrozen:false — the agent NEVER autonomously acts on suspicion).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["fwa", "siu", "claims", "audit", "menopause"]
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
