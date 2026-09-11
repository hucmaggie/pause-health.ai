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
  type ReportableCaseDetermination,
  type ReportableCaseRequest,
  DEMO_REPORTABLE_CASE_REQUEST,
  classificationConsistent,
  evaluateReportableCase,
  factsSourced,
  noAutonomousReport,
  reportableCaseSummary
} from "../../../../../lib/reportable-condition";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "reportable-condition-agent";

/**
 * Google A2A `tasks/send` endpoint for the Reportable / Notifiable Condition Case Classification agent — a
 * care-coordination / public-health-compliance service on the patient-care plane that classifies a patient
 * case against a nested public-health CASE DEFINITION using RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION.
 *
 *   POST /api/agents/reportable-condition/tasks
 *
 * Loads a reportable-case request and DETERMINISTICALLY evaluates it via evaluateReportableCase: it
 * recursively walks each classification's criteria tree (nested all-of / any-of / not over the case's
 * facts), marks each classification met / not, selects the highest-precedence one that holds (else
 * not-a-case), and derives the reportable flag. There is no stable matching, no geospatial distance, no
 * checksum, no union-find, no percentile, no identity match, no largest-remainder apportionment, no FSM
 * transition, no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval
 * merge, no topological sort, no set-difference, and no hash chain — it is RECURSIVE BOOLEAN EXPRESSION-TREE
 * EVALUATION, a pure function of the facts + definition. Every criterion is sourced, the classification
 * recomputes, and nothing is reported — an epidemiologist confirms every classification. This is a
 * PHI-bearing agent (phiAccessed:true throughout). The condition + definition are illustrative; real
 * notifiable-condition reporting uses the jurisdiction's official CSTE / CDC case definitions and eCR / eICR
 * electronic case reporting.
 *
 * Enforced-block policies checked before any classification leaves the fabric:
 *   - policy.reportable.facts-sourced (signal caseFactsSourced).
 *   - policy.reportable.classification-consistent (signal classificationConsistent).
 *   - policy.reportable.no-autonomous-report (signal noAutonomousReport).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: ReportableCaseRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if every criterion is sourced, the classification recomputes, and it is
 *   not auto-reported) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("reportable-condition");
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
      ? (data.request as ReportableCaseRequest)
      : DEMO_REPORTABLE_CASE_REQUEST;

  // Deterministic reportable-condition classification.
  const determination = evaluateReportableCase(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as ReportableCaseDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: facts-sourced + classification-consistent + no autonomous report.
  const sourced = factsSourced(determinationForCheck);
  const consistent = classificationConsistent(determinationForCheck);
  const noAutonomous = noAutonomousReport(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      caseFactsSourced: sourced,
      classificationConsistent: consistent,
      noAutonomousReport: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "rc.evaluate-criteria.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        caseRef: request.caseRef,
        caseFactsSourced: sourced,
        classificationConsistent: consistent,
        noAutonomousReport: noAutonomous,
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
          `Pause Agent Fabric blocked this reportable-condition classification: ${governance.blockingViolations
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

  const summary = reportableCaseSummary(determination);

  // Receive-case span — the fabric records the case it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "rc.receive-case",
    protocol: "a2a",
    attributes: {
      caseRef: request.caseRef,
      condition: determination.condition,
      factCount: determination.facts.length,
      classificationCount: determination.classificationResults.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Evaluate-criteria span — the recursive boolean tree evaluation, parented to the received case.
  const evalSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "rc.evaluate-criteria",
    protocol: "a2a",
    attributes: {
      caseRef: request.caseRef,
      caseFactsSourced: sourced,
      classificationConsistent: consistent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify span — the selected classification, parented to the evaluation.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: evalSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "rc.classify",
    protocol: "a2a",
    attributes: {
      caseRef: request.caseRef,
      classification: determination.classification,
      reportable: determination.reportable,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the classification recorded to the audit trail, parented to the classify step.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "rc.log-audit",
    protocol: "a2a",
    attributes: {
      caseRef: request.caseRef,
      classification: determination.classification,
      noAutonomousReport: noAutonomous,
      requiresEpiReview: determination.requiresEpiReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, caseRef: request.caseRef };

  const completedMessage = determination.reportable
    ? `Reportable-condition classification complete — case ${determination.caseRef} meets the ${determination.condition} definition at the ${determination.classification.toUpperCase()} level; a recommendation for an epidemiologist, nothing reported (synthetic — recursive boolean case-definition evaluation, NOT a certified surveillance / case-reporting system).`
    : `Reportable-condition classification complete — case ${determination.caseRef} does not meet any ${determination.condition} classification (not-a-case); nothing reported (synthetic — recursive boolean case-definition evaluation, NOT a certified surveillance / case-reporting system).`;

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
        name: "ReportableCaseDetermination",
        description:
          "Deterministically-produced reportable-condition classification. It classifies a patient case against a nested public-health CASE DEFINITION (an ordered list of classifications — confirmed / probable / suspect — each a boolean criteria tree of all-of / any-of / not over leaf predicates) using RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION: it recursively walks each classification's tree over the case's facts, marks each met / not, selects the highest-precedence one that holds (else not-a-case), and derives the reportable flag. Every leaf predicate references a submitted fact (no fabricated criterion), the reported classification results are exactly the definition's classifications in order, and the classification recomputes — re-evaluating each tree reproduces each met flag, the selected classification, and the reportable flag; and no case is ever reported to a public-health authority — an epidemiologist confirms the classification. There is no stable matching, no geospatial distance, no checksum, no union-find, no percentile, no identity match, no largest-remainder apportionment, no FSM transition, no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, and no hash chain — it is recursive boolean expression-tree evaluation, a pure function of the facts + definition. This is a PHI-bearing agent — the case is a patient's clinical data. It is DISTINCT from the Adverse-Event Reporting agent (which drafts a MedWatch / VAERS report for a drug / vaccine event), the Utilization Review agent (medical-necessity criteria for a service), and the Lab Result agent (a single analyte vs a reference range); this classifies a case against a nested public-health CASE DEFINITION. The condition + definition + facts are illustrative synthetics, NOT a certified surveillance / case-reporting system (real notifiable-condition reporting uses the jurisdiction's official CSTE / CDC case definitions, eCR / eICR electronic case reporting, and an epidemiologist's judgment).",
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
        caseRef: request.caseRef,
        condition: determination.condition,
        classification: determination.classification,
        reportable: determination.reportable,
        classificationCount: summary.classificationCount,
        requiresEpiReview: summary.requiresEpiReview,
        caseFactsSourced: sourced,
        classificationConsistent: consistent,
        noAutonomousReport: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
