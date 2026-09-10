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
  type AccessAnomalyDetermination,
  type AccessAnomalyRequest,
  DEMO_ACCESS_ANOMALY_REQUEST,
  accessAnomalySummary,
  accessEventsSourced,
  accessNoAutonomousAction,
  accessWindowCountConsistent,
  evaluateAccessAnomaly
} from "../../../../../lib/access-anomaly";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "access-anomaly-agent";

/**
 * Google A2A `tasks/send` endpoint for the Access Anomaly Detection agent — a control-plane /
 * data-substrate service on the platform & data substrate plane that implements the HIPAA Security
 * Rule's information-system-activity-review safeguard (§164.308(a)(1)(ii)(D)).
 *
 *   POST /api/agents/access-anomaly/tasks
 *
 * Loads an access-anomaly request and DETERMINISTICALLY evaluates it via evaluateAccessAnomaly: it
 * counts the actor's PHI-access events within a rolling time window, finds the peak number of accesses
 * in any window of the configured length, and flags an anomaly when that peak exceeds the threshold.
 * There is no interval merge, no topological sort, no set-difference, no dollar waterfall, no identity
 * match, and no hash chain — it is sliding-window counting (a two-pointer scan), a pure function of the
 * events + window + threshold. Every counted access is sourced, the window count is exact, and no
 * access action is taken — a privacy officer reviews every flag. This is a PHI-bearing agent
 * (phiAccessed:true throughout). The events are illustrative; real activity review uses the full audit
 * trail, user-behavior analytics, and role / relationship context.
 *
 * Enforced-block policies checked before any finding leaves the fabric:
 *   - policy.access.events-sourced (signal accessEventsSourced).
 *   - policy.access.window-count-consistent (signal accessWindowCountConsistent).
 *   - policy.access.no-autonomous-action (signal accessNoAutonomousAction).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: AccessAnomalyRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if its peak events are sourced, its window count
 *   is exact, and it takes no autonomous action) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("access-anomaly");
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
      ? (data.request as AccessAnomalyRequest)
      : DEMO_ACCESS_ANOMALY_REQUEST;

  // Deterministic access-anomaly analysis.
  const determination = evaluateAccessAnomaly(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as AccessAnomalyDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: events-sourced + window-count-consistent + no autonomous action.
  const eventsSourced = accessEventsSourced(determinationForCheck);
  const countConsistent = accessWindowCountConsistent(determinationForCheck);
  const noAutonomous = accessNoAutonomousAction(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      accessEventsSourced: eventsSourced,
      accessWindowCountConsistent: countConsistent,
      accessNoAutonomousAction: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "access.flag-anomaly.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        accessEventsSourced: eventsSourced,
        accessWindowCountConsistent: countConsistent,
        accessNoAutonomousAction: noAutonomous,
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
          `Pause Agent Fabric blocked this access-anomaly run: ${governance.blockingViolations
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

  const summary = accessAnomalySummary(determination);

  // Receive-events span — the fabric records the events it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "access.receive-events",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      actorRef: request.actorRef,
      eventCount: determination.totalEvents,
      accessEventsSourced: eventsSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Scan-window span — the sliding-window peak, parented to the received events.
  const scanSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "access.scan-window",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      peakCount: summary.peakCount,
      windowMinutes: determination.windowMinutes,
      accessWindowCountConsistent: countConsistent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Flag-anomaly span — the anomaly finding, parented to the scan.
  const flagSpan = recordInstantSpan({
    taskId,
    parentSpanId: scanSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "access.flag-anomaly",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      hasAnomaly: determination.hasAnomaly,
      distinctPatients: summary.distinctPatients,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the finding recorded to the audit trail, parented to the flag.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: flagSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "access.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      accessNoAutonomousAction: noAutonomous,
      requiresPrivacyReview: determination.requiresPrivacyReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage =
    determination.disposition === "anomalous-access-volume"
      ? `Actor ${request.actorRef} accessed ${summary.peakCount} record(s) within a ${determination.windowMinutes}-minute window (${summary.distinctPatients} distinct patient(s)) — over the threshold of ${determination.threshold}, an anomalous access volume flagged for privacy review (synthetic — illustrative events, NOT a certified breach-detection / SIEM system).`
      : `Actor ${request.actorRef} peaked at ${summary.peakCount} access(es) in any ${determination.windowMinutes}-minute window across ${determination.totalEvents} event(s) — within the threshold of ${determination.threshold}, normal activity; a recommendation for a privacy officer, no access action taken autonomously (synthetic — illustrative events, NOT a certified breach-detection / SIEM system).`;

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
        name: "AccessAnomalyDetermination",
        description:
          "Deterministically-produced access-anomaly detection. It counts an actor's PHI-access events within a rolling time window, finds the peak number of accesses in any window of the configured length (a two-pointer sliding-window scan), and flags an anomalous access volume when that peak exceeds the threshold — the HIPAA Security Rule's information-system-activity-review safeguard (§164.308(a)(1)(ii)(D)). Every event in the peak window traces to a submitted access event (a fabricated peak event or a phantom count is blocked), the window count is exact (recomputing the sliding-window peak reproduces the count, the peak window fits within the configured length, and the anomaly flag equals whether the peak exceeds the threshold), and no access action is ever taken — a privacy officer reviews every flag. There is no interval merge, no topological sort, no set-difference, no dollar waterfall, no identity match, and no hash chain — it is sliding-window counting, a pure function of the events + window + threshold, and the detection is WINDOWED (a high daily total spread into small bursts is not flagged), not a naive total count. This is a PHI-bearing agent — the events reference the patients whose records were accessed. The events + window + threshold are illustrative, NOT a certified breach-detection / SIEM system — real activity review uses the full audit trail, user-behavior analytics, and role / relationship context.",
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
        actorRef: determination.actorRef,
        disposition: determination.disposition,
        peakCount: summary.peakCount,
        distinctPatients: summary.distinctPatients,
        totalEvents: determination.totalEvents,
        hasAnomaly: determination.hasAnomaly,
        requiresPrivacyReview: determination.requiresPrivacyReview,
        accessEventsSourced: eventsSourced,
        accessWindowCountConsistent: countConsistent,
        accessNoAutonomousAction: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
