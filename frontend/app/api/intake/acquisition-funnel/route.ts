import { NextResponse } from "next/server";
import {
  type A2ATask,
  findDataPart,
  newTaskId,
  sendA2ATask,
  userMessage
} from "../../../../lib/a2a";
import { recordInstantSpan } from "../../../../lib/agent-fabric";
import { leadToIntake, type FunnelLead } from "../../../../lib/agent-funnel";

/**
 * Server-side orchestration of the patient-acquisition funnel, wiring the
 * upstream Agentforce agents into the Patient Intake → Care Router flow:
 *
 *   POST /api/intake/acquisition-funnel
 *   { "lead": { source, ageBand, primarySymptom, consentOptIn, ... } }
 *
 * Flow (all under one Agent Fabric trace, correlated by a single taskId):
 *   1. Inbound Lead Generation  (/api/agents/inbound-lead)  — capture,
 *      ICP screen, identity resolution, handoff.
 *   2. Qualification            (/api/agents/qualification) — qualified/
 *      disqualified + route.
 *   3a. route "intake"  → Agentforce Intake completes → Care Router
 *       (/api/agents/care-router) returns the pathway.
 *   3b. route "nurture" → Prospecting & Nurture (/api/agents/prospecting)
 *       drafts a touch for human approval.
 *   3c. route "none"    → disqualified; logged for human review.
 *
 * Each hop is a real A2A `tasks/send` over HTTP, threading the previous
 * hop's span id via metadata.parentSpanId so the whole funnel renders as
 * one parented span tree at /demo/agent-fabric?taskId=<id>. Governance is
 * enforced inside each agent route; a block short-circuits the funnel and
 * is returned as `outcome: "blocked"` (the blocking `.blocked` span is
 * still recorded so the trace explains why).
 */

type Body = {
  lead?: FunnelLead;
  sessionId?: string;
  personaId?: string;
};

function spanIdOf(task: A2ATask): string | undefined {
  const af = task.metadata?.agentFabric as { traceSpanId?: unknown } | undefined;
  return typeof af?.traceSpanId === "string" ? af.traceSpanId : undefined;
}

