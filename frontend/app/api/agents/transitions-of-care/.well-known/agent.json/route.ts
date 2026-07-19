import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Discharge & Transitions of Care agent — a
 * care-coordination agent that closes the loop back to primary care after a
 * hospitalization / ED visit for a menopause/midlife patient.
 *
 *   GET /api/agents/transitions-of-care/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "transitions-of-care-agent";

const CARD: A2AAgentCard = {
  name: "Discharge & Transitions of Care Agent",
  description:
    "Closes the loop back to primary care after a hospitalization / ED / observation encounter for a menopause/midlife patient. DETERMINISTICALLY reconciles the discharge medication list against the pre-admit list (added / removed / dose-changed / unchanged, each tracing to an approved medication source), books (or drafts an appointment-request handoff to the Appointment Scheduling agent for) the follow-up appointment — never a text recommendation, pulls the encounter-reason red-flag warning signs from an illustrative catalog, emits a universal teach-back checklist, and assembles the PCP handoff summary. It is a care-coordination agent, distinct from the Care Plan Agent (active treatment planning), the Medication Adherence Agent (nudge-only refill / adherence prompts), and the Referral Management Agent (specialist triage) — this one runs the CLOSE-THE-LOOP workflow after an acute event, reusing the existing care-coordination tier. It is a DETERMINISTIC (no-Claude) agent: the package is a pure function of the patient context + discharge date + provided medication lists (no randomness, no clock; timestamps are accepted as data), so the same context always yields the same reconciliation + red-flag list + teach-back checklist + PCP summary. It NEVER autonomously commits a medication change — every add / remove / dose-change is a clinician-signoff gated proposal, mirroring the ACP Agent's directive-change and the Medication Adherence Agent's refill posture. The encounter categories, red-flag catalog, approved-source labels, follow-up window (14 days), and teach-back items are illustrative/synthetic, clearly labeled — NOT a certified TOC schema, a real ADT / discharge system, or a clinical-guideline registry. Enforces, via the Pause Agent Fabric, that every medication on the reconciliation cites an approved source (no fabricated meds slipping in), that every medication change requires clinician sign-off (no autonomous med changes), and that the follow-up is a scheduled slot or an explicit awaiting-schedule handoff (no 'recommended' follow-ups masquerading as complete — the classic 30-day-readmission failure mode this guard closes).",
  url: `${HOST}/api/agents/transitions-of-care`,
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
      id: "assemble-transitions-of-care-package",
      name: "Assemble a post-encounter transitions-of-care package + PCP handoff",
      description:
        "Given a patient's structured context (a synthetic patientRef, an ISO discharge date accepted as data, the encounter kind, an encounter-reason category, the pre-admit and discharge medication lists — each catalog-sourced with an approved source label, and an optional scheduled follow-up), returns a medication reconciliation (added / removed / dose-changed / unchanged), a scheduled follow-up or awaiting-schedule handoff, the encounter-reason red-flag warning signs, a universal teach-back checklist, a PCP handoff summary, and a clinician-signoff gated reconciliation-change proposal for the first added / dose-changed medication (NEVER autonomously applied).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["transitions-of-care", "TOC", "discharge", "medication-reconciliation", "follow-up", "care-coordination", "menopause"]
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
