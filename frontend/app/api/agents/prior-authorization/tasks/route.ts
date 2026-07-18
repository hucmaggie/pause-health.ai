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
  type PriorAuthAction,
  type PriorAuthPackage,
  type PriorAuthRequest,
  DEMO_PRIOR_AUTH_REQUEST,
  assemblePriorAuth,
  isCatalogItem,
  priorAuthDocumentationComplete,
  priorAuthHasClinicianApproval,
  priorAuthSummary,
  submitPriorAuth
} from "../../../../../lib/prior-auth";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "prior-authorization-agent";

/**
 * Google A2A `tasks/send` endpoint for the Prior Authorization agent — the
 * Salesforce "Agentforce for Health" / Health Cloud CareRequest + Utilization
 * Management analog.
 *
 *   POST /api/agents/prior-authorization/tasks
 *
 * For a PA-requiring item (systemic HRT / compounded estradiol, a bone-density
 * DEXA, or a specialized hormone lab panel) it DETERMINISTICALLY matches the
 * payer's medical-necessity criteria, assembles the required supporting-
 * documentation checklist, and returns a clinician-gated PA package. This is the
 * HEAVIEST agent and the LEAST demo-honest of the set: real PA is a genuinely
 * multi-system EDI/278 (or FHIR PAS) workflow. This is a MOCK — NOT a real
 * 278/EDI or payer PA portal submission.
 *
 * TWO enforced-block honesty properties checked before any PA leaves the fabric:
 *   - policy.pa.no-autonomous-submission (signal paHasClinicianApproval) — a
 *     PA submission without a clinician's approval is blocked; the agent may
 *     only assemble a clinician-gated draft.
 *   - policy.pa.documentation-integrity (signal paDocumentationComplete) — a
 *     PA submission missing a required supporting document is blocked.
 * A block returns HTTP 200 with an A2A task in state `failed`.
 *
 * Input (data part):
 *   { request?: PriorAuthRequest } — the agent assembles (and, on an
 *      approved+complete submit action, submits) the PA.
 * A bare data object is also accepted and read as the PriorAuthRequest; absent
 * item falls back to a representative synthetic demo request.
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
  const taskId = params.id || newTaskId("priorauth");
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
  const provided = (data.request ?? data.priorAuthRequest ?? data) as
    | PriorAuthRequest
    | undefined;
  const request: PriorAuthRequest =
    provided && typeof provided === "object" && typeof provided.itemId === "string"
      ? provided
      : DEMO_PRIOR_AUTH_REQUEST;
  const action: PriorAuthAction = request.action ?? { kind: "assemble" };

  // Off-catalog items are refused before anything else — the agent can't
  // assemble a PA for an item that isn't defined.
  if (!isCatalogItem(request.itemId)) {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "priorauth.assemble.invalid",
      protocol: "a2a",
      status: "error",
      attributes: {
        itemId: String(request.itemId),
        error: "off-catalog prior-authorization item",
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
          `Prior authorization could not be assembled: unknown item "${request.itemId}" (off-catalog).`
        )
      },
      metadata: {
        agentFabric: {
          decision: "allow",
          error: "off-catalog prior-authorization item"
        }
      }
    };
    return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: failed });
  }

  // Assemble the package deterministically (needed to know documentation
  // completeness for the integrity signal).
  const assembled = assemblePriorAuth(request);

  // Honest governance signals. The agent only ever ASSEMBLES a clinician-gated
  // draft: on an assemble both PA signals are non-violating; a caller-asserted
  // autonomous submit (no approval) trips policy.pa.no-autonomous-submission, and
  // a submit whose package is missing a required document trips
  // policy.pa.documentation-integrity. It also grounds on the (synthetic)
  // clinical record (consent-gated) and never commits a clinical action itself.
  const paHasClinicianApproval = priorAuthHasClinicianApproval(action);
  const paDocumentationComplete = priorAuthDocumentationComplete(assembled, action);
  const hasAiDecisionSupportConsent = request.hasConsent !== false;

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      paHasClinicianApproval,
      paDocumentationComplete,
      commitsClinicalActionWithoutClinician: false,
      hasAiDecisionSupportConsent
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "priorauth.assemble.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        itemId: request.itemId,
        paHasClinicianApproval,
        paDocumentationComplete,
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
          `Pause Agent Fabric blocked this prior-authorization task: ${governance.blockingViolations
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

  // 1. Match the payer's medical-necessity criteria — DETERMINISTIC, parented
  //    under the caller's span if any.
  const matchSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "priorauth.criteria.match",
    protocol: "rest",
    attributes: {
      itemId: assembled.itemId,
      criteriaTotal: assembled.criteria.length,
      criteriaMet: assembled.criteria.filter((c) => c.met).length,
      criteriaComplete: assembled.criteriaComplete,
      criteriaTraceToCatalog: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // 2. Assemble the required supporting-documentation checklist.
  recordInstantSpan({
    taskId,
    parentSpanId: matchSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "priorauth.docs.assemble",
    protocol: "rest",
    attributes: {
      itemId: assembled.itemId,
      documentsRequired: assembled.documentation.checklist.length,
      documentsPresent: assembled.documentation.present.length,
      documentsMissing: assembled.documentation.missing.length,
      paDocumentationComplete: assembled.documentation.complete,
      careRequestId: assembled.source.careRequestId,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // 3. Either park the package on an await-clinician marker (the human-approval
  //    gate — nothing is submitted until a clinician approves), or, on a
  //    clinician-approved + documentation-complete submit that passed the gate,
  //    advance it to "submitted" (submitPriorAuth refuses as defense in depth).
  let pkg: PriorAuthPackage = assembled;
  let terminalSpanId: string;
  if (action.kind === "submit") {
    pkg = submitPriorAuth(assembled, action);
    const submitSpan = recordInstantSpan({
      taskId,
      parentSpanId: matchSpan.id,
      agentId: FABRIC_AGENT_ID,
      operation: "priorauth.submit",
      protocol: "rest",
      attributes: {
        itemId: pkg.itemId,
        status: pkg.status,
        requiresClinicianApproval: pkg.requiresClinicianApproval,
        paHasClinicianApproval,
        paDocumentationComplete: pkg.documentation.complete,
        submitted: pkg.submitted,
        synthetic: true,
        ...(personaId ? { personaId } : {})
      }
    });
    terminalSpanId = submitSpan.id;
  } else {
    const awaitSpan = recordInstantSpan({
      taskId,
      parentSpanId: matchSpan.id,
      agentId: FABRIC_AGENT_ID,
      operation: "priorauth.await-clinician",
      protocol: "rest",
      attributes: {
        itemId: pkg.itemId,
        status: pkg.status,
        // The honesty invariants: never autonomously submitted; a submission
        // must be documentation-complete.
        requiresClinicianApproval: pkg.requiresClinicianApproval,
        paHasClinicianApproval,
        paDocumentationComplete: pkg.documentation.complete,
        submitted: false,
        synthetic: true,
        ...(personaId ? { personaId } : {})
      }
    });
    terminalSpanId = awaitSpan.id;
  }

  const summary = priorAuthSummary(pkg);

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `${pkg.itemLabel}: matched ${summary.criteriaMet}/${summary.criteriaTotal} payer criteria, ${summary.documentsPresent}/${summary.documentsRequired} required documents present — status "${pkg.status}"${
          pkg.submitted
            ? " (submitted after clinician approval)"
            : " (clinician-gated; not submitted — a clinician must approve before submission)"
        }. Synthetic — illustrative payer criteria + document checklist, NOT a real 278/EDI or payer PA portal.`,
        { package: pkg, summary }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "PriorAuthPackage",
        description:
          "A DETERMINISTICALLY-assembled prior-authorization package for a PA-requiring menopause item: the payer medical-necessity criteria matched against the (synthetic) clinical context (every criterion references a defined catalog id), the required supporting-documentation checklist (present vs missing), a synthetic Health Cloud CareRequest / authorization id, and a status of draft / ready-for-clinician / submitted. CRITICAL: requiresClinicianApproval:true and, unless a clinician approved a documentation-complete submit, submitted:false — the agent never autonomously submits a PA, and a submission must include the required documentation. This is a MOCK, NOT a real X12 278 / FHIR PAS EDI transaction or payer PA portal submission.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { package: pkg, summary } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: matchSpan.id,
        traceTaskId: taskId,
        itemId: pkg.itemId,
        status: pkg.status,
        // The honesty invariants surfaced on the wire.
        requiresClinicianApproval: pkg.requiresClinicianApproval,
        paHasClinicianApproval,
        paDocumentationComplete: pkg.documentation.complete,
        submitted: pkg.submitted,
        terminalSpanId
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
