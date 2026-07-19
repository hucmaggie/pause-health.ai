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
  type PatientQualitySignals,
  DEMO_AS_OF_PERIOD,
  DEMO_PANEL,
  assembleSubmission,
  collectAppliedExclusions,
  exclusionsTraceToCatalog,
  measuresTraceToCatalog,
  rollUpPanel,
  submissionRequiresHumanApproval
} from "../../../../../lib/hedis-quality";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "hedis-quality-agent";

/**
 * Google A2A `tasks/send` endpoint for the HEDIS & Quality Reporting agent —
 * a panel-level QUALITY-REPORTING agent that rolls up per-patient signals into
 * HEDIS / Star measure compliance (numerator, denominator, exclusions, rate)
 * for value-based-care contracts.
 *
 *   POST /api/agents/hedis-quality/tasks
 *
 * DETERMINISTICALLY rolls up a whole PANEL against a defined HEDIS measure
 * catalog + catalog-sourced exclusions and assembles a submission package for
 * human quality-team review. It NEVER autonomously submits to a payer / CMS /
 * quality registry. The rollup is a pure function of the panel + the caller-
 * provided `asOfPeriod` (accepted as data — no clock). The measures,
 * thresholds, and exclusions are illustrative/synthetic, NOT NCQA-certified.
 *
 * Enforced-block policies checked before any submission is acted on:
 *   - policy.hedis.measure-catalog-sourced (signal measuresTraceToCatalog) —
 *     every scored measure must trace to the defined HEDIS measure catalog.
 *   - policy.hedis.exclusion-integrity (signal exclusionsTraceToCatalog) —
 *     every applied denominator exclusion must trace to a defined catalog
 *     exclusion on that measure.
 *   - policy.hedis.no-autonomous-submission (signal
 *     submissionRequiresHumanApproval) — a submission package requires human
 *     quality-team approval and is never autonomously filed.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { panel?: PatientQualitySignals[], asOfPeriod?: string,
 *     appliedExclusions?: Array<{measureId, exclusionId}>,
 *     submissionPlan?: object,
 *     perMeasure?: Array<{measureId, ...}> } — the panel is rolled up against
 *   the measure catalog; a caller-asserted `perMeasure` set (admissible only if
 *   every measureId is on the catalog) demonstrates the measure-catalog-sourced
 *   block, a caller-asserted `appliedExclusions` set (admissible only if every
 *   exclusion is on its measure's spec) demonstrates the exclusion-integrity
 *   block, and a caller-asserted `submissionPlan` (admissible only if it
 *   requires human approval and is not marked submitted) demonstrates the
 *   no-autonomous-submission block.
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
  const taskId = params.id || newTaskId("hedis");
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
  const panel = Array.isArray(data.panel)
    ? (data.panel as PatientQualitySignals[])
    : DEMO_PANEL;
  const asOfPeriod =
    typeof data.asOfPeriod === "string" && data.asOfPeriod.length > 0
      ? (data.asOfPeriod as string)
      : DEMO_AS_OF_PERIOD;

  // Deterministic panel roll-up + submission package.
  const report = rollUpPanel(panel, asOfPeriod);
  const submission = assembleSubmission(report);

  // The measures the catalog-source gate checks: the caller-asserted set (to
  // demonstrate the block) or the produced report's measures.
  const assertedPerMeasure = Array.isArray(data.perMeasure)
    ? (data.perMeasure as Array<{ measureId: string }>)
    : undefined;
  const measuresForCheck = assertedPerMeasure ?? report.perMeasure;

  // The exclusions the integrity gate checks: the caller-asserted set (to
  // demonstrate the block) or the panel's applied exclusions.
  const assertedExclusions = Array.isArray(data.appliedExclusions)
    ? (data.appliedExclusions as Array<{ measureId: string; exclusionId: string }>)
    : undefined;
  const exclusionsForCheck = assertedExclusions ?? collectAppliedExclusions(panel);

  // The submission plan the no-autonomous-submission gate checks: the caller-
  // asserted plan (to demonstrate the block) or the produced package.
  const assertedSubmissionPlan =
    data.submissionPlan && typeof data.submissionPlan === "object"
      ? (data.submissionPlan as Record<string, unknown>)
      : undefined;
  const submissionPlanForCheck = assertedSubmissionPlan ?? submission;

  // Honest governance signals. Every measure must trace to the catalog; every
  // exclusion must trace to a catalog exclusion; a submission requires human
  // approval and is never autonomously filed.
  const measuresCatalog = measuresTraceToCatalog(measuresForCheck);
  const exclusionsIntegrity = exclusionsTraceToCatalog(exclusionsForCheck);
  const submissionHumanApproved = submissionRequiresHumanApproval(submissionPlanForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      measuresTraceToCatalog: measuresCatalog,
      exclusionsTraceToCatalog: exclusionsIntegrity,
      submissionRequiresHumanApproval: submissionHumanApproved
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "hedis.rollup.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        asOfPeriod,
        panelSize: panel.length,
        measuresTraceToCatalog: measuresCatalog,
        exclusionsTraceToCatalog: exclusionsIntegrity,
        submissionRequiresHumanApproval: submissionHumanApproved,
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
          `Pause Agent Fabric blocked this HEDIS quality-reporting run: ${governance.blockingViolations
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

  // Rollup span — records the panel-level roll-up parented under the caller's
  // span if any.
  const rollupSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "hedis.rollup",
    protocol: "a2a",
    attributes: {
      asOfPeriod,
      panelSize: panel.length,
      measureCount: report.perMeasure.length,
      measuresTraceToCatalog: measuresCatalog,
      exclusionsTraceToCatalog: exclusionsIntegrity,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Assemble-submission span — records the human-approval-gated package.
  const assembleSpan = recordInstantSpan({
    taskId,
    parentSpanId: rollupSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "hedis.assemble-submission",
    protocol: "a2a",
    attributes: {
      submissionState: submission.state,
      requiresQualityTeamApproval: submission.requiresQualityTeamApproval,
      submitted: submission.submitted,
      submissionRequiresHumanApproval: submissionHumanApproved,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const totalGaps = report.perMeasure.reduce(
    (sum, m) => sum + m.gapPatientRefs.length,
    0
  );
  const rateSummary = report.perMeasure
    .map(
      (m) =>
        `${m.measureCode} ${m.rate === null ? "n/a" : `${Math.round(m.rate * 100)}%`}`
    )
    .join(", ");
  const result = { report, submission };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Rolled up ${panel.length} patient${panel.length === 1 ? "" : "s"} across ${
          report.perMeasure.length
        } HEDIS measure${report.perMeasure.length === 1 ? "" : "s"} for ${asOfPeriod} (${rateSummary}); ${totalGaps} open care gap${
          totalGaps === 1 ? "" : "s"
        } identified; assembled submission package ${submission.packageId} — READY FOR HUMAN QUALITY-TEAM REVIEW (the agent never autonomously submits). Every measure traces to the catalog; every applied exclusion traces to a defined catalog exclusion (synthetic — illustrative measures, thresholds, and exclusions, not an NCQA-certified HEDIS engine).`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "PanelQualityReport",
        description:
          "Deterministically-produced HEDIS quality report over a panel of menopause/midlife patients — per-measure eligible / excluded / denominator / numerator / rate with the non-compliant patient list per measure, plus a submission package assembled for human quality-team review (never autonomously submitted to a payer / CMS / quality registry). Every measure traces to the defined HEDIS measure catalog; every applied denominator exclusion traces to a defined catalog exclusion on that measure. The measure catalog, thresholds, and exclusions are illustrative/synthetic, NOT an NCQA-certified HEDIS engine.",
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
        traceSpanId: assembleSpan.id,
        traceTaskId: taskId,
        asOfPeriod,
        panelSize: panel.length,
        measureCount: report.perMeasure.length,
        gapCount: totalGaps,
        submissionState: submission.state,
        submissionPackageId: submission.packageId,
        measuresTraceToCatalog: measuresCatalog,
        exclusionsTraceToCatalog: exclusionsIntegrity,
        submissionRequiresHumanApproval: submissionHumanApproved
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
