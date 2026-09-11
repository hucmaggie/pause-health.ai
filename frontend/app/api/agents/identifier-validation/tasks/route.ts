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
  type IdentifierValidationDetermination,
  type IdentifierValidationRequest,
  DEMO_IDENTIFIER_VALIDATION_REQUEST,
  checksumConsistent,
  evaluateIdentifierValidation,
  identifierNoAutonomousReject,
  identifierValidationSummary,
  identifiersSourced
} from "../../../../../lib/identifier-validation";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "identifier-validation-agent";

/**
 * Google A2A `tasks/send` endpoint for the Provider Identifier (NPI) Validation & Integrity agent — a
 * data-substrate integrity service on the platform plane that validates a batch of National Provider
 * Identifiers with the CMS check-digit algorithm (the Luhn / mod-10 checksum over the "80840" prefix + the
 * 9-digit base).
 *
 *   POST /api/agents/identifier-validation/tasks
 *
 * Loads an identifier-validation request and DETERMINISTICALLY evaluates it via
 * evaluateIdentifierValidation: it validates every NPI's format and Luhn check digit, classifies each as
 * valid / invalid-format / invalid-checksum, tallies the per-kind counts, and derives the batch disposition
 * (all-valid / invalids-flagged). There is no percentile, no union-find, no identity match, no FSM
 * transition, no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval
 * merge, no topological sort, no set-difference, and no hash chain — it is a MODULAR-ARITHMETIC CHECKSUM
 * (the Luhn / mod-10 check digit), a pure function of the identifiers. Every result is sourced, the
 * checksums recompute exactly, and nothing is rejected — a data steward confirms every finding. This is
 * DELIBERATELY NOT a PHI-bearing agent (phiAccessed:false throughout) — an NPI is a provider identifier,
 * not patient health information. The identifiers are illustrative; this validates STRUCTURE + check digit
 * only, NOT a certified NPPES / registry lookup.
 *
 * Enforced-block policies checked before any finding leaves the fabric:
 *   - policy.identifier.identifiers-sourced (signal identifiersSourced).
 *   - policy.identifier.checksum-consistent (signal checksumConsistent).
 *   - policy.identifier.no-autonomous-reject (signal identifierNoAutonomousReject).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: IdentifierValidationRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if every result is sourced, the checksums recompute
 *   exactly, and it is not auto-rejected) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("identifier-validation");
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
      ? (data.request as IdentifierValidationRequest)
      : DEMO_IDENTIFIER_VALIDATION_REQUEST;

  // Deterministic identifier-validation finding.
  const determination = evaluateIdentifierValidation(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as IdentifierValidationDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: identifiers-sourced + checksum-consistent + no autonomous reject.
  const sourced = identifiersSourced(determinationForCheck);
  const consistent = checksumConsistent(determinationForCheck);
  const noAutonomous = identifierNoAutonomousReject(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      identifiersSourced: sourced,
      checksumConsistent: consistent,
      identifierNoAutonomousReject: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "identifier.validate-checksums.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        batchRef: request.batchRef,
        identifiersSourced: sourced,
        checksumConsistent: consistent,
        identifierNoAutonomousReject: noAutonomous,
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
          `Pause Agent Fabric blocked this identifier-validation run: ${governance.blockingViolations
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

  const summary = identifierValidationSummary(determination);

  // Receive-batch span — the fabric records the batch it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "identifier.receive-batch",
    protocol: "a2a",
    attributes: {
      batchRef: request.batchRef,
      total: determination.total,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Validate-checksums span — the Luhn computation, parented to the received batch.
  const validateSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "identifier.validate-checksums",
    protocol: "a2a",
    attributes: {
      batchRef: request.batchRef,
      validCount: determination.validCount,
      invalidFormatCount: determination.invalidFormatCount,
      invalidChecksumCount: determination.invalidChecksumCount,
      identifiersSourced: sourced,
      checksumConsistent: consistent,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the disposition, parented to the checksum computation.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: validateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "identifier.classify-disposition",
    protocol: "a2a",
    attributes: {
      batchRef: request.batchRef,
      disposition: determination.disposition,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the finding recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "identifier.log-audit",
    protocol: "a2a",
    attributes: {
      batchRef: request.batchRef,
      disposition: determination.disposition,
      identifierNoAutonomousReject: noAutonomous,
      requiresStewardReview: determination.requiresStewardReview,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, batchRef: request.batchRef };

  const invalidTotal = determination.invalidFormatCount + determination.invalidChecksumCount;
  const completedMessage =
    determination.disposition === "all-valid"
      ? `All ${determination.total} NPI(s) are well-formed with valid check digits — a recommendation for a data steward, no claim rejected or provider removed (synthetic — illustrative identifiers, validates STRUCTURE + Luhn check digit only, NOT a certified NPPES / registry lookup).`
      : `${invalidTotal} of ${determination.total} NPI(s) failed validation (${determination.invalidFormatCount} format, ${determination.invalidChecksumCount} checksum) — flagged for a data steward, no claim rejected or provider removed (synthetic — illustrative identifiers, validates STRUCTURE + Luhn check digit only, NOT a certified NPPES / registry lookup).`;

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
        name: "IdentifierValidationDetermination",
        description:
          "Deterministically-produced identifier-validation finding. It validates every submitted NPI with the CMS check-digit algorithm — the Luhn (mod-10) checksum computed over the '80840' prefix + the 9-digit base — classifying each as valid, invalid-format (not 10 digits beginning with 1 or 2), or invalid-checksum (a well-formed NPI whose 10th digit does not match the recomputed Luhn check digit, a likely transposition / typo), and derives the batch disposition: all-valid or invalids-flagged. Every result corresponds to a submitted identifier (same NPI, same order; no fabricated result, no dropped identifier) with the per-kind counts summing to the total; the checksums recompute exactly from the NPIs; and no claim is rejected, no provider removed, and no number corrected — a data steward confirms every finding. There is no percentile, no union-find, no identity match, no FSM transition, no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, and no hash chain — it is a modular-arithmetic checksum (the Luhn / mod-10 check digit), a pure function of the identifiers. This is DELIBERATELY NOT a PHI-bearing agent — an NPI is a provider identifier, not patient health information. It is DISTINCT from the Provider Credentialing agent (which cites an npi-registry as a verification SOURCE but does not validate the check digit) and the OIG Exclusion agent (which MATCHES an NPI against the sanctions list); this validates that the NPI itself is well-formed and its check digit is correct. It validates STRUCTURE + check digit only — it does NOT confirm the NPI is assigned, active, or belongs to a particular provider (that requires an NPPES / registry lookup); the identifiers are illustrative synthetics.",
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
        batchRef: request.batchRef,
        disposition: determination.disposition,
        total: determination.total,
        validCount: determination.validCount,
        invalidFormatCount: determination.invalidFormatCount,
        invalidChecksumCount: determination.invalidChecksumCount,
        requiresStewardReview: summary.requiresStewardReview,
        identifiersSourced: sourced,
        checksumConsistent: consistent,
        identifierNoAutonomousReject: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
