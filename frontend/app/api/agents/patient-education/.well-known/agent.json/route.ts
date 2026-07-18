import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Patient Education & Health Coaching Agent — a
 * patient-facing engagement-tier agent that delivers personalized,
 * evidence-sourced menopause/midlife education + lifestyle coaching.
 *
 *   GET /api/agents/patient-education/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "patient-education-agent";

const CARD: A2AAgentCard = {
  name: "Patient Education & Health Coaching Agent",
  description:
    "Patient-facing engagement agent that turns already-produced signals (intake symptoms/severity, an optional validated-instrument assessment, Care Plan focus areas, and detected care gaps) into personalized, evidence-sourced menopause/midlife education (bone health, cardiovascular risk, sleep hygiene, vasomotor self-management, mood/stress, nutrition, physical activity) and a warm, motivational coaching message. Distinct from the clinician-authored Care Plan agent and the refill-focused Medication Adherence agent — it only EDUCATES and COACHES. Module SELECTION is DETERMINISTIC (a pure function of the inputs against a defined evidence-sourced catalog — no randomness, no clock), and every module references a defined catalog id AND carries a (synthetic) source label — never a fabricated topic. The coaching message is generated with live Anthropic Claude — the FOURTH live-Claude agent on Pause's Agent Fabric — falling back to a DETERMINISTIC scripted message (with a recorded fallbackReason) when ANTHROPIC_API_KEY is unset or the API call fails. The education modules + source labels (The Menopause Society, USPSTF, NAMS/ACOG-style) are illustrative/synthetic, clearly labeled — NOT a certified patient-education engine. Enforces, via the Pause Agent Fabric, that every module traces to a defined evidence source, that coaching stays strictly within general education scope (no diagnosis, medication dosing, or individualized medical advice), that any coaching outreach is consent-gated + human-approval-gated, and that the serving model is on the approved allow-list (Claude Sonnet / Opus).",
  url: `${HOST}/api/agents/patient-education`,
  provider: {
    organization: "Anthropic (via Pause-Health.ai)",
    url: "https://pause-health.ai"
  },
  version: "0.1.0",
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true
  },
  defaultInputModes: ["data"],
  defaultOutputModes: ["text", "data"],
  skills: [
    {
      id: "curate-and-coach-education",
      name: "Curate evidence-sourced education + coach the patient",
      description:
        "Given the intake symptoms/severity + upstream Care Plan focus areas + detected care gaps, returns a menopause/midlife education curriculum selected DETERMINISTICALLY from a defined evidence-sourced catalog — each module referencing a defined catalog id (bone health, cardiovascular, sleep hygiene, vasomotor, mood/stress, nutrition, physical activity) with general key points and a synthetic source label — plus a warm, motivational coaching message generated with live Anthropic Claude and a deterministic scripted fallback (via + fallbackReason recorded). General education only; coaching outreach is consent-gated and human-approval-gated.",
      inputModes: ["data"],
      outputModes: ["text", "data"],
      tags: [
        "patient-education",
        "health-coaching",
        "menopause",
        "engagement",
        "claude",
        "lifestyle"
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
