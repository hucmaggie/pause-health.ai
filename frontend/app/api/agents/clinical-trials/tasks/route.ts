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
  type PatientTrialContext,
  type Study,
  type StudyMatch,
  type TrialOutreach,
  DEMO_TRIAL_PATIENT,
  eligibilityTracesToCriteria,
  enrollmentRequiresHuman,
  matchTrials,
  outreachHasResearchConsent
} from "../../../../../lib/clinical-trials";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "clinical-trials-agent";

/**
 * Google A2A `tasks/send` endpoint for the Clinical Trials & Research Matching
 * agent — the Salesforce "Agentforce for Health" / Health Cloud clinical-trials /
 * research-matching analog.
 *
 *   POST /api/agents/clinical-trials/tasks
 *
 * Evaluates a single patient's STRUCTURED context (age band, symptom profile,
 * comorbidities, geography, prior therapy, HRT status, postmenopausal status)
 * against a synthetic study catalog's DEFINED eligibility criteria, returns the
 * matching studies ranked with per-criterion match explanations, and drafts a
 * consent-gated outreach — it NEVER auto-enrolls a patient (informed consent + a
 * human are required). Matching is a pure function of the context + research
 * consent (no randomness, no clock). The catalog + sponsors + criteria are
 * illustrative/synthetic, NOT a certified trial-eligibility engine.
 *
 * Enforced-block policies checked before any match is acted on:
 *   - policy.trials.eligibility-criteria-sourced (signal eligibilityTracesToCriteria)
 *     — every eligibility determination must trace to a defined study criterion.
 *   - policy.trials.research-consent-required (signal researchConsentPresent) — a
 *     trial outreach / enrollment step requires the patient's research consent.
 *   - policy.trials.no-autonomous-enrollment (signal enrollmentRequiresHuman) — the
 *     agent may never enroll a patient autonomously (informed consent + a human).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { patient?: PatientTrialContext, researchConsent?: boolean, catalog?: Study[],
 *     matches?: StudyMatch[], outreach?: TrialOutreach } — the patient is matched
 *   against the catalog; caller-asserted `matches` (admissible only if every
 *   eligibility determination traces to a defined criterion) demonstrate the
 *   eligibility-criteria-sourced block, and a caller-asserted `outreach`
 *   (admissible only if an active outreach has research consent and never
 *   enrolls) demonstrates the research-consent-required and no-autonomous-enrollment
 *   blocks.
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
  const taskId = params.id || newTaskId("trials");
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
      ? (data.patient as PatientTrialContext)
      : DEMO_TRIAL_PATIENT;
  const researchConsent =
    typeof data.researchConsent === "boolean" ? data.researchConsent : undefined;
  const catalog = Array.isArray(data.catalog) ? (data.catalog as Study[]) : undefined;

  // Deterministic trial-matching for the patient.
  const result = matchTrials(patient, { researchConsent, catalog });

  // The matches the eligibility gate checks: the caller-asserted set (to
  // demonstrate the eligibility-criteria-sourced block) or the produced matches.
  const assertedMatches = data.matches as StudyMatch[] | undefined;
  const matchesForCheck = Array.isArray(assertedMatches) ? assertedMatches : result.matches;

  // The outreach the consent / no-enrollment gates check: the caller-asserted
  // outreach (to demonstrate those blocks) or the produced outreach.
  const assertedOutreach =
    data.outreach && typeof data.outreach === "object"
      ? (data.outreach as TrialOutreach)
      : undefined;
  const outreachForCheck = assertedOutreach ?? result.outreach;

  // Honest governance signals. Every eligibility determination must trace to a
  // defined criterion; a trial outreach must be research-consent-gated; the
  // agent may never enroll a patient autonomously.
  const tracesToCriteria = eligibilityTracesToCriteria(matchesForCheck);
  const consentPresent = outreachHasResearchConsent(outreachForCheck);
  const humanEnrollment = enrollmentRequiresHuman(outreachForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      eligibilityTracesToCriteria: tracesToCriteria,
      researchConsentPresent: consentPresent,
      enrollmentRequiresHuman: humanEnrollment
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "trials.match.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: patient.patientRef,
        eligibilityTracesToCriteria: tracesToCriteria,
        researchConsentPresent: consentPresent,
        enrollmentRequiresHuman: humanEnrollment,
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
          `Pause Agent Fabric blocked this clinical-trials run: ${governance.blockingViolations
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

  // Load-catalog span — the fabric records the study catalog it loaded, parented
  // under the caller's span if any.
  const loadSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "trials.load-catalog",
    protocol: "a2a",
    attributes: {
      studiesLoaded: (catalog ?? result.matches).length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Match span — the fabric records the eligibility matching it produced,
  // parented to the catalog it read from.
  const matchSpan = recordInstantSpan({
    taskId,
    parentSpanId: loadSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "trials.match",
    protocol: "a2a",
    attributes: {
      patientRef: patient.patientRef,
      eligibleCount: result.eligibleCount,
      recommendedStudyIds: result.recommendedStudyIds,
      eligibilityTracesToCriteria: tracesToCriteria,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Draft-outreach span — the consent-gated outreach draft, parented to the
  // match it follows from. Never enrolls: requiresHuman + informed consent.
  const outreachSpan = recordInstantSpan({
    taskId,
    parentSpanId: matchSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "trials.draft-outreach",
    protocol: "a2a",
    attributes: {
      outreachState: result.outreach.state,
      researchConsentPresent: consentPresent,
      enrollmentRequiresHuman: humanEnrollment,
      enrolled: false,
      phiAccessed: true,
      synthetic: true,
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
        `Matched ${result.patientRef} against ${result.matches.length} synthetic stud${
          result.matches.length === 1 ? "y" : "ies"
        }: ${result.eligibleCount} eligible. ${
          result.outreach.state === "drafted"
            ? `A consent-gated outreach was drafted for ${result.recommendedStudyIds.length} stud${
                result.recommendedStudyIds.length === 1 ? "y" : "ies"
              }`
            : result.outreach.state === "consent-required"
              ? "Outreach was WITHHELD — the patient's research consent is not present"
              : "No outreach — no eligible studies"
        }. Every eligibility determination traces to a defined criterion; outreach is research-consent-gated (it defers to the patient's research consent scope); and the agent never auto-enrolls — enrollment requires informed consent and a human (synthetic — illustrative catalog + sponsors + criteria, not a certified trial-eligibility engine).`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "TrialMatchResult",
        description:
          "Deterministically-produced clinical-trials / research match for a single menopause/midlife patient — the synthetic studies ranked (eligible first, then match score, then studyId) with per-criterion match explanations tracing to defined eligibility criteria, the eligible count, the recommended study ids, and a consent-gated outreach draft that NEVER auto-enrolls (informed consent + a human required; an active outreach is drafted only when the patient's research consent is present, otherwise it is withheld). The catalog + sponsors + criteria + patientRef are illustrative/synthetic, NOT a certified trial-eligibility engine.",
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
        traceSpanId: outreachSpan.id,
        traceTaskId: taskId,
        eligibleCount: result.eligibleCount,
        recommendedStudyIds: result.recommendedStudyIds,
        outreachState: result.outreach.state,
        eligibilityTracesToCriteria: tracesToCriteria,
        researchConsentPresent: consentPresent,
        enrollmentRequiresHuman: humanEnrollment
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
