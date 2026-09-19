import { NextResponse } from "next/server";
import {
  answerBillingQuestion,
  answerTracesToClaim,
  billingAnswerSummary,
  generateClaims
} from "../../../../lib/member-service";
import { evaluateGovernance } from "../../../../lib/agent-fabric";

/**
 * Agentforce-facing REST alias for the Member Service · Billing & Coverage agent.
 *
 *   GET /api/agentforce/member-service?query=what%20is%20my%20balance&memberId=M-123
 *
 * The fabric agent proper speaks Google A2A (`POST /api/agents/member-service/
 * tasks`, a JSON-RPC `tasks/send` envelope). Salesforce Agentforce External
 * Services map a flat REST request/response, not an A2A envelope — so this thin
 * alias exposes the SAME deterministic billing answer (`answerBillingQuestion`
 * over `generateClaims`) and the SAME Agent Fabric governance gate as a plain GET
 * that returns the flat billing summary + answer text.
 *
 * It is a pure re-use of lib/member-service.ts — no new business logic — so the
 * Agentforce action and the A2A agent can never diverge. Synthetic data only;
 * every answer traces to a synthetic claim/EOB record (never a real 835/ERA or
 * FHIR ExplanationOfBenefit). Out-of-scope or claimless requests route to a human.
 *
 * Registered in Salesforce as the External Service `PauseMemberService`
 * (see salesforce/external-services/pause-member-service.oas.yaml).
 */

const FABRIC_AGENT_ID = "member-service-agent";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") ?? "").trim();
  const memberIdRaw = searchParams.get("memberId") ?? undefined;
  const memberId =
    memberIdRaw && memberIdRaw.trim().length > 0 ? memberIdRaw.trim() : "M-DEMO-0001";

  if (!query) {
    return NextResponse.json(
      {
        error: "missing-query",
        _note:
          "Provide ?query=<the member's billing/coverage question>. Synthetic member-service alias for the A2A member-service agent."
      },
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  // Deterministic synthetic claims for this member, then the billing answer —
  // identical to the A2A /tasks route.
  const claims = generateClaims(memberId);
  const answer = answerBillingQuestion(query, claims);

  // Same governance gate the A2A route enforces: the answer must trace to a
  // claim record (billing.claim-data-sourced), and the agent emits structured,
  // claim-referenced answers only (never free-text PII).
  const tracesToClaim = answerTracesToClaim(answer);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      billingTracesToClaim: tracesToClaim,
      containsFreeTextPii: false
    }
  });

  if (governance.decision === "block") {
    return NextResponse.json(
      {
        blocked: true,
        decision: "block",
        violations: governance.blockingViolations.map((v) => ({
          policyId: v.policyId,
          reason: v.reason
        })),
        _note:
          "Pause Agent Fabric blocked this billing answer. Synthetic; see the A2A agent at /api/agents/member-service."
      },
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  const summary = billingAnswerSummary(answer);

  return NextResponse.json(
    {
      ...summary,
      answer: answer.answer,
      routeToHumanReason: answer.routeToHuman.required ? answer.routeToHuman.reason : undefined,
      routeToHumanQueue: answer.routeToHuman.required ? answer.routeToHuman.queue : undefined,
      synthetic: true,
      _note:
        "Synthetic deterministic billing answer traced to mock claim/EOB records — NOT a real 835/ERA remittance or FHIR ExplanationOfBenefit. Agentforce alias for the A2A member-service agent."
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
      }
    }
  );
}
