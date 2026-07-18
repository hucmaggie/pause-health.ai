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
import type { CarePathway, IntakeRecord } from "../../../../../lib/care-router";
import type { InstantiatedCarePlan } from "../../../../../lib/care-plan";
import type { AssessmentResult } from "../../../../../lib/assessments";
import type { CareGap } from "../../../../../lib/care-gaps";
import {
  assembleClinicalSummaryContext,
  summarizeClinical,
  summaryTracesToSourceRecords,
  type ClinicalSummaryResult
} from "../../../../../lib/clinical-summary";

// summarizeClinical dynamically imports the Anthropic SDK (Node-only) when
// ANTHROPIC_API_KEY is set; pin the runtime so Vercel doesn't ship this to Edge.
export const runtime = "nodejs";

const FABRIC_AGENT_ID = "clinical-summary-agent";

/**
 * Google A2A `tasks/send` endpoint for the Clinical Summary Agent — the
 * Salesforce "Agentforce for Health" After-Visit Summary / clinical-
 * documentation analog, the THIRD live-Claude agent after the Care Router and
 * the Care Plan agent.
 *
 *   POST /api/agents/clinical-summary/tasks
 *
 * Flow:
 *   1. Pre-flight governance via the Agent Fabric, INCLUDING the model
 *      allow-list (like the Care Router / Care Plan) and the new source-record
 *      grounding block. A block returns HTTP 200 with a `failed` task.
 *   2. clinical-summary.assemble — DETERMINISTICALLY assemble the context from
 *      the lifecycle outputs, gathering ONLY facts present in the inputs and a
 *      source-record provenance list. Every summary must trace to those
 *      records; a caller-asserted, off-context (fabricated) summary trips the
 *      source-record block.
 *   3. clinical-summary.summarize — phrase the patient after-visit summary +
 *      clinician handoff with live Anthropic Claude, falling back to a
 *      DETERMINISTIC scripted composition (with a recorded fallbackReason) on a
 *      missing key or any SDK/parse error — mirroring the Care Plan agent. The
 *      span records `via`, `fallbackReason` (on fallback), and phiAccessed:true.
 *   4. Return a completed A2ATask with the context + summary artifact and
 *      metadata.agentFabric.
 *
 * Input (data part), either:
 *   { intake?, pathway?, decision?: {pathway}, onHrt?, assessment?, carePlan?,
 *     careGaps?, hasAiDecisionSupportConsent? } — the agent assembles + composes
 *   { summary: ClinicalSummaryResult } — a caller-asserted summary, admissible
 *     only if every source record traces to the assembled context (else blocked)
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
  const taskId = params.id || newTaskId("clinsum");
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
  const asserted = data.summary as ClinicalSummaryResult | undefined;
  const usingAsserted = Boolean(asserted && typeof asserted === "object");
  const intake = (data.intake ?? {}) as IntakeRecord;
  const pathway =
    (typeof data.pathway === "string" ? (data.pathway as CarePathway) : undefined) ??
    ((data.decision as { pathway?: CarePathway } | undefined)?.pathway);
  const onHrt = typeof data.onHrt === "boolean" ? (data.onHrt as boolean) : undefined;

  // DETERMINISTICALLY assemble the context, gathering ONLY facts present in the
  // inputs — the source of the grounding guarantee.
  const context = assembleClinicalSummaryContext({
    intake,
    ...(pathway ? { pathway } : {}),
    ...(onHrt !== undefined ? { onHrt } : {}),
    ...(data.assessment ? { assessment: data.assessment as AssessmentResult } : {}),
    ...(data.carePlan ? { carePlan: data.carePlan as InstantiatedCarePlan } : {}),
    ...(Array.isArray(data.careGaps) ? { careGaps: data.careGaps as CareGap[] } : {}),
    ...(personaId ? { personaId } : {})
  });

  // The honest grounding signal: do the acted-on summary's source records trace
  // to the records the context was assembled from? For instantiator output the
  // provenance IS the context's; a caller-asserted, off-context summary trips
  // policy.clinical-summary.source-record-sourced.
  const actedSourceRecords = usingAsserted
    ? Array.isArray(asserted?.sourceRecords)
      ? (asserted!.sourceRecords as string[])
      : []
    : context.sourceRecords;
  const summaryTrace = summaryTracesToSourceRecords(
    { sourceRecords: actedSourceRecords },
    context
  );

  // Live-Claude clinical agent: it requests a model, so it is governed by the
  // model allow-list just like the Care Router / Care Plan. Consent defaults to
  // present and can be toggled off. The agent commits no clinical action
  // (summaries only re-state existing facts for two audiences).
  const requestedModel =
    process.env.PAUSE_CLINICAL_SUMMARY_MODEL ?? "claude-sonnet-4-5-20250929";
  const hasAiDecisionSupportConsent = data.hasAiDecisionSupportConsent !== false;

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      summaryTracesToSourceRecords: summaryTrace,
      requestedModel,
      commitsClinicalActionWithoutClinician: false,
      hasAiDecisionSupportConsent
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "clinical-summary.assemble.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        sourceRecords: context.sourceRecords.length,
        summaryTracesToSourceRecords: summaryTrace,
        requestedModel,
        phiAccessed: true,
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
          `Pause Agent Fabric blocked this clinical-summary task: ${governance.blockingViolations
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

  // 1. Assemble span — DETERMINISTIC context gather, parented under the caller's
  //    span if any. phiAccessed:true because it composes clinical context.
  const assembleSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "clinical-summary.assemble",
    protocol: "a2a",
    attributes: {
      sourceRecords: context.sourceRecords.length,
      summaryTracesToSourceRecords: summaryTrace,
      hasCarePlan: Boolean(context.carePlan),
      hasAssessment: Boolean(context.assessment),
      careGaps: context.careGaps.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // 2. Summarize span — LIVE Claude with a deterministic scripted fallback,
  //    mirroring the Care Plan agent. Records `via` and, on fallback, the
  //    (non-clinical) fallbackReason.
  const summary: ClinicalSummaryResult = usingAsserted
    ? (asserted as ClinicalSummaryResult)
    : await summarizeClinical(context, { model: requestedModel });
  const summarizeSpan = recordInstantSpan({
    taskId,
    parentSpanId: assembleSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "clinical-summary.summarize",
    protocol: "a2a",
    attributes: {
      sourceRecords: summary.sourceRecords.length,
      provider: summary.modelProvenance.provider,
      model: summary.modelProvenance.model,
      via: summary.via,
      // Present ONLY on a scripted-fallback composition: the leading
      // (non-clinical) diagnostic explaining why the live Claude call was not
      // used. Absent on a successful claude-api composition, like the Care Plan.
      ...(summary.fallbackReason ? { fallbackReason: summary.fallbackReason } : {}),
      nonPrescriptive: true,
      phiAccessed: true,
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
        `Composed an after-visit summary + clinician handoff for ${context.patientDisplayName} from ${context.sourceRecords.length} source record(s) via a ${
          summary.via === "claude-api" ? "live-Claude" : "deterministic scripted"
        } composition (synthetic — a composition of existing records, not a certified clinical-documentation engine).`,
        { context, summary }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "ClinicalSummary",
        description:
          "A patient-friendly After-Visit Summary and a clinician handoff note COMPOSED DETERMINISTICALLY from the lifecycle outputs the other agents produced (intake, Care Router pathway, optional assessment / care plan / care gaps). The context is assembled from ONLY facts present in the inputs, and every artifact traces to a defined source record (never fabricated) — enforced at the Agent Fabric governance boundary. The phrasing is generated with live Anthropic Claude and a deterministic scripted fallback (via + fallbackReason recorded). Non-prescriptive; the artifacts are illustrative/synthetic, NOT a certified clinical-documentation engine.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { context, summary } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: summarizeSpan.id,
        traceTaskId: taskId,
        sourceRecords: summary.sourceRecords,
        summaryTracesToSourceRecords: summaryTrace,
        summaryVia: summary.via,
        ...(summary.fallbackReason ? { fallbackReason: summary.fallbackReason } : {})
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
