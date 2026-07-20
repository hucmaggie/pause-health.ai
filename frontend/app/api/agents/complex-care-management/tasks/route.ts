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
  type CcmBillingPackage,
  type CcmEligibility,
  type CcmMonthContext,
  type CcmTimeSummary,
  DEMO_ELIGIBLE_PATIENT,
  assembleCcmMonthReport,
  billingRequiresHumanApproval,
  eligibilityTracesToCatalog,
  timeEntriesAddUp
} from "../../../../../lib/complex-care-management";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "complex-care-management-agent";

/**
 * Google A2A `tasks/send` endpoint for the Complex Care Management Agent —
 * confirms Medicare CCM eligibility, tracks per-activity time, and assembles
 * a CPT-coded billing package for human quality-team review.
 *
 *   POST /api/agents/complex-care-management/tasks
 *
 * DETERMINISTICALLY produces the eligibility + time summary + CPT selection
 * + billing package. It NEVER autonomously submits a CMS claim.
 *
 * Enforced-block policies checked before the report is returned:
 *   - policy.ccm.eligibility-catalog-sourced (signal
 *     eligibilityTracesToCatalog)
 *   - policy.ccm.no-autonomous-billing (signal billingRequiresHumanApproval)
 *   - policy.ccm.time-integrity (signal timeEntriesAddUp)
 *
 * Input (data part):
 *   { context?: CcmMonthContext,
 *     eligibilityOverride?: CcmEligibility,
 *     billingOverride?: CcmBillingPackage,
 *     timeSummaryOverride?: CcmTimeSummary } — the context is processed by
 *   default; overrides are used to demonstrate the three governance blocks.
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
  const taskId = params.id || newTaskId("ccm");
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
  const context =
    data.context && typeof data.context === "object"
      ? (data.context as CcmMonthContext)
      : DEMO_ELIGIBLE_PATIENT;

  // Ground-truth deterministic computation.
  const report = assembleCcmMonthReport(context);

  // Governance-signal targets — caller-asserted overrides let the fabric
  // demonstrate each block without altering the core computation.
  const eligibilityForCheck =
    data.eligibilityOverride && typeof data.eligibilityOverride === "object"
      ? (data.eligibilityOverride as CcmEligibility)
      : report.eligibility;
  const billingForCheck =
    "billingOverride" in data
      ? (data.billingOverride as CcmBillingPackage | null)
      : report.billingPackage;
  const timeForCheckSource =
    data.timeSummaryOverride && typeof data.timeSummaryOverride === "object"
      ? (data.timeSummaryOverride as CcmTimeSummary)
      : report.timeSummary;

  // Adapter shape for timeEntriesAddUp (needs entries + totalMinutes).
  const timeAdapter = {
    entries: (context.timeEntries ?? []).map((e) => ({
      activityId: e.activityId,
      minutes: e.minutes
    })),
    totalMinutes: timeForCheckSource.totalMinutes
  };

  const eligibilityCatalog = eligibilityTracesToCatalog({
    qualifyingConditions: eligibilityForCheck.qualifyingConditions
  });
  const billingHumanApproval = billingRequiresHumanApproval(billingForCheck);
  const timeAddsUp = timeEntriesAddUp(timeAdapter);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      eligibilityTracesToCatalog: eligibilityCatalog,
      billingRequiresHumanApproval: billingHumanApproval,
      timeEntriesAddUp: timeAddsUp
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "ccm.assemble.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: context.patientRef,
        month: context.month,
        eligibilityTracesToCatalog: eligibilityCatalog,
        billingRequiresHumanApproval: billingHumanApproval,
        timeEntriesAddUp: timeAddsUp,
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
          `Pause Agent Fabric blocked this CCM run: ${governance.blockingViolations
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

  // Eligibility span — records the eligibility outcome.
  const eligibilitySpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "ccm.evaluate-eligibility",
    protocol: "a2a",
    attributes: {
      patientRef: context.patientRef,
      month: context.month,
      eligible: report.eligibility.eligible,
      qualifyingConditionCount: report.eligibility.qualifyingConditions.length,
      eligibilityTracesToCatalog: eligibilityCatalog,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Time span — records the time summary.
  const timeSpan = recordInstantSpan({
    taskId,
    parentSpanId: eligibilitySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "ccm.summarize-time",
    protocol: "a2a",
    attributes: {
      totalMinutes: report.timeSummary.totalMinutes,
      activityCount: report.timeSummary.perActivity.length,
      everyActivityIsCatalogSourced: report.timeSummary.everyActivityIsCatalogSourced,
      timeEntriesAddUp: timeAddsUp,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Billing span — records the billing package (or its absence).
  const billingSpan = recordInstantSpan({
    taskId,
    parentSpanId: timeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "ccm.assemble-billing-package",
    protocol: "a2a",
    attributes: {
      cptCode: report.billingPackage?.cptCode ?? "NOT_BILLABLE",
      state: report.billingPackage?.state ?? "not-billable",
      billingRequiresHumanApproval: billingHumanApproval,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { report };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        report.eligibility.eligible
          ? `CCM month report for ${report.patientRef} · ${report.month} · eligible · ${report.timeSummary.totalMinutes}min · ${
              report.billingPackage?.cptCode
            } package assembled for HUMAN QUALITY-TEAM REVIEW (never autonomously submitted to CMS). Synthetic — illustrative catalog + refs, not certified CCM billing.`
          : `CCM month report for ${report.patientRef} · ${report.month}: not eligible — ${report.eligibility.ineligibilityReasons.join("; ")}. No billing package assembled.`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "CcmMonthReport",
        description:
          "Deterministically-produced monthly CCM report — eligibility (with qualifying conditions catalog-sourced + Medicare-age gate + coverage + consent flags), a time summary (per-activity roll-up sorted by activityId ascending + total minutes + everyActivityIsCatalogSourced flag), and a billing package (state ready-for-quality-team-review OR not-billable, CPT code from the 99490/99491/99487/99489 ladder, requiresQualityTeamApproval:true, submitted:false — the agent NEVER autonomously files a CMS claim). The chronic-condition catalog, CCM activity catalog, CPT thresholds, and Medicare flags are illustrative/synthetic, NOT CMS Chapter 12 CCM billing or a live Medicare claim-submission system.",
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
        traceSpanId: billingSpan.id,
        traceTaskId: taskId,
        patientRef: context.patientRef,
        month: context.month,
        eligible: report.eligibility.eligible,
        qualifyingConditionCount: report.eligibility.qualifyingConditions.length,
        totalMinutes: report.timeSummary.totalMinutes,
        cptCode: report.billingPackage?.cptCode ?? "NOT_BILLABLE",
        billingState: report.billingPackage?.state ?? "not-billable",
        eligibilityTracesToCatalog: eligibilityCatalog,
        billingRequiresHumanApproval: billingHumanApproval,
        timeEntriesAddUp: timeAddsUp
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
