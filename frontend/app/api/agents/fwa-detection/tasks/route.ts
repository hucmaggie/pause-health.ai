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
  type FwaScreeningReport,
  type FwaScreeningRequest,
  DEFAULT_FWA_FACTORS,
  DEMO_CLEAR_REQUEST,
  noProtectedClassFactors,
  patternsTraceToCatalog,
  reportRequiresSiuReview,
  screenClaim
} from "../../../../../lib/fwa-detection";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "fwa-detection-agent";

/**
 * Google A2A `tasks/send` endpoint for the Fraud, Waste & Abuse Detection
 * Agent — deterministic pattern-based screening that routes flagged claims
 * to the SIU for human review. NEVER autonomously denies / opens
 * investigations / freezes payment.
 *
 *   POST /api/agents/fwa-detection/tasks
 *
 * Enforced-block policies checked before the report is returned:
 *   - policy.fwa.pattern-catalog-sourced (signal patternsTraceToCatalog)
 *   - policy.fwa.no-autonomous-denial (signal reportRequiresSiuReview)
 *   - policy.fwa.no-protected-class-factors (signal noProtectedClassFactors)
 *
 * Input (data part):
 *   { request?: FwaScreeningRequest,
 *     reportOverride?: FwaScreeningReport } — the request is screened
 *   deterministically by default; a reportOverride demonstrates the three
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
  const taskId = params.id || newTaskId("fwa");
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
      ? (data.request as FwaScreeningRequest)
      : DEMO_CLEAR_REQUEST;

  // Ground-truth deterministic screening.
  const report = screenClaim(request);

  // Governance-signal targets — a caller-asserted override lets the fabric
  // demonstrate each block without altering the core computation.
  const reportForCheck =
    data.reportOverride && typeof data.reportOverride === "object"
      ? (data.reportOverride as FwaScreeningReport)
      : report;

  const factorsInUse = request.factorsInUse ?? DEFAULT_FWA_FACTORS;

  const catalogOk = patternsTraceToCatalog(reportForCheck.flags);
  const siuOk = reportRequiresSiuReview(reportForCheck);
  const protectedOk = noProtectedClassFactors(factorsInUse);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      patternsTraceToCatalog: catalogOk,
      reportRequiresSiuReview: siuOk,
      noProtectedClassFactors: protectedOk
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "fwa.screen.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        providerRef: request.providerRef,
        patternsTraceToCatalog: catalogOk,
        reportRequiresSiuReview: siuOk,
        noProtectedClassFactors: protectedOk,
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
          `Pause Agent Fabric blocked this FWA screening: ${governance.blockingViolations
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

  // Evaluate span.
  const evaluateSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "fwa.evaluate-patterns",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      providerRef: request.providerRef,
      claimRef: request.claimRef,
      flagCount: report.flags.length,
      patternsTraceToCatalog: catalogOk,
      noProtectedClassFactors: protectedOk,
      factorsInUseCount: factorsInUse.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Decide span.
  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: evaluateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "fwa.decide",
    protocol: "a2a",
    attributes: {
      decision: report.decision,
      primaryPatternId: report.primaryPatternId,
      primarySeverity: report.primarySeverity,
      routedTo: report.routedTo,
      requiresSiuReview: report.requiresSiuReview,
      reportRequiresSiuReview: siuOk,
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
        report.decision === "clear"
          ? `FWA screening ${report.requestRef} · CLEAR · provider ${report.providerRef} · claim ${report.claimRef} · no patterns fired.`
          : `FWA screening ${report.requestRef} · FLAG-FOR-SIU-REVIEW · ${report.flags.length} pattern${report.flags.length === 1 ? "" : "s"} fired · primary ${report.primaryPatternId} (${report.primarySeverity}) · routed to ${report.routedTo}. The agent NEVER autonomously denies a claim, opens an investigation, or freezes payment. Synthetic — illustrative pattern catalog + refs, not certified FWA.`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "FwaScreeningReport",
        description:
          "Deterministically-produced FWA screening report — clear / flag-for-siu-review with the sorted applied catalog patterns, primary pattern + severity, routing target (clear-no-action / siu-standard-queue / siu-priority-queue), and hard invariants (requiresSiuReview reflects the decision; investigationOpened:false and paymentFrozen:false ALWAYS — the agent NEVER autonomously opens investigations or freezes payment). The pattern catalog, peer-baseline metrics, and severity thresholds are illustrative/synthetic, NOT SAS Detection and Investigation, LexisNexis Provider Insight, an actual payer SIU rule set, or a certified fraud-detection engine.",
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
        claimRef: request.claimRef,
        fwaDecision: report.decision,
        flagCount: report.flags.length,
        primaryPatternId: report.primaryPatternId,
        primarySeverity: report.primarySeverity,
        routedTo: report.routedTo,
        requiresSiuReview: report.requiresSiuReview,
        patternsTraceToCatalog: catalogOk,
        reportRequiresSiuReview: siuOk,
        noProtectedClassFactors: protectedOk
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
