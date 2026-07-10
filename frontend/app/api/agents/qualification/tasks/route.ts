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
  qualifyLead,
  screenInboundLead,
  type FunnelLead,
  type LeadScreen
} from "../../../../../lib/agent-funnel";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "qualification-agent";

/**
 * Google A2A `tasks/send` endpoint for the Agentforce Qualification
 * agent (prototype stand-in).
 *
 *   POST /api/agents/qualification/tasks
 *
 * Applies the qualification rubric (menopause-care fit + readiness) to a
 * captured lead and returns a qualified/disqualified decision with a
 * human-readable rationale and a route (intake | nurture | none).
 * Enforced-block policies checked before any work:
 *   - policy.qualification.rationale-required (every decision carries one)
 *   - policy.qualification.no-protected-class-criteria (never used)
 * A block returns HTTP 200 with an A2A task in state `failed`.
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
  const taskId = params.id || newTaskId("qualification");
  const sessionId = params.sessionId;
  const parentSpanId =
    typeof params.metadata?.parentSpanId === "string"
      ? (params.metadata.parentSpanId as string)
      : undefined;
  const personaId =
    typeof params.metadata?.personaId === "string"
      ? (params.metadata.personaId as string)
      : undefined;

  const data = findDataPart(params.message?.parts);
  const lead: FunnelLead =
    (data?.lead as FunnelLead) ?? (data as FunnelLead) ?? {};
  // Recompute the screen from the lead so qualification is independently
  // authoritative; an upstream screen (if present) is deterministic and
  // will match.
  const screen: LeadScreen =
    (data?.screen as LeadScreen) ?? screenInboundLead(lead);
  const decision = qualifyLead(lead, screen);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      hasRationaleField: decision.rationale.trim().length > 0,
      usesProtectedClassCriteria: decision.protectedClassUsed
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "qualification.decide.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
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
          `Pause Agent Fabric blocked this qualification: ${governance.blockingViolations
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

  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "qualification.decide",
    protocol: "a2a",
    attributes: {
      decision: decision.decision,
      score: decision.score,
      route: decision.route,
      rationale: decision.rationale,
      protectedClassUsed: decision.protectedClassUsed,
      ...(personaId ? { personaId } : {})
    }
  });

  // Disqualifications are logged for human review (audit policy). Emit a
  // dedicated span so the review queue is visible in the trace.
  if (decision.decision === "disqualified") {
    recordInstantSpan({
      taskId,
      parentSpanId: decideSpan.id,
      agentId: FABRIC_AGENT_ID,
      operation: "qualification.human-review.enqueue",
      protocol: "internal",
      attributes: {
        reason: decision.rationale,
        ...(personaId ? { personaId } : {})
      }
    });
  }

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(decision.rationale, { decision })
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "QualificationDecision",
        description:
          "Qualified/disqualified decision with rationale and downstream route.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { decision, lead } as unknown as Record<string, unknown>
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
        route: decision.route,
        nextAgent:
          decision.route === "intake"
            ? "agentforce-intake"
            : decision.route === "nurture"
              ? "prospecting-agent"
              : null
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
