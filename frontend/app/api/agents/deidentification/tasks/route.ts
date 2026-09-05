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
  type DeidentificationDetermination,
  type DeidentificationRequest,
  DEMO_DEIDENTIFICATION_REQUEST,
  deidAllCategoriesScreened,
  deidMethodCited,
  deidNoReleaseOfReidentifiable,
  deidentificationSummary,
  evaluateDeidentification
} from "../../../../../lib/deidentification";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "deidentification-agent";

/**
 * Google A2A `tasks/send` endpoint for the De-Identification & Safe Harbor agent — the
 * data-substrate service that screens a dataset's fields against the eighteen HIPAA Safe
 * Harbor identifier categories (45 CFR 164.514(b)(2)) and decides whether the dataset
 * qualifies as de-identified.
 *
 *   POST /api/agents/deidentification/tasks
 *
 * Loads a dataset and DETERMINISTICALLY evaluates it via evaluateDeidentification: it screens
 * every field, computes which Safe Harbor categories remain identifiable after the field
 * actions, computes whether all eighteen categories were screened, validates the method
 * citation, and decides de-identification. The determination is a pure function of the
 * request + the category catalog (no randomness, no clock). All eighteen categories must be
 * screened, a recognized method must be cited, and a re-identifiable dataset is never
 * released as de-identified. The category catalog + generalization rules are illustrative /
 * synthetic; a real determination applies the full Safe Harbor method or a qualified Expert
 * Determination under 45 CFR 164.514(b).
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.deid.all-categories-screened (signal deidAllCategoriesScreened) — all eighteen
 *     Safe Harbor categories must be screened.
 *   - policy.deid.method-cited (signal deidMethodCited) — a recognized method must be cited.
 *   - policy.deid.no-release-of-reidentifiable (signal deidNoReleaseOfReidentifiable) — a
 *     dataset with a remaining identifier may never be marked de-identified / released.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: DeidentificationRequest, determination?: object } — the request is evaluated;
 *   a caller-asserted `determination` (admissible only if it screens all categories, cites a
 *   method, and never releases a re-identifiable dataset) demonstrates the three blocks.
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
  const taskId = params.id || newTaskId("deid");
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
      ? (data.request as DeidentificationRequest)
      : DEMO_DEIDENTIFICATION_REQUEST;

  // Deterministic de-identification determination.
  const determination = evaluateDeidentification(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced determination.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as DeidentificationDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: all categories screened, a recognized method cited, and a
  // re-identifiable dataset never released.
  const allScreened = deidAllCategoriesScreened(determinationForCheck);
  const methodCited = deidMethodCited(determinationForCheck);
  const noReleaseOfReidentifiable = deidNoReleaseOfReidentifiable(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      deidAllCategoriesScreened: allScreened,
      deidMethodCited: methodCited,
      deidNoReleaseOfReidentifiable: noReleaseOfReidentifiable
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "deid.screen.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        datasetRef: request.datasetRef,
        deidAllCategoriesScreened: allScreened,
        deidMethodCited: methodCited,
        deidNoReleaseOfReidentifiable: noReleaseOfReidentifiable,
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
          `Pause Agent Fabric blocked this de-identification run: ${governance.blockingViolations
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

  const summary = deidentificationSummary(determination);

  // Receive-dataset span — the fabric records the dataset it received, parented under the
  // caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "deid.receive-dataset",
    protocol: "a2a",
    attributes: {
      datasetRef: request.datasetRef,
      method: determination.method,
      fieldCount: determination.fieldCount,
      deidMethodCited: methodCited,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Screen span — the deterministic screen of all eighteen categories, parented to the
  // received dataset.
  const screenSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "deid.screen",
    protocol: "a2a",
    attributes: {
      datasetRef: request.datasetRef,
      categoriesScreened: determination.categoriesScreened.length,
      deidAllCategoriesScreened: allScreened,
      remainingIdentifierCategories: determination.remainingIdentifierCategories.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Determine span — the de-identification decision + release flag, parented to the screen.
  const determineSpan = recordInstantSpan({
    taskId,
    parentSpanId: screenSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "deid.determine",
    protocol: "a2a",
    attributes: {
      datasetRef: request.datasetRef,
      deidentified: determination.deidentified,
      releaseApproved: determination.releaseApproved,
      requiresHumanReview: determination.requiresHumanReview,
      deidNoReleaseOfReidentifiable: noReleaseOfReidentifiable,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the
  // decision. Every de-identification decision is logged.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: determineSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "deid.log-audit",
    protocol: "a2a",
    attributes: {
      datasetRef: request.datasetRef,
      method: determination.method,
      deidentified: determination.deidentified,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, datasetRef: request.datasetRef };

  const completedMessage = determination.deidentified
    ? `De-identification determination for ${request.datasetRef}: DE-IDENTIFIED under ${determination.method} — all ${determination.categoriesScreened.length} Safe Harbor categories screened, no identifier remains, release approved (synthetic — illustrative catalog; a real determination applies the full Safe Harbor method or Expert Determination under 45 CFR 164.514(b)).`
    : `De-identification determination for ${request.datasetRef}: NOT de-identified — ${determination.reason} (synthetic — NOT a certified de-identification engine).`;

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
        name: "DeidentificationDetermination",
        description:
          "Deterministically-produced HIPAA Safe Harbor de-identification determination. It screens the dataset's fields against the eighteen Safe Harbor identifier categories (45 CFR 164.514(b)(2)(i)(A)–(R)), computes which categories remain identifiable after the field actions (a retained identifier, or a generalization that does not satisfy Safe Harbor — only geographic → first three ZIP digits and dates → year only qualify), computes whether all eighteen categories were screened (present as a field or attested absent), validates the method citation (Safe Harbor, or a qualified Expert Determination with a cited reference under §164.514(b)(1)), and decides whether the dataset qualifies as de-identified: de-identified iff a recognized method is cited, all eighteen categories were screened, and no identifier category remains. A re-identifiable dataset is NEVER released as de-identified — it is a completed determination requiring human review under a data use agreement. The determination is a pure function of the dataset's fields + the category catalog (no randomness, no clock). The Safe Harbor category catalog + generalization rules are illustrative/synthetic, NOT a certified de-identification engine — a real determination applies the full Safe Harbor method (including the actual-knowledge clause) or a qualified statistician's Expert Determination under 45 CFR 164.514(b).",
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
        datasetRef: request.datasetRef,
        method: summary.method,
        fieldCount: determination.fieldCount,
        categoriesScreened: determination.categoriesScreened.length,
        allCategoriesScreened: determination.allCategoriesScreened,
        remainingIdentifierCategoryCount: determination.remainingIdentifierCategories.length,
        methodCited: determination.methodCited,
        deidentified: determination.deidentified,
        releaseApproved: determination.releaseApproved,
        requiresHumanReview: determination.requiresHumanReview,
        deidAllCategoriesScreened: allScreened,
        deidMethodCited: methodCited,
        deidNoReleaseOfReidentifiable: noReleaseOfReidentifiable
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
