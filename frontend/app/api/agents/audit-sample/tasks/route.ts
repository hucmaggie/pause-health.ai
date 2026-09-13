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
  type AuditSampleDetermination,
  type AuditSampleRequest,
  DEMO_AUDIT_SAMPLE_REQUEST,
  auditSampleSummary,
  evaluateAuditSample,
  noAutonomousAudit,
  sampleSourced,
  selectionReproducible
} from "../../../../../lib/audit-sample";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "audit-sample-agent";

/**
 * Google A2A `tasks/send` endpoint for the Audit Sample Selection / Reservoir Sampling (Algorithm R, Seeded)
 * agent — a payer-operations compliance-sampling service that, given a stream of record ids and a target sample
 * size k + a seed, draws a statistically-defensible, reproducible k-record sample in a single pass.
 *
 *   POST /api/agents/audit-sample/tasks
 *
 * Loads a request and DETERMINISTICALLY evaluates it via evaluateAuditSample: it runs RESERVOIR SAMPLING
 * (Algorithm R) with a seeded PRNG (mulberry32) in one pass — fill the reservoir with the first k, then for each
 * later item i draw j in [0, i] and replace reservoir[j] if j < k. There is no Bloom filter, no knapsack, no EDF
 * schedule, no percentile/rank, no token bucket, and no keyed set-difference — it is single-pass uniform
 * reservoir sampling, a pure function of the ids + k + seed. The sample is sourced + self-consistent,
 * selection-reproducible, and nothing is audited — a compliance auditor runs the audit. It is PHI-adjacent
 * (phiAccessed:true — record ids).
 *
 * A full-population disposition is a LEGITIMATE FINDING (the population is at most k), NOT a governance block.
 * Enforced-block policies checked before any sample leaves the fabric:
 *   - policy.auditsample.sample-sourced (signal auditSampleSourced).
 *   - policy.auditsample.selection-reproducible (signal auditSelectionReproducible).
 *   - policy.auditsample.no-autonomous-audit (signal auditNoAutonomousAudit).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: AuditSampleRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the sample is sourced + self-consistent, selection-reproducible, and not
 *   auto-audited) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("audit-sample");
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
      ? (data.request as AuditSampleRequest)
      : DEMO_AUDIT_SAMPLE_REQUEST;

  // Deterministic seeded reservoir sampling.
  const determination = evaluateAuditSample(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as AuditSampleDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: sample sourced + self-consistent, selection reproducible, no autonomous audit.
  const sourced = sampleSourced(determinationForCheck);
  const reproducible = selectionReproducible(determinationForCheck);
  const noAutonomous = noAutonomousAudit(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      auditSampleSourced: sourced,
      auditSelectionReproducible: reproducible,
      auditNoAutonomousAudit: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "auditsample.select.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        auditRef: request.auditRef,
        auditSampleSourced: sourced,
        auditSelectionReproducible: reproducible,
        auditNoAutonomousAudit: noAutonomous,
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
          `Pause Agent Fabric blocked this sample: ${governance.blockingViolations
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

  const summary = auditSampleSummary(determination);

  // Receive-population span — the fabric records the population it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "auditsample.receive-population",
    protocol: "a2a",
    attributes: {
      auditRef: request.auditRef,
      populationSize: determination.populationSize,
      sampleSize: determination.sampleSize,
      seed: determination.seed,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Select span — seeded reservoir sampling, parented to the received population.
  const selectSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "auditsample.select",
    protocol: "a2a",
    attributes: {
      auditRef: request.auditRef,
      effectiveSampleSize: determination.effectiveSampleSize,
      inclusionProbability: determination.inclusionProbability,
      auditSampleSourced: sourced,
      auditSelectionReproducible: reproducible,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the sample disposition, parented to the select.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: selectSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "auditsample.classify-disposition",
    protocol: "a2a",
    attributes: {
      auditRef: request.auditRef,
      disposition: determination.disposition,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the sample recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "auditsample.log-audit",
    protocol: "a2a",
    attributes: {
      auditRef: request.auditRef,
      disposition: determination.disposition,
      auditNoAutonomousAudit: noAutonomous,
      requiresAuditorReview: determination.requiresAuditorReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, auditRef: request.auditRef };

  const completedMessage =
    determination.disposition === "full-population"
      ? `Sample complete — the population of ${determination.populationSize} record(s) for ${request.auditRef} is at most the sample size ${determination.sampleSize}, so the whole population is selected; a recommendation for a compliance auditor, nothing audited (synthetic — reservoir sampling, NOT a certified statistical-sampling system).`
      : `Sample complete — a reproducible ${determination.effectiveSampleSize}-record sample drawn from ${determination.populationSize} record(s) for ${request.auditRef} (seed ${determination.seed}, inclusion probability ${determination.inclusionProbability}); a recommendation for a compliance auditor, nothing audited (synthetic — reservoir sampling, NOT a certified statistical-sampling system).`;

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
        name: "AuditSampleDetermination",
        description:
          "Deterministically-produced audit sample. Given a STREAM of record ids (claims / charts flagged for a compliance audit) and a target sample size k plus an explicit SEED, it draws a statistically-defensible k-record SAMPLE in a SINGLE PASS via RESERVOIR SAMPLING (Vitter's Algorithm R): fill a reservoir with the first k items, then for each subsequent item at 0-indexed position i draw a random integer j in [0, i] and replace reservoir[j] if j < k — after one pass every item has been retained with uniform probability k/n, without ever holding the whole population in memory. The randomness is a SEEDED PRNG (mulberry32), so the sample is fully REPRODUCIBLE: the same stream + k + seed always yields the same records — which is what makes an audit sample defensible (an auditor or regulator can re-run it and get the identical sample). If the population is at most k the whole population is selected (disposition full-population); otherwise a proper k-subset is drawn (disposition sampled). The sample is sourced + self-consistent (a real subset of the submitted stream, size min(k, n), honest population size and inclusion probability), selection-reproducible — re-running the seeded Algorithm R reproduces the exact sample — and nothing is audited; a compliance auditor runs the audit. CRUCIALLY this is NOT the Duplicate-Claim Screen agent's BLOOM FILTER (a membership test, not a uniform draw), NOT the Outreach Prioritization agent's 0/1 KNAPSACK (a value-maximizing subset, not an equal-probability sample), NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, NOT the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, NOT the Contact Rate Limit agent's TOKEN BUCKET, and NOT the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE — it is single-pass uniform reservoir sampling, a pure function of the ids + k + seed. It is PHI-adjacent — record ids are PHI-adjacent, so a determination is on the HIPAA audit path. The ids are an illustrative synthetic, NOT a certified statistical-sampling / audit system (real audit sampling weighs stratification, RAT-STATS / OIG methodology, confidence intervals, and dollar-unit / probability-proportional-to-size designs — not a bare uniform reservoir over illustrative ids).",
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
        auditRef: request.auditRef,
        disposition: determination.disposition,
        populationSize: determination.populationSize,
        effectiveSampleSize: determination.effectiveSampleSize,
        inclusionProbability: determination.inclusionProbability,
        seed: determination.seed,
        sampleSize: summary.sampleSize,
        requiresAuditorReview: summary.requiresAuditorReview,
        auditSampleSourced: sourced,
        auditSelectionReproducible: reproducible,
        auditNoAutonomousAudit: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
