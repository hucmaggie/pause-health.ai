import { NextResponse } from "next/server";
import type { A2AAgentCard } from "../../../../../../lib/a2a";
import { getPoliciesForAgent } from "../../../../../../lib/agent-fabric";

/**
 * Google A2A Agent Card for the Creditable Coverage Continuity agent — a claims / payer-operations
 * service on the payer & plan operations plane.
 *
 *   GET /api/agents/coverage-continuity/.well-known/agent.json
 *
 * Advertised governance policies are derived from the Agent Fabric registry
 * (appliesTo) rather than hand-listed, so the discovery document can't drift
 * from what the /tasks handler enforces.
 */

const HOST = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pause-health.ai";
const FABRIC_AGENT_ID = "coverage-continuity-agent";

const CARD: A2AAgentCard = {
  name: "Creditable Coverage Continuity Agent",
  description:
    "A claims / payer-operations service on the payer & plan operations plane — a DETERMINISTIC (no-Claude) agent that takes a member's coverage segments (each a start/end date from an employer, individual, or public plan), merges the overlapping / adjacent ones into continuous spans, totals the covered days, and measures the gaps between spans — flagging a significant break in creditable coverage when a gap exceeds the threshold (63 days by the HIPAA / ACA rule). UNLIKE the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the OIG Exclusion agent's identity MATCHING, or the MLR Rebate agent's RATIO + apportionment — and UNLIKE the date-deadline agents (Timely Filing, Right of Access, Amendment) that add N days to a single date — the heart of this service is INTERVAL MERGING + GAP DETECTION over a set of date ranges. Time is data: the analysis is a pure function of the segments + the request's own asOfDate (no real clock), so the same segments always yield the same spans + gaps + determination. Every merged span traces to submitted segments (a fabricated / dropped span is blocked), the coverage math is exact (the total covered days, the gaps, and the significant-break flag all recompute exactly — the load-bearing correctness gate), and no determination is ever issued (an autonomous determination is blocked). It COMPLEMENTS — it does not duplicate — the other payer-operations agents: distinct from the Benefits Verification agent (is coverage active NOW), the Coordination of Benefits agent (the ORDER of concurrent coverages), the Enrollment Reconciliation agent (employer-vs-carrier roster drift), the Member Cost-Share agent (splitting a claim), and the MLR Rebate agent (a plan-year rebate) — this measures the CONTINUITY of a member's coverage OVER TIME. It is PHI-bearing (the segments reference the member's coverage history), so it is on the HIPAA-audit policy. The segments + threshold are illustrative, clearly labeled — NOT a certified creditable-coverage system; real determination uses the certificate of creditable coverage, plan-specific rules, and the full HIPAA / ACA / Medicare Part D frameworks. Enforces, via the Pause Agent Fabric, that every span is sourced, the coverage math is exact, and no determination is issued autonomously.",
  url: `${HOST}/api/agents/coverage-continuity`,
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
      id: "analyze-coverage-continuity",
      name: "Merge a member's coverage segments and detect a significant break",
      description:
        "Given a member's coverage segments, deterministically merges the overlapping / adjacent ones into continuous spans, totals the covered days, and measures the gaps — flagging a significant break in creditable coverage when a gap exceeds the threshold. Every span is sourced; the coverage math is exact; no determination is issued autonomously.",
      inputModes: ["data"],
      outputModes: ["data"],
      tags: [
        "coverage",
        "creditable-coverage",
        "continuity",
        "gap-detection",
        "payer-operations",
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
