import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "utilization-review-agent";

const CARD: A2AAgentCard = {
  name: "Utilization Review Agent",
  description:
    "Deterministic pre-service utilization-review pipeline (MCG-analog / InterQual-analog): for each proposed procedure or inpatient admission, screens per-criterion evidence against the catalog medical-necessity criteria set for that service type, classifies as approves-meets-criteria / pend-for-clinical-review / require-peer-to-peer / blocked-non-covered, and routes non-approved cases to a clinical reviewer or peer-to-peer with a catalog-sourced SLA deadline. Distinct from Prior Authorization (assembly), Claims Adjudication (post-service mechanical edits), and Grievance & Appeals (post-denial intake). It NEVER autonomously denies a UR case; every non-approved decision is DRAFTED for clinician cosign (Medicare Advantage / state utilization-review-agent codes require notice + due-process rights). Every criterion, rule, and reason code traces to the catalog. Every case SLA (standard 72h, urgent 24h, concurrent-review 24h) traces to the catalog urgency + received asOfDate — silently extending a deadline is a Medicare Advantage Chapter 4 / state UR-agent code breach. The service-type catalog, criteria sets, rules, reason codes, and SLA windows are illustrative/synthetic, NOT MCG, InterQual, or a real payer's UR rule set.",
  url: `${HOST}/api/agents/utilization-review`,
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
      id: "review-medical-necessity",
      name: "Review a pre-service UR request against the medical-necessity criteria catalog",
      description:
        "Given a UR request (memberRef, serviceTypeId, urgency, per-criterion evidence flags, provider-requests-peer-to-peer flag, ISO asOfDate), returns a deterministic decision — approves-meets-criteria / pend-for-clinical-review / require-peer-to-peer / blocked-non-covered — with applied catalog rules, met/missing criteria lists, primary reason code, routing target, catalog-sourced SLA deadline, and cosign flags (NEVER autonomously cosigned).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["utilization-management", "medical-necessity", "mcg-analog", "interqual-analog", "menopause"]
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
