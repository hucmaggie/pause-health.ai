import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the HEDIS & Quality Reporting agent — a
 * panel-level quality-reporting agent that rolls per-patient signals into
 * HEDIS / Star measure compliance for value-based-care contracts.
 *
 *   GET /api/agents/hedis-quality/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "hedis-quality-agent";

const CARD: A2AAgentCard = {
  name: "HEDIS & Quality Reporting Agent",
  description:
    "Rolls per-patient signals across a menopause/midlife panel into HEDIS / Star measure compliance for value-based-care contracts — numerator, denominator, catalog-sourced exclusions, and compliance rate per measure, plus a submission package assembled for human quality-team review. It is a panel-level quality-reporting agent, distinct from the single-patient Care Gap Closure Agent (which drafts outreach for one patient's gaps) and the panel-level Population Health & Risk Stratification Agent (which prioritizes people); it reuses the existing care-coordination tier (a quality / care-management activity), not a new tier. It is a DETERMINISTIC (no-Claude) agent: the roll-up is a pure function of the panel signals + the caller-provided `asOfPeriod` (accepted as data — no clock), so the same panel + period always yields the same rates and gap lists. It NEVER autonomously submits a measure package to a payer / CMS / a quality registry — every submission requires a human quality-team approval. The HEDIS measure catalog, denominator windows, numerator thresholds, and exclusion lists are illustrative/synthetic, clearly labeled — NOT NCQA-certified specifications, real value sets, or a certified HEDIS engine. Enforces, via the Pause Agent Fabric, that every scored measure traces to the defined HEDIS measure catalog (no off-catalog / fabricated measure), that every applied denominator exclusion traces to a defined catalog exclusion on that measure (no ad-hoc / unlisted exclusion — the load-bearing rate-integrity guard against inflating a rate by shrinking the denominator), and that a submission package requires human quality-team approval (no autonomous filing).",
  url: `${HOST}/api/agents/hedis-quality`,
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
      id: "roll-up-hedis-panel",
      name: "Roll up a panel against HEDIS quality measures and assemble a human-approved submission package",
      description:
        "Given a panel of patients (each with synthetic per-patient signals — age, sex, care-relationship, diagnoses, screenings, adherence — and catalog-sourced exclusions), returns a per-measure roll-up (eligible / excluded / denominator / numerator / rate) with the non-compliant patient list per measure and a submission package assembled for human quality-team review (never autonomously submitted to a payer / CMS / quality registry). Every scored measure traces to the defined HEDIS measure catalog; every applied denominator exclusion traces to a defined catalog exclusion on that measure.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["hedis", "quality-reporting", "value-based-care", "star-measures", "population-health", "menopause", "care-coordination"]
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
