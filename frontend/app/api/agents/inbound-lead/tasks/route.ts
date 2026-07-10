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
import { resolveIdentity } from "../../../../../lib/data-360";
import {
  screenInboundLead,
  type FunnelLead
} from "../../../../../lib/agent-funnel";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "inbound-lead-agent";

/**
 * Google A2A `tasks/send` endpoint for the Agentforce Inbound Lead
 * Generation agent (prototype stand-in).
 *
 *   POST /api/agents/inbound-lead/tasks
 *
 * Captures an inbound lead, runs the ICP screen, resolves identity
 * against Data 360, and hands the captured lead onward to the
 * Qualification agent over A2A. Enforced-block policies checked before
 * any work:
 *   - policy.lead.explicit-optin-and-source-required (opt-in + source)
 *   - policy.lead.identity-resolution-before-create (resolved first)
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
  const taskId = params.id || newTaskId("inbound-lead");
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

  // Identity resolution runs BEFORE lead creation (policy requirement),
  // so the governance signal reflects reality: we resolved first.
  const identity = resolveIdentity({
    preferredName: lead.preferredName,
    ageBand: lead.ageBand,
    cycleStatus: lead.cycleStatus
  });

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      hasLeadOptInAndSource: Boolean(lead.consentOptIn) && Boolean(lead.source),
      identityResolved: true
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "lead.capture.blocked",
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
          `Pause Agent Fabric blocked this lead: ${governance.blockingViolations
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

  const screen = screenInboundLead(lead);

  const captureSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "lead.capture",
    protocol: "rest",
    attributes: {
      source: lead.source,
      consentOptIn: Boolean(lead.consentOptIn),
      ageBand: lead.ageBand,
      primarySymptom: lead.primarySymptom,
      ...(personaId ? { personaId } : {})
    }
  });

  const screenSpan = recordInstantSpan({
    taskId,
    parentSpanId: captureSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "lead.qualify",
    protocol: "rest",
    attributes: {
      icpMatch: screen.icpMatch,
      leadScore: screen.leadScore,
      readiness: screen.readiness,
      ...(personaId ? { personaId } : {})
    }
  });

  const identitySpan = recordInstantSpan({
    taskId,
    parentSpanId: screenSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "lead.identity.resolve",
    protocol: "rest",
    attributes: {
      unifiedPatientId: identity.unifiedPatientId,
      matched: identity.matchedSources.length > 0,
      action: identity.matchedSources.length > 0 ? "link" : "create",
      confidence: identity.confidence,
      source: "salesforce-data-360",
      ...(personaId ? { personaId } : {})
    }
  });

  const handoffSpan = recordInstantSpan({
    taskId,
    parentSpanId: identitySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "lead.route.handoff",
    protocol: "a2a",
    attributes: {
      destination: "qualification-agent",
      readiness: screen.readiness,
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
        `Captured lead (score ${screen.leadScore}, ${screen.readiness}); resolved identity and handing off to Qualification.`,
        { screen }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "CapturedLead",
        description:
          "Inbound lead with ICP screen + resolved identity, ready for qualification.",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              lead,
              screen,
              unifiedPatientId: identity.unifiedPatientId
            } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: handoffSpan.id,
        traceTaskId: taskId,
        nextAgent: "qualification-agent"
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
