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
  type ProviderBenchmarkingDetermination,
  type ProviderBenchmarkingRequest,
  DEMO_PROVIDER_BENCHMARKING_REQUEST,
  benchmarkCohortSourced,
  benchmarkNoAutonomousTiering,
  benchmarkStatsConsistent,
  evaluateProviderBenchmarking,
  providerBenchmarkingSummary
} from "../../../../../lib/provider-benchmarking";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "provider-benchmarking-agent";

/**
 * Google A2A `tasks/send` endpoint for the Provider Cost & Quality Percentile Benchmarking agent — a
 * commercial-operations service on the commercial plane that ranks a target provider within a peer cohort
 * using percentile / rank statistics over a numeric distribution.
 *
 *   POST /api/agents/provider-benchmarking/tasks
 *
 * Loads a benchmarking request and DETERMINISTICALLY evaluates it via evaluateProviderBenchmarking: it
 * counts how many peers fall below / at / above the target, computes the target's percentile rank (the
 * midpoint method), adjusts for the metric direction (so a higher effective percentile always means
 * better), computes the cohort median, and derives a performance band + disposition (benchmark-favorable /
 * benchmark-review). There is no FSM transition, no edit distance, no interval selection, no bin-packing,
 * no sliding-window count, no interval merge, no topological sort, no set-difference, no dollar waterfall,
 * no pairwise KB lookup, no exact identity match, and no hash chain — it is percentile / rank statistics,
 * a pure function of the value + cohort + direction. The cohort is sourced, the statistics recompute
 * exactly, and nothing is tiered — a network manager confirms every benchmark. DELIBERATELY NOT
 * PHI-bearing — it operates on provider-level aggregate metrics, not patient PHI. The cohorts are
 * illustrative; real benchmarking uses risk / case-mix adjustment, valid peer grouping, and minimum
 * denominators.
 *
 * Enforced-block policies checked before any finding leaves the fabric:
 *   - policy.benchmark.cohort-sourced (signal benchmarkCohortSourced).
 *   - policy.benchmark.stats-consistent (signal benchmarkStatsConsistent).
 *   - policy.benchmark.no-autonomous-tiering (signal benchmarkNoAutonomousTiering).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: ProviderBenchmarkingRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if the cohort is sourced, the statistics recompute
 *   exactly, and it is not auto-tiered) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("provider-benchmarking");
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
      ? (data.request as ProviderBenchmarkingRequest)
      : DEMO_PROVIDER_BENCHMARKING_REQUEST;

  // Deterministic benchmarking finding.
  const determination = evaluateProviderBenchmarking(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as ProviderBenchmarkingDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: cohort-sourced + stats-consistent + no autonomous tiering.
  const cohortSourced = benchmarkCohortSourced(determinationForCheck);
  const statsConsistent = benchmarkStatsConsistent(determinationForCheck);
  const noAutonomous = benchmarkNoAutonomousTiering(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      benchmarkCohortSourced: cohortSourced,
      benchmarkStatsConsistent: statsConsistent,
      benchmarkNoAutonomousTiering: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "benchmark.compute-percentile.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        benchmarkRef: request.benchmarkRef,
        benchmarkCohortSourced: cohortSourced,
        benchmarkStatsConsistent: statsConsistent,
        benchmarkNoAutonomousTiering: noAutonomous,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        synthetic: true,
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
          `Pause Agent Fabric blocked this provider-benchmarking run: ${governance.blockingViolations
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

  const summary = providerBenchmarkingSummary(determination);

  // Receive-metric span — the fabric records the metric it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "benchmark.receive-metric",
    protocol: "a2a",
    attributes: {
      benchmarkRef: request.benchmarkRef,
      providerRef: determination.providerRef,
      metricName: determination.metricName,
      cohortSize: determination.cohortSize,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-percentile span — the rank statistics, parented to the received metric.
  const computeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "benchmark.compute-percentile",
    protocol: "a2a",
    attributes: {
      benchmarkRef: request.benchmarkRef,
      percentileRank: determination.percentileRank,
      effectivePercentile: determination.effectivePercentile,
      benchmarkCohortSourced: cohortSourced,
      benchmarkStatsConsistent: statsConsistent,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-band span — the performance band, parented to the percentile computation.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: computeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "benchmark.classify-band",
    protocol: "a2a",
    attributes: {
      benchmarkRef: request.benchmarkRef,
      performanceBand: determination.performanceBand,
      disposition: determination.disposition,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the finding recorded to the audit trail, parented to the band classification.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "benchmark.log-audit",
    protocol: "a2a",
    attributes: {
      benchmarkRef: request.benchmarkRef,
      disposition: determination.disposition,
      benchmarkNoAutonomousTiering: noAutonomous,
      requiresNetworkReview: determination.requiresNetworkReview,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, benchmarkRef: request.benchmarkRef };

  const completedMessage =
    determination.disposition === "benchmark-favorable"
      ? `${determination.providerRef} is in the ${determination.performanceBand} for ${determination.metricName} (effective percentile ${determination.effectivePercentile}) — a favorable benchmark, a recommendation for a network manager, no tiering made (synthetic — illustrative cohort, NOT a certified benchmarking system).`
      : `${determination.providerRef} is in the ${determination.performanceBand} for ${determination.metricName} (effective percentile ${determination.effectivePercentile}) — flagged for network review, a recommendation for a network manager, no tiering made (synthetic — illustrative cohort, NOT a certified benchmarking system).`;

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
        name: "ProviderBenchmarkingDetermination",
        description:
          "Deterministically-produced provider-benchmarking finding. It counts how many peers fall below / at / above the target value, computes the target's percentile rank by value (the standard midpoint method), adjusts for the metric direction (lower-is-better for cost, higher-is-better for quality) so a higher effective percentile always means better, computes the cohort median, and derives a performance band (top-quartile / above-median / below-median / bottom-quartile) and disposition (benchmark-favorable for an above-median-or-better band, benchmark-review otherwise). Every cohort member is a well-formed { providerId, numeric value } and the reported cohort size equals the actual cohort; the rank statistics recompute exactly from the cohort; and the provider is never tiered, penalized, or de-networked — a network manager confirms the benchmark. There is no FSM transition, no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, no dollar waterfall, no pairwise KB lookup, no exact identity match, and no hash chain — it is percentile / rank statistics, a pure function of the value + cohort + direction. This is DELIBERATELY NOT a PHI-bearing agent — it operates on provider-level aggregate metrics, not patient health information. The cohort is illustrative, NOT a certified benchmarking system — real provider benchmarking uses risk / case-mix adjustment, statistically valid peer grouping, minimum denominators, confidence intervals, and the network team's judgment.",
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
        benchmarkRef: request.benchmarkRef,
        providerRef: determination.providerRef,
        metricName: determination.metricName,
        disposition: determination.disposition,
        percentileRank: determination.percentileRank,
        effectivePercentile: determination.effectivePercentile,
        performanceBand: determination.performanceBand,
        median: determination.median,
        cohortSize: summary.cohortSize,
        requiresNetworkReview: determination.requiresNetworkReview,
        benchmarkCohortSourced: cohortSourced,
        benchmarkStatsConsistent: statsConsistent,
        benchmarkNoAutonomousTiering: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
