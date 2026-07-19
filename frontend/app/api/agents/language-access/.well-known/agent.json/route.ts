import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Language Access & Health Equity agent — a
 * patient-care EQUITY agent that ensures limited-English-proficiency (LEP)
 * patients can understand their care.
 *
 *   GET /api/agents/language-access/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "language-access-agent";

const CARD: A2AAgentCard = {
  name: "Language Access & Health Equity Agent",
  description:
    "Ensures limited-English-proficiency (LEP) patients can understand their care: it DETERMINISTICALLY determines the patient's PREFERRED LANGUAGE (deferring in copy to the Consent & Preferences Management agent's preferred-language preference), decides whether a QUALIFIED MEDICAL INTERPRETER is required and of which modality (in-person / video / phone), checks whether the needed PATIENT MATERIALS exist in that language (from an approved translated-materials catalog, each with a translation-provenance label), and FLAGS EQUITY / ACCESS GAPS (no qualified interpreter available for a language, a consent form only in English) — a patient-care health-equity / access agent, distinct from the SDOH, consent, and clinical agents. It is a DETERMINISTIC (no-Claude) agent: the assessment is a pure function of the patient's structured context against the supported-language + approved-materials catalogs (no randomness, no clock), so the same context always yields the same assessment (with a stable, documented equity-gap ordering). It NEVER substitutes machine translation or an untrained / family interpreter for clinical communication or consent — when no qualified interpreter is available it escalates to a human language-access coordinator (a safe answer), never an unqualified fallback. The supported-language list, interpreter availability, translated-materials catalog, and translation-provenance labels are illustrative/synthetic, clearly labeled — NOT a certified language-access system. Enforces, via the Pause Agent Fabric, that clinical interpretation uses a qualified medical interpreter only (no untrained / ad-hoc / family interpreter for clinical communication), that in-language materials trace to the approved translated-materials catalog (no unverified / ad-hoc translation presented as official), and that machine translation is never used for clinical consent or clinical decision communication.",
  url: `${HOST}/api/agents/language-access`,
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
      id: "assess-language-access",
      name: "Assess language access + arrange a qualified interpreter for an LEP patient",
      description:
        "Given a patient's structured context (a synthetic patientRef plus the preferred-language code, needed materials, and whether a clinical consent step is involved), returns the resolved preferred language, whether a qualified medical interpreter is required and of which modality, the per-material in-language availability tracing to the approved translated-materials catalog, the flagged equity / access gaps, and a qualified-interpreter arrangement — an equity-gap escalation to a human coordinator (never an unqualified fallback) when no qualified interpreter is available; clinical consent is never machine-translated.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["language-access", "health-equity", "interpreter", "translation", "LEP", "menopause", "whole-person-care"]
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
