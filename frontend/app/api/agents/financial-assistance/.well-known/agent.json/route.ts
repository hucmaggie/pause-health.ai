import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Patient Financial Assistance & Charity Care agent — the
 * patient-access service that screens a self-pay / underinsured patient for hospital
 * financial assistance (charity care) under an IRS 501(r) FAP.
 *
 *   GET /api/agents/financial-assistance/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "financial-assistance-agent";

const CARD: A2AAgentCard = {
  name: "Patient Financial Assistance & Charity Care Agent",
  description:
    "The patient-access / charity-care layer of the Pause patient & clinical plane — a provider-side patient-financial-experience service, a sibling to the Benefits & Coverage Verification (EBV) agent. Given a household size + annual income (plus the FPL guideline year, an optional presumptive-eligibility signal, whether the FAP application is complete, and whether an extraordinary collection action is being requested), it DETERMINISTICALLY computes the household's income as a percentage of the Federal Poverty Level (from the household size's FPL base), cites the governing FAP tier from a schedule, and classifies the patient as full-charity / partial-charity / not-eligible with a discount percentage under an IRS 501(r) Financial Assistance Policy. The determination is a pure function of the household size + income + FPL year + the request's own flags (no randomness, no clock), so the same household always yields the same tier + discount + eligibility. It NEVER autonomously DENIES assistance: a not-eligible determination is a RECOMMENDATION requiring human review with written notice + appeal rights (501(r)(4)), and an extraordinary collection action (ECA) may NEVER proceed before financial screening is complete (501(r)(6)). It COMPLEMENTS — it does not duplicate — the Benefits & Coverage Verification / EBV agent (which verifies plan eligibility + estimates the covered visit cost): this screens the patient-responsibility remainder for CHARITY CARE, and is also distinct from the SDOH Screening agent (health-related social needs). It is a patient-access service (patient & clinical plane), PHI-bearing (on the HIPAA audit policy), NOT a live-Claude agent. The FAP tier schedule, discount percentages, FPL table, and presumptive-eligibility reasons are illustrative/synthetic, clearly labeled — NOT a certified financial-assistance system; real hospital FAPs are governed by IRS 501(r) / 26 CFR 1.501(r), the HHS Federal Poverty Guidelines, and each hospital's Board-approved FAP + state charity-care law. Enforces, via the Pause Agent Fabric, that no collection action precedes screening, that every determination cites a recorded FAP tier, and that a denial is never autonomous (it is human-review-gated).",
  url: `${HOST}/api/agents/financial-assistance`,
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
      id: "screen-financial-assistance",
      name: "Screen a patient for charity care under a 501(r) FAP",
      description:
        "Given a household size + annual income (plus the FPL year, an optional presumptive-eligibility signal, whether the FAP application is complete, and whether an extraordinary collection action is being requested), deterministically computes the household's income as a percentage of the Federal Poverty Level, cites the governing FAP tier, and classifies the patient as full-charity / partial-charity / not-eligible with a discount percentage. A collection action never precedes complete screening; a not-eligible determination is a denial requiring human review with written notice + appeal rights — the agent never autonomously denies charity care.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "financial-assistance",
        "charity-care",
        "501r",
        "federal-poverty-level",
        "patient-access",
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
