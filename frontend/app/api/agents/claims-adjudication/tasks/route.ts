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
  type ClaimAdjudicationDecision,
  type ClaimAdjudicationRequest,
  DEMO_CLEAN_CLAIM,
  adjudicateClaim,
  decisionsCiteReasonCodes,
  denialRequiresAdjudicatorCosign,
  editsTraceToCatalog
} from "../../../../../lib/claims-adjudication";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "claims-adjudication-agent";

/**
 * Google A2A `tasks/send` endpoint for the Claims Adjudication Assistant —
 * applies first-pass payer-side edits, classifies as clean-pay / pend /
 * deny-drafted with a specific reason code, and routes anything non-clean
 * to a human. NEVER autonomously finalizes a denial.
 *
 *   POST /api/agents/claims-adjudication/tasks
 *
 * Enforced-block policies checked before the decision is returned:
 *   - policy.claims.edit-catalog-sourced (signal editsTraceToCatalog)
 *   - policy.claims.no-autonomous-denial (signal
 *     denialRequiresAdjudicatorCosign)
 *   - policy.claims.reason-code-integrity (signal
 *     decisionsCiteReasonCodes)
 *
 * Input (data part):
 *   { request?: ClaimAdjudicationRequest,
 *     decisionOverride?: ClaimAdjudicationDecision } — the request is
 *   adjudicated by default; a decisionOverride demonstrates the three
 *   governance blocks.
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
  const taskId = params.id || newTaskId("claim");
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
      ? (data.request as ClaimAdjudicationRequest)
      : DEMO_CLEAN_CLAIM;

  // Ground-truth deterministic adjudication.
  const decision = adjudicateClaim(request);

  // Governance-signal target — a caller-asserted override lets the fabric
  // demonstrate each block without altering the core computation.
  const decisionForCheck =
    data.decisionOverride && typeof data.decisionOverride === "object"
      ? (data.decisionOverride as ClaimAdjudicationDecision)
      : decision;

  const editsCatalog = editsTraceToCatalog(decisionForCheck.appliedEdits);
  const cosignOk = denialRequiresAdjudicatorCosign(decisionForCheck);
  const reasonCodesOk = decisionsCiteReasonCodes(decisionForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      editsTraceToCatalog: editsCatalog,
      denialRequiresAdjudicatorCosign: cosignOk,
      decisionsCiteReasonCodes: reasonCodesOk
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "claims.adjudicate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        claimRef: request.claimRef,
        memberRef: request.memberRef,
        editsTraceToCatalog: editsCatalog,
        denialRequiresAdjudicatorCosign: cosignOk,
        decisionsCiteReasonCodes: reasonCodesOk,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        phiAccessed: true,
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
          `Pause Agent Fabric blocked this claim adjudication: ${governance.blockingViolations
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

  // Evaluate span — records applied edits.
  const evaluateSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "claims.evaluate-edits",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      memberRef: request.memberRef,
      appliedEditCount: decision.appliedEdits.length,
      editsTraceToCatalog: editsCatalog,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Decide span — records classification + route + reason code.
  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "claims.decide",
    protocol: "a2a",
    attributes: {
      decision: decision.decision,
      primaryReasonCode: decision.primaryReasonCode,
      routedTo: decision.routedTo,
      requiresAdjudicatorCosign: decision.requiresAdjudicatorCosign,
      denialRequiresAdjudicatorCosign: cosignOk,
      decisionsCiteReasonCodes: reasonCodesOk,
      phiAccessed: true,
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
        decision.decision === "clean-pay"
          ? `Claim ${decision.claimRef} · clean-pay (${(decision.totalBilledCents / 100).toFixed(2)} USD, ${decision.appliedEdits.length} edits fired).`
          : `Claim ${decision.claimRef} · ${decision.decision} · ${decision.primaryReasonCode} · routed to ${decision.routedTo} · ${decision.appliedEdits.length} edit${decision.appliedEdits.length === 1 ? "" : "s"} hit. ` +
            (decision.decision === "deny-drafted"
              ? "DENIAL is DRAFTED for adjudicator cosign — the agent NEVER autonomously finalizes a denial."
              : "Pended for human review. Synthetic — illustrative catalog + refs, not certified adjudication."),
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "ClaimAdjudicationDecision",
        description:
          "Deterministically-produced first-pass claim adjudication decision — clean-pay / pend-clinical-review / pend-adjudicator-review / deny-drafted with a specific catalog reason code, the sorted list of applied catalog edits, the routing target, and denial-cosign flags (requiresAdjudicatorCosign:true, cosigned:false — the agent NEVER autonomously finalizes a denial). The edit catalog, reason-code catalog, and benefit rules are illustrative/synthetic, NOT CMS X12 837, an NCCI PTP edit table, an LCD/NCD registry, or a real payer's benefit configuration.",
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
        claimRef: request.claimRef,
        memberRef: request.memberRef,
        claimDecision: decision.decision,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        appliedEditCount: decision.appliedEdits.length,
        totalBilledCents: decision.totalBilledCents,
        requiresAdjudicatorCosign: decision.requiresAdjudicatorCosign,
        editsTraceToCatalog: editsCatalog,
        denialRequiresAdjudicatorCosign: cosignOk,
        decisionsCiteReasonCodes: reasonCodesOk
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
