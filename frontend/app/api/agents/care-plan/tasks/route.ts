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
import {
  carePlanContextFromIntake,
  instantiateCarePlan,
  planTracesToTemplate,
  summarizeCarePlan,
  type InstantiatedCarePlan
} from "../../../../../lib/care-plan";

// summarizeCarePlan dynamically imports the Anthropic SDK (Node-only) when
// ANTHROPIC_API_KEY is set; pin the runtime so Vercel doesn't ship this to Edge.
export const runtime = "nodejs";

const FABRIC_AGENT_ID = "care-plan-agent";

/**
 * Google A2A `tasks/send` endpoint for the Care Plan Agent — the Salesforce
 * "Agentforce for Health" / Health Cloud CarePlan + care-plan-summarization
 * analog, a clinical-plane sibling of the Care Router and the SECOND live-Claude
 * agent.
 *
 *   POST /api/agents/care-plan/tasks
 *
 * Flow:
 *   1. Pre-flight governance via the Agent Fabric, INCLUDING the model
 *      allow-list (like the Care Router) and the new template-sourced block. A
 *      block returns HTTP 200 with a `failed` task.
 *   2. careplan.instantiate — DETERMINISTICALLY instantiate a menopause care
 *      plan from a defined template (goals, interventions, follow-up cadence)
 *      based on the Care Router pathway/severity + intake. Every plan references
 *      a defined template id; a caller-asserted off-catalog plan trips the
 *      template-sourced block.
 *   3. careplan.summarize — generate a patient/clinician progress SUMMARY with
 *      live Anthropic Claude, falling back to a DETERMINISTIC scripted summary
 *      (with a recorded fallbackReason) on a missing key or any SDK error —
 *      mirroring the Care Router. The span records `via` and, on fallback, the
 *      `fallbackReason`.
 *   4. Return a completed A2ATask with the plan + summary artifact and
 *      metadata.agentFabric.
 *
 * Input (data part), either:
 *   { intake?, pathway?, decision?: {pathway}, onHrt?,
 *     hasAiDecisionSupportConsent? } — the agent instantiates + summarizes
 *   { plan: InstantiatedCarePlan } — a caller-asserted plan, admissible only if
 *     it references a defined template (else blocked)
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
  const taskId = params.id || newTaskId("careplan");
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
  const asserted = data.plan as InstantiatedCarePlan | undefined;
  const usingAsserted = Boolean(asserted && typeof asserted === "object");
  const intake = (data.intake ?? {}) as IntakeRecord;
  const decisionPathway =
    (typeof data.pathway === "string" ? (data.pathway as CarePathway) : undefined) ??
    ((data.decision as { pathway?: CarePathway } | undefined)?.pathway) ??
    "mscp-virtual-visit";
  const onHrt = typeof data.onHrt === "boolean" ? (data.onHrt as boolean) : undefined;

  // Instantiate deterministically from the Care Router pathway/severity + intake
  // (unless the caller asserted a plan, which the integrity gate then checks).
  const instantiated = instantiateCarePlan(
    carePlanContextFromIntake(intake, { pathway: decisionPathway }, { onHrt })
  );
  const plan: InstantiatedCarePlan = usingAsserted
    ? (asserted as InstantiatedCarePlan)
    : instantiated;

  // The honest integrity signal: does the acted-on plan trace to a defined
  // template? True for instantiator output; a fabricated off-catalog plan trips
  // policy.careplan.template-sourced.
  const planTrace = planTracesToTemplate(plan);

  // Live-Claude clinical agent: it requests a model, so it is governed by the
  // model allow-list just like the Care Router. Consent defaults to present and
  // can be toggled off. The plan carries a rationale, and the agent never
  // commits a clinical action without a clinician (summaries are non-prescriptive).
  const requestedModel =
    process.env.PAUSE_CARE_PLAN_MODEL ?? "claude-sonnet-4-5-20250929";
  const hasAiDecisionSupportConsent = data.hasAiDecisionSupportConsent !== false;

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      planTracesToTemplate: planTrace,
      requestedModel,
      commitsClinicalActionWithoutClinician: false,
      hasRationaleField: true,
      hasAiDecisionSupportConsent
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "careplan.instantiate.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        templateId: typeof plan?.templateId === "string" ? plan.templateId : null,
        planTracesToTemplate: planTrace,
        requestedModel,
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
          `Pause Agent Fabric blocked this care-plan task: ${governance.blockingViolations
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

  // 1. Instantiation span — DETERMINISTIC template fill, parented under the
  //    caller's span if any.
  const instantiateSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "careplan.instantiate",
    protocol: "a2a",
    attributes: {
      templateId: plan.templateId,
      templateLabel: plan.templateLabel,
      pathway: plan.pathway,
      severity: plan.severity,
      goals: plan.goals.length,
      interventions: plan.interventions.length,
      followUpIntervalDays: plan.followUp.intervalDays,
      planTracesToTemplate: planTrace,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // 2. Summarization span — LIVE Claude with a deterministic scripted fallback,
  //    mirroring the Care Router. Records `via` and, on fallback, the
  //    (non-clinical) fallbackReason.
  const summary = await summarizeCarePlan(plan);
  const summarizeSpan = recordInstantSpan({
    taskId,
    parentSpanId: instantiateSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "careplan.summarize",
    protocol: "a2a",
    attributes: {
      templateId: plan.templateId,
      provider: summary.modelProvenance.provider,
      model: summary.modelProvenance.model,
      via: summary.via,
      // Present ONLY on a scripted-fallback summary: the leading (non-clinical)
      // diagnostic explaining why the live Claude call was not used. Absent on a
      // successful claude-api summary, exactly like the Care Router route.
      ...(summary.fallbackReason ? { fallbackReason: summary.fallbackReason } : {}),
      nonPrescriptive: true,
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
        `Instantiated the ${plan.templateLabel} (${plan.severity} presentation) from a defined template and generated a ${
          summary.via === "claude-api" ? "live-Claude" : "deterministic scripted"
        } progress summary (synthetic — illustrative templates, not a certified care-plan engine).`,
        { plan, summary }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "CarePlan",
        description:
          "A menopause care plan instantiated DETERMINISTICALLY from a defined CarePlanTemplate (goals, interventions, follow-up cadence) based on the Care Router pathway/severity + intake — every plan references a defined template id (never fabricated) — plus a patient/clinician progress SUMMARY generated with live Anthropic Claude and a deterministic scripted fallback (via + fallbackReason recorded). Summaries are non-prescriptive. The templates are illustrative/synthetic, NOT a certified care-plan engine.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { plan, summary } as unknown as Record<string, unknown>
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
        templateId: plan.templateId,
        planTracesToTemplate: planTrace,
        summaryVia: summary.via,
        ...(summary.fallbackReason ? { fallbackReason: summary.fallbackReason } : {})
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
