import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Risk Adjustment & HCC Coding agent — a patient-
 * care clinical-documentation-integrity agent for value-based care.
 *
 *   GET /api/agents/risk-adjustment/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "risk-adjustment-agent";

const CARD: A2AAgentCard = {
  name: "Risk Adjustment & HCC Coding Agent",
  description:
    "A clinical-documentation-integrity agent for value-based care: it DETERMINISTICALLY reviews a patient's synthetic clinical context and identifies suspected / confirmed HIERARCHICAL CONDITION CATEGORIES (HCCs) for risk adjustment, mapping each to the documented clinical evidence that supports it, computes a RAF-style risk score from the confirmed set, and flags coding gaps (suspected-but-unconfirmed conditions) and unsupported / over-coded entries. It COMPLEMENTS — it does NOT duplicate — the quality agents (HEDIS & Quality Reporting, Quality-Measure Attribution): those score quality MEASURES, this is risk-adjustment CONDITION coding. It is a DETERMINISTIC (no-Claude) agent: the assessment is a pure function of the structured clinical context against the HCC + supporting-evidence catalogs (no randomness, no clock), so the same context always yields the same assessment. It is a RECOMMENDER + integrity checker: every suspected code is a recommendation carrying requiresClinicianValidation:true, and it NEVER autonomously submits codes or adjusts a claim / RAF (submitted:false). A coding gap (a suspected HCC) and an unsupported / over-coded flag are SAFE, honest outputs surfaced for a clinician to validate / correct — they are NOT governance blocks. The HCC catalog, illustrative RAF weights, and supporting-evidence catalog are illustrative/synthetic, clearly labeled — NOT the certified CMS-HCC model, real RAF coefficients, ICD-10 → HCC crosswalks, or a certified coding engine. Enforces, via the Pause Agent Fabric, that every confirmed / suspected HCC traces to documented clinical evidence (no upcoding), that a suspected code is only finalized after clinician validation, and that the agent never autonomously submits a code or adjusts a claim.",
  url: `${HOST}/api/agents/risk-adjustment`,
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
      id: "assess-risk-adjustment",
      name: "Suspect HCCs + compute a RAF-style score + flag coding gaps for a patient",
      description:
        "Given a patient's structured clinical context (a synthetic patientRef plus the documented supporting-evidence signals and the HCCs that already carry a confirmed diagnosis code), returns the confirmed / suspected / unsupported HCCs (each tracing to the documented clinical evidence that supports it), a RAF-style risk score computed from the confirmed set, the suspected coding gaps for a clinician to validate and code, and the unsupported / over-coded flags for a clinician to correct. Every suspected code is a recommendation requiring clinician validation; the agent never autonomously submits codes or adjusts a claim.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "risk-adjustment",
        "hcc",
        "coding",
        "raf",
        "value-based-care",
        "documentation-integrity",
        "menopause",
        "care-coordination"
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
