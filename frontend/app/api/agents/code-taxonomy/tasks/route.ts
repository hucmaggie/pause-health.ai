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
  type CodeTaxonomyDetermination,
  type CodeTaxonomyRequest,
  DEMO_CODE_TAXONOMY_REQUEST,
  classificationConsistent,
  classificationsSourced,
  codeTaxonomySummary,
  evaluateCodeTaxonomy,
  noAutonomousRecode
} from "../../../../../lib/code-taxonomy";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "code-taxonomy-agent";

/**
 * Google A2A `tasks/send` endpoint for the Clinical Code Taxonomy / Longest-Prefix Classification agent — a
 * terminology / value-set service on the platform & data-substrate plane that, given a batch of clinical
 * codes and a taxonomy of category prefixes, classifies each code to its most-specific matching category via
 * a TRIE (PREFIX TREE) LONGEST-PREFIX MATCH.
 *
 *   POST /api/agents/code-taxonomy/tasks
 *
 * Loads a classification request and DETERMINISTICALLY evaluates it via evaluateCodeTaxonomy: it builds the
 * trie from the taxonomy and classifies each code by longest-prefix match. There is no regression, no
 * knapsack, no CUSUM, no k-way merge, no recursive boolean tree, no stable matching, no geospatial distance,
 * no checksum, no union-find, no percentile, no largest-remainder apportionment, no edit distance, no
 * interval selection, no hash chain, no BFS hop-count, no Dijkstra shortest path, no keyed set-difference, no
 * majority vote, and no hierarchy-coefficient sum — it is a trie longest-prefix match, a pure function of the
 * taxonomy + codes. The batch is sourced, the classification recomputes, and nothing is re-coded — a coder
 * confirms. This is DELIBERATELY NOT a PHI-bearing agent (phiAccessed:false throughout) — a code is a
 * terminology token, classified against a value-set taxonomy, not patient health information.
 *
 * Enforced-block policies checked before any classification leaves the fabric:
 *   - policy.code.classifications-sourced (signal codeClassificationsSourced).
 *   - policy.code.classification-consistent (signal codeClassificationConsistent).
 *   - policy.code.no-autonomous-recode (signal codeNoAutonomousRecode).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: CodeTaxonomyRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the batch is sourced, the classification recomputes, and it is not
 *   auto-applied) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("code-taxonomy");
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
      ? (data.request as CodeTaxonomyRequest)
      : DEMO_CODE_TAXONOMY_REQUEST;

  // Deterministic trie longest-prefix classification.
  const determination = evaluateCodeTaxonomy(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as CodeTaxonomyDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: classifications-sourced + classification-consistent + no autonomous re-code.
  const sourced = classificationsSourced(determinationForCheck);
  const consistent = classificationConsistent(determinationForCheck);
  const noAutonomous = noAutonomousRecode(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      codeClassificationsSourced: sourced,
      codeClassificationConsistent: consistent,
      codeNoAutonomousRecode: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "taxonomy.match-prefixes.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        catalogRef: request.catalogRef,
        codeClassificationsSourced: sourced,
        codeClassificationConsistent: consistent,
        codeNoAutonomousRecode: noAutonomous,
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
          `Pause Agent Fabric blocked this classification: ${governance.blockingViolations
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

  const summary = codeTaxonomySummary(determination);

  // Receive-codes span — the fabric records the taxonomy + codes it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "taxonomy.receive-codes",
    protocol: "a2a",
    attributes: {
      catalogRef: request.catalogRef,
      codeCount: determination.codes.length,
      prefixCount: determination.taxonomy.length,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Match-prefixes span — the trie longest-prefix classification, parented to the received codes.
  const matchSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "taxonomy.match-prefixes",
    protocol: "a2a",
    attributes: {
      catalogRef: request.catalogRef,
      classifiedCount: determination.classifiedCount,
      codeClassificationsSourced: sourced,
      codeClassificationConsistent: consistent,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the batch disposition, parented to the matching.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: matchSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "taxonomy.classify-disposition",
    protocol: "a2a",
    attributes: {
      catalogRef: request.catalogRef,
      disposition: determination.disposition,
      unclassifiedCount: determination.unclassifiedCount,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the classification recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "taxonomy.log-audit",
    protocol: "a2a",
    attributes: {
      catalogRef: request.catalogRef,
      disposition: determination.disposition,
      codeNoAutonomousRecode: noAutonomous,
      requiresCoderReview: determination.requiresCoderReview,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, catalogRef: request.catalogRef };

  const completedMessage =
    determination.unclassifiedCount > 0
      ? `Code-taxonomy classification complete — ${determination.classifiedCount}/${determination.total} code(s) classified, ${determination.unclassifiedCount} unclassified; a recommendation for a coder, nothing re-coded (synthetic — trie longest-prefix match, NOT a certified terminology / code-set engine).`
      : `Code-taxonomy classification complete — all ${determination.total} code(s) classified to their most-specific category; a recommendation for a coder, nothing re-coded (synthetic — trie longest-prefix match, NOT a certified terminology / code-set engine).`;

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
        name: "CodeTaxonomyDetermination",
        description:
          "Deterministically-produced code-taxonomy classification finding. Given a batch of clinical codes (ICD-10 diagnosis, HCPCS / CPT procedure) and a taxonomy of category prefixes, it runs a TRIE (PREFIX TREE) LONGEST-PREFIX MATCH — the taxonomy prefixes are inserted into a trie and each code is walked character-by-character down the trie, remembering the deepest terminal node reached (the longest taxonomy prefix that is a prefix of the code, i.e. the most specific category) — classifying each code to its most-specific category, or leaving it unclassified when no prefix matches, and reporting one classification per code, the classified / unclassified counts, and the disposition: all-classified or unclassified-present. The batch is sourced (one classification per submitted code, in order; every matched prefix a submitted taxonomy prefix; no fabricated code or invented category), the classification recomputes — rebuilding the trie and re-running the longest-prefix match reproduces the reported category + matched prefix — and no claim is re-coded, no codes submitted, and no coded record overwritten; a coder confirms. There is no regression, no knapsack, no CUSUM, no k-way merge, no recursive boolean tree, no stable matching, no geospatial distance, no checksum, no union-find, no percentile, no largest-remainder apportionment, no edit distance, no interval selection, no hash chain, no BFS hop-count, no Dijkstra shortest path, no keyed set-difference, no majority vote, and no hierarchy-coefficient sum — it is a trie longest-prefix match, a pure function of the taxonomy + codes. This is DELIBERATELY NOT a PHI-bearing agent — a code is a terminology token, classified against a value-set taxonomy, not patient health information. It is DISTINCT from the Identifier Validation agent (which validates an NPI's Luhn check digit), the Medication Name Safety agent (which flags look-alike drug names by edit distance), and the HCC Risk Adjustment agent (which scores confirmed conditions up a clinical hierarchy); this maps codes to a value-set taxonomy by longest prefix. The taxonomy + codes are illustrative synthetics, NOT a certified terminology / code-set engine (real terminology services resolve full code systems — ICD-10-CM, SNOMED CT, LOINC, RxNorm — with versioned value sets, inclusion/exclusion logic, and semantic relationships, not a bare longest-prefix match).",
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
        catalogRef: request.catalogRef,
        disposition: determination.disposition,
        classifiedCount: determination.classifiedCount,
        unclassifiedCount: determination.unclassifiedCount,
        total: determination.total,
        codeCount: summary.codeCount,
        prefixCount: summary.prefixCount,
        requiresCoderReview: summary.requiresCoderReview,
        codeClassificationsSourced: sourced,
        codeClassificationConsistent: consistent,
        codeNoAutonomousRecode: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
