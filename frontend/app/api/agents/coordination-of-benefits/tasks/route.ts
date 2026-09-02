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
  type CobDetermination,
  type CobRequest,
  DEMO_COB_REQUEST,
  cobHumanCosigned,
  cobDecreeHonored,
  cobRuleCited,
  cobSummary,
  evaluateCoordinationOfBenefits
} from "../../../../../lib/coordination-of-benefits";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "coordination-of-benefits-agent";

/**
 * Google A2A `tasks/send` endpoint for the Coordination of Benefits agent — the
 * plan-side payer & plan operations service that decides the order of benefits
 * when a patient carries more than one coverage.
 *
 *   POST /api/agents/coordination-of-benefits/tasks
 *
 * Loads the patient's COVERAGES and DETERMINISTICALLY orders them (primary →
 * secondary → tertiary) via evaluateCoordinationOfBenefits, applying the NAIC-model
 * order-of-benefits rules + Medicare Secondary Payer + the birthday rule, citing the
 * governing COB rule for every ordering decision. The order is a pure function of the
 * coverages + the request's own context (no randomness, no clock). It NEVER
 * autonomously adjudicates or pays: a determination sets payer ORDER only and is a
 * RECOMMENDATION requiring human cosign, and an active custody / court decree ALWAYS
 * overrides the birthday rule. The COB rule catalog + payers are illustrative /
 * synthetic; real COB is governed by the NAIC COB Model Regulation, MSP, and
 * Medicaid TPL.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.cob.custody-decree-overrides-birthday (signal cobDecreeHonored) — never
 *     order a dependent child's coverages against an active custody decree.
 *   - policy.cob.order-of-benefits-rule-sourced (signal cobRuleCited) — every
 *     ordering decision must cite a recorded COB rule.
 *   - policy.cob.no-autonomous-adjudication (signal cobHumanCosigned) — a
 *     determination is human-cosign-gated; it never autonomously adjudicates.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: CobRequest, determination?: object } — the coverages are ordered;
 *   a caller-asserted `determination` (admissible only if it honors an active custody
 *   decree, cites a recorded COB rule for every ordering, and is human-cosign-gated)
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
  const taskId = params.id || newTaskId("cob");
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
      ? (data.request as CobRequest)
      : DEMO_COB_REQUEST;

  // Deterministic order-of-benefits determination.
  const determination = evaluateCoordinationOfBenefits(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced recommendation.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as CobDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals. A determination must honor an active custody decree,
  // cite a recorded COB rule for every ordering, and be human-cosign-gated.
  const decreeHonored = cobDecreeHonored(determinationForCheck);
  const ruleCited = cobRuleCited(determinationForCheck);
  const humanCosigned = cobHumanCosigned(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      cobDecreeHonored: decreeHonored,
      cobRuleCited: ruleCited,
      cobHumanCosigned: humanCosigned
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "cob.order-benefits.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: request.patientRef,
        isDependentChild: request.isDependentChild,
        cobDecreeHonored: decreeHonored,
        cobRuleCited: ruleCited,
        cobHumanCosigned: humanCosigned,
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
          `Pause Agent Fabric blocked this coordination-of-benefits run: ${governance.blockingViolations
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

  const summary = cobSummary(determination);

  // Receive-coverages span — the fabric records the coverages it received to
  // coordinate, parented under the caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "cob.receive-coverages",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      isDependentChild: request.isDependentChild,
      coverageCount: Array.isArray(request.coverages) ? request.coverages.length : 0,
      cobDecreeHonored: decreeHonored,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Order-benefits span — the deterministic ordering against the COB rule catalog,
  // parented to the received coverages.
  const orderSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "cob.order-benefits",
    protocol: "a2a",
    attributes: {
      primaryCoverageId: determination.primaryCoverageId,
      primaryRuleId: determination.orderedCoverages[0]?.decidingRuleId,
      custodyDecreeApplied: determination.custodyDecreeApplied,
      cobRuleCited: ruleCited,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Recommend span — the payer-order recommendation (never an autonomous
  // adjudication), parented to the ordering.
  const recommendSpan = recordInstantSpan({
    taskId,
    parentSpanId: orderSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "cob.recommend",
    protocol: "a2a",
    attributes: {
      primaryCoverageId: determination.primaryCoverageId,
      requiresHumanCosign: determination.requiresHumanCosign,
      cobHumanCosigned: humanCosigned,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the
  // recommendation. Every coordination-of-benefits decision is logged.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: recommendSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "cob.log-audit",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      primaryCoverageId: determination.primaryCoverageId,
      custodyDecreeApplied: determination.custodyDecreeApplied,
      requiresHumanCosign: determination.requiresHumanCosign,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, patientRef: request.patientRef };

  const primary = determination.orderedCoverages[0];

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        determination.orderedCoverages.length === 0
          ? `Coordination of benefits for ${request.patientRef}: no coverage on file — nothing to coordinate (synthetic — illustrative COB rule catalog; real COB is governed by the NAIC COB Model Regulation).`
          : determination.custodyDecreeApplied
            ? `Coordination of benefits for ${request.patientRef}: PRIMARY is ${primary.payerName} (${primary.coverageId}) — an active custody / court decree overrides the birthday rule. This is a payer-order RECOMMENDATION requiring human cosign; the agent never autonomously adjudicates (synthetic — NOT a certified coordination-of-benefits engine).`
            : `Coordination of benefits for ${request.patientRef}: PRIMARY is ${primary.payerName} (${primary.coverageId}) under ${primary.decidingRuleLabel}${
                determination.orderedCoverages.length > 1
                  ? `, ${determination.orderedCoverages.length} coverages coordinated`
                  : ""
              }. This is a payer-order RECOMMENDATION requiring human cosign; the agent never autonomously adjudicates (synthetic — illustrative COB rule catalog; real COB is governed by the NAIC COB Model Regulation, Medicare Secondary Payer, and Medicaid TPL).`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "CobDetermination",
        description:
          "Deterministically-produced coordination-of-benefits / order-of-benefits determination for a patient + coverages. The coverages are ordered primary → secondary → tertiary, each citing the governing COB rule (custody-decree, Medicaid-payer-of-last-resort, Medicare-secondary-payer, subscriber-before-dependent, active-before-inactive, the birthday rule, or the longer-coverage tie-break). An active custody / court decree ALWAYS overrides the birthday rule. The determination sets payer ORDER only — it is a RECOMMENDATION requiring human cosign (requiresHumanCosign:true) and the agent NEVER autonomously adjudicates or pays. The order is a pure function of the coverages + the request's own context (no randomness, no clock). The COB rule catalog, plan types, and payers are illustrative/synthetic, NOT a certified coordination-of-benefits engine — real COB is governed by the NAIC COB Model Regulation, Medicare Secondary Payer (42 CFR 411), Medicaid third-party liability (42 CFR 433.139), ERISA plan documents, and state insurance code.",
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
        isDependentChild: determination.isDependentChild,
        primaryCoverageId: determination.primaryCoverageId,
        citedRuleIds: summary.citedRuleIds,
        custodyDecreeApplied: determination.custodyDecreeApplied,
        requiresHumanCosign: determination.requiresHumanCosign,
        cobDecreeHonored: decreeHonored,
        cobRuleCited: ruleCited,
        cobHumanCosigned: humanCosigned
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
