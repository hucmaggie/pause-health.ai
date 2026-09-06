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
  type QuoteDecision,
  type QuoteRequest,
  DEMO_QUOTE_REQUEST,
  dealDeskCatalogSourced,
  dealDeskMathConsistent,
  dealDeskNoAutonomousApproval,
  evaluateQuote,
  quoteSummary
} from "../../../../../lib/deal-desk";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "deal-desk-agent";

/**
 * Google A2A `tasks/send` endpoint for the Deal Desk / Quote Approval (CPQ) agent — Pause's OWN
 * go-to-market deal-desk service on the strictly PHI-separated commercial-operations plane. It
 * validates a proposed enterprise quote's pricing + discounting against the recorded guardrail
 * catalog and decides auto-approve vs. escalate to a human deal-desk owner.
 *
 *   POST /api/agents/deal-desk/tasks
 *
 * Loads a quote and DETERMINISTICALLY evaluates it via evaluateQuote: it prices each line, sums the
 * list / net / discount totals, computes the effective blended discount, checks each line's discount
 * against its product's max auto-approve guardrail, and decides the disposition. The decision is a
 * pure function of the quote's own line items (no randomness, no clock). Every line prices from the
 * recorded catalog, the totals equal the computed sums, and an out-of-guardrail discount is never
 * auto-approved — it escalates to a human deal-desk owner. This is a COMMERCIAL agent: it never
 * reads patient PHI (phiAccessed:false throughout). The product catalog + guardrails are
 * illustrative; real quoting is governed by the company's CPQ, price book, and discount-approval
 * matrix.
 *
 * Enforced-block policies checked before any decision is acted on:
 *   - policy.dealdesk.pricing-catalog-sourced (signal dealDeskCatalogSourced) — every line prices a
 *     recorded product.
 *   - policy.dealdesk.discount-math-consistent (signal dealDeskMathConsistent) — the totals equal the
 *     computed line sums.
 *   - policy.dealdesk.no-autonomous-out-of-guardrail-approval (signal dealDeskNoAutonomousApproval) —
 *     an out-of-guardrail quote is never auto-approved.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: QuoteRequest, decision?: object } — the request is evaluated; a caller-asserted
 *   `decision` (admissible only if every product is cataloged, the totals add up, and no
 *   out-of-guardrail quote is auto-approved) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("deal-desk");
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
  const request =
    data.request && typeof data.request === "object"
      ? (data.request as QuoteRequest)
      : DEMO_QUOTE_REQUEST;

  // Deterministic quote evaluation.
  const decision = evaluateQuote(request);

  // The decision the governance gates check: the caller-asserted decision (to demonstrate the
  // blocks) or the produced decision.
  const assertedDecision =
    data.decision && typeof data.decision === "object"
      ? (data.decision as QuoteDecision)
      : undefined;
  const decisionForCheck = assertedDecision ?? decision;

  // Honest governance signals: catalog-sourced pricing + consistent math + no out-of-guardrail auto-approve.
  const catalogSourced = dealDeskCatalogSourced(decisionForCheck);
  const mathConsistent = dealDeskMathConsistent(decisionForCheck);
  const noAutonomousApproval = dealDeskNoAutonomousApproval(decisionForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      dealDeskCatalogSourced: catalogSourced,
      dealDeskMathConsistent: mathConsistent,
      dealDeskNoAutonomousApproval: noAutonomousApproval
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "dealdesk.decide-approval.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        quoteRef: request.quoteRef,
        dealDeskCatalogSourced: catalogSourced,
        dealDeskMathConsistent: mathConsistent,
        dealDeskNoAutonomousApproval: noAutonomousApproval,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        // Commercial plane — no PHI accessed.
        phiAccessed: false,
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
          `Pause Agent Fabric blocked this deal-desk run: ${governance.blockingViolations
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

  const summary = quoteSummary(decision);

  // Receive-quote span — the fabric records the quote it received, parented under the caller's span.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "dealdesk.receive-quote",
    protocol: "a2a",
    attributes: {
      quoteRef: request.quoteRef,
      accountRef: request.accountRef,
      lineCount: request.lineItems.length,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Validate-pricing span — the deterministic pricing + totals, parented to the received quote.
  const validateSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "dealdesk.validate-pricing",
    protocol: "a2a",
    attributes: {
      quoteRef: request.quoteRef,
      listTotal: decision.listTotal,
      netTotal: decision.netTotal,
      effectiveDiscountPct: decision.effectiveDiscountPct,
      dealDeskCatalogSourced: catalogSourced,
      dealDeskMathConsistent: mathConsistent,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Decide-approval span — the guardrail decision + disposition, parented to the pricing.
  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: validateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "dealdesk.decide-approval",
    protocol: "a2a",
    attributes: {
      quoteRef: request.quoteRef,
      withinGuardrail: decision.withinGuardrail,
      disposition: decision.disposition,
      requiresDealDeskApproval: decision.requiresDealDeskApproval,
      dealDeskNoAutonomousApproval: noAutonomousApproval,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Record-audit span — the decision recorded to the commercial audit trail, parented to the decision.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: decideSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "dealdesk.record-audit",
    protocol: "a2a",
    attributes: {
      quoteRef: request.quoteRef,
      disposition: decision.disposition,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { decision, quoteRef: request.quoteRef };

  const completedMessage = decision.withinGuardrail
    ? `Quote ${request.quoteRef} for ${request.accountRef}: net $${decision.netTotal.toFixed(2)} (${decision.effectiveDiscountPct.toFixed(1)}% effective discount) — within guardrail, auto-approved (synthetic — illustrative catalog, NOT a certified CPQ system).`
    : `Quote ${request.quoteRef} for ${request.accountRef}: net $${decision.netTotal.toFixed(2)} (${decision.effectiveDiscountPct.toFixed(1)}% effective discount) — ${decision.breachingLines.length} line(s) out of guardrail; escalated to a human deal-desk owner, never auto-approved (synthetic — illustrative catalog, NOT a certified CPQ system).`;

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(completedMessage, { result })
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "QuoteDecision",
        description:
          "Deterministically-produced deal-desk quote decision. It prices each line, sums the list / net / discount totals, computes the effective blended discount, checks each line's discount against its product's max auto-approve guardrail, and decides whether the quote auto-approves (every line within guardrail) or must escalate to a human deal-desk owner (any line out of guardrail). Every line prices from the recorded catalog, the totals equal the computed sums, and an out-of-guardrail discount is NEVER autonomously approved — it escalates to a human deal-desk owner. The decision is a pure function of the quote's own line items (no randomness, no clock). This is a COMMERCIAL agent on the PHI-separated commercial plane — it never reads patient PHI. The product catalog + guardrails are illustrative, NOT a certified CPQ / pricing system — real quoting is governed by the company's CPQ (e.g. Salesforce Revenue Cloud), its approved price book, and its deal-desk / finance discount-approval matrix.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: auditSpan.id,
        traceTaskId: taskId,
        quoteRef: request.quoteRef,
        accountRef: decision.accountRef,
        listTotal: decision.listTotal,
        netTotal: decision.netTotal,
        effectiveDiscountPct: decision.effectiveDiscountPct,
        withinGuardrail: decision.withinGuardrail,
        disposition: decision.disposition,
        autoApproved: decision.autoApproved,
        requiresDealDeskApproval: decision.requiresDealDeskApproval,
        breachingLines: decision.breachingLines,
        dealDeskCatalogSourced: catalogSourced,
        dealDeskMathConsistent: mathConsistent,
        dealDeskNoAutonomousApproval: noAutonomousApproval,
        summaryNetTotal: summary.netTotal
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
