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
  type DisclosureRequest,
  type MinimumNecessaryDetermination,
  DEMO_MINIMUM_NECESSARY_REQUEST,
  evaluateMinimumNecessary,
  minNecNoAutonomousOverDisclosure,
  minNecPurposeSourced,
  minNecScoped,
  minimumNecessarySummary
} from "../../../../../lib/minimum-necessary";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "minimum-necessary-agent";

/**
 * Google A2A `tasks/send` endpoint for the Minimum Necessary (HIPAA) agent — the data-substrate
 * service that decides whether a PHI disclosure is limited to the minimum necessary for its
 * stated purpose-of-use + requestor role.
 *
 *   POST /api/agents/minimum-necessary/tasks
 *
 * Loads a disclosure request and DETERMINISTICALLY evaluates it via evaluateMinimumNecessary:
 * it resolves the governing purpose-of-use rule and decides per field whether it is within the
 * minimum-necessary scope (release) or beyond it (withhold), yielding a disclosure limited to
 * the minimum necessary. The determination is a pure function of the request + the purpose
 * catalog (no randomness, no clock). Every decision cites a recorded purpose-of-use, every
 * released field is within scope, and an over-scope / bulk disclosure requires human review
 * (never autonomously released). The purpose catalog + mappings are illustrative / synthetic; a
 * real determination uses the covered entity's role-based access policies under 45 CFR
 * 164.502(b) / 164.514(d).
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.minnec.purpose-of-use-sourced (signal minNecPurposeSourced) — every decision must
 *     cite a recorded purpose-of-use.
 *   - policy.minnec.minimum-necessary-scoped (signal minNecScoped) — every released field must
 *     be within the purpose's permitted categories.
 *   - policy.minnec.no-autonomous-over-disclosure (signal minNecNoAutonomousOverDisclosure) —
 *     an over-scope / bulk disclosure must require human review.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: DisclosureRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if it cites a recorded purpose, releases
 *   only in-scope fields, and gates over-scope / bulk disclosures on human review) demonstrates
 *   the three governance blocks.
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
  const taskId = params.id || newTaskId("minimum-necessary");
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
      ? (data.request as DisclosureRequest)
      : DEMO_MINIMUM_NECESSARY_REQUEST;

  // Deterministic minimum-necessary determination.
  const determination = evaluateMinimumNecessary(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced determination.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as MinimumNecessaryDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: the purpose is sourced, every released field is in scope, and an
  // over-scope / bulk disclosure requires human review.
  const purposeSourced = minNecPurposeSourced(determinationForCheck);
  const scoped = minNecScoped(determinationForCheck);
  const noAutonomousOverDisclosure = minNecNoAutonomousOverDisclosure(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      minNecPurposeSourced: purposeSourced,
      minNecScoped: scoped,
      minNecNoAutonomousOverDisclosure: noAutonomousOverDisclosure
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "minnec.scope.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        minNecPurposeSourced: purposeSourced,
        minNecScoped: scoped,
        minNecNoAutonomousOverDisclosure: noAutonomousOverDisclosure,
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
          `Pause Agent Fabric blocked this minimum-necessary run: ${governance.blockingViolations
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

  const summary = minimumNecessarySummary(determination);

  // Receive-request span — the fabric records the request it received, parented under the
  // caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "minnec.receive-request",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      purposeId: request.purposeId,
      requestorRole: request.requestorRole,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Scope span — the deterministic per-field scoping, parented to the received request.
  const scopeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "minnec.scope",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      releasedCount: determination.releasedCount,
      withheldCount: determination.withheldCount,
      minimumNecessary: determination.minimumNecessary,
      minNecPurposeSourced: purposeSourced,
      minNecScoped: scoped,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Decide span — the disclosure decision (human-review-gated when over-scope / bulk), parented
  // to the scoping.
  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: scopeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "minnec.decide",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      requiresHumanReview: determination.requiresHumanReview,
      minNecNoAutonomousOverDisclosure: noAutonomousOverDisclosure,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the decision.
  // Every minimum-necessary determination is logged.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: decideSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "minnec.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      requiresHumanReview: determination.requiresHumanReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage = determination.exempt
    ? `Minimum-necessary determination for ${request.requestRef}: "${determination.purposeId}" is minimum-necessary EXEMPT — all ${determination.releasedCount} field(s) released${determination.bulk ? " (bulk scope — human review required)" : ""} (synthetic — illustrative purpose-of-use catalog; a real determination uses the covered entity's role-based access policies).`
    : determination.minimumNecessary && !determination.bulk
      ? `Minimum-necessary determination for ${request.requestRef}: minimum-necessary for "${determination.purposeId}" — all ${determination.releasedCount} requested field(s) within scope, released (synthetic — NOT a certified minimum-necessary engine).`
      : `Minimum-necessary determination for ${request.requestRef}: NOT minimum-necessary as submitted for "${determination.purposeId}" — ${determination.releasedCount} released, ${determination.withheldCount} withheld as out-of-scope${determination.bulk ? " (bulk scope)" : ""}; human review required (synthetic — illustrative purpose-of-use catalog).`;

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
        name: "MinimumNecessaryDetermination",
        description:
          "Deterministically-produced HIPAA minimum-necessary determination. It resolves the governing purpose-of-use rule (treatment, payment, healthcare-operations, research, or marketing) for the requestor role, then decides per requested field whether its category is within the minimum-necessary scope for that purpose (release) or beyond it (withhold), yielding a disclosure limited to the minimum necessary (45 CFR 164.502(b) / 164.514(d)). Treatment / disclosure-to-the-individual / authorized / required-by-law purposes are EXEMPT from the standard (all fields released). An over-scope (narrowed) or bulk / cohort disclosure is a RECOMMENDATION requiring human review — it is never autonomously released. The determination is a pure function of the request + the purpose catalog (no randomness, no clock). The purpose-of-use catalog, requestor roles, field categories, and allowed-category mappings are illustrative/synthetic, NOT a certified minimum-necessary engine — a real determination uses the covered entity's role-based access policies and its minimum-necessary standard under 45 CFR 164.502(b) / 164.514(d).",
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
        purposeId: determination.purposeId,
        requestorRole: determination.requestorRole,
        recordScope: determination.recordScope,
        exempt: determination.exempt,
        fieldCount: summary.fieldCount,
        releasedCount: determination.releasedCount,
        withheldCount: determination.withheldCount,
        minimumNecessary: determination.minimumNecessary,
        bulk: determination.bulk,
        requiresHumanReview: determination.requiresHumanReview,
        minNecPurposeSourced: purposeSourced,
        minNecScoped: scoped,
        minNecNoAutonomousOverDisclosure: noAutonomousOverDisclosure
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
