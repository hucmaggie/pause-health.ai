import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Data Retention & Records Lifecycle Management
 * agent — the MuleSoft control-plane / data-substrate records-management service,
 * the records-disposition layer of the data substrate.
 *
 *   GET /api/agents/records-retention/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "records-retention-agent";

const CARD: A2AAgentCard = {
  name: "Data Retention & Records Lifecycle Management Agent",
  description:
    "The records-disposition layer of the Pause data substrate — the MuleSoft control-plane / data-substrate records-management service. Manages the lifecycle of records against RETENTION SCHEDULES and LEGAL HOLDS: given a RECORD (type/category, patient, created and last-touched dates evaluated against a provided atTime, jurisdiction, and any active legal hold), it DETERMINISTICALLY produces a disposition RECOMMENDATION — retain / eligible-for-purge / hold — citing the governing retention rule and the computed retention expiry. The disposition is a pure function of the record's dates + the request's own atTime (no randomness, no clock), so the same record always yields the same recommendation + cited rule + expiry. It NEVER autonomously purges: an eligible-for-purge is a RECOMMENDATION requiring human approval, and an active LEGAL HOLD ALWAYS overrides a purge (a held record is `hold`, never eligible-for-purge). An eligible-for-purge RECOMMENDATION is a SAFE, completed answer — NOT a block, and never a deletion. It COMPLEMENTS — it does not duplicate — the other platform agents: distinct from the Consent & Preferences Management agent (patient consent scopes for outreach / data-sharing), the Master Patient Index (identity / dedup), and the Break-the-Glass / Emergency Access Governance agent (which governs emergency PHI access), this governs records RETENTION / DISPOSITION under records-management + legal-hold obligations. It is a control-plane / data-substrate service (platform plane), NOT a live-Claude agent. The retention schedules, retention periods, and rule ids are illustrative/synthetic, clearly labeled — NOT a certified records-management system; real retention is jurisdiction-specific and legally reviewed. Enforces, via the Pause Agent Fabric, that a legal hold always overrides a purge (a held record is never marked eligible-for-purge), that every disposition cites a recorded retention schedule, and that a destructive purge is never executed autonomously (an eligible-for-purge is human-approval-gated).",
  url: `${HOST}/api/agents/records-retention`,
  provider: {
    organization: "MuleSoft Anypoint (via Pause-Health.ai)",
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
      id: "evaluate-records-retention",
      name: "Evaluate a record's retention / disposition against schedules and legal holds",
      description:
        "Given a record (type/category, patient, created/last-touched dates, patient DOB, jurisdiction, and any active legal hold) and an evaluation time, deterministically produces a disposition recommendation (retain / eligible-for-purge / hold), citing the governing retention rule and the computed retention expiry. A legal hold always overrides a purge (a held record is `hold`, never eligible-for-purge); a purge is only ever a recommendation requiring human approval — the agent never autonomously purges.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "data-retention",
        "records-lifecycle",
        "records-management",
        "legal-hold",
        "retention-schedule",
        "governance",
        "control-plane",
        "data-substrate"
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
