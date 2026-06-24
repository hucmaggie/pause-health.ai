import { NextResponse } from "next/server";
import {
  type A2ARpcRequest,
  type A2ATask,
  type A2ATasksSendParams,
  agentMessage,
  newTaskId,
  nowIso
} from "../../../../../lib/a2a";
import {
  route,
  type Data360GroundingHint,
  type IntakeRecord
} from "../../../../../lib/care-router";
import {
  evaluateGovernance,
  recordInstantSpan
} from "../../../../../lib/agent-fabric";
import { createMCPHostFromRequest } from "../../../../../lib/mcp/host";
import { providerLookupViaMcpHost } from "../../../../../lib/mcp/provider-lookup";

// The MCP SDK depends on Node-only APIs; pin the runtime so Vercel
// doesn't try to ship this route to the Edge.
export const runtime = "nodejs";

function mcpHostEnabled(): boolean {
  const raw = (process.env.PAUSE_MCP_HOST_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

/**
 * Google A2A `tasks/send` endpoint for the Pause Care Router agent.
 *
 *   POST /api/agents/care-router/tasks
 *   Content-Type: application/json
 *
 * Body is the JSON-RPC envelope. params must include:
 *   - id: client-chosen task id (we reuse for the trace)
 *   - sessionId: optional grouping (e.g. one patient session)
 *   - message: A2A Message with at least one data part containing the
 *     IntakeRecord under message.parts[*].data.intake.
 *   - metadata: optional. Pause respects metadata.parentSpanId to
 *     stitch this task into the upstream agent's trace.
 *
 * Flow:
 *   1. Pre-flight governance evaluation via the Agent Fabric.
 *      If policies block, return a JSON-RPC error and an A2A task
 *      in state `failed`.
 *   2. Call route() -- real Claude when ANTHROPIC_API_KEY is set,
 *      scripted fallback otherwise.
 *   3. Record one span on the Agent Fabric trace, capturing duration,
 *      model provenance, pathway, and red-flags.
 *   4. Return a completed A2ATask with the RoutingDecision attached
 *      as an artifact and as a data part on the final agent message.
 */
export async function POST(req: Request) {
  let body: A2ARpcRequest<A2ATasksSendParams>;
  try {
    body = (await req.json()) as A2ARpcRequest<A2ATasksSendParams>;
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" }
      },
      { status: 400 }
    );
  }

  if (body.jsonrpc !== "2.0" || body.method !== "tasks/send" || !body.params) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: body?.id ?? null,
        error: {
          code: -32600,
          message:
            "Invalid Request -- expected JSON-RPC 2.0 with method=tasks/send"
        }
      },
      { status: 400 }
    );
  }

  const params = body.params;
  const taskId = params.id || newTaskId("care-router");
  const sessionId = params.sessionId;
  const parentSpanId =
    typeof params.metadata?.parentSpanId === "string"
      ? (params.metadata.parentSpanId as string)
      : undefined;
  // Threaded by the /api/intake/route-to-care-router handoff when
  // it's run from /demo/routing. Used purely to stamp the Care
  // Router's span so /demo/analytics can filter by persona.
  // Production / non-demo callers omit this and the analytics
  // filter just shows zero hits for the empty persona filter.
  const personaId =
    typeof params.metadata?.personaId === "string"
      ? (params.metadata.personaId as string)
      : undefined;

  const dataPart = params.message?.parts?.find((p) => p.type === "data");
  const dataPayload =
    dataPart && dataPart.type === "data" && typeof dataPart.data === "object"
      ? (dataPart.data as {
          intake?: IntakeRecord;
          data360Grounding?: Data360GroundingHint;
        })
      : undefined;
  const intake: IntakeRecord =
    dataPayload?.intake ?? (dataPayload as IntakeRecord) ?? {};
  const grounding: Data360GroundingHint | undefined =
    dataPayload?.data360Grounding;

  const governance = evaluateGovernance({
    agentId: "care-router-claude",
    task: {
      hasRedFlagScreen: intake.redFlagsAcknowledged !== undefined,
      requestedModel:
        process.env.PAUSE_CARE_ROUTER_MODEL ?? "claude-sonnet-4-5-20250929",
      hasRationaleField: true
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: "care-router-claude",
      operation: "a2a.tasks/send.blocked",
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
          `Pause Agent Fabric blocked this task: ${governance.blockingViolations
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
    return NextResponse.json({
      jsonrpc: "2.0",
      id: body.id,
      result: failed
    });
  }

  // Per-request MCP host. When PAUSE_MCP_HOST_ENABLED is set, the
  // Care Router resolves providers by calling find_menopause_providers
  // on a registered MCP server (loopback to /api/mcp by default; plus
  // any external slot configured via PAUSE_MCP_HOST_REMOTES) rather
  // than calling the directory directly. The lookup adapter falls
  // back to the legacy direct-call path on host failure, so the
  // routing decision never regresses when an MCP remote is down.
  const useMcpHost = mcpHostEnabled();
  const host = useMcpHost ? createMCPHostFromRequest(req) : null;
  const hostAttempts: Array<{
    remoteId: string | null;
    ok: boolean;
    error?: string;
  }> = [];
  const providerLookup = host
    ? providerLookupViaMcpHost({
        host,
        onAttempt: (event) => hostAttempts.push(event)
      })
    : undefined;

  const startedAt = Date.now();
  let decision;
  try {
    decision = await route(intake, grounding, { providerLookup });
  } finally {
    if (host) await host.close();
  }
  const finishedAt = Date.now();

  const span = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: "care-router-claude",
    operation: "a2a.tasks/send",
    protocol: "a2a",
    status: "ok",
    attributes: {
      pathway: decision.pathway,
      acuity: decision.acuity,
      redFlagsTriggered: decision.redFlagsTriggered,
      provider: decision.modelProvenance.provider,
      model: decision.modelProvenance.model,
      via: decision.modelProvenance.via,
      policiesEvaluated: governance.appliesPolicies.length,
      durationMs: finishedAt - startedAt,
      ageBand: intake.ageBand,
      primarySymptom: intake.primarySymptom,
      severity: intake.severity,
      data360Grounded: grounding !== undefined,
      data360UnifiedPatientId: grounding?.unifiedPatientId,
      data360InsightsCited: decision.groundingUsed?.insightsCited ?? [],
      data360Cohort: decision.groundingUsed?.cohortName,
      recommendedProviderCount: decision.recommendedProviders?.providers.length ?? 0,
      recommendedProvidersSource: decision.recommendedProviders?.source,
      // The patient ZIP that drove the distance ranking, so the live-decision
      // card can carry ?from=<zip> through to each profile link (matching the
      // scripted intake fallback). Null when the patient gave no ZIP.
      recommendedProvidersZip: decision.recommendedProviders?.query?.zip ?? null,
      recommendedProviderNames:
        decision.recommendedProviders?.providers.map(
          (p) => `${p.name} · ${p.specialty}`
        ) ?? [],
      // Richer per-provider attributes so the UI can show distance + creds
      // without re-fetching the directory. Kept alongside the legacy
      // `recommendedProviderNames` array so older trace consumers still work.
      recommendedProviders:
        decision.recommendedProviders?.providers.map((p) => ({
          npi: p.npi,
          name: p.name,
          specialty: p.specialty,
          city: p.city,
          state: p.state,
          telehealth: p.telehealth,
          distanceMiles: p.distanceMiles ?? null,
          serviceSignals: p.serviceSignals ?? [],
          insuranceAccepted: p.insuranceAccepted ?? []
        })) ?? [],
      // MCP host attribution. Empty `mcpHostAttempts` means the
      // direct-call (non-host) path served the request. A non-empty
      // array gives the trace viewer per-remote success/failure so
      // an operator can see which MCP server the provider list came
      // from (loopback vs. an external partner).
      mcpHostEnabled: useMcpHost,
      mcpHostRemoteCount: host?.listRemotes().length ?? 0,
      mcpHostAttempts: hostAttempts,
      ...(personaId ? { personaId } : {})
    }
  });

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Recommended pathway: ${decision.pathwayLabel} (${decision.acuity}). ${decision.rationale[0] ?? ""}`,
        { decision }
      )
    },
    history: [params.message],
    artifacts: [
      {
        name: "RoutingDecision",
        description:
          "Care pathway decision for the supplied menopause intake record.",
        index: 0,
        parts: [
          { type: "data", data: decision as unknown as Record<string, unknown> }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: span.id,
        traceTaskId: span.taskId
      }
    }
  };

  return NextResponse.json({
    jsonrpc: "2.0",
    id: body.id,
    result: completed
  });
}
