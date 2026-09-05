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
  type AuditLogDetermination,
  type AuditLogVerificationRequest,
  DEMO_AUDIT_LOG_REQUEST,
  auditLogHashChainVerified,
  auditLogNoAutonomousRedaction,
  auditLogSequenceComplete,
  auditLogSummary,
  evaluateAuditLogIntegrity
} from "../../../../../lib/audit-log-integrity";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "audit-log-integrity-agent";

/**
 * Google A2A `tasks/send` endpoint for the Audit Log Integrity (Tamper-Evidence) agent — the
 * data-substrate service that verifies an audit trail is tamper-evident by recomputing its hash
 * chain and checking its sequence for gaps.
 *
 *   POST /api/agents/audit-log-integrity/tasks
 *
 * Loads an audit log and DETERMINISTICALLY evaluates it via evaluateAuditLogIntegrity: it
 * recomputes each entry's hash and chain link, checks the sequence numbers for gaps, and decides
 * whether the log is verified (hash chain intact AND sequence complete). Verification is a pure
 * function of the log's entries (no randomness, no clock). A log is marked verified only over an
 * intact chain + complete sequence, and the agent never rewrites the log — a break is flagged
 * for human forensic review. The hash is an illustrative non-cryptographic FNV-1a; a real
 * control uses a cryptographic hash (SHA-256), append-only / WORM storage, and signed
 * checkpoints.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.auditlog.hash-chain-verified (signal auditLogHashChainVerified) — a verified log
 *     must have an intact hash chain.
 *   - policy.auditlog.sequence-complete (signal auditLogSequenceComplete) — a verified log must
 *     have a complete sequence.
 *   - policy.auditlog.no-autonomous-redaction (signal auditLogNoAutonomousRedaction) — the log
 *     must never be redacted / repaired.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: AuditLogVerificationRequest, determination?: object } — the request is
 *   evaluated; a caller-asserted `determination` (admissible only if it does not mark a broken /
 *   gapped log verified and does not claim it repaired the log) demonstrates the three
 *   governance blocks.
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
  const taskId = params.id || newTaskId("audit-log-integrity");
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
      ? (data.request as AuditLogVerificationRequest)
      : DEMO_AUDIT_LOG_REQUEST;

  // Deterministic audit-log integrity verification.
  const determination = evaluateAuditLogIntegrity(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced determination.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as AuditLogDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: verified only over an intact chain + complete sequence, and the
  // log is never redacted / repaired.
  const hashChainVerified = auditLogHashChainVerified(determinationForCheck);
  const sequenceComplete = auditLogSequenceComplete(determinationForCheck);
  const noAutonomousRedaction = auditLogNoAutonomousRedaction(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      auditLogHashChainVerified: hashChainVerified,
      auditLogSequenceComplete: sequenceComplete,
      auditLogNoAutonomousRedaction: noAutonomousRedaction
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "auditlog.verify.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        logRef: request.logRef,
        auditLogHashChainVerified: hashChainVerified,
        auditLogSequenceComplete: sequenceComplete,
        auditLogNoAutonomousRedaction: noAutonomousRedaction,
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
          `Pause Agent Fabric blocked this audit-log integrity run: ${governance.blockingViolations
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

  const summary = auditLogSummary(determination);

  // Receive-log span — the fabric records the log it received, parented under the caller's span
  // if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "auditlog.receive-log",
    protocol: "a2a",
    attributes: {
      logRef: request.logRef,
      entryCount: determination.entryCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Verify span — the deterministic hash-chain + sequence verification, parented to the received
  // log.
  const verifySpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "auditlog.verify",
    protocol: "a2a",
    attributes: {
      logRef: request.logRef,
      verified: determination.verified,
      brokenLinks: determination.brokenLinks,
      sequenceGaps: determination.sequenceGaps,
      auditLogHashChainVerified: hashChainVerified,
      auditLogSequenceComplete: sequenceComplete,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Attest span — the integrity attestation (forensic-review-gated on a break), parented to the
  // verification.
  const attestSpan = recordInstantSpan({
    taskId,
    parentSpanId: verifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "auditlog.attest",
    protocol: "a2a",
    attributes: {
      logRef: request.logRef,
      requiresForensicReview: determination.requiresForensicReview,
      auditLogNoAutonomousRedaction: noAutonomousRedaction,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the attestation.
  // (The integrity check is itself audited.)
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: attestSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "auditlog.log-audit",
    protocol: "a2a",
    attributes: {
      logRef: request.logRef,
      verified: determination.verified,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, logRef: request.logRef };

  const completedMessage = determination.verified
    ? `Audit log ${request.logRef}: VERIFIED — hash chain intact and sequence complete across ${determination.entryCount} entr${determination.entryCount === 1 ? "y" : "ies"} (synthetic — illustrative non-cryptographic FNV-1a chain; a real control uses SHA-256 + WORM storage + signed checkpoints).`
    : `Audit log ${request.logRef}: TAMPER SUSPECTED — ${determination.brokenLinks} broken link(s), ${determination.sequenceGaps} sequence gap(s)${determination.firstBreakSeq !== undefined ? ` (first break at seq ${determination.firstBreakSeq})` : ""}; flagged for forensic review, NOT repaired (synthetic — NOT a certified tamper-evidence system).`;

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
        name: "AuditLogDetermination",
        description:
          "Deterministically-produced audit-log integrity determination. It recomputes each entry's hash and verifies each chain link (the entry's prevHash against the prior entry's hash), checks the sequence numbers for gaps, and decides whether the log is verified (hash chain intact AND sequence complete). A log is marked verified only over an intact chain + complete sequence — a single broken link is tampering and a sequence gap means a deleted entry. The agent VERIFIES and FLAGS — it NEVER deletes, rewrites, or repairs an audit entry; a broken log is flagged for human forensic review. Verification is a pure function of the log's entries (no randomness, no clock). The hash is an illustrative non-cryptographic FNV-1a, NOT a certified tamper-evidence system — a real control uses a cryptographic hash (SHA-256), append-only / WORM storage, and signed checkpoints.",
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
        logRef: request.logRef,
        entryCount: determination.entryCount,
        verified: determination.verified,
        hashChainIntact: determination.hashChainIntact,
        sequenceComplete: determination.sequenceComplete,
        brokenLinks: determination.brokenLinks,
        sequenceGaps: determination.sequenceGaps,
        firstBreakSeq: determination.firstBreakSeq,
        requiresForensicReview: determination.requiresForensicReview,
        auditLogHashChainVerified: hashChainVerified,
        auditLogSequenceComplete: sequenceComplete,
        auditLogNoAutonomousRedaction: noAutonomousRedaction,
        summaryEntryCount: summary.entryCount
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
