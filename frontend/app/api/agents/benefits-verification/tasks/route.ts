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
  coverageSummary,
  hasEbvSource,
  verifyCoverage,
  type CoverageBenefitResult,
  type CoverageQuery
} from "../../../../../lib/benefits";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "benefits-verification-agent";

/**
 * Google A2A `tasks/send` endpoint for the Agentforce Benefits & Coverage
 * Verification (EBV) agent — the Salesforce "Agentforce for Health —
 * Eligibility & Benefit Verification" analog.
 *
 *   POST /api/agents/benefits-verification/tasks
 *
 * Verifies a patient's insurance eligibility & benefits for a menopause
 * specialist (MSCP) visit and returns a structured CoverageBenefitResult
 * (plan status, in/out-of-network, deductible + amount met,
 * coinsurance/copay, estimated visit cost + patient responsibility) plus
 * its (mock) payer/clearinghouse source. The verification is a
 * DETERMINISTIC synthetic EBV round-trip — NOT a real 270/271 EDI
 * transaction or FHIR CoverageEligibilityResponse.
 *
 * Enforced-block policies checked before the result is returned:
 *   - policy.benefits.eligibility-source-integrity (a returned coverage
 *     result MUST trace to a payer/clearinghouse EBV response — the agent
 *     may not fabricate coverage without a source)
 *   - policy.data360.consent-required-before-grounding (coverage
 *     verification touches patient/plan data)
 * A block returns HTTP 200 with an A2A task in state `failed`.
 *
 * Input (data part), either:
 *   { coverageQuery: CoverageQuery }  — the agent performs the EBV lookup
 *   { coverage: CoverageBenefitResult } — a caller-asserted result, only
 *      admissible if it carries EBV source provenance (else it's blocked)
 * A bare data object is also accepted and read as the CoverageQuery.
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
  const taskId = params.id || newTaskId("benefits");
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
  // A caller-asserted coverage result (bypassing the EBV lookup) is only
  // admissible if it carries EBV source provenance; otherwise the agent
  // performs its own deterministic synthetic verification, which always
  // attaches a source.
  const asserted = data.coverage as CoverageBenefitResult | undefined;
  const query = (data.coverageQuery ?? data.query ?? data) as CoverageQuery;
  const usingAsserted = asserted !== undefined && asserted !== null;
  const result: CoverageBenefitResult = usingAsserted
    ? asserted
    : verifyCoverage(query);

  // Honest signals for the governance gate:
  //  - eligibilityTracesToSource: does the result carry a (mock) EBV source?
  //    (true for anything the agent verifies; false for a fabricated result)
  //  - hasAiDecisionSupportConsent: coverage verification touches patient/
  //    plan data, so it's consent-gated like grounding. Present unless the
  //    caller explicitly clears it.
  const tracesToSource = hasEbvSource(result);
  const hasConsent = data.hasConsent !== false;

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      eligibilityTracesToSource: tracesToSource,
      hasAiDecisionSupportConsent: hasConsent
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "benefits.verify.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        payer: String(result?.payerName ?? query?.payer ?? "unknown"),
        sourced: tracesToSource,
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
          `Pause Agent Fabric blocked this coverage verification: ${governance.blockingViolations
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

  const summary = coverageSummary(result);

  const verifySpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "benefits.verify",
    protocol: "rest",
    attributes: {
      payer: summary.payerName,
      planName: summary.planName,
      eligibilityStatus: summary.eligibilityStatus,
      network: summary.network,
      deductibleTotal: summary.deductibleTotal,
      deductibleMet: summary.deductibleMet,
      deductibleRemaining: summary.deductibleRemaining,
      coinsuranceRate: summary.coinsuranceRate,
      ...(summary.copay !== undefined ? { copay: summary.copay } : {}),
      estimatedVisitCost: summary.estimatedVisitCost,
      estimatedPatientResponsibility: summary.estimatedPatientResponsibility,
      ebvTransactionId: summary.ebvTransactionId,
      sourced: summary.sourced,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `${result.payerName} · ${result.eligibilityStatus} · ${result.network}: estimated patient responsibility $${result.estimatedPatientResponsibility} for the ${result.serviceType} (synthetic EBV — ${result.source.transactionId}).`,
        { result, summary }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "CoverageBenefitResult",
        description:
          "Synthetic (deterministic) eligibility & benefit verification for the MSCP visit: plan status, in/out-of-network, deductible + amount met, coinsurance/copay, estimated visit cost + patient out-of-pocket, and the (mock) payer/clearinghouse EBV source provenance the result traces to.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result, summary } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: verifySpan.id,
        traceTaskId: taskId,
        ebvTransactionId: summary.ebvTransactionId,
        eligibilityStatus: summary.eligibilityStatus,
        network: summary.network,
        estimatedPatientResponsibility: summary.estimatedPatientResponsibility,
        nextAgent: "agentforce-intake"
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
