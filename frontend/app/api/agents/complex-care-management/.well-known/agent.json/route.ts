import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Complex Care Management Agent — the
 * reimbursable time-tracking piece of care management, paired with the
 * Care Team and Care Plan agents.
 *
 *   GET /api/agents/complex-care-management/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "complex-care-management-agent";

const CARD: A2AAgentCard = {
  name: "Complex Care Management Agent",
  description:
    "Runs the REIMBURSABLE time-tracking piece of a Medicare CCM program for high-need midlife/menopause patients. Deterministically confirms CCM eligibility (2+ catalog-sourced chronic conditions, Medicare-eligible age, coverage flag on file, patient consent documented), tracks per-activity monthly time entries against a defined CCM activity catalog (medication reconciliation, care-plan update, patient communication, referral follow-up, care-team coordination, patient education, resource navigation), maps the monthly total to the CPT ladder (99490 non-complex 20-39min → 99491 non-complex 40-59min → 99487 complex 60-89min → 99489 complex ≥90min with moderate/high complexity), and assembles a billing package for HUMAN quality-team review. It NEVER autonomously submits a CCM claim to CMS. Every logged minute must trace to a catalog activity and the reported total must equal the sum of the per-entry minutes — phantom-minute inflation is the classic CCM audit finding this closes. It is a DETERMINISTIC (no-Claude) agent: eligibility, time totals, and CPT selection are pure functions of the caller-provided context (no randomness, no clock), so the same context always yields the same eligibility + time summary + CPT selection + billing package. It is distinct from the Care Team & Case Management agent (multi-disciplinary team assembly around a patient) and the Care Plan agent (treatment content) — this one is the reimbursable time-tracking piece paired with them. The chronic-condition catalog, CCM activity catalog, CPT thresholds, and Medicare eligibility flags are illustrative/synthetic, clearly labeled — NOT CMS Chapter 12 / MLN Booklet 909188 CCM billing, an actual CPT coding manual, or a live Medicare claim-submission system. Enforces, via the Pause Agent Fabric, that every eligibility claim traces to the catalog (no fabricated chronic conditions), that every CCM claim requires human quality-team approval (no autonomous CMS submission), and that every logged minute traces to a catalog activity + sums correctly to the reported total (no phantom minutes).",
  url: `${HOST}/api/agents/complex-care-management`,
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
      id: "assemble-ccm-month-report",
      name: "Assemble a Medicare CCM month report: eligibility + time + CPT-coded billing package",
      description:
        "Given a monthly CCM context (a synthetic patientRef, ISO month string, age, Medicare-coverage flag, consent flag, chronic conditions from the catalog, and per-activity time entries), returns a deterministic report — eligibility outcome with the qualifying conditions cited from the catalog, per-activity time summary sorted for a stable display, CPT-code selection from the illustrative ladder (99490 → 99491 → 99487 → 99489), and a human-quality-team-approval gated billing package (NEVER autonomously submitted).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["ccm", "complex-care-management", "medicare", "cpt-99490", "care-coordination", "menopause"]
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
