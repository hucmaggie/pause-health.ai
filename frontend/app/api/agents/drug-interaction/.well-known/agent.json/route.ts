import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Drug–Drug Interaction (DDI) Safety Check agent — a clinical-decision
 * service on the patient / clinical plane.
 *
 *   GET /api/agents/drug-interaction/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "drug-interaction-agent";

const CARD: A2AAgentCard = {
  name: "Drug–Drug Interaction (DDI) Safety Check Agent",
  description:
    "A clinical-decision service on the patient / clinical plane — a DETERMINISTIC (no-Claude) agent that screens a PROPOSED medication against the patient's ACTIVE medication list for drug–drug interactions. UNLIKE the recent platform agents there is NO date math, NO dollar waterfall, and NO single-record exception classifier — the heart is a PAIRWISE KNOWLEDGE-BASE LOOKUP + a SEVERITY RANKING. Given a proposed / new drug and the patient's active medication list, it DETERMINISTICALLY pairs the proposed drug with each active medication, looks up every recorded interaction in the knowledge base, ranks them by severity (contraindicated > major > moderate > minor), reports the overall severity + mechanism + management, and decides the disposition (no-interaction-detected / monitor / review-recommended / review-required / do-not-coadminister-needs-review). The determination is a pure function of the request's own fields (no randomness, no clock), so the same proposed drug + active list always yields the same interactions + overall severity + disposition. Every reported interaction traces to a recorded knowledge-base record with a matching pair + severity (a fabricated / off-catalog interaction is blocked), the overall severity equals the highest cataloged severity among the detected interactions (an inflated or suppressed severity is blocked — the load-bearing correctness gate), and the order is never autonomously held (which could deny needed therapy) or the alert overridden (which could push through a contraindicated combination) — an autonomous hold / override is blocked. It COMPLEMENTS — it does not duplicate — the other clinical / medication agents: distinct from the Controlled Substance / PDMP agent (the TOTAL controlled-substance MME burden across prescribers), the Formulary & DUR Review agent (plan-level coverage / step therapy), the Medication Adherence agent (taking an already-prescribed drug), the Prior Authorization agent (assembling a PA package), and the Immunization agent (the vaccine schedule) — this screens whether a NEW drug INTERACTS with what the patient already takes. It is PHI-bearing (the screen references the patient's active medication list), so it is on the HIPAA-audit policy. The interaction knowledge base + severity assignments are illustrative, clearly labeled — NOT a certified clinical decision support system; real interaction checking uses a maintained compendium, normalized drug vocabularies (RxNorm), dose / route / timing context, patient-specific factors, and the pharmacist's / prescriber's clinical judgment. Enforces, via the Pause Agent Fabric, that every interaction is sourced, the overall severity is consistent, and the order is never autonomously held or the alert overridden.",
  url: `${HOST}/api/agents/drug-interaction`,
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
      id: "screen-drug-interactions",
      name: "Screen a proposed medication against the active list for interactions",
      description:
        "Given a proposed drug and the patient's active medication list, deterministically finds every recorded interaction, ranks them by severity, and decides the disposition (no-interaction-detected / monitor / review-recommended / review-required / do-not-coadminister-needs-review). Every interaction is sourced; the overall severity is consistent; the order is never autonomously held or the alert overridden.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "drug-interaction",
        "ddi",
        "medication-safety",
        "clinical-decision-support",
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
