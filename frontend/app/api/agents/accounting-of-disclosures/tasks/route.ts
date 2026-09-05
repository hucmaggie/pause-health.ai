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
  type AccountingDetermination,
  type AccountingRequest,
  DEMO_ACCOUNTING_REQUEST,
  accountingComplete,
  accountingNoAutonomousSuppression,
  accountingPurposeSourced,
  accountingSummary,
  evaluateAccounting
} from "../../../../../lib/accounting-of-disclosures";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "accounting-of-disclosures-agent";

/**
 * Google A2A `tasks/send` endpoint for the Accounting of Disclosures (HIPAA §164.528) agent — the
 * control-plane / data-substrate privacy service that assembles a patient's accounting of who their
 * PHI was disclosed to, and for what non-TPO purpose, over the lookback window.
 *
 *   POST /api/agents/accounting-of-disclosures/tasks
 *
 * Loads an accounting request and DETERMINISTICALLY evaluates it via evaluateAccounting: it computes
 * the lookback window (as-of date − lookback years), classifies each disclosure (in-accounting /
 * excluded-TPO / excluded-authorized / out-of-window) against the §164.528 accountability rules, and
 * assembles the accounting. The classification is a pure function of the request's own fields (no
 * randomness, no clock). Every disclosure's purpose traces to a recorded catalog, every accountable
 * in-window disclosure appears in the accounting, and no logged disclosure is autonomously
 * suppressed — the accounting requires privacy-officer review. The purpose catalog is illustrative;
 * a real accounting is governed by HIPAA §164.528 and the covered entity's Notice of Privacy
 * Practices.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.accounting.purpose-category-sourced (signal accountingPurposeSourced) — every
 *     disclosure cites a recorded purpose.
 *   - policy.accounting.accountable-disclosures-complete (signal accountingDisclosuresComplete) —
 *     every accountable, in-window disclosure appears in the accounting.
 *   - policy.accounting.no-autonomous-suppression (signal accountingNoAutonomousSuppression) — no
 *     logged disclosure is autonomously suppressed and release is privacy-officer-reviewed.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: AccountingRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if every purpose is cataloged, every
 *   accountable in-window disclosure is in the accounting, and no disclosure is suppressed)
 *   demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("accounting-of-disclosures");
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
      ? (data.request as AccountingRequest)
      : DEMO_ACCOUNTING_REQUEST;

  // Deterministic accounting evaluation.
  const determination = evaluateAccounting(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced determination.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as AccountingDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: sourced purposes + a complete accounting + no autonomous suppression.
  const purposeSourced = accountingPurposeSourced(determinationForCheck);
  const disclosuresComplete = accountingComplete(determinationForCheck);
  const noAutonomousSuppression = accountingNoAutonomousSuppression(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      accountingPurposeSourced: purposeSourced,
      accountingDisclosuresComplete: disclosuresComplete,
      accountingNoAutonomousSuppression: noAutonomousSuppression
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "accounting.assemble.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        accountingPurposeSourced: purposeSourced,
        accountingDisclosuresComplete: disclosuresComplete,
        accountingNoAutonomousSuppression: noAutonomousSuppression,
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
          `Pause Agent Fabric blocked this accounting-of-disclosures run: ${governance.blockingViolations
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

  const summary = accountingSummary(determination);

  // Receive-log span — the fabric records the disclosure log it received, parented under the
  // caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "accounting.receive-log",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      patientRef: request.patientRef,
      totalDisclosures: determination.totalDisclosures,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify span — the deterministic per-disclosure classification, parented to the received log.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "accounting.classify",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      accountableCount: determination.accountableCount,
      excludedCount: determination.excludedCount,
      outOfWindowCount: determination.outOfWindowCount,
      accountingPurposeSourced: purposeSourced,
      accountingDisclosuresComplete: disclosuresComplete,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Assemble span — the assembled accounting (release-gated on privacy-officer review), parented to
  // the classification.
  const assembleSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "accounting.assemble",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      accountableCount: determination.accountableCount,
      requiresPrivacyOfficerReview: determination.requiresPrivacyOfficerReview,
      accountingNoAutonomousSuppression: noAutonomousSuppression,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the assembly.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: assembleSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "accounting.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      accountableCount: determination.accountableCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage = `Accounting for ${request.patientRef} as of ${determination.asOfDate} (${determination.lookbackYears}-year window from ${determination.windowStart}): ${determination.accountableCount} accountable disclosure(s) of ${determination.totalDisclosures} logged — ${determination.excludedCount} excluded (TPO / authorized), ${determination.outOfWindowCount} outside the window; privacy-officer review required before release (synthetic — illustrative purpose catalog, NOT a certified §164.528 system).`;

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
        name: "AccountingDetermination",
        description:
          "Deterministically-produced HIPAA §164.528 accounting of disclosures. It computes the lookback window (as-of date − lookback years), classifies each disclosure (in-accounting / excluded-TPO / excluded-authorized / out-of-window) against the §164.528 accountability rules (treatment / payment / operations and patient-authorized disclosures are excluded; non-TPO disclosures — public-health mandates, law enforcement, judicial orders, research without authorization — are accountable), and assembles the accounting. Every disclosure's purpose traces to a recorded catalog, every accountable in-window disclosure appears in the accounting, and NO logged disclosure is autonomously suppressed — the accounting is a recommendation requiring privacy-officer review. The classification is a pure function of the request's own fields (no randomness, no clock). The purpose catalog is illustrative, NOT a certified accounting-of-disclosures system — a real accounting is governed by HIPAA §164.528 (the full exclusion set, the six-year window, and the electronic-health-record disclosure rules) and the covered entity's Notice of Privacy Practices.",
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
        patientRef: determination.patientRef,
        windowStart: determination.windowStart,
        totalDisclosures: determination.totalDisclosures,
        accountableCount: determination.accountableCount,
        excludedCount: determination.excludedCount,
        outOfWindowCount: determination.outOfWindowCount,
        requiresPrivacyOfficerReview: determination.requiresPrivacyOfficerReview,
        accountingPurposeSourced: purposeSourced,
        accountingDisclosuresComplete: disclosuresComplete,
        accountingNoAutonomousSuppression: noAutonomousSuppression,
        summaryAccountableCount: summary.accountableCount
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
