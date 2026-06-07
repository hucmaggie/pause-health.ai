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
import {
  getGroundingContextPreferReal,
  resolveIdentityFromOrg,
  warnSalesforceDegradationOnce
} from "../../../../lib/salesforce/grounding";
import { isSalesforceConfigured } from "../../../../lib/salesforce/auth";

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
  type Body = {
    intake?: IntakeRecord;
    sessionId?: string;
    /**
     * Optional demo cohort persona id (e.g. "anika-patel"). When
     * present, threaded into every span emitted by this handler so
     * /demo/analytics can filter Care Router decisions + grounding
     * spans by persona. Production callers omit this field and the
     * filter just stays empty on analytics; nothing else branches.
     */
    personaId?: string;
  };
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const intake = body.intake ?? {};
  const sessionId = body.sessionId ?? newTaskId("session");
  const taskId = newTaskId("intake-to-router");
  const personaId =
    typeof body.personaId === "string" && body.personaId.length > 0
      ? body.personaId
      : undefined;

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
      severity: intake.severity,
      ...(personaId ? { personaId } : {})
    }
  });

  // 1. Identity resolution via Data 360 -- maps the partial intake
  //    identity to the unified patient id. Prefer real-org resolution
  //    when SF is configured; degrade silently to the deterministic mock
  //    on any failure so the trace never breaks for a transient network
  //    blip against the org.
  const idStartedAt = Date.now();
  let identitySource: "real" | "mock" = "mock";
  let identity = resolveIdentity({
    preferredName: intake.preferredName,
    ageBand: intake.ageBand,
    cycleStatus: intake.cycleStatus
  });
  if (isSalesforceConfigured()) {
    try {
      const real = await resolveIdentityFromOrg({
        preferredName: intake.preferredName,
        ageBand: intake.ageBand,
        cycleStatus: intake.cycleStatus
      });
      if (real) {
        identity = real;
        identitySource = "real";
      }
    } catch (err) {
      warnSalesforceDegradationOnce("intake.identity.resolve", err);
    }
  }
  const idFinishedAt = Date.now();
  const identitySpan = recordInstantSpan({
    taskId,
    parentSpanId: intakeSpan.id,
    agentId: "salesforce-data-360",
    operation: "data360.identity.resolve",
    protocol: "rest",
    attributes: {
      _source: identitySource,
      unifiedPatientId: identity.unifiedPatientId,
      confidence: identity.confidence,
      matchedSources: identity.matchedSources,
      resolutionRuleset: identity.resolutionRuleset,
      durationMs: idFinishedAt - idStartedAt,
      ...(personaId ? { personaId } : {})
    }
  });

  // 2. Federated grounding query. Prefer real Health Cloud grounding
  //    (Phase 1: Contact + CareProgramEnrollee + CarePlan + Case); fall
  //    back to the deterministic mock. The returned shape is identical
  //    so the Care Router code path doesn't branch.
  const groundingStartedAt = Date.now();
  const { source: groundingSource, grounding } = await getGroundingContextPreferReal({
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
      _source: groundingSource,
      unifiedPatientId: grounding.unifiedPatientId,
      computedInsightsCount: grounding.groundingProvenance.computedInsightsCount,
      sourcesQueried: grounding.groundingProvenance.sourcesQueried,
      cohort: grounding.cohortComparison.cohortName,
      cohortSize: grounding.cohortComparison.cohortSize,
      patientPercentile: grounding.cohortComparison.patientPercentile,
      lastClinicianContactDaysAgo: grounding.lastClinicianContact.daysAgo,
      durationMs: groundingFinishedAt - groundingStartedAt,
      ...(personaId ? { personaId } : {})
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
      metadata: {
        parentSpanId: intakeSpan.id,
        ...(personaId ? { personaId } : {})
      }
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
        _data360UnifiedPatientId: identity.unifiedPatientId,
        _data360IdentitySource: identitySource,
        _data360GroundingSource: groundingSource,
        _salesforceConfigured: isSalesforceConfigured()
      },
      taskId,
      sessionId,
      task,
      decision,
      data360: {
        source: { identity: identitySource, grounding: groundingSource },
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
