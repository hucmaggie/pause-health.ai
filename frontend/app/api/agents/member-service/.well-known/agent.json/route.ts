import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Member Service / Billing agent — the Salesforce
 * "Agentforce for Health" Claims & Coverage / patient-service analog.
 *
 *   GET /api/agents/member-service/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "member-service-agent";

const CARD: A2AAgentCard = {
  name: "Member Service / Billing Agent",
  description:
    "Answers a member's BILLING & COVERAGE self-service questions — claim status, copay / patient responsibility, outstanding balance, and EOB explanation — the Salesforce 'Agentforce for Health' Claims & Coverage / patient-service analog. Every answer is grounded on the member's DETERMINISTIC synthetic claim/EOB records (hashed member/claim keys → realistic billed / allowed / plan-paid / patient-responsibility figures across submitted / adjudicated / paid / denied statuses; no randomness, no clock), so the same member always produces the same claims and the same question always answers identically. CRITICAL HONESTY PROPERTY: a billing/claim answer must trace to a specific synthetic claim/EOB record — the agent may not fabricate claim data. When a request is out of scope (a clinical, prescription, or scheduling question) it routes to a human member-services specialist with a PII-safe billing context bundle, keeping the agent scoped to billing/coverage self-service and distinct from the engagement agent. The claim/EOB records are illustrative/synthetic, clearly labeled — NOT a real claims / 835-ERA remittance or FHIR ExplanationOfBenefit. Enforces, via the Pause Agent Fabric, that every billing answer traces to a claim/EOB record (policy.billing.claim-data-sourced), that no free-text PII is captured (policy.phi.no-free-text-pii), and that every turn is HIPAA-audited.",
  url: `${HOST}/api/agents/member-service`,
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
      id: "answer-billing-question",
      name: "Answer a member billing/coverage question (claim-sourced)",
      description:
        "Given a member's billing/coverage question (+ a synthetic member id), classifies the intent (claim status, copay / patient responsibility, outstanding balance, or EOB explanation) and returns a structured answer that ALWAYS cites the specific synthetic claim/EOB record(s) it derived from — the agent may not fabricate claim data. Out-of-scope requests (clinical / prescription / scheduling) route to a human with a PII-safe billing context bundle.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "billing",
        "coverage",
        "claims",
        "eob",
        "copay",
        "patient-responsibility",
        "member-service",
        "patient-service"
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
