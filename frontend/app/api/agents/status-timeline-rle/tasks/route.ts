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
  type StatusTimelineDetermination,
  type StatusTimelineRequest,
  DEMO_STATUS_TIMELINE_REQUEST,
  encodingSourced,
  evaluateStatusTimeline,
  noAutonomousWrite,
  runsCanonical,
  statusTimelineSummary
} from "../../../../../lib/status-timeline-rle";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "status-timeline-rle-agent";

/**
 * Google A2A `tasks/send` endpoint for the Status Timeline Compression / Run-Length Encoding (RLE) agent — a
 * platform / data-substrate stream-compression service that, given a per-slot status stream, compresses it into
 * a canonical sequence of (value, length) runs.
 *
 *   POST /api/agents/status-timeline-rle/tasks
 *
 * Loads a request and DETERMINISTICALLY evaluates it via evaluateStatusTimeline: a single left-to-right pass
 * coalesces each maximal block of identical consecutive statuses into one run (RUN-LENGTH ENCODING). There is no
 * Huffman prefix code, no difference-array accumulation, no sliding-window maximum, no k-way merge, and no LCS —
 * it is run-length encoding, a pure function of the statuses. The encoding is sourced + self-consistent (it
 * decodes back exactly), canonical (RLE re-derives the unique maximal-run list), and nothing is written back — a
 * data steward confirms. It is PHI-adjacent (phiAccessed:true — the statuses reference a device / bed monitoring
 * timeline).
 *
 * An incompressible disposition is a LEGITIMATE FINDING (the stream has no consecutive repeats to coalesce), NOT
 * a governance block. Enforced-block policies checked before any encoding leaves the fabric:
 *   - policy.statusrle.encoding-sourced (signal statusEncodingSourced).
 *   - policy.statusrle.runs-canonical (signal statusRunsCanonical).
 *   - policy.statusrle.no-autonomous-write (signal statusNoAutonomousWrite).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: StatusTimelineRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the encoding is sourced + self-consistent, canonical, and not
 *   auto-written) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("status-timeline-rle");
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
      ? (data.request as StatusTimelineRequest)
      : DEMO_STATUS_TIMELINE_REQUEST;

  // Deterministic run-length encoding.
  const determination = evaluateStatusTimeline(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as StatusTimelineDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: encoding sourced + self-consistent, runs canonical, no autonomous write.
  const sourced = encodingSourced(determinationForCheck);
  const canonical = runsCanonical(determinationForCheck);
  const noAutonomous = noAutonomousWrite(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      statusEncodingSourced: sourced,
      statusRunsCanonical: canonical,
      statusNoAutonomousWrite: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "statusrle.encode.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        streamRef: request.streamRef,
        statusEncodingSourced: sourced,
        statusRunsCanonical: canonical,
        statusNoAutonomousWrite: noAutonomous,
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
          `Pause Agent Fabric blocked this encoding: ${governance.blockingViolations
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

  const summary = statusTimelineSummary(determination);

  // Receive-stream span — the fabric records the stream it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "statusrle.receive-stream",
    protocol: "a2a",
    attributes: {
      streamRef: request.streamRef,
      originalLength: determination.originalLength,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Encode span — run-length encoding, parented to the received stream.
  const encodeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "statusrle.encode",
    protocol: "a2a",
    attributes: {
      streamRef: request.streamRef,
      runCount: determination.runCount,
      compressionRatio: determination.compressionRatio,
      statusEncodingSourced: sourced,
      statusRunsCanonical: canonical,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the encoding disposition, parented to the encode.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: encodeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "statusrle.classify-disposition",
    protocol: "a2a",
    attributes: {
      streamRef: request.streamRef,
      disposition: determination.disposition,
      longestRun: determination.longestRun,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the encoding recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "statusrle.log-audit",
    protocol: "a2a",
    attributes: {
      streamRef: request.streamRef,
      disposition: determination.disposition,
      statusNoAutonomousWrite: noAutonomous,
      requiresStewardReview: determination.requiresStewardReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, streamRef: request.streamRef };

  const completedMessage =
    determination.disposition === "compressible"
      ? `Encoding complete — ${determination.originalLength} status slot(s) of ${request.streamRef} compressed to ${determination.runCount} run(s) (ratio ${determination.compressionRatio}×, longest run ${determination.longestRun}); a recommendation for a data steward, nothing written back (synthetic — run-length encoding, NOT a certified telemetry-compression system).`
      : `Encoding complete — stream ${request.streamRef} is INCOMPRESSIBLE by RLE (${determination.originalLength} slot(s) → ${determination.runCount} run(s), no consecutive repeats); a recommendation for a data steward, nothing written back (synthetic — run-length encoding, NOT a certified telemetry-compression system).`;

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
        name: "StatusTimelineDetermination",
        description:
          "Deterministically-produced status-timeline run-length encoding. Given a per-slot STATUS stream (a device state / bed-occupancy / monitoring status once per time slot), it compresses the stream into a sequence of RUNS — (value, length) pairs, one per maximal block of identical consecutive statuses — via RUN-LENGTH ENCODING: a single left-to-right pass that coalesces each maximal block into one run (the canonical, provably-unique RLE, losslessly reversible). If RLE shrinks the stream (fewer runs than slots) the disposition is compressible; otherwise incompressible (the honest finding that the stream has no consecutive repeats to coalesce — NOT an error). The exact, reversible run list is the invariant. The encoding is sourced + self-consistent (decoding the runs — value repeated `length` times, in order — reproduces the exact submitted stream, every run length ≥ 1, honest counts/ratio/longest-run/dominant-status), canonical — re-running RLE reproduces the unique maximal-run list (adjacent runs never share a value, so no over-split) — and nothing is written back; a data steward confirms. CRUCIALLY this is NOT the Huffman agent's OPTIMAL PREFIX CODING (a FREQUENCY-based variable-length code over the alphabet — this is CONSECUTIVE-RUN coalescing, order-dependent, no frequency model), NOT the Coverage Heatmap agent's DIFFERENCE-ARRAY RANGE ACCUMULATION, NOT the Rolling Census Peak agent's SLIDING-WINDOW MAXIMUM, NOT the Timeline Merge agent's K-WAY MERGE (which interleaves multiple sorted streams — this compresses ONE stream), and NOT the List Reconciliation agent's LONGEST COMMON SUBSEQUENCE — it is run-length encoding, a pure function of the statuses. It is PHI-adjacent — the statuses reference a device / bed monitoring timeline, so a determination is on the HIPAA audit path. The stream is an illustrative synthetic, NOT a certified time-series / telemetry compression system (real telemetry compression uses delta / delta-of-delta encoding, dictionary methods, Gorilla-style float compression, and lossy downsampling — not a bare RLE over illustrative status labels).",
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
        streamRef: request.streamRef,
        disposition: determination.disposition,
        runCount: determination.runCount,
        originalLength: determination.originalLength,
        compressionRatio: determination.compressionRatio,
        longestRun: determination.longestRun,
        dominantStatus: determination.dominantStatus,
        requiresStewardReview: summary.requiresStewardReview,
        statusEncodingSourced: sourced,
        statusRunsCanonical: canonical,
        statusNoAutonomousWrite: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
