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
  type GoodFaithEstimateDetermination,
  type GoodFaithEstimateRequest,
  DEMO_GFE_REQUEST,
  evaluateGoodFaithEstimate,
  gfeChargeMasterSourced,
  gfeEstimateNotBinding,
  gfeExpectedItemsComplete,
  goodFaithEstimateSummary
} from "../../../../../lib/good-faith-estimate";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "good-faith-estimate-agent";

/**
 * Google A2A `tasks/send` endpoint for the Good Faith Estimate (No Surprises Act) agent —
 * the patient-access service that assembles an itemized Good Faith Estimate of expected
 * charges for a self-pay / uninsured patient BEFORE care, from a charge master.
 *
 *   POST /api/agents/good-faith-estimate/tasks
 *
 * Loads a GFE request and DETERMINISTICALLY evaluates it via evaluateGoodFaithEstimate: it
 * prices each expected line item from the charge master, verifies every reasonably-expected
 * co-item for the primary service is included, sums the total, and returns a GFE marked as
 * an ESTIMATE (binding:false) requiring patient confirmation, with the NSA $400 dispute
 * threshold recorded. The estimate is a pure function of the request's line items + the
 * charge master (no randomness, no clock). Every line item must be charge-master-sourced,
 * the estimate must include all reasonably-expected items, and a GFE is never a binding
 * bill. The charge master + rules are illustrative / synthetic; a real GFE is governed by
 * the No Surprises Act (45 CFR 149.610) + the provider's actual charges.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.gfe.charge-master-sourced (signal gfeChargeMasterSourced) — every priced line
 *     item must trace to a recorded charge-master entry at the catalog amount.
 *   - policy.gfe.expected-items-complete (signal gfeExpectedItemsComplete) — the estimate
 *     must include the primary service + every reasonably-expected co-item.
 *   - policy.gfe.estimate-not-binding (signal gfeEstimateNotBinding) — a GFE is an estimate
 *     requiring patient confirmation, never a binding / final bill.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: GoodFaithEstimateRequest, determination?: object } — the request is priced;
 *   a caller-asserted `determination` (admissible only if every line item is
 *   charge-master-sourced, all expected items are present, and it is not a binding bill)
 *   demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("gfe");
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
      ? (data.request as GoodFaithEstimateRequest)
      : DEMO_GFE_REQUEST;

  // Deterministic good-faith-estimate determination.
  const determination = evaluateGoodFaithEstimate(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced estimate.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as GoodFaithEstimateDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals. A determination must be charge-master-sourced, complete,
  // and presented as an estimate (never a binding bill).
  const chargeSourced = gfeChargeMasterSourced(determinationForCheck);
  const itemsComplete = gfeExpectedItemsComplete(determinationForCheck);
  const notBinding = gfeEstimateNotBinding(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      gfeChargeMasterSourced: chargeSourced,
      gfeExpectedItemsComplete: itemsComplete,
      gfeEstimateNotBinding: notBinding
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "gfe.price.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: request.patientRef,
        gfeChargeMasterSourced: chargeSourced,
        gfeExpectedItemsComplete: itemsComplete,
        gfeEstimateNotBinding: notBinding,
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
          `Pause Agent Fabric blocked this good-faith-estimate run: ${governance.blockingViolations
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

  const summary = goodFaithEstimateSummary(determination);

  // Receive-request span — the fabric records the GFE request it received, parented under
  // the caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "gfe.receive-request",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      primaryServiceId: determination.primaryServiceId,
      lineItemCount: determination.lineItems.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Price span — the deterministic charge-master pricing, parented to the received request.
  const priceSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "gfe.price",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      totalEstimate: determination.totalEstimate,
      gfeChargeMasterSourced: chargeSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Assemble span — the completeness + estimate-not-binding assembly, parented to pricing.
  const assembleSpan = recordInstantSpan({
    taskId,
    parentSpanId: priceSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "gfe.assemble",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      totalEstimate: determination.totalEstimate,
      gfeExpectedItemsComplete: itemsComplete,
      gfeEstimateNotBinding: notBinding,
      requiresPatientConfirmation: determination.requiresPatientConfirmation,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to assembly.
  // Every good-faith-estimate decision is logged.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: assembleSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "gfe.log-audit",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      primaryServiceId: determination.primaryServiceId,
      totalEstimate: determination.totalEstimate,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, patientRef: request.patientRef };

  const completedMessage = `Good Faith Estimate for ${request.patientRef}: ${determination.lineItems.length} line item(s), primary ${determination.primaryServiceLabel} → total $${determination.totalEstimate}. An ESTIMATE requiring patient confirmation — never a binding bill; the NSA $${determination.disputeThreshold} dispute threshold applies (synthetic — illustrative charge master; a real GFE is governed by the No Surprises Act / 45 CFR 149.610 + the provider's actual charges).`;

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
        name: "GoodFaithEstimateDetermination",
        description:
          "Deterministically-produced itemized Good Faith Estimate of expected charges for a self-pay / uninsured patient BEFORE care under the No Surprises Act. It prices each expected line item from the charge master (citing the charge-master service id at the catalog amount), verifies the estimate includes the primary service AND every reasonably-expected co-item, sums the total expected charge, and returns a GFE that is an ESTIMATE (binding:false) requiring patient confirmation, with the NSA $400 dispute threshold recorded (if the actual bill exceeds the GFE by $400 or more the patient has dispute rights). Every priced line item must be charge-master-sourced (no ad-hoc / off-schedule charges), the estimate must be COMPLETE (an omitted expected item understates the total and misleads the patient — 45 CFR 149.610), and a GFE is NEVER a binding / final bill. The estimate is a pure function of the request's line items + the charge master (no randomness, no clock). The charge master, categories, amounts, and expected-co-item rules are illustrative/synthetic, NOT a certified hospital chargemaster, machine-readable price-transparency file, or a real provider's charges — a real GFE is governed by the No Surprises Act (45 CFR 149.610), the provider's actual charges, and HHS guidance.",
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
        patientRef: request.patientRef,
        primaryServiceId: summary.primaryServiceId,
        lineItemCount: summary.lineItemCount,
        totalEstimate: determination.totalEstimate,
        allLineItemsSourced: determination.allLineItemsSourced,
        expectedItemsComplete: determination.expectedItemsComplete,
        binding: determination.binding,
        requiresPatientConfirmation: determination.requiresPatientConfirmation,
        disputeThreshold: determination.disputeThreshold,
        gfeChargeMasterSourced: chargeSourced,
        gfeExpectedItemsComplete: itemsComplete,
        gfeEstimateNotBinding: notBinding
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
