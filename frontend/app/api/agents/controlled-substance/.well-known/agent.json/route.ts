import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Controlled Substance / PDMP Safety Check agent — the
 * clinical-decision service that screens a proposed controlled-substance prescription against the
 * patient's PDMP history.
 *
 *   GET /api/agents/controlled-substance/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "controlled-substance-agent";

const CARD: A2AAgentCard = {
  name: "Controlled Substance / PDMP Safety Check Agent",
  description:
    "The controlled-substance safety layer of the Pause patient & clinical plane — a DETERMINISTIC (no-Claude) clinical-decision service. Given a proposed controlled-substance prescription (a drug, its class, its dose in MME/day, days supply, prescriber, pharmacy) and the patient's active PDMP (Prescription Drug Monitoring Program) history, it DETERMINISTICALLY sums the total opioid MME/day (morphine milligram equivalents; proposed + concurrent), flags a concurrent opioid+benzodiazepine combination (a respiratory-depression risk) and multi-prescriber / multi-pharmacy patterns, compares the total against the cited guideline's caution (50 MME/day) and high-risk (90 MME/day) thresholds, and classifies the risk (low / elevated / high). The finding is a pure function of the request's data + the cited guideline (no randomness, no clock), so the same request always yields the same total / risk / disposition. Every finding cites a recorded guideline (an ad-hoc / un-sourced threshold is blocked), the total MME/day is computed and never guessed (a total that does not match the proposed + concurrent sum is blocked — the load-bearing correctness gate), and a risk finding is NEVER an autonomous prescribing decision — the agent never approves, denies, dispenses, or writes the prescription; an elevated / high finding requires prescriber review (an auto-decided / unreviewed finding is blocked). It COMPLEMENTS — it does not duplicate — the other clinical / medication agents: distinct from the Formulary & DUR Review agent (plan-level coverage, step therapy, and drug-utilization-review alerts), the Medication Adherence agent (taking an already-prescribed drug), the Prior Authorization agent (assembling a payer PA package), and the Immunization Forecasting agent (vaccine schedule) — this screens the TOTAL controlled-substance burden across ALL prescribers per the PDMP. It is PHI-bearing (on the HIPAA audit policy — it screens a patient's controlled-substance history). The MME thresholds + figures are illustrative, clearly labeled — NOT a certified PDMP or clinical decision support; real monitoring uses the state PDMP, the CDC MME conversion factors, the CDC 2022 Clinical Practice Guideline for Prescribing Opioids, and the prescriber's clinical judgment. Enforces, via the Pause Agent Fabric, that every finding cites a recorded guideline, the total MME/day is computed not guessed, and a risk finding never makes an autonomous prescribing decision.",
  url: `${HOST}/api/agents/controlled-substance`,
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
      id: "screen-controlled-substance",
      name: "Screen a controlled-substance prescription against the PDMP",
      description:
        "Given a proposed controlled-substance prescription and the patient's active PDMP history, deterministically sums the total opioid MME/day, flags a concurrent opioid+benzodiazepine combination and multi-prescriber / multi-pharmacy patterns, compares the total against the cited guideline's thresholds, and classifies the risk. Every finding cites a recorded guideline and a computed MME total; an elevated / high finding requires prescriber review and is never an autonomous prescribing decision.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "controlled-substance",
        "pdmp",
        "opioid",
        "mme",
        "clinical-decision",
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
