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
  type CoverageContinuityDetermination,
  type CoverageContinuityRequest,
  DEMO_COVERAGE_CONTINUITY_REQUEST,
  coverageContinuitySummary,
  coverageMathConsistent,
  coverageNoAutonomousDetermination,
  coverageSegmentsSourced,
  evaluateCoverageContinuity
} from "../../../../../lib/coverage-continuity";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "coverage-continuity-agent";

/**
 * Google A2A `tasks/send` endpoint for the Creditable Coverage Continuity agent — a claims /
 * payer-operations service on the payer & plan operations plane that measures the continuity of a
 * member's coverage over time.
 *
 *   POST /api/agents/coverage-continuity/tasks
 *
 * Loads a continuity request and DETERMINISTICALLY evaluates it via evaluateCoverageContinuity: it
 * merges the member's overlapping / adjacent coverage segments into continuous spans, totals the
 * covered days, and measures the gaps between spans — flagging a significant break (a gap longer than
 * the threshold, 63 days by the HIPAA / ACA rule). There is no topological sort, no set-difference, no
 * dollar waterfall, no ratio, and no single-date deadline — it is interval merging + gap detection, a
 * pure function of the segments + the request's own asOfDate. Every span is sourced, the coverage math
 * is exact, and no determination is issued — an eligibility reviewer confirms every one. This is a
 * PHI-bearing agent (phiAccessed:true throughout). The segments are illustrative; real determination
 * uses the certificate of creditable coverage and the full HIPAA / ACA / Medicare Part D frameworks.
 *
 * Enforced-block policies checked before any determination leaves the fabric:
 *   - policy.coverage.segments-sourced (signal coverageSegmentsSourced).
 *   - policy.coverage.math-consistent (signal coverageMathConsistent).
 *   - policy.coverage.no-autonomous-determination (signal coverageNoAutonomousDetermination).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: CoverageContinuityRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if its spans are sourced, its math is exact, and
 *   it is not auto-issued) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("coverage-continuity");
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
      ? (data.request as CoverageContinuityRequest)
      : DEMO_COVERAGE_CONTINUITY_REQUEST;

  // Deterministic continuity analysis.
  const determination = evaluateCoverageContinuity(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as CoverageContinuityDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: segments-sourced + math-consistent + no autonomous determination.
  const segmentsSourced = coverageSegmentsSourced(determinationForCheck);
  const mathConsistent = coverageMathConsistent(determinationForCheck);
  const noAutonomous = coverageNoAutonomousDetermination(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      coverageSegmentsSourced: segmentsSourced,
      coverageMathConsistent: mathConsistent,
      coverageNoAutonomousDetermination: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "coverage.detect-gaps.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        coverageSegmentsSourced: segmentsSourced,
        coverageMathConsistent: mathConsistent,
        coverageNoAutonomousDetermination: noAutonomous,
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
          `Pause Agent Fabric blocked this coverage-continuity run: ${governance.blockingViolations
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

  const summary = coverageContinuitySummary(determination);

  // Receive-segments span — the fabric records the segments it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "coverage.receive-segments",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      memberRef: request.memberRef,
      segmentCount: determination.segments.length,
      coverageSegmentsSourced: segmentsSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Merge-intervals span — the merged spans, parented to the received segments.
  const mergeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "coverage.merge-intervals",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      spanCount: summary.spanCount,
      totalCoveredDays: determination.totalCoveredDays,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Detect-gaps span — the gaps + break determination, parented to the merge.
  const gapsSpan = recordInstantSpan({
    taskId,
    parentSpanId: mergeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "coverage.detect-gaps",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      gapCount: summary.gapCount,
      hasSignificantBreak: determination.hasSignificantBreak,
      coverageMathConsistent: mathConsistent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the gaps.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: gapsSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "coverage.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      coverageNoAutonomousDetermination: noAutonomous,
      requiresEligibilityReview: determination.requiresEligibilityReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage =
    determination.disposition === "significant-break"
      ? `Coverage for ${request.memberRef} has a significant break: a gap exceeds ${determination.maxGapDays} days across ${summary.spanCount} span(s) — flagged for eligibility review (synthetic — illustrative segments, NOT a certified creditable-coverage system).`
      : `Coverage for ${request.memberRef} is continuous within the ${determination.maxGapDays}-day threshold: ${determination.totalCoveredDays} covered day(s) across ${summary.spanCount} span(s) — a recommendation for an eligibility reviewer, no determination issued autonomously (synthetic — illustrative segments, NOT a certified creditable-coverage system).`;

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
        name: "CoverageContinuityDetermination",
        description:
          "Deterministically-produced creditable coverage continuity analysis. It merges the member's overlapping / adjacent coverage segments into continuous spans, totals the inclusive covered days, measures the gaps between consecutive spans, and flags a significant break in creditable coverage when a gap exceeds the threshold (63 days by the HIPAA / ACA rule). Every merged span traces to submitted segments (each span boundary comes from a real segment boundary and every segment falls within a span — no fabricated or dropped coverage), the coverage math is exact (the total covered days equal the sum of the spans' inclusive lengths, each gap equals the exact distance between consecutive spans, and the significant-break flag equals whether any gap exceeds the threshold), and no determination is ever issued — an eligibility reviewer confirms every one. There is no topological sort, no set-difference, no dollar waterfall, no ratio, and no single-date deadline — it is interval merging + gap detection, a pure function of the segments + the request's own asOfDate. This is a PHI-bearing agent — the segments reference the member's coverage history. The segments + threshold are illustrative, NOT a certified creditable-coverage system — real determination uses the certificate of creditable coverage, plan-specific rules, and the full HIPAA / ACA / Medicare Part D frameworks.",
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
        requestRef: request.requestRef,
        memberRef: determination.memberRef,
        disposition: determination.disposition,
        spanCount: summary.spanCount,
        gapCount: summary.gapCount,
        totalCoveredDays: determination.totalCoveredDays,
        hasSignificantBreak: determination.hasSignificantBreak,
        requiresEligibilityReview: determination.requiresEligibilityReview,
        coverageSegmentsSourced: segmentsSourced,
        coverageMathConsistent: mathConsistent,
        coverageNoAutonomousDetermination: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
