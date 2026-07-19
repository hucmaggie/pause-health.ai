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
  type DirectiveChangeProposal,
  type DirectiveOnFile,
  type PatientAcpContext,
  DEMO_ACP_PATIENT,
  assessAdvanceCarePlanning,
  directiveChangeRequiresHumanSignoff,
  directivesTraceToCatalog,
  languageAccessSatisfied,
  proposeDirectiveChange
} from "../../../../../lib/advance-care-planning";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "advance-care-planning-agent";

/**
 * Google A2A `tasks/send` endpoint for the Advance Care Planning agent — a
 * whole-person-care ACP touchpoint agent for the midlife/menopause patient.
 *
 *   POST /api/agents/advance-care-planning/tasks
 *
 * DETERMINISTICALLY assesses a patient's advance directives (living will,
 * DPOA-HC, POLST — POLST only when a serious-illness flag is on), flags
 * missing / stale / language-access gaps, and drafts a consent-gated
 * conversation prompt. It NEVER creates, updates, or overrides a directive
 * on its own. For an LEP patient with no interpreter plan it WITHHOLDS the
 * active prompt (a safe completed answer). The assessment is a pure function
 * of the caller-provided asOfDate + directives-on-file (no clock).
 *
 * Enforced-block policies checked before any plan is acted on:
 *   - policy.acp.directive-source-integrity (signal directivesTraceToCatalog)
 *     — every claimed directive on file must trace to the catalog + an
 *     approved source with a recorded execution date.
 *   - policy.acp.no-autonomous-directive-change (signal
 *     directiveChangeRequiresHumanSignoff) — every directive-change proposal
 *     requires clinician + patient sign-off and is never applied.
 *   - policy.acp.language-access-integrity (signal languageAccessSatisfied)
 *     — an LEP patient's active conversation must have a qualified-interpreter
 *     plan (or the prompt is withheld — a safe answer).
 * A block returns HTTP 200 with a `failed` task. A WITHHELD prompt is NOT a
 * block — it is a safe completed answer with the language-access gap flagged.
 *
 * Input (data part):
 *   { patient?: PatientAcpContext, onFile?: DirectiveOnFile[],
 *     proposal?: object, plan?: object } — the patient is assessed for ACP;
 *   a caller-asserted `onFile` set (admissible only if every entry traces to
 *   the catalog + an approved source + a recorded execution date) demonstrates
 *   the directive-source-integrity block, a caller-asserted `proposal` set
 *   (admissible only if every proposal requires clinician + patient sign-off
 *   and is not applied) demonstrates the no-autonomous-directive-change
 *   block, and a caller-asserted `plan` (admissible only if it satisfies
 *   language access for the patient) demonstrates the language-access-integrity
 *   block.
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
  const taskId = params.id || newTaskId("acp");
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
  const patient =
    data.patient && typeof data.patient === "object"
      ? (data.patient as PatientAcpContext)
      : DEMO_ACP_PATIENT;

  // Deterministic ACP assessment.
  const assessment = assessAdvanceCarePlanning(patient);

  // The on-file directives the source-integrity gate checks: the caller-
  // asserted set (to demonstrate the block) or the patient's own set.
  const assertedOnFile = Array.isArray(data.onFile)
    ? (data.onFile as DirectiveOnFile[])
    : undefined;
  const onFileForCheck = assertedOnFile ?? patient.directivesOnFile ?? [];

  // The change-proposal set the human-signoff gate checks: the caller-
  // asserted set (to demonstrate the block) or an empty set (the agent's
  // default posture — no autonomous proposals, only conversation prompts).
  const assertedProposals = Array.isArray(data.proposal)
    ? (data.proposal as DirectiveChangeProposal[])
    : undefined;
  const proposalsForCheck = assertedProposals ?? [];

  // The plan the language-access gate checks: the caller-asserted plan (to
  // demonstrate the block) or a plan derived from the produced assessment.
  const assertedPlan =
    data.plan && typeof data.plan === "object"
      ? (data.plan as Record<string, unknown>)
      : undefined;
  const planForCheck =
    assertedPlan ??
    ({
      preferredLanguageCode: assessment.preferredLanguageCode,
      qualifiedInterpreterPlanned: assessment.qualifiedInterpreterPlanned,
      conversationPromptState: assessment.conversationPrompt.state
    } as Record<string, unknown>);

  // Honest governance signals.
  const directivesCatalog = directivesTraceToCatalog(onFileForCheck);
  const changeSignoff = directiveChangeRequiresHumanSignoff(proposalsForCheck);
  const langAccess = languageAccessSatisfied(planForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      directivesTraceToCatalog: directivesCatalog,
      directiveChangeRequiresHumanSignoff: changeSignoff,
      languageAccessSatisfied: langAccess
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "acp.assess.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: patient.patientRef,
        directivesTraceToCatalog: directivesCatalog,
        directiveChangeRequiresHumanSignoff: changeSignoff,
        languageAccessSatisfied: langAccess,
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
          `Pause Agent Fabric blocked this advance-care-planning run: ${governance.blockingViolations
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

  // Assess span — the fabric records the produced ACP assessment, parented
  // under the caller's span if any.
  const assessSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "acp.assess",
    protocol: "a2a",
    attributes: {
      patientRef: patient.patientRef,
      asOfDate: patient.asOfDate,
      preferredLanguageCode: assessment.preferredLanguageCode,
      qualifiedInterpreterPlanned: assessment.qualifiedInterpreterPlanned,
      completeness: assessment.completeness,
      flagCount: assessment.flags.length,
      directivesTraceToCatalog: directivesCatalog,
      languageAccessSatisfied: langAccess,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Draft-conversation span — the consent-gated conversation prompt (or the
  // withheld / language-access-required safe answer).
  const draftSpan = recordInstantSpan({
    taskId,
    parentSpanId: assessSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "acp.draft-conversation",
    protocol: "a2a",
    attributes: {
      conversationPromptState: assessment.conversationPrompt.state,
      actionable: assessment.conversationPrompt.actionable,
      directiveChangeRequiresHumanSignoff: changeSignoff,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // A default illustrative change proposal — a living-will conversation
  // draft (for the missing universally-recommended directive) is the most
  // common midlife touchpoint. Always requires clinician + patient sign-off.
  const defaultProposal = proposeDirectiveChange({
    directiveId: "directive.living-will",
    proposedChange: "hold a midlife-touchpoint conversation to consider executing a living will"
  });

  const result = { assessment, proposal: defaultProposal };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Assessed advance-care-planning for ${assessment.patientRef} as of ${assessment.asOfDate}: completeness ${Math.round(
          assessment.completeness * 100
        )}%; ${
          assessment.conversationPrompt.state === "drafted"
            ? "drafted a consent-gated conversation prompt for the care team"
            : "WITHHELD the active prompt — a qualified-interpreter plan is required for this LEP patient (a safe answer, not a block)"
        }; ${assessment.flags.length} flag${assessment.flags.length === 1 ? "" : "s"} surfaced. Every directive on file traces to the catalog + an approved source; every directive change is clinician + patient sign-off gated (the agent NEVER autonomously creates, updates, or overrides a directive); for an LEP patient the active prompt is withheld until a qualified-interpreter plan is documented (synthetic — illustrative directives, sources, and thresholds, not a certified directives registry).`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "AcpAssessment",
        description:
          "Deterministically-produced advance-care-planning assessment for a single midlife/menopause patient — the per-directive status (on-file / on-file-stale / missing / not-applicable), an illustrative completeness percentage over the universally-recommended directives, the flagged ACP gaps (missing / stale / off-source / language-access), a consent-gated conversation prompt for the care team (WITHHELD for an LEP patient with no qualified-interpreter plan — a safe completed answer, not a block), and a clinician + patient sign-off gated directive-change proposal that is NEVER autonomously applied. The directive catalog, approved-source labels, and staleness threshold are illustrative/synthetic, NOT a certified advance-directives registry.",
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
        traceSpanId: draftSpan.id,
        traceTaskId: taskId,
        patientRef: patient.patientRef,
        asOfDate: patient.asOfDate,
        preferredLanguageCode: assessment.preferredLanguageCode,
        qualifiedInterpreterPlanned: assessment.qualifiedInterpreterPlanned,
        conversationPromptState: assessment.conversationPrompt.state,
        completeness: assessment.completeness,
        flagCount: assessment.flags.length,
        directivesTraceToCatalog: directivesCatalog,
        directiveChangeRequiresHumanSignoff: changeSignoff,
        languageAccessSatisfied: langAccess
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
