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
  type FinancialAssistanceDetermination,
  type FinancialAssistanceRequest,
  DEMO_FINANCIAL_ASSISTANCE_REQUEST,
  ecaGatedOnScreening,
  evaluateFinancialAssistance,
  finAssistHumanReviewed,
  finAssistScheduleCited,
  financialAssistanceSummary
} from "../../../../../lib/financial-assistance";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "financial-assistance-agent";

/**
 * Google A2A `tasks/send` endpoint for the Patient Financial Assistance & Charity Care
 * agent — the patient-access service that screens a self-pay / underinsured patient for
 * hospital financial assistance (charity care) under an IRS 501(r) FAP.
 *
 *   POST /api/agents/financial-assistance/tasks
 *
 * Loads a screening request and DETERMINISTICALLY evaluates it via
 * evaluateFinancialAssistance: it computes the household's income as a percentage of the
 * Federal Poverty Level, cites the governing FAP tier, and classifies the patient as
 * full-charity / partial-charity / not-eligible. The determination is a pure function of
 * the household size + income + FPL year + the request's own flags (no randomness, no
 * clock). It NEVER autonomously DENIES assistance (a not-eligible determination is a
 * RECOMMENDATION requiring human review with written notice + appeal rights) and NEVER
 * lets an extraordinary collection action proceed before screening is complete. The FAP
 * schedule + FPL table are illustrative / synthetic; real FAPs are governed by IRS
 * 501(r), the HHS Federal Poverty Guidelines, and each hospital's Board-approved policy.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.finassist.no-eca-before-screening (signal ecaGatedOnScreening) — never run
 *     an extraordinary collection action before financial screening is complete.
 *   - policy.finassist.fap-schedule-sourced (signal finAssistScheduleCited) — every
 *     determination must cite a recorded FAP tier.
 *   - policy.finassist.no-autonomous-denial (signal finAssistHumanReviewed) — a denial
 *     is human-review-gated; it never autonomously denies charity care.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: FinancialAssistanceRequest, determination?: object } — the request is
 *   screened; a caller-asserted `determination` (admissible only if it gates any ECA on
 *   complete screening, cites a recorded FAP tier, and is human-review-gated for a
 *   denial) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("finassist");
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
      ? (data.request as FinancialAssistanceRequest)
      : DEMO_FINANCIAL_ASSISTANCE_REQUEST;

  // Deterministic financial-assistance determination.
  const determination = evaluateFinancialAssistance(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced recommendation.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as FinancialAssistanceDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals. A determination must gate any ECA on complete screening,
  // cite a recorded FAP tier, and be human-review-gated for a denial.
  const ecaGated = ecaGatedOnScreening(determinationForCheck);
  const scheduleCited = finAssistScheduleCited(determinationForCheck);
  const humanReviewed = finAssistHumanReviewed(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      ecaGatedOnScreening: ecaGated,
      finAssistScheduleCited: scheduleCited,
      finAssistHumanReviewed: humanReviewed
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "finassist.evaluate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: request.patientRef,
        ecaGatedOnScreening: ecaGated,
        finAssistScheduleCited: scheduleCited,
        finAssistHumanReviewed: humanReviewed,
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
          `Pause Agent Fabric blocked this financial-assistance run: ${governance.blockingViolations
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

  const summary = financialAssistanceSummary(determination);

  // Receive-application span — the fabric records the screening request it received,
  // parented under the caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "finassist.receive-application",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      householdSize: request.householdSize,
      ecaGatedOnScreening: ecaGated,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Evaluate span — the deterministic FPL + FAP-tier evaluation, parented to the
  // received application.
  const evaluateSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "finassist.evaluate",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      fplPercent: determination.fplPercent,
      assistanceTier: determination.assistanceTier,
      tierId: determination.tierId,
      finAssistScheduleCited: scheduleCited,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Recommend span — the charity-care recommendation (never an autonomous denial),
  // parented to the evaluation.
  const recommendSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "finassist.recommend",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      assistanceTier: determination.assistanceTier,
      discountPct: determination.discountPct,
      requiresHumanReview: determination.requiresHumanReview,
      finAssistHumanReviewed: humanReviewed,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the
  // recommendation. Every financial-assistance decision is logged.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: recommendSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "finassist.log-audit",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      assistanceTier: determination.assistanceTier,
      tierId: determination.tierId,
      discountPct: determination.discountPct,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, patientRef: request.patientRef };

  const completedMessage =
    determination.presumptivelyEligible
      ? `Financial-assistance screening for ${request.patientRef}: presumptively eligible (${determination.presumptiveReasonId}) → FULL CHARITY (100% discount). A benefit granted; no denial (synthetic — illustrative FAP schedule; real charity care is governed by IRS 501(r)).`
      : determination.assistanceTier === "not-eligible"
        ? `Financial-assistance screening for ${request.patientRef}: ${determination.fplPercent}% FPL → NOT ELIGIBLE for charity care under this FAP. A DENIAL requiring human review with written notice + appeal rights; the agent never autonomously denies (synthetic — NOT a certified financial-assistance system).`
        : `Financial-assistance screening for ${request.patientRef}: ${determination.fplPercent}% FPL → ${determination.tierLabel} (${determination.discountPct}% discount). A benefit granted; no autonomous collection action precedes screening (synthetic — illustrative FAP schedule; real charity care is governed by IRS 501(r) / 26 CFR 1.501(r), the HHS Federal Poverty Guidelines, and the hospital's Board-approved FAP).`;

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
        name: "FinancialAssistanceDetermination",
        description:
          "Deterministically-produced patient financial-assistance / charity-care determination under an IRS 501(r) FAP. It computes the household's income as a percentage of the Federal Poverty Level (from the household size's FPL base), cites the governing FAP tier (full-charity, partial-charity, or not-eligible) or a recorded presumptive-eligibility reason, and classifies the patient with a discount percentage. An extraordinary collection action may proceed only when screening is complete (IRS 501(r)(6)); a not-eligible determination is a DENIAL requiring human review with written notice + appeal rights (501(r)(4)) — the agent NEVER autonomously denies charity care, and granting full/partial charity is a benefit. The determination is a pure function of the household size + income + FPL year + the request's own flags (no randomness, no clock). The FAP tier schedule, discount percentages, FPL table, and presumptive-eligibility reasons are illustrative/synthetic, NOT a certified financial-assistance system — real hospital FAPs are governed by IRS 501(r) / 26 CFR 1.501(r), the HHS Federal Poverty Guidelines, and each hospital's Board-approved FAP + state charity-care law.",
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
        fplPercent: determination.fplPercent,
        assistanceTier: determination.assistanceTier,
        tierId: summary.tierId,
        discountPct: determination.discountPct,
        presumptivelyEligible: determination.presumptivelyEligible,
        screeningComplete: determination.screeningComplete,
        ecaAllowed: determination.ecaAllowed,
        requiresHumanReview: determination.requiresHumanReview,
        ecaGatedOnScreening: ecaGated,
        finAssistScheduleCited: scheduleCited,
        finAssistHumanReviewed: humanReviewed
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
