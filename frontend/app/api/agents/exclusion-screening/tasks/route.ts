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
  type ScreeningDetermination,
  type ScreeningRequest,
  DEMO_SCREENING_REQUEST,
  evaluateScreening,
  exclusionMatchNotOverstated,
  exclusionMatchSourced,
  exclusionNoAutonomousBlockOrClear,
  screeningSummary
} from "../../../../../lib/exclusion-screening";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "exclusion-screening-agent";

/**
 * Google A2A `tasks/send` endpoint for the OIG Exclusion / Sanctions Screening agent — a claims /
 * payer-operations service on the payer & plan operations plane that screens a party against the OIG
 * LEIE before a plan pays or contracts with them.
 *
 *   POST /api/agents/exclusion-screening/tasks
 *
 * Loads a screening request and DETERMINISTICALLY evaluates it via evaluateScreening: it matches the
 * party's identifiers against the recorded exclusion catalog and reports a match strength grounded in
 * which identifiers actually matched. The match is a pure function of the request's own fields + the
 * catalog (no randomness, no clock). A reported match traces to a recorded record, the match strength
 * is never overstated, and a payment is never autonomously blocked / a party never autonomously
 * cleared — the screening is a recommendation a compliance officer acts on. This agent is deliberately
 * NOT PHI-bearing (phiAccessed:false throughout) — it screens a provider / vendor's identity against a
 * public exclusion list, not a patient's health information. The catalog + match rules are
 * illustrative; real screening is governed by the OIG LEIE and the payer's screening policy.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.exclusion.match-record-sourced (signal exclusionMatchSourced) — a match cites a cataloged record.
 *   - policy.exclusion.match-not-overstated (signal exclusionMatchNotOverstated) — the strength fits the signals.
 *   - policy.exclusion.no-autonomous-block-or-clear (signal exclusionNoAutonomousBlockOrClear) — no auto block/clear.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: ScreeningRequest, determination?: object } — the request is evaluated; a caller-
 *   asserted `determination` (admissible only if the match is sourced, not overstated, and no auto
 *   block/clear) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("exclusion-screening");
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
      ? (data.request as ScreeningRequest)
      : DEMO_SCREENING_REQUEST;

  // Deterministic screening.
  const determination = evaluateScreening(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as ScreeningDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: match-sourced + match-not-overstated + no autonomous block/clear.
  const matchSourced = exclusionMatchSourced(determinationForCheck);
  const matchNotOverstated = exclusionMatchNotOverstated(determinationForCheck);
  const noAutonomousBlockOrClear = exclusionNoAutonomousBlockOrClear(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      exclusionMatchSourced: matchSourced,
      exclusionMatchNotOverstated: matchNotOverstated,
      exclusionNoAutonomousBlockOrClear: noAutonomousBlockOrClear
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "exclusion.match-leie.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        partyRef: request.partyRef,
        exclusionMatchSourced: matchSourced,
        exclusionMatchNotOverstated: matchNotOverstated,
        exclusionNoAutonomousBlockOrClear: noAutonomousBlockOrClear,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        phiAccessed: false,
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
          `Pause Agent Fabric blocked this exclusion-screening run: ${governance.blockingViolations
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

  const summary = screeningSummary(determination);

  // Receive-party span — the fabric records the party it received, parented under the caller's span.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "exclusion.receive-party",
    protocol: "a2a",
    attributes: {
      partyRef: request.partyRef,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Match-LEIE span — the deterministic identifier match, parented to the received party.
  const matchSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "exclusion.match-leie",
    protocol: "a2a",
    attributes: {
      partyRef: request.partyRef,
      matchStrength: determination.matchStrength,
      matchedExclusionId: determination.matchedExclusionId,
      exclusionMatchSourced: matchSourced,
      exclusionMatchNotOverstated: matchNotOverstated,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Recommend-disposition span — the recommendation, parented to the match.
  const dispositionSpan = recordInstantSpan({
    taskId,
    parentSpanId: matchSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "exclusion.recommend-disposition",
    protocol: "a2a",
    attributes: {
      partyRef: request.partyRef,
      disposition: determination.disposition,
      exclusionNoAutonomousBlockOrClear: noAutonomousBlockOrClear,
      requiresComplianceReview: determination.requiresComplianceReview,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, partyRef: request.partyRef };

  const completedMessage = `Party ${request.partyRef} (${request.firstName} ${request.lastName}): ${determination.matchStrength} exclusion match${determination.matchedExclusionId ? ` to ${determination.matchedExclusionId} (${determination.exclusionType})` : ""} → ${determination.disposition} — recommendation for compliance review, no payment blocked and no party cleared autonomously (synthetic — illustrative LEIE catalog, NOT a certified screening system).`;

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
        name: "ScreeningDetermination",
        description:
          "Deterministically-produced OIG exclusion / sanctions screening determination. It matches the party's identifiers (last name, first name, and optionally an NPI and a date of birth) against the recorded LEIE catalog and reports a match strength grounded in which identifiers actually matched (no-match / possible / probable / confirmed) — a confirmed match requires an NPI match OR a full-name AND date-of-birth match. A reported match traces to a recorded exclusion record, the match strength is NEVER overstated (a name coincidence is never a confirmed exclusion), and a payment is NEVER autonomously blocked / a party never autonomously cleared — the screening is a recommendation a compliance officer confirms and acts on. The match is a pure function of the party's own fields + the catalog (no randomness, no clock). This agent is deliberately NOT PHI-bearing — it screens a provider / vendor's identity against a public exclusion list, not a patient's health information. The catalog + match rules are illustrative (no fuzzy / phonetic matching, no SAM.gov / state Medicaid lists, no reinstatement handling), NOT a certified exclusion-screening system — real screening is governed by the OIG LEIE, the OIG Special Advisory Bulletin on the effect of exclusion, and the payer's screening policy.",
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
        traceSpanId: dispositionSpan.id,
        traceTaskId: taskId,
        partyRef: request.partyRef,
        matchStrength: determination.matchStrength,
        matchedExclusionId: determination.matchedExclusionId,
        disposition: determination.disposition,
        npiMatch: determination.npiMatch,
        nameMatch: determination.nameMatch,
        dobMatch: determination.dobMatch,
        requiresComplianceReview: determination.requiresComplianceReview,
        exclusionMatchSourced: matchSourced,
        exclusionMatchNotOverstated: matchNotOverstated,
        exclusionNoAutonomousBlockOrClear: noAutonomousBlockOrClear,
        summaryStrength: summary.matchStrength
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
