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
  type ContactRateLimitDetermination,
  type ContactRateLimitRequest,
  DEMO_CONTACT_RATE_LIMIT_REQUEST,
  contactRateLimitSummary,
  evaluateContactRateLimit,
  noAutonomousSend,
  replaySourced,
  throttleExact
} from "../../../../../lib/contact-rate-limit";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "contact-rate-limit-agent";

/**
 * Google A2A `tasks/send` endpoint for the Member Contact Rate Limiting / Token-Bucket Throttle agent — a
 * care-coordination contact-governance service that, given a chronologically-ordered sequence of outbound contact
 * attempts to a member and a token-bucket config (burst capacity + refill per hour), replays the attempts through
 * a token bucket to decide which contacts are permitted and which are throttled.
 *
 *   POST /api/agents/contact-rate-limit/tasks
 *
 * Loads a request and DETERMINISTICALLY evaluates it via evaluateContactRateLimit: it replays the TOKEN BUCKET
 * (start full, accrue continuous refill between attempts capped at capacity, consume one token per permitted
 * attempt, throttle when empty). There is no knapsack, no sliding-window count, no EDF schedule, no max-flow, no
 * minimum spanning tree, no Dijkstra path, and no interval selection — it is token-bucket rate limiting, a pure
 * function of the config + timestamps. The replay is sourced + self-consistent, policy-exact, and nothing is sent
 * — an outreach coordinator confirms. It is PHI-adjacent (phiAccessed:true — the attempts reference member
 * contacts).
 *
 * A throttled disposition is a LEGITIMATE FINDING (some attempts really exceed the frequency cap), NOT a
 * governance block. Enforced-block policies checked before any plan leaves the fabric:
 *   - policy.contactrate.replay-sourced (signal contactReplaySourced).
 *   - policy.contactrate.throttle-exact (signal contactThrottleExact).
 *   - policy.contactrate.no-autonomous-send (signal contactNoAutonomousSend).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: ContactRateLimitRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the replay is sourced + self-consistent, policy-exact, and not auto-sent)
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
  const taskId = params.id || newTaskId("contact-rate-limit");
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
      ? (data.request as ContactRateLimitRequest)
      : DEMO_CONTACT_RATE_LIMIT_REQUEST;

  // Deterministic token-bucket replay.
  const determination = evaluateContactRateLimit(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as ContactRateLimitDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: replay sourced + self-consistent, throttle policy-exact, no autonomous send.
  const sourced = replaySourced(determinationForCheck);
  const exact = throttleExact(determinationForCheck);
  const noAutonomous = noAutonomousSend(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      contactReplaySourced: sourced,
      contactThrottleExact: exact,
      contactNoAutonomousSend: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "contactrate.throttle.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        memberRef: request.memberRef,
        contactReplaySourced: sourced,
        contactThrottleExact: exact,
        contactNoAutonomousSend: noAutonomous,
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
          `Pause Agent Fabric blocked this throttle plan: ${governance.blockingViolations
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

  const summary = contactRateLimitSummary(determination);

  // Receive-attempts span — the fabric records the attempts it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "contactrate.receive-attempts",
    protocol: "a2a",
    attributes: {
      memberRef: request.memberRef,
      attemptCount: determination.attemptCount,
      capacity: determination.capacity,
      refillPerHour: determination.refillPerHour,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Throttle span — token-bucket replay, parented to the received attempts.
  const throttleSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "contactrate.throttle",
    protocol: "a2a",
    attributes: {
      memberRef: request.memberRef,
      permittedCount: determination.permittedCount,
      throttledCount: determination.throttledCount,
      contactReplaySourced: sourced,
      contactThrottleExact: exact,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the throttle disposition, parented to the throttle.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: throttleSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "contactrate.classify-disposition",
    protocol: "a2a",
    attributes: {
      memberRef: request.memberRef,
      disposition: determination.disposition,
      finalTokens: determination.finalTokens,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the throttle plan recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "contactrate.log-audit",
    protocol: "a2a",
    attributes: {
      memberRef: request.memberRef,
      disposition: determination.disposition,
      contactNoAutonomousSend: noAutonomous,
      requiresCoordinatorReview: determination.requiresCoordinatorReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, memberRef: request.memberRef };

  const completedMessage =
    determination.disposition === "within-limits"
      ? `Throttle plan complete — all ${determination.attemptCount} contact attempt(s) to ${request.memberRef} are within the frequency cap (capacity ${determination.capacity}, refill ${determination.refillPerHour}/hr); a recommendation for an outreach coordinator, nothing sent (synthetic — token-bucket, NOT a certified communications-compliance system).`
      : `Throttle plan complete — ${determination.throttledCount} of ${determination.attemptCount} contact attempt(s) to ${request.memberRef} exceed the frequency cap and are throttled (${determination.permittedCount} permitted); a recommendation for an outreach coordinator, nothing sent or suppressed (synthetic — token-bucket, NOT a certified communications-compliance system).`;

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
        name: "ContactRateLimitDetermination",
        description:
          "Deterministically-produced member-contact throttle plan. Given a CHRONOLOGICALLY-ORDERED sequence of outbound contact ATTEMPTS to a member and a token-bucket CONFIG (a burst CAPACITY of tokens and a continuous REFILL rate per hour), it replays the attempts through a TOKEN BUCKET: the bucket starts full and refills continuously at refillPerHour tokens/hour (never above capacity); each attempt, in time order, first accrues the refill earned since the previous attempt, then — if at least one whole token is available — consumes one token and is PERMITTED, otherwise is THROTTLED. If no attempt is throttled the disposition is within-limits; otherwise throttled (the honest finding that some attempts exceed the frequency cap — NOT an error). The per-attempt decision is provably determined by the bucket state, and the exact throttle decision is the invariant. The replay is sourced + self-consistent (the decisions cover exactly the submitted attempts, in non-decreasing time order, with honest tallies), policy-exact — re-running the token-bucket simulation reproduces every permit/throttle decision and the final token level — and nothing is sent or suppressed; an outreach coordinator confirms. CRUCIALLY this is NOT the Outreach Prioritization agent's 0/1 KNAPSACK (which selects WHICH members to contact under a capacity budget — this governs HOW OFTEN one member may be contacted over time), NOT the Access Anomaly agent's SLIDING-WINDOW COUNTING (a fixed-window count with no continuous refill or token reservoir), NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, NOT the Referral Throughput agent's MAX-FLOW, NOT the Network Build-Out agent's MINIMUM SPANNING TREE, NOT the Care Routing agent's DIJKSTRA'S SHORTEST PATH, and NOT the Schedule Conflict agent's GREEDY INTERVAL SELECTION — it is token-bucket rate limiting, a continuously-refilling token reservoir with a burst cap. It COMPLEMENTS the Outreach Prioritization agent: that chooses whom to reach, this caps how often. It is PHI-adjacent — the attempts reference member contacts, so a determination is on the HIPAA audit path. The attempts are an illustrative synthetic, NOT a certified communications-compliance system (real member-contact governance weighs TCPA / CAN-SPAM consent, quiet hours, channel-specific caps, member preferences, and campaign suppression lists — not a bare token bucket over illustrative timestamps).",
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
        memberRef: request.memberRef,
        disposition: determination.disposition,
        permittedCount: determination.permittedCount,
        throttledCount: determination.throttledCount,
        finalTokens: determination.finalTokens,
        capacity: determination.capacity,
        refillPerHour: determination.refillPerHour,
        attemptCount: summary.attemptCount,
        requiresCoordinatorReview: summary.requiresCoordinatorReview,
        contactReplaySourced: sourced,
        contactThrottleExact: exact,
        contactNoAutonomousSend: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
