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
  type HuffmanDetermination,
  type HuffmanRequest,
  DEMO_HUFFMAN_REQUEST,
  codeOptimal,
  codeSourced,
  evaluateHuffman,
  huffmanSummary,
  noAutonomousDeploy
} from "../../../../../lib/huffman-coding";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "huffman-coding-agent";

/**
 * Google A2A `tasks/send` endpoint for the Event-Stream Code Assignment / Huffman Optimal Prefix Coding agent
 * — a data-plane code-assignment service that, given a set of event types with observed frequencies, assigns
 * an optimal prefix-free binary code minimizing the total encoded length.
 *
 *   POST /api/agents/huffman-coding/tasks
 *
 * Loads a coding request and DETERMINISTICALLY evaluates it via evaluateHuffman: it builds the Huffman code
 * (merging the two lowest-frequency nodes repeatedly), reads each symbol's code off the tree, sums the
 * weighted total, and derives the disposition against the fixed-width baseline. There is no trie longest-prefix
 * match, no checksum, no majority vote, no k-way merge, no longest common subsequence, no EDF schedule, no
 * Kadane, no Dijkstra, no knapsack, no stable matching, no union-find, no percentile, and no apportionment —
 * it is Huffman coding, a pure function of the frequencies. The code is sourced + self-consistent, optimal, and
 * nothing is deployed — an engineer confirms. It is NON-PHI (phiAccessed:false throughout) — an event-type
 * frequency is aggregate integration telemetry.
 *
 * Enforced-block policies checked before any code leaves the fabric:
 *   - policy.huffcode.code-sourced (signal huffCodeSourced).
 *   - policy.huffcode.code-optimal (signal huffCodeOptimal).
 *   - policy.huffcode.no-autonomous-deploy (signal huffCodeNoAutonomousDeploy).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: HuffmanRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the code is sourced + self-consistent, optimal, and not auto-deployed)
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
  const taskId = params.id || newTaskId("huffman-coding");
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
      ? (data.request as HuffmanRequest)
      : DEMO_HUFFMAN_REQUEST;

  // Deterministic Huffman coding.
  const determination = evaluateHuffman(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as HuffmanDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: code sourced + self-consistent, code optimal, no autonomous deploy.
  const sourced = codeSourced(determinationForCheck);
  const optimal = codeOptimal(determinationForCheck);
  const noAutonomous = noAutonomousDeploy(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      huffCodeSourced: sourced,
      huffCodeOptimal: optimal,
      huffCodeNoAutonomousDeploy: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "huffcode.build-code.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        streamRef: request.streamRef,
        huffCodeSourced: sourced,
        huffCodeOptimal: optimal,
        huffCodeNoAutonomousDeploy: noAutonomous,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        phiAccessed: false,
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
          `Pause Agent Fabric blocked this code assignment: ${governance.blockingViolations
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

  const summary = huffmanSummary(determination);

  // Receive-symbols span — the fabric records the event types it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "huffcode.receive-symbols",
    protocol: "a2a",
    attributes: {
      streamRef: request.streamRef,
      symbolCount: determination.symbols.length,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Build-code span — Huffman coding, parented to the received symbols.
  const buildSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "huffcode.build-code",
    protocol: "a2a",
    attributes: {
      streamRef: request.streamRef,
      weightedTotal: determination.weightedTotal,
      huffCodeSourced: sourced,
      huffCodeOptimal: optimal,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the coding disposition, parented to the build.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: buildSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "huffcode.classify-disposition",
    protocol: "a2a",
    attributes: {
      streamRef: request.streamRef,
      disposition: determination.disposition,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the assignment recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "huffcode.log-audit",
    protocol: "a2a",
    attributes: {
      streamRef: request.streamRef,
      disposition: determination.disposition,
      huffCodeNoAutonomousDeploy: noAutonomous,
      requiresEngineerReview: determination.requiresEngineerReview,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, streamRef: request.streamRef };

  const completedMessage =
    determination.disposition === "compressible"
      ? `Code assignment complete — ${determination.symbols.length} event type(s) coded to ${determination.weightedTotal} bits vs ${determination.fixedTotal} fixed-width (${summary.savedBits} saved); a recommendation for an engineer, nothing deployed (synthetic — Huffman coding, NOT a certified codec system).`
      : `Code assignment complete — ${determination.symbols.length} event type(s) coded, no gain over the ${determination.fixedWidth}-bit fixed-width code; a recommendation for an engineer, nothing deployed (synthetic — Huffman coding, NOT a certified codec system).`;

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
        name: "HuffmanDetermination",
        description:
          "Deterministically-produced event-stream code assignment. Given a set of event / message types flowing across the integration bus — each type with an observed frequency (its share of the stream volume) — it runs HUFFMAN CODING: build the optimal prefix-free code by repeatedly merging the two lowest-frequency nodes into a subtree (a greedy priority-queue construction), then read each symbol's code off the root-to-leaf path — reporting one code per type, the weighted total (the sum over types of frequency × code length), the fixed-width baseline, and the disposition: compressible or already-uniform. Huffman is provably optimal — no prefix-free code assigns a smaller total encoded length. The code is sourced + self-consistent (the codes covering exactly the submitted symbols, each a non-empty binary string with a matching length + echoed frequency, the code prefix-free, the weightedTotal honest), optimal — re-running the Huffman construction reproduces the reported weightedTotal — and nothing is deployed to the live bus or re-encoded; an engineer confirms. There is no trie longest-prefix match, no checksum, no majority vote, no k-way merge, no longest common subsequence, no EDF schedule, no Kadane max-subarray, no Dijkstra path, no knapsack, no stable matching, no union-find, no percentile, and no apportionment — it is Huffman coding, a pure function of the frequencies. It COMPLEMENTS the Code Taxonomy agent (which walks a code down a prefix tree of taxonomy categories to bucket it) and the Identifier Validation agent (which validates an identifier's check digit): this CONSTRUCTS an optimal prefix-free code from frequencies. It is NON-PHI — an event-type frequency is aggregate integration telemetry, not patient health information. The frequencies are an illustrative synthetic, NOT a certified codec / compression system (real stream compression uses context modeling, arithmetic / range coding, dictionary methods (LZ77 / LZMA), and adaptive codebooks).",
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
        weightedTotal: determination.weightedTotal,
        fixedTotal: determination.fixedTotal,
        savedBits: summary.savedBits,
        symbolCount: summary.symbolCount,
        requiresEngineerReview: summary.requiresEngineerReview,
        huffCodeSourced: sourced,
        huffCodeOptimal: optimal,
        huffCodeNoAutonomousDeploy: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