function isBlocked(task: A2ATask): boolean {
  return task.status.state === "failed";
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const lead = body.lead ?? {};
  const sessionId = body.sessionId ?? newTaskId("session");
  const taskId = newTaskId("funnel");
  const personaId =
    typeof body.personaId === "string" && body.personaId.length > 0
      ? body.personaId
      : undefined;

  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;
  const metaBase = personaId ? { personaId } : {};

  try {
    // 1. Inbound Lead Generation (root of the trace).
    const inbound = await sendA2ATask(`${base}/api/agents/inbound-lead`, {
      id: taskId,
      sessionId,
      message: userMessage("Capture and screen this inbound lead.", { lead }),
      metadata: { ...metaBase }
    });
    if (isBlocked(inbound)) {
      return NextResponse.json({
        meta: { _taskId: taskId, _blockedAt: "inbound-lead-agent" },
        taskId,
        sessionId,
        outcome: "blocked",
        blockedAt: "inbound-lead-agent",
        task: inbound
      });
    }
    const captured = findDataPart(inbound.artifacts?.[0]?.parts) ?? {};
    const capturedLead = (captured.lead as FunnelLead) ?? lead;
    const screen = captured.screen;
    const inboundSpanId = spanIdOf(inbound);

    // 2. Qualification.
    const qualification = await sendA2ATask(`${base}/api/agents/qualification`, {
      id: taskId,
      sessionId,
      message: userMessage("Qualify this captured lead.", {
        lead: capturedLead,
        screen
      }),
      metadata: { parentSpanId: inboundSpanId, ...metaBase }
    });
    if (isBlocked(qualification)) {
      return NextResponse.json({
        meta: { _taskId: taskId, _blockedAt: "qualification-agent" },
        taskId,
        sessionId,
        outcome: "blocked",
        blockedAt: "qualification-agent",
        task: qualification
      });
    }
    const decisionData = findDataPart(qualification.artifacts?.[0]?.parts) ?? {};
    const decision = decisionData.decision as
      | { decision: string; route: "intake" | "nurture" | "none"; score: number; rationale: string }
      | undefined;
    const qualSpanId = spanIdOf(qualification);
    const route = decision?.route ?? "none";

    // 3a. Qualified & ready → Intake → Care Router.
    if (route === "intake") {
      const intake = leadToIntake(capturedLead);
      const intakeSpan = recordInstantSpan({
        taskId,
        parentSpanId: qualSpanId,
        agentId: "agentforce-intake",
        operation: "intake.complete",
        protocol: "a2a",
        attributes: {
          capturedFields: Object.values(intake).filter((v) => v !== undefined).length,
          redFlag: intake.redFlagsAcknowledged === "yes",
          convertedFromInboundLead: true,
          source: capturedLead.source,
          ...metaBase
        }
      });

      const routing = await sendA2ATask(`${base}/api/agents/care-router`, {
        id: taskId,
        sessionId,
        message: userMessage(
          "Route this qualified menopause intake to the appropriate care pathway.",
          { intake }
        ),
        metadata: { parentSpanId: intakeSpan.id, ...metaBase }
      });
      const routingDecisionPart = findDataPart(routing.artifacts?.[0]?.parts);
      return NextResponse.json({
        meta: {
          _taskId: taskId,
          _note:
            "Acquisition funnel: Inbound Lead → Qualification → Intake → Care Router. Open /demo/agent-fabric?taskId=" +
            taskId +
            " to see the full parented trace."
        },
        taskId,
        sessionId,
        outcome: "routed-to-intake",
        lead: capturedLead,
        screen,
        decision,
        routingDecision: routingDecisionPart ?? null,
        careRouterState: routing.status.state
      });
    }

    // 3b. Qualified but warming → Prospecting & Nurture.
    if (route === "nurture") {
      const nurtureTask = await sendA2ATask(`${base}/api/agents/prospecting`, {
        id: taskId,
        sessionId,
        message: userMessage("Advance the nurture cadence for this warming lead.", {
          lead: capturedLead,
          decision
        }),
        metadata: { parentSpanId: qualSpanId, ...metaBase }
      });
      if (isBlocked(nurtureTask)) {
        return NextResponse.json({
          meta: { _taskId: taskId, _blockedAt: "prospecting-agent" },
          taskId,
          sessionId,
          outcome: "blocked",
          blockedAt: "prospecting-agent",
          task: nurtureTask
        });
      }
      const nurturePart = findDataPart(nurtureTask.artifacts?.[0]?.parts) ?? {};
      return NextResponse.json({
        meta: {
          _taskId: taskId,
          _note:
            "Acquisition funnel: Inbound Lead → Qualification → Prospecting & Nurture. Open /demo/agent-fabric?taskId=" +
            taskId +
            " to see the full parented trace."
        },
        taskId,
        sessionId,
        outcome: "nurturing",
        lead: capturedLead,
        screen,
        decision,
        nurture: nurturePart.nurture ?? null
      });
    }

    // 3c. Disqualified.
    return NextResponse.json({
      meta: {
        _taskId: taskId,
        _note:
          "Acquisition funnel: Inbound Lead → Qualification → disqualified (logged for human review). Open /demo/agent-fabric?taskId=" +
          taskId +
          " to see the trace."
      },
      taskId,
      sessionId,
      outcome: "disqualified",
      lead: capturedLead,
      screen,
      decision
    });
  } catch (err) {
    recordInstantSpan({
      taskId,
      agentId: "inbound-lead-agent",
      operation: "a2a.tasks/send.transport-error",
      protocol: "a2a",
      status: "error",
      attributes: { error: (err as Error).message, ...metaBase }
    });
    return NextResponse.json(
      { meta: { _taskId: taskId, _sessionId: sessionId }, error: (err as Error).message },
      { status: 502 }
    );
  }
}
