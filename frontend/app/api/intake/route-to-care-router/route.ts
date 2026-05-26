import { NextResponse } from "next/server";
import {
  newTaskId,
  sendA2ATask,
  userMessage
} from "../../../../lib/a2a";
import type { IntakeRecord } from "../../../../lib/care-router";
import { recordInstantSpan } from "../../../../lib/agent-fabric";
import {
  DEMO_DATA360_PATIENT_ID,
  getGroundingContext,
  resolveIdentity
} from "../../../../lib/data-360";

/**
 * Server-side A2A handoff from the (mocked) Agentforce Service Agent
 * to the Pause Care Router agent.
 *
 *   POST /api/intake/route-to-care-router
 *   { "intake": { ... } }
 *
 * Flow:
 *   1. Generate a session-scoped task id (used as the Agent Fabric
 *      trace correlation key).
 *   2. Record a synthetic "intake.complete" span attributed to the
 *      Agentforce intake agent -- this is what an Anypoint OpenTelemetry
 *      tap would emit in production.
 *   3. POST an A2A `tasks/send` request to the Care Router endpoint,
 *      threading the trace via metadata.parentSpanId.
 *   4. Return both the routing decision and the task id so the client
 *      can pivot to /demo/agent-fabric?taskId=<id> and watch the trace.
 *
 * Why a server-side handoff: the prototype's fallback intake runs in
 * the browser, so the patient's browser would never see the Care
 * Router endpoint's logs. Threading through the server route gives us
 * a single trace context, real network latency, and the ability to
 * later add OAuth between agents without changing the client.
 */
export async function POST(req: Request) {
  type Body = { intake?: IntakeRecord; sessionId?: string };
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const intake = body.intake ?? {};
  const sessionId = body.sessionId ?? newTaskId("session");
  const taskId = newTaskId("intake-to-router");

  const intakeSpan = recordInstantSpan({
    taskId,
    agentId: "agentforce-intake",
    operation: "intake.complete",
    protocol: "rest",
    attributes: {
      capturedFields: Object.values(intake).filter((v) => v !== undefined).length,
      redFlag: intake.redFlagsAcknowledged === "yes",
      ageBand: intake.ageBand,
      primarySymptom: intake.primarySymptom,
      severity: intake.severity
    }
  });

  // 1. Identity resolution via Data 360 -- maps the partial intake
  //    identity to the unified patient id.
  const idStartedAt = Date.now();
  const identity = resolveIdentity({
    preferredName: intake.preferredName,
    ageBand: intake.ageBand,
    cycleStatus: intake.cycleStatus
  });
  const idFinishedAt = Date.now();
  const identitySpan = recordInstantSpan({
    taskId,
    parentSpanId: intakeSpan.id,
    agentId: "salesforce-data-360",
    operation: "data360.identity.resolve",
    protocol: "rest",
    attributes: {
      unifiedPatientId: identity.unifiedPatientId,
      confidence: identity.confidence,
      matchedSources: identity.matchedSources,
      resolutionRuleset: identity.resolutionRuleset,
      durationMs: idFinishedAt - idStartedAt
    }
  });

  // 2. Federated grounding query against the Data 360 unified
  //    patient view. Returns calculated insights + longitudinal
  //    observations + cohort + last clinician contact + IR provenance.
  const groundingStartedAt = Date.now();
  const grounding = getGroundingContext({
    patientId: identity.unifiedPatientId || DEMO_DATA360_PATIENT_ID,
    hint: {
      ageBand: intake.ageBand,
      primarySymptom: intake.primarySymptom,
      cycleStatus: intake.cycleStatus
    }
  });
  const groundingFinishedAt = Date.now();
  recordInstantSpan({
    taskId,
    parentSpanId: identitySpan.id,
    agentId: "salesforce-data-360",
    operation: "data360.grounding.federated-query",
    protocol: "rest",
    attributes: {
      unifiedPatientId: grounding.unifiedPatientId,
      computedInsightsCount: grounding.groundingProvenance.computedInsightsCount,
      sourcesQueried: grounding.groundingProvenance.sourcesQueried,
      cohort: grounding.cohortComparison.cohortName,
      cohortSize: grounding.cohortComparison.cohortSize,
      patientPercentile: grounding.cohortComparison.patientPercentile,
      lastClinicianContactDaysAgo: grounding.lastClinicianContact.daysAgo,
      durationMs: groundingFinishedAt - groundingStartedAt
    }
  });

  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;
  const careRouterUrl = `${base}/api/agents/care-router`;

  try {
    const task = await sendA2ATask(careRouterUrl, {
      id: taskId,
      sessionId,
      message: userMessage(
        "Please route this menopause intake to the appropriate care pathway. Longitudinal context attached from Salesforce Data 360.",
        { intake, data360Grounding: grounding, data360Identity: identity }
      ),
      metadata: { parentSpanId: intakeSpan.id }
    });

    const decisionPart = task.artifacts?.[0]?.parts?.find(
      (p) => p.type === "data"
    );
    const decision =
      decisionPart && decisionPart.type === "data" ? decisionPart.data : null;

    return NextResponse.json({
      meta: {
        _note:
          "A2A handoff: Agentforce intake -> Data 360 identity resolution -> Data 360 federated grounding query -> Pause Care Router. Open /demo/agent-fabric?taskId=" +
          taskId +
          " to see the four-span multi-agent trace.",
        _taskId: taskId,
        _sessionId: sessionId,
        _careRouterUrl: careRouterUrl,
        _data360UnifiedPatientId: identity.unifiedPatientId
      },
      taskId,
      sessionId,
      task,
      decision,
      data360: {
        identity,
        grounding
      }
    });
  } catch (err) {
    recordInstantSpan({
      taskId,
      parentSpanId: intakeSpan.id,
      agentId: "care-router-claude",
      operation: "a2a.tasks/send.transport-error",
      protocol: "a2a",
      status: "error",
      attributes: { error: (err as Error).message }
    });
    return NextResponse.json(
      {
        meta: { _taskId: taskId, _sessionId: sessionId },
        error: (err as Error).message
      },
      { status: 502 }
    );
  }
}
