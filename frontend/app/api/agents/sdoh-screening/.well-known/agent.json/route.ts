import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";
import { ALLOWLISTED_SDOH_SCREENERS } from "../../../../../../lib/sdoh";

/**
 * Google A2A Agent Card for the Agentforce SDOH Screening Agent (the
 * Salesforce "Agentforce for Health" whole-person-care analog).
 *
 *   GET /api/agents/sdoh-screening/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric
 * registry (appliesTo) rather than hand-listed, so the discovery
 * document can't drift from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "sdoh-screening-agent";

const CARD: A2AAgentCard = {
  name: "Agentforce SDOH Screening Agent",
  description: `Screens a patient for health-related social needs / social determinants of health with a validated, public-domain instrument (${ALLOWLISTED_SDOH_SCREENERS.join(
    ", "
  )} — the CMS Accountable Health Communities HRSN core-domain tool: housing instability, food insecurity, transportation needs, utility needs, interpersonal safety) using real rule-based scoring (no LLM). It deterministically flags the positive social-need domains, escalates a positive interpersonal-safety screen to a human social worker as a mandatory red flag, and drafts CONSENT-GATED community-resource referrals (211, food bank, housing/utility assistance, a domestic-violence hotline) — never an autonomous enrollment. Enforces a validated-screener allow-list and a patient-consent-before-referral gate via the Pause Agent Fabric. The community-resource catalog is illustrative/synthetic, NOT a live directory of real programs.`,
  url: `${HOST}/api/agents/sdoh-screening`,
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
      id: "screen-social-needs",
      name: "Screen health-related social needs and draft community referrals",
      description:
        "Given a validated SDOH screener id (ahc-hrsn) and its per-domain coded responses (plus whether the patient consented to a community referral), returns a deterministically screened result: per-domain positive/negative determination, a count of positive social-need domains, any interpersonal-safety red flag (a mandatory human-social-worker escalation), and consent-gated, catalog-sourced community-resource referral drafts — human-approval-gated and never an autonomous enrollment.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["sdoh", "hrsn", "whole-person-care", "patient-facing", "validated-instrument"]
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
