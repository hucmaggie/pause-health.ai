import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Care Team & Case Management agent — a
 * care-coordination agent that assembles the multi-disciplinary team around
 * a single high-need menopause/midlife patient.
 *
 *   GET /api/agents/care-team/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "care-team-management-agent";

const CARD: A2AAgentCard = {
  name: "Care Team & Case Management Agent",
  description:
    "Assembles the multi-disciplinary care team around a single high-need menopause/midlife patient — PCP, MSCP, cardiology, endocrinology, bone-health, pelvic-floor PT, behavioral health — DETERMINISTICALLY resolves which roles are needed from the patient's active clinical needs against an illustrative role catalog + condition→role trigger map, assigns a case manager (a stable-hash pick from a synthetic pool), and emits a shared team snapshot. It is a care-coordination agent, distinct from the panel-level Population Health & Risk Stratification agent (which PRIORITIZES patients); it reuses the existing care-coordination tier. It is a DETERMINISTIC (no-Claude) agent: the assembly is a pure function of the patient's clinical needs + asOfDate (no randomness, no clock), so the same context always yields the same team + case manager + snapshot. It NEVER autonomously adds or removes a team member — every roster change is a case-manager sign-off gated proposal, mirroring the ACP Agent's directive-change and the HEDIS Agent's submission posture. The care-role catalog, condition→role triggers, case-manager pool, and member refs are illustrative/synthetic, clearly labeled — NOT a certified care-team schema, a real provider directory, or a case-management workflow engine. Enforces, via the Pause Agent Fabric, that every role on the roster and in the needed-roles set traces to the defined care-role catalog (no fabricated discipline labels or invented coverage), that every team change requires case-manager approval (no autonomous roster edits), and that a legitimate team includes a PCP anchor (no specialist-only assembly without an accountable primary-care owner).",
  url: `${HOST}/api/agents/care-team`,
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
      id: "assemble-care-team",
      name: "Assemble a multi-disciplinary care team + assign a case manager",
      description:
        "Given a patient's structured context (a synthetic patientRef, an asOfDate accepted as data, the patient's active clinical needs, and the members already on the roster — each catalog-sourced), returns the assembled roster ordered by role catalog order, the needed-roles set for this patient, per-role coverage, flagged gaps (with the PCP gap raised to urgent), a stable case-manager assignment, a shared team snapshot, and a case-manager-approval gated team-change proposal for the first open gap (NEVER autonomously applied).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["care-team", "case-management", "care-coordination", "multi-disciplinary", "menopause", "midlife"]
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
