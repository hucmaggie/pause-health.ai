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
  type IdentityResolution,
  type PatientRecord,
  type ScoredCandidate,
  DEMO_CANDIDATE_RECORDS,
  DEMO_INCOMING_RECORD,
  excludesProtectedAttributesInMatching,
  identityResolutionSummary,
  matchTracesToFeatures,
  matchingFeatureIds,
  mergeRequiresHumanReview,
  resolveIdentity
} from "../../../../../lib/master-patient-index";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "master-patient-index-agent";

/**
 * Google A2A `tasks/send` endpoint for the Master Patient Index / Identity
 * Resolution agent — the MuleSoft control-plane / data-substrate identity
 * service, the identity/dedup layer of the data substrate.
 *
 *   POST /api/agents/master-patient-index/tasks
 *
 * Loads the CANDIDATE records, DETERMINISTICALLY scores each against the INCOMING
 * record with the transparent weighted feature set (name, DOB, administrative
 * sex, address, phone, member/MRN identifiers), classifies each as match /
 * possible-match / no-match by fixed thresholds, and recommends a resolution
 * action (link / merge / manual-review / no-action) via resolveIdentity. The
 * resolution is a pure function of the records (no randomness, no clock). It is a
 * RECOMMENDER + integrity gate: a merge below the auto-match threshold is a
 * manual-review recommendation requiring a human steward — there is never an
 * 'auto-merged' state. The features + weights + thresholds + records are
 * illustrative/synthetic, NOT a certified EMPI algorithm.
 *
 * Enforced-block policies checked before any resolution is acted on:
 *   - policy.mpi.transparent-matching (signal matchTracesToFeatures) — every
 *     match decision must trace to the defined match-feature spec (no opaque /
 *     black-box matching).
 *   - policy.mpi.no-autonomous-merge (signal mergeRequiresHumanReview) — a merge
 *     below the auto-match threshold must not be performed autonomously.
 *   - policy.mpi.no-protected-class-matching (signal
 *     excludesProtectedAttributesInMatching) — matching must not use a
 *     protected-class attribute as a feature.
 * A block returns HTTP 200 with a `failed` task. A POSSIBLE-MATCH (manual-review
 * with requiresHumanReview:true) is NOT a block — it is a safe completed answer
 * surfaced for a human steward.
 *
 * Input (data part):
 *   { incoming?: PatientRecord, candidates?: PatientRecord[],
 *     scoredCandidates?: ScoredCandidate[], resolution?: object,
 *     matchingFeatureIds?: string[] } — the incoming + candidates are resolved;
 *   a caller-asserted `scoredCandidates` set (admissible only if every one
 *   traces to the feature spec) demonstrates the transparent-matching block, a
 *   caller-asserted `resolution` (an autonomous merge below the threshold)
 *   demonstrates the no-autonomous-merge block, and a caller-asserted
 *   `matchingFeatureIds` set (admissible only if none is a protected-class
 *   attribute) demonstrates the no-protected-class-matching block.
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
  const taskId = params.id || newTaskId("mpi");
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
  const incoming =
    data.incoming && typeof data.incoming === "object"
      ? (data.incoming as PatientRecord)
      : DEMO_INCOMING_RECORD;
  const candidates = Array.isArray(data.candidates)
    ? (data.candidates as PatientRecord[])
    : DEMO_CANDIDATE_RECORDS;

  // Deterministic identity resolution.
  const resolution = resolveIdentity(incoming, candidates);

  // The scored candidates the transparent-matching gate checks: the caller-
  // asserted set (to demonstrate the block) or the produced candidates.
  const assertedScored = data.scoredCandidates as ScoredCandidate[] | undefined;
  const scoredForCheck = Array.isArray(assertedScored)
    ? assertedScored
    : resolution.candidates;

  // The resolution the no-autonomous-merge gate checks: the caller-asserted
  // resolution (to demonstrate the block) or the produced resolution.
  const assertedResolution =
    data.resolution && typeof data.resolution === "object"
      ? (data.resolution as IdentityResolution)
      : undefined;
  const resolutionForCheck = assertedResolution ?? resolution;

  // The matching feature ids the no-protected-class gate checks: the caller-
  // asserted set (to demonstrate the block) or the default feature spec.
  const assertedFeatureIds = data.matchingFeatureIds as string[] | undefined;
  const featureIdsForCheck = Array.isArray(assertedFeatureIds)
    ? assertedFeatureIds
    : matchingFeatureIds();

  // Honest governance signals. Every match must trace to the feature spec; a
  // merge below the auto threshold requires a human steward; matching may not use
  // a protected-class attribute.
  const tracesToFeatures = matchTracesToFeatures(scoredForCheck);
  const mergeGated = mergeRequiresHumanReview(resolutionForCheck);
  const excludesProtected = excludesProtectedAttributesInMatching(featureIdsForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      matchTracesToFeatures: tracesToFeatures,
      mergeRequiresHumanReview: mergeGated,
      excludesProtectedAttributesInMatching: excludesProtected
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "mpi.resolve.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        incomingRef: incoming.recordId,
        matchTracesToFeatures: tracesToFeatures,
        mergeRequiresHumanReview: mergeGated,
        excludesProtectedAttributesInMatching: excludesProtected,
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
          `Pause Agent Fabric blocked this identity-resolution run: ${governance.blockingViolations
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

  const summary = identityResolutionSummary(incoming, resolution);
  const possibleMatchCount = resolution.candidates.filter(
    (c) => c.classification === "possible-match"
  ).length;

  // Load-candidates span — the fabric records the candidate set it loaded,
  // parented under the caller's span if any.
  const loadSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "mpi.load-candidates",
    protocol: "a2a",
    attributes: {
      incomingRef: incoming.recordId,
      candidateCount: resolution.candidates.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Score span — the transparent feature scoring it produced, parented to the
  // candidates it read.
  const scoreSpan = recordInstantSpan({
    taskId,
    parentSpanId: loadSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "mpi.score",
    protocol: "a2a",
    attributes: {
      candidateCount: resolution.candidates.length,
      bestScore: summary.bestScore,
      matchTracesToFeatures: tracesToFeatures,
      excludesProtectedAttributesInMatching: excludesProtected,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Resolve span — the best match + recommendation, parented to the scoring it
  // follows from. A merge below the auto threshold always requires a human steward.
  const resolveSpan = recordInstantSpan({
    taskId,
    parentSpanId: scoreSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "mpi.resolve",
    protocol: "a2a",
    attributes: {
      bestMatchId: summary.bestMatchId,
      bestScore: summary.bestScore,
      classification: summary.classification,
      recommendation: resolution.recommendation,
      mergeRequiresHumanReview: mergeGated,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Flag-for-review span — the ambiguous possible-matches handed to a human
  // steward, parented to the resolution. A possible-match is a safe answer, not
  // a block.
  const flagSpan = recordInstantSpan({
    taskId,
    parentSpanId: resolveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "mpi.flag-for-review",
    protocol: "a2a",
    attributes: {
      matchCount: resolution.candidates.filter((c) => c.classification === "match").length,
      possibleMatchCount,
      noMatchCount: resolution.candidates.filter((c) => c.classification === "no-match").length,
      requiresHumanReview: resolution.requiresHumanReview,
      mergeRequiresHumanReview: mergeGated,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { resolution, incomingRef: incoming.recordId };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Resolved identity for ${incoming.recordId} against ${resolution.candidates.length} candidate record${
          resolution.candidates.length === 1 ? "" : "s"
        }: ${
          resolution.bestMatch
            ? `best match ${resolution.bestMatch.candidateId} scored ${resolution.bestMatch.score} (${resolution.bestMatch.classification})`
            : "no candidates"
        } → recommendation ${resolution.recommendation}${
          resolution.requiresHumanReview ? " (requires human steward review)" : ""
        }. Every match decision traces to the defined match-feature spec (transparent, not a black box); a merge below the auto-match threshold is NEVER performed autonomously — it requires a human steward; and protected-class attributes are never used as matching features (synthetic — illustrative features, weights, thresholds, and records, NOT a certified EMPI algorithm).`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "IdentityResolution",
        description:
          "Deterministically-produced identity resolution for an incoming patient record against a set of candidate records — each candidate scored against a TRANSPARENT weighted demographic feature set (name, DOB, administrative sex, address, phone, member/MRN identifiers), classified as match / possible-match / no-match by fixed thresholds, with a recommended resolution action (link / merge / manual-review / no-action) for the best match. A merge below the auto-match threshold is a manual-review recommendation carrying requiresHumanReview:true (there is never an 'auto-merged' state); every match decision traces to the defined feature spec; and protected-class attributes are never used as matching features. The match features + weights + thresholds + patient records are illustrative/synthetic, NOT a certified EMPI algorithm.",
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
        traceSpanId: flagSpan.id,
        traceTaskId: taskId,
        incomingRef: incoming.recordId,
        bestMatchId: summary.bestMatchId,
        bestScore: summary.bestScore,
        classification: summary.classification,
        recommendation: resolution.recommendation,
        requiresHumanReview: resolution.requiresHumanReview,
        possibleMatchCount,
        matchTracesToFeatures: tracesToFeatures,
        mergeRequiresHumanReview: mergeGated,
        excludesProtectedAttributesInMatching: excludesProtected
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
