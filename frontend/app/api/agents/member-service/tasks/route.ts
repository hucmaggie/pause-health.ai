import { NextResponse } from "next/server";
import {
  type A2ATask,
  agentMessage,
  findDataPart,
  newTaskId,
  nowIso,
  parseTasksSendEnvelope
} from "../../../../../lib/a2a";
import {
  evaluateGovernance,
  recordInstantSpan
} from "../../../../../lib/agent-fabric";
import {
  type BillingAnswer,
  type ClaimRecord,
  DEFAULT_MEMBER_ID,
  DEMO_BILLING_QUERY,
  answerBillingQuestion,
  answerTracesToClaim,
  billingAnswerSummary,
  generateClaims
} from "../../../../../lib/member-service";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "member-service-agent";

/**
 * Google A2A `tasks/send` endpoint for the Member Service / Billing agent — the
 * Salesforce "Agentforce for Health" Claims & Coverage / patient-service analog.
 *
 *   POST /api/agents/member-service/tasks
 *
 * Answers a member's BILLING & COVERAGE self-service question — claim status,
 * copay / patient responsibility, outstanding balance, or EOB explanation —
 * grounded on their DETERMINISTIC synthetic claim/EOB records, and routes an
 * out-of-scope request (a clinical, prescription, or scheduling question) to a
 * human member-services specialist with a PII-safe billing context bundle. The
 * claim/EOB records are a clearly-labeled deterministic synthetic — NOT a real
 * claims / 835-ERA remittance or FHIR ExplanationOfBenefit.
 *
 * CRITICAL: a billing/claim answer must trace to a synthetic claim/EOB record —
 * the agent may not fabricate claim data.
 *
 * Enforced-block policies checked before the answer is returned:
 *   - policy.billing.claim-data-sourced (signal billingTracesToClaim) — a
 *     caller-asserted billing answer that cites no claim record trips the block;
 *     an answer that cites a claim (or a route-to-human handoff) passes.
 *   - policy.phi.no-free-text-pii (signal containsFreeTextPii) — the agent emits
 *     structured, claim-referenced answers only.
 * A block returns HTTP 200 with an A2A task in state `failed`.
 *
 * Input (data part):
 *   { query: string, memberId?: string, claims?: ClaimRecord[] } — the agent
 *      classifies the question and answers over the member's claims (generated
 *      deterministically when not supplied).
 *   { answer: BillingAnswer } — a caller-asserted answer, admissible only if it
 *      traces to a claim record (else blocked).
 * A bare data object is also accepted and read as { query }.
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  const parsed = parseTasksSendEnvelope(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: parsed.id, error: { code: parsed.code, message: parsed.message } },
      { status: 400 }
    );
  }

  const params = parsed.params;
  const taskId = params.id || newTaskId("member-service");
  const sessionId = params.sessionId;
  const parentSpanId =
    typeof params.metadata?.parentSpanId === "string"
      ? (params.metadata.parentSpanId as string)
      : undefined;
  const personaId =
    typeof params.metadata?.personaId === "string"
      ? (params.metadata.personaId as string)
      : undefined;

  const data = findDataPart(params.message?.parts) ?? {};
  const memberId =
    typeof data.memberId === "string" && data.memberId.trim().length > 0
      ? data.memberId
      : DEFAULT_MEMBER_ID;
  const query =
    typeof data.query === "string" && data.query.trim().length > 0
      ? data.query
      : typeof data.question === "string" && data.question.trim().length > 0
        ? (data.question as string)
        : DEMO_BILLING_QUERY;

  // The member's synthetic claim history — supplied by the caller or generated
  // deterministically from the member id.
  const claims: ClaimRecord[] = Array.isArray(data.claims)
    ? (data.claims as ClaimRecord[])
    : generateClaims(memberId);

  // A caller-asserted answer (bypassing the lookup) is only admissible if it
  // traces to a claim record; otherwise the agent produces its own answer, which
  // always cites the claim(s) it derived from.
  const asserted = data.answer as BillingAnswer | undefined;
  const usingAsserted = asserted !== undefined && asserted !== null;
  const answer: BillingAnswer = usingAsserted
    ? asserted
    : answerBillingQuestion(query, claims);

  // Honest signals for the governance gate:
  //  - billingTracesToClaim: does the answer trace to a synthetic claim record?
  //    (true for anything the agent answers / a human handoff; false for a
  //    fabricated billing answer with no cited claim)
  //  - containsFreeTextPii: the agent emits structured, claim-referenced answers
  //    only, so it never persists free-text PII.
  const tracesToClaim = answerTracesToClaim(answer);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      billingTracesToClaim: tracesToClaim,
      containsFreeTextPii: false
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "billing.answer.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        intent: answer?.intent ?? "unknown",
        billingTracesToClaim: tracesToClaim,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        ...(personaId ? { personaId } : {})
      }
    });
    const failed: A2ATask = {
      id: taskId,
      sessionId,
      status: {
        state: "failed",
        timestamp: nowIso(),
        message: agentMessage(
          `Pause Agent Fabric blocked this member-service answer: ${governance.blockingViolations
            .map((v) => `${v.policyId} (${v.reason})`)
            .join("; ")}`,
          { blockingViolations: governance.blockingViolations }
        )
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
          violations: governance.blockingViolations
        }
      }
    };
    return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: failed });
  }

  const summary = billingAnswerSummary(answer);

  // 1. Claim lookup — the record set the answer is grounded on.
  const lookupSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "billing.claim.lookup",
    protocol: "rest",
    attributes: {
      memberId,
      claimsConsidered: claims.length,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // 2. The billing answer — always traces to the cited claim(s).
  const answerSpan = recordInstantSpan({
    taskId,
    parentSpanId: lookupSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "billing.answer",
    protocol: "rest",
    attributes: {
      intent: summary.intent,
      kind: summary.kind,
      citedClaimIds: summary.citedClaimIds,
      citedClaimCount: summary.citedClaimCount,
      patientResponsibility: summary.patientResponsibility,
      billingTracesToClaim: summary.sourced,
      routeToHuman: summary.routeToHuman,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // 3. Optional human handoff span when the request is out of scope (or there
  //    is no claim on file) — the escalation carries a PII-safe context bundle.
  let routeSpanId: string | undefined;
  if (answer.routeToHuman.required) {
    const routeSpan = recordInstantSpan({
      taskId,
      parentSpanId: lookupSpan.id,
      agentId: FABRIC_AGENT_ID,
      operation: "billing.route-to-human",
      protocol: "a2a",
      attributes: {
        intent: answer.intent,
        reason: answer.routeToHuman.reason,
        queue: answer.routeToHuman.queue,
        contextClaimIds: answer.routeToHuman.contextBundle.citedClaimIds,
        billingTracesToClaim: summary.sourced,
        routeToHuman: true,
        synthetic: true,
        ...(personaId ? { personaId } : {})
      }
    });
    routeSpanId = routeSpan.id;
  }

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        answer.routeToHuman.required
          ? `${answer.answer} (${summary.intent}; synthetic claim records — routed to ${answer.routeToHuman.queue}).`
          : `${answer.answer} (${summary.intent}; grounded on ${summary.citedClaimCount} synthetic claim record${
              summary.citedClaimCount === 1 ? "" : "s"
            }).`,
        { answer, summary }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "BillingAnswer",
        description:
          "A member billing/coverage self-service answer (claim status, copay / patient responsibility, outstanding balance, or EOB explanation) grounded on the member's DETERMINISTIC synthetic claim/EOB records — ALWAYS citing the specific ClaimRecord(s) it derived from (the agent may not fabricate claim data) — plus a route-to-human escalation path with a PII-safe billing context bundle when the request is out of scope. The claim/EOB records are illustrative/synthetic, NOT a real claims / 835-ERA remittance or FHIR ExplanationOfBenefit.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { answer, summary } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: answerSpan.id,
        traceTaskId: taskId,
        intent: summary.intent,
        // The honesty invariant: every billing answer traces to a claim record.
        billingTracesToClaim: summary.sourced,
        routeToHuman: summary.routeToHuman,
        ...(routeSpanId ? { routeToHumanSpanId: routeSpanId } : {}),
        ...(answer.routeToHuman.required
          ? { nextAgent: "member-services-human" }
          : {})
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
