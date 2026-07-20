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
  type ProviderContractDecision,
  type ProviderContractRequest,
  DEMO_CONTRACT_GOOD_STANDING,
  benchmarksTraceToMethodology,
  contractChangeRequiresOwnerCosign,
  contractsTraceToCatalog,
  evaluateContract
} from "../../../../../lib/provider-contracting";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "provider-contracting-agent";

/**
 * Google A2A `tasks/send` endpoint for the Provider Contracting & VBC Terms
 * Agent. Deterministic contract classification + benchmark drift computation
 * with account-owner cosign for every contract-term change. Commercial-plane
 * agent — never accesses PHI.
 *
 *   POST /api/agents/provider-contracting/tasks
 *
 * Enforced-block policies:
 *   - policy.contracting.contract-type-catalog-sourced (contractsTraceToCatalog)
 *   - policy.contracting.no-autonomous-term-change (contractChangeRequiresOwnerCosign)
 *   - policy.contracting.benchmark-methodology-catalog-sourced (benchmarksTraceToMethodology)
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
  const taskId = params.id || newTaskId("pc");
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
      ? (data.request as ProviderContractRequest)
      : DEMO_CONTRACT_GOOD_STANDING;

  const decision = evaluateContract(request);

  const decisionForCheck =
    data.decisionOverride && typeof data.decisionOverride === "object"
      ? (data.decisionOverride as ProviderContractDecision)
      : decision;

  const catalogOk = contractsTraceToCatalog(decisionForCheck);
  const cosignOk = contractChangeRequiresOwnerCosign(decisionForCheck);
  const benchmarkOk = benchmarksTraceToMethodology(decisionForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      contractsTraceToCatalog: catalogOk,
      contractChangeRequiresOwnerCosign: cosignOk,
      benchmarksTraceToMethodology: benchmarkOk
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "provider-contracting.evaluate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        providerRef: request.providerRef,
        contractRef: request.contractRef,
        contractsTraceToCatalog: catalogOk,
        contractChangeRequiresOwnerCosign: cosignOk,
        benchmarksTraceToMethodology: benchmarkOk,
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
          `Pause Agent Fabric blocked this contracting decision: ${governance.blockingViolations
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

  const evaluateSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "provider-contracting.evaluate-rules",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      providerRef: request.providerRef,
      contractRef: request.contractRef,
      contractTypeId: request.contractTypeId,
      methodologyId: request.methodologyId,
      appliedRuleCount: decision.appliedRules.length,
      contractsTraceToCatalog: catalogOk,
      benchmarksTraceToMethodology: benchmarkOk,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "provider-contracting.decide",
    protocol: "a2a",
    attributes: {
      decision: decision.decision,
      primaryReasonCode: decision.primaryReasonCode,
      routedTo: decision.routedTo,
      qualityGateMet: decision.qualityGateMet,
      spendDriftFraction: decision.spendDriftFraction,
      requiresAccountOwnerCosign: decision.requiresAccountOwnerCosign,
      contractChangeRequiresOwnerCosign: cosignOk,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { decision };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        decision.decision === "in-good-standing"
          ? `Contract ${decision.contractRef} · IN-GOOD-STANDING · ${decision.contractTypeLabel}.`
          : `Contract ${decision.contractRef} · ${decision.decision} · ${decision.primaryReasonCode} · routed to ${decision.routedTo} · ${decision.appliedRules.length} rule${decision.appliedRules.length === 1 ? "" : "s"} hit. ` +
            (decision.decision === "blocked-non-catalog-contract"
              ? "BLOCKED — non-catalog contract type."
              : decision.decision === "draft-term-change"
              ? "DRAFTED for account-owner cosign — the agent NEVER autonomously commits a contract-term change. Synthetic — illustrative catalog, not certified contracting."
              : "ROUTED to account manager for benchmark-drift review."),
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "ProviderContractDecision",
        description:
          "Deterministically-produced provider-contracting decision — in-good-standing / benchmark-drift-review / draft-term-change / blocked-non-catalog-contract with the applied catalog rules, quality-gate + spend-drift analysis, primary reason code, routing target (auto-continue / account-manager-drift-review / account-owner-cosign / blocked-hold), and cosign flags (requiresAccountOwnerCosign:true / cosigned:false on every draft-term-change decision — the agent NEVER autonomously commits a contract-term change). Runs on the commercial plane — no PHI. The contract-type catalog, methodology catalog, rules, and reason codes are illustrative/synthetic, NOT Salesforce Health Cloud Provider Network Management, Optum Contract Manager, or a real payer's contract-lifecycle system.",
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
        traceSpanId: decideSpan.id,
        traceTaskId: taskId,
        requestRef: request.requestRef,
        providerRef: request.providerRef,
        contractRef: request.contractRef,
        contractTypeId: request.contractTypeId,
        methodologyId: request.methodologyId,
        contractingDecision: decision.decision,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        qualityGateMet: decision.qualityGateMet,
        spendDriftFraction: decision.spendDriftFraction,
        appliedRuleCount: decision.appliedRules.length,
        requiresAccountOwnerCosign: decision.requiresAccountOwnerCosign,
        contractsTraceToCatalog: catalogOk,
        contractChangeRequiresOwnerCosign: cosignOk,
        benchmarksTraceToMethodology: benchmarkOk
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
