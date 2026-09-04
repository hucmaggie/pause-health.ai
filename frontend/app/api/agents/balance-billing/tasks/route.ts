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
  type BalanceBillingDetermination,
  type BalanceBillingRequest,
  DEMO_BALANCE_BILLING_REQUEST,
  balanceBillBasisCited,
  balanceBillCostShareInNetwork,
  balanceBillProhibitionHonored,
  balanceBillingSummary,
  evaluateBalanceBilling
} from "../../../../../lib/balance-billing";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "balance-billing-agent";

/**
 * Google A2A `tasks/send` endpoint for the Balance Billing Protection (No Surprises Act)
 * agent — the payer-side service that decides whether the NSA prohibits balance-billing an
 * out-of-network claim, and on what basis a protected patient's cost-share is computed.
 *
 *   POST /api/agents/balance-billing/tasks
 *
 * Loads a claim and DETERMINISTICALLY evaluates it via evaluateBalanceBilling: it resolves
 * the protection basis, applies any effective notice-and-consent waiver (valid only for a
 * waivable, non-ancillary service), decides protection, computes the patient's cost-share
 * BASIS (in-network QPA for a protected claim, billed charge otherwise), and computes the
 * balance-bill amount (0 + prohibited for a protected claim). The determination is a pure
 * function of the request + the basis catalog (no randomness, no clock). Every
 * determination must cite a recorded protection basis, a protected patient's cost-share is
 * on the in-network basis, and a protected claim is never balance-billed. The bases + QPA
 * amounts are illustrative / synthetic; a real determination uses the actual QPA + the
 * federal IDR process under 45 CFR 149.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.balancebill.protection-basis-sourced (signal balanceBillBasisCited) — every
 *     determination must cite a recorded protection basis.
 *   - policy.balancebill.cost-share-in-network-basis (signal balanceBillCostShareInNetwork)
 *     — a protected patient's cost-share must be on the in-network (QPA) basis.
 *   - policy.balancebill.no-autonomous-balance-bill (signal balanceBillProhibitionHonored)
 *     — a protected claim may never allow a balance bill.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: BalanceBillingRequest, determination?: object } — the request is evaluated;
 *   a caller-asserted `determination` (admissible only if it cites a recorded basis, bases
 *   a protected patient's cost-share on the in-network amount, and allows no balance bill on
 *   a protected claim) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("balancebill");
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
      ? (data.request as BalanceBillingRequest)
      : DEMO_BALANCE_BILLING_REQUEST;

  // Deterministic balance-billing determination.
  const determination = evaluateBalanceBilling(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced determination.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as BalanceBillingDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals. A determination must cite a recorded basis, base a protected
  // patient's cost-share on the in-network amount, and allow no balance bill on a protected claim.
  const basisCited = balanceBillBasisCited(determinationForCheck);
  const costShareInNetwork = balanceBillCostShareInNetwork(determinationForCheck);
  const prohibitionHonored = balanceBillProhibitionHonored(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      balanceBillBasisCited: basisCited,
      balanceBillCostShareInNetwork: costShareInNetwork,
      balanceBillProhibitionHonored: prohibitionHonored
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "balancebill.evaluate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        claimRef: request.claimRef,
        balanceBillBasisCited: basisCited,
        balanceBillCostShareInNetwork: costShareInNetwork,
        balanceBillProhibitionHonored: prohibitionHonored,
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
          `Pause Agent Fabric blocked this balance-billing run: ${governance.blockingViolations
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

  const summary = balanceBillingSummary(determination);

  // Receive-claim span — the fabric records the claim it received, parented under the
  // caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "balancebill.receive-claim",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      patientRef: request.patientRef,
      basisId: determination.basisId,
      balanceBillBasisCited: basisCited,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Evaluate span — the deterministic protection + cost-share-basis evaluation, parented to
  // the received claim.
  const evaluateSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "balancebill.evaluate",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      protected: determination.protected,
      costShareBasis: determination.costShareBasis,
      balanceBillCostShareInNetwork: costShareInNetwork,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Recommend span — the balance-billing recommendation (prohibited for a protected claim),
  // parented to the evaluation.
  const recommendSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "balancebill.recommend",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      balanceBillProhibited: determination.balanceBillProhibited,
      balanceBillAmount: determination.balanceBillAmount,
      requiresHumanReview: determination.requiresHumanReview,
      balanceBillProhibitionHonored: prohibitionHonored,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the
  // recommendation. Every balance-billing decision is logged.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: recommendSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "balancebill.log-audit",
    protocol: "a2a",
    attributes: {
      claimRef: request.claimRef,
      basisId: determination.basisId,
      balanceBillProhibited: determination.balanceBillProhibited,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, claimRef: request.claimRef };

  const completedMessage = determination.protected
    ? `Balance-billing determination for ${request.claimRef}: ${determination.basisLabel} → PROTECTED, balance billing PROHIBITED; the patient's cost-share is on the in-network (QPA) basis of $${determination.inNetworkAllowed}, and the $${Math.max(determination.billedCharge - determination.inNetworkAllowed, 0)} difference may not be billed (synthetic — illustrative bases; a real determination uses the actual QPA under 45 CFR 149).`
    : `Balance-billing determination for ${request.claimRef}: ${determination.basisLabel} → not protected; a balance bill of $${determination.balanceBillAmount} is permitted and requires human review (synthetic — NOT a certified No Surprises Act engine).`;

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
        name: "BalanceBillingDetermination",
        description:
          "Deterministically-produced No Surprises Act balance-billing determination. It resolves the protection basis (emergency, out-of-network at an in-network facility, air ambulance, ground ambulance, in-network), applies any effective notice-and-consent waiver (valid only for a waivable, non-ancillary service — ancillary services such as anesthesiology / radiology / pathology can never be waived), decides whether the patient is PROTECTED from balance billing, computes the patient's cost-share BASIS (the in-network Qualifying Payment Amount for a protected claim, never the out-of-network billed charge — 45 CFR 149.110–149.130), and computes the balance-bill amount (0 + prohibited for a protected claim; billedCharge − allowed for a permitted one requiring human review). A protected claim can NEVER be balance-billed. The determination is a pure function of the request + the basis catalog (no randomness, no clock). The protection bases, waiver rules, ancillary handling, and QPA amounts are illustrative/synthetic, NOT a certified No Surprises Act engine — a real determination uses the actual Qualifying Payment Amount, the federal Independent Dispute Resolution process, the notice-and-consent requirements, and the provider's network contracts under 45 CFR 149.",
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
        claimRef: request.claimRef,
        patientRef: request.patientRef,
        basisId: summary.basisId,
        protected: determination.protected,
        waiverEffective: determination.waiverEffective,
        balanceBillProhibited: determination.balanceBillProhibited,
        costShareBasis: determination.costShareBasis,
        patientCostShareBasisAmount: determination.patientCostShareBasisAmount,
        balanceBillAmount: determination.balanceBillAmount,
        balanceBillAllowed: determination.balanceBillAllowed,
        requiresHumanReview: determination.requiresHumanReview,
        balanceBillBasisCited: basisCited,
        balanceBillCostShareInNetwork: costShareInNetwork,
        balanceBillProhibitionHonored: prohibitionHonored
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
