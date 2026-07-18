import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Clinical Trials & Research Matching agent — the
 * Salesforce "Agentforce for Health" / Health Cloud clinical-trials /
 * research-matching analog.
 *
 *   GET /api/agents/clinical-trials/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "clinical-trials-agent";

const CARD: A2AAgentCard = {
  name: "Clinical Trials & Research Matching Agent",
  description:
    "Matches a single menopause/midlife patient against a SYNTHETIC catalog of research studies / clinical trials using STRUCTURED eligibility criteria (age band, symptom profile, comorbidities, geography, prior therapy, HRT status, postmenopausal status), returns the matching studies ranked with per-criterion match explanations, and drafts a CONSENT-GATED outreach — it NEVER auto-enrolls a patient (informed consent + a human are required) — the Salesforce 'Agentforce for Health' / Health Cloud clinical-trials / research-matching analog. It is a DETERMINISTIC (no-Claude) agent: eligibility is a pure function of the patient context against each study's DEFINED criteria (no randomness, no clock), so the same context always yields the same matches + ranking (with a stable, documented tie-break). It ties to the Consent & Preferences Management agent's `research` consent scope — it defers to that authoritative research-consent state before drafting any outreach — but does its own eligibility logic. The study catalog, sponsor labels, and eligibility criteria are illustrative/synthetic, clearly labeled — NOT real studies, real sponsors, or a certified trial-eligibility engine. Enforces, via the Pause Agent Fabric, that every eligibility determination traces to a defined study criterion (no fabricated / ad-hoc eligibility), that trial outreach is research-consent-gated (no outreach / enrollment without the patient's research consent), and that the agent never enrolls a patient autonomously (enrollment requires informed consent + a human).",
  url: `${HOST}/api/agents/clinical-trials`,
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
      id: "match-trials",
      name: "Match a patient against a synthetic research-study catalog + draft consent-gated outreach",
      description:
        "Given a patient's structured context (age band, symptom profile, comorbidities, geography, prior therapy, HRT status, postmenopausal status), returns the synthetic studies ranked with per-criterion match explanations tracing to defined eligibility criteria, the eligible count and recommended study ids, and a consent-gated outreach draft that never auto-enrolls — an active outreach is drafted only when the patient's research consent is present, otherwise it is withheld; enrollment always requires informed consent + a human.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["clinical-trials", "research-matching", "eligibility", "consent", "menopause", "care-coordination"]
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
