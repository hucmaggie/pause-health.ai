import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Grievance & Appeals agent — a member-
 * service intake agent that classifies grievances and coverage-denial
 * appeals, routes them to the correct human queue, and stamps a regulatory
 * deadline.
 *
 *   GET /api/agents/grievance-appeals/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "grievance-appeals-agent";

const CARD: A2AAgentCard = {
  name: "Grievance & Appeals Agent",
  description:
    "Runs the INTAKE half of the regulated grievance-and-appeals process — classifies a member complaint or coverage-denial appeal (grievance-quality-of-service, grievance-billing-dispute, appeal-coverage-denial, or expedited appeal-coverage-denial), routes it to the correct human queue (member-services / clinical-review / compliance), and stamps a regulatory deadline that traces to the case-type catalog + received date. It NEVER resolves, approves, or denies a case on its own — every case is queued for human review; a denial-appeal in particular needs a clinician-plus-compliance human review. The routing summary handed to the receiving queue is PHI-SAFE (structured only — memberRef, caseType, urgency, queue, deadlineDate; NO free-text PHI), so it can be delivered via lower-trust channels (Slack, email, ticketing) without leaking PHI; the free-text complaint stays on the case record itself. It is distinct from the Member Service / Billing agent (billing self-service, one-shot answers) and the Prior Authorization agent (pre-service utilization management) — this one runs the regulated grievance/appeal intake and routing workflow. It is a DETERMINISTIC (no-Claude) agent: classification, routing, and deadline stamping are pure functions of the intake keywords + coverage/service flags + received date accepted as data (no randomness, no clock), so the same intake always yields the same case type / urgency / queue / deadline / summary. The case-type catalog, deadline windows (3d expedited / 30d standard), expedited-eligibility rules, and queue mapping are illustrative/synthetic, clearly labeled — NOT Medicare Advantage Chapter 13, a certified state-insurance-code process, or a real appeal-adjudication engine. Enforces, via the Pause Agent Fabric, that every resolution requires human queue action (no autonomous resolutions), that every deadline traces to the catalog + received date and does not exceed the regulatory maximum (deadline integrity), and that the routing summary contains no free-text PHI (PHI-safe routing).",
  url: `${HOST}/api/agents/grievance-appeals`,
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
      id: "classify-and-route-grievance-or-appeal",
      name: "Classify a member grievance or coverage-denial appeal and route to the correct human queue",
      description:
        "Given a member's intake (a synthetic memberRef, a free-text complaint, an optional coverage-denial flag, an optional expedited-request flag, and an ISO received date accepted as data), returns the classified case (grievance / billing / standard-appeal / expedited-appeal) with its target human queue, regulatory deadline, a PHI-safe routing summary (structured only), and a human-queue-action gated resolution proposal (NEVER autonomously applied).",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["grievance", "appeals", "member-services", "compliance", "regulatory", "menopause"]
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
