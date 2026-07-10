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
  draftNurtureTouch,
  type FunnelLead
} from "../../../../../lib/agent-funnel";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "prospecting-agent";

/**
 * Google A2A `tasks/send` endpoint for the Agentforce Prospecting &
 * Nurture agent (prototype stand-in).
 *
 *   POST /api/agents/prospecting/tasks
 *
 * Advances a qualified-but-warming lead one nurture touch. Drafts a
 * consent-aware touch for human review; never sends autonomously.
 * Enforced-block policies checked before any work:
 *   - policy.marketing.consent-to-contact-required (active opt-in)
 *   - policy.marketing.human-approval-before-send (no autonomous send)
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
  const taskId = params.id || newTaskId("prospecting");
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
  const touch =
    typeof data?.touch === "number" && Number.isFinite(data.touch)
      ? (data.touch as number)
      : 1;

  // Outreach is always drafted for human approval, never auto-sent.
  const nurture = draftNurtureTouch(lead, touch);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      hasContactConsent: Boolean(lead.consentOptIn),
      autonomousSend: nurture.sent
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "prospect.nurture.advance.blocked",
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
          `Pause Agent Fabric blocked this nurture touch: ${governance.blockingViolations
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

  const nurtureSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "prospect.nurture.advance",
    protocol: "rest",
    attributes: {
      channel: nurture.channel,
      touch: nurture.touch,
      cadenceDays: nurture.cadenceDays,
      humanApprovalRequired: nurture.humanApprovalRequired,
      sent: nurture.sent,
      ...(personaId ? { personaId } : {})
    }
  });

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(nurture.summary, { nurture })
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "NurtureTouch",
        description:
          "A drafted, human-approval-required nurture touch for a warming lead.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { nurture } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: nurtureSpan.id,
        traceTaskId: taskId
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
