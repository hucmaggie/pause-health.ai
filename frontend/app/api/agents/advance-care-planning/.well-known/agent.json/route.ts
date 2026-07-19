import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Advance Care Planning agent — a whole-person-
 * care ACP touchpoint agent for the midlife/menopause patient.
 *
 *   GET /api/agents/advance-care-planning/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "advance-care-planning-agent";

const CARD: A2AAgentCard = {
  name: "Advance Care Planning Agent",
  description:
    "Surfaces which advance directives (living will, DPOA-HC, POLST — POLST only when a serious-illness flag is on) are on file for a midlife/menopause patient, DETERMINISTICALLY flags missing / stale / off-source / language-access gaps against an illustrative directive catalog + approved-source list, and drafts a consent-gated conversation prompt for the care team to deliver. It is a whole-person-care ACP touchpoint agent — perimenopause / menopause is a natural midlife moment to hold this conversation, when the patient is engaged with the health system but not in acute illness — distinct from the Consent Management agent (data-use consent) and the Care Plan agent (active treatment planning). It is a DETERMINISTIC (no-Claude) agent: the assessment is a pure function of the caller-provided asOfDate + directives-on-file against the illustrative catalog (no randomness, no clock), so the same context always yields the same assessment. It NEVER creates, updates, or overrides a directive on its own — a directive is a legal / clinical instrument, and every directive change requires clinician AND patient sign-off. For a limited-English-proficiency (LEP) patient the agent defers to the Language Access & Health Equity agent and WITHHOLDS the active prompt (a safe completed answer, not a block) until a qualified-interpreter plan is documented — it will not ask a clinician to hold a legally-consequential conversation the patient cannot participate in. The directive catalog, approved-source labels, staleness threshold, and language handling are illustrative/synthetic, clearly labeled — NOT a certified advance-directives registry, a POLST/MOLST program, or a legal instrument. Enforces, via the Pause Agent Fabric, that every claimed directive on file traces to the catalog + an approved source + a recorded execution date (no fabricated directives inflating completeness), that every directive change requires clinician + patient sign-off (no autonomous directive changes), and that an LEP patient's active conversation is gated on a documented qualified-interpreter plan (no legally-consequential conversation in a language the patient cannot participate in).",
  url: `${HOST}/api/agents/advance-care-planning`,
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
      id: "assess-advance-care-planning",
      name: "Assess a patient's advance directives and draft a consent-gated conversation prompt",
      description:
        "Given a patient's structured context (a synthetic patientRef, preferred-language code, optional qualified-interpreter-planned flag, optional serious-illness flag, an as-of date accepted as data, and the directives claimed on file — each catalog-sourced with an approved source label and a recorded execution date), returns the per-directive status (on-file / on-file-stale / missing / not-applicable), an illustrative completeness percentage over the universally-recommended directives, the flagged ACP gaps, a consent-gated conversation prompt for the care team (WITHHELD for an LEP patient with no qualified-interpreter plan — a safe completed answer), and a clinician + patient sign-off gated directive-change proposal (NEVER autonomously applied).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["advance-care-planning", "ACP", "directives", "living-will", "DPOA-HC", "POLST", "midlife", "menopause", "whole-person-care"]
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
