import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Immunization Forecasting (ACIP) agent — the clinical-decision
 * service that forecasts which vaccines a patient is up-to-date / due / overdue /
 * contraindicated / not-indicated for against an ACIP-style schedule.
 *
 *   GET /api/agents/immunization/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "immunization-agent";

const CARD: A2AAgentCard = {
  name: "Immunization Forecasting (ACIP) Agent",
  description:
    "The immunization-forecasting layer of the Pause patient & clinical plane — a DETERMINISTIC (no-Claude) clinical-decision service. Given a patient (a synthetic reference, a birth date, an immunization history, and any recorded contraindications) evaluated against a provided asOfDate, it DETERMINISTICALLY computes the patient's age and forecasts each vaccine (up-to-date / due / overdue / contraindicated / not-indicated) against an ACIP-style schedule (influenza annual, Td/Tdap booster every 10 years, recombinant zoster/RZV 2-dose series at 50+, pneumococcal at 65+, updated COVID-19), applying age-eligibility, dose-series / booster-interval logic, and any recorded contraindications, citing the governing schedule rule and the next-due date. The forecast is a pure function of the request + its own asOfDate + the schedule catalog (no randomness, no clock), so the same patient always yields the same forecast + cited rules + next-due dates. Every forecast entry must cite a recorded ACIP schedule rule (no ad-hoc recommendation), a vaccine the patient is contraindicated for is NEVER recommended (it is withheld and flagged — the load-bearing safety gate), and a due / overdue vaccine is a RECOMMENDATION requiring a clinician order — the agent never administers, orders, or records a vaccine autonomously. It COMPLEMENTS — it does not duplicate — the other clinical / care agents: distinct from the Care Gap Closure agent (broad missing preventive measures), the Lab Result agent (discrete diagnostic results), the Care Plan agent (the longitudinal plan), and the Care Router (triage). It is a clinical-decision service, PHI-bearing (on the HIPAA audit policy). The ACIP-style schedule, age-eligibility, dose series, and booster intervals are illustrative/synthetic, clearly labeled — NOT a certified immunization forecaster; a real forecast uses the current ACIP recommendations, the CDC immunization schedules, and the patient's full clinical context. Enforces, via the Pause Agent Fabric, that every forecast entry cites a recorded schedule rule, that a contraindicated vaccine is never recommended, and that a due / overdue vaccine requires a clinician order.",
  url: `${HOST}/api/agents/immunization`,
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
      id: "evaluate-immunization",
      name: "Forecast a patient's vaccines against an ACIP-style schedule",
      description:
        "Given a patient (birth date, immunization history, recorded contraindications) evaluated against an asOfDate, deterministically computes age and forecasts each vaccine (up-to-date / due / overdue / contraindicated / not-indicated), citing the governing schedule rule and next-due date. Every forecast entry cites a recorded schedule rule; a contraindicated vaccine is never recommended; a due / overdue vaccine requires a clinician order.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "immunization",
        "vaccine",
        "acip",
        "forecasting",
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
