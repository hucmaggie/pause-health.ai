import { NextResponse } from "next/server";
import {
  newTaskId,
  sendA2ATask,
  userMessage
} from "../../../../lib/a2a";
import type { CarePathway, IntakeRecord } from "../../../../lib/care-router";
import { recordInstantSpan } from "../../../../lib/agent-fabric";
import {
  carePlanContextFromIntake,
  instantiateCarePlan,
  summarizeCarePlan,
  type InstantiatedCarePlan
} from "../../../../lib/care-plan";
import {
  assembleClinicalSummaryContext,
  summarizeClinical
} from "../../../../lib/clinical-summary";
import {
  buildEducationCurriculum,
  coachEducation,
  educationContextFromIntake
} from "../../../../lib/patient-education";
import {
  assessmentToIntakeSignal,
  isAllowlistedInstrument,
  scoreAssessment,
  type AssessmentResponse
} from "../../../../lib/assessments";
import {
  coverageQueryFromIntake,
  coverageSummary,
  verifyCoverage,
  type CoverageQuery
} from "../../../../lib/benefits";
import {
  bookAppointment,
  bookingSummary,
  modalityForPathway,
  type Modality,
  type SchedulingRequest
} from "../../../../lib/scheduling";
import {
  draftCommunityReferralsForResult,
  isAllowlistedSdohScreener,
  screenSocialNeeds,
  sdohToIntakeSignal,
  type SdohScreener,
  type SdohScreeningResponse
} from "../../../../lib/sdoh";
import {
  DEMO_DATA360_PATIENT_ID,
  getGroundingContext,
  resolveIdentity
} from "../../../../lib/data-360";
import {
  getGroundingContextPreferReal,
  resolveIdentityFromOrg,
  warnSalesforceDegradationOnce
} from "../../../../lib/salesforce/grounding";
import { isSalesforceConfigured } from "../../../../lib/salesforce/auth";

/**
 * Server-side A2A handoff from the (mocked) Agentforce Service Agent
 * to the Pause Care Router agent.
 *
 *   POST /api/intake/route-to-care-router
 *   { "intake": { ... } }
 *
 * Flow:
 *   1. Generate a session-scoped task id (used as the Agent Fabric
 *      trace correlation key).
 *   2. Record a synthetic "intake.complete" span attributed to the
 *      Agentforce intake agent -- this is what an Anypoint OpenTelemetry
 *      tap would emit in production.
 *   3. POST an A2A `tasks/send` request to the Care Router endpoint,
 *      threading the trace via metadata.parentSpanId.
 *   4. Return both the routing decision and the task id so the client
 *      can pivot to /demo/agent-fabric?taskId=<id> and watch the trace.
 *
 * Why a server-side handoff: the prototype's fallback intake runs in
 * the browser, so the patient's browser would never see the Care
 * Router endpoint's logs. Threading through the server route gives us
 * a single trace context, real network latency, and the ability to
 * later add OAuth between agents without changing the client.
 */
export async function POST(req: Request) {
  type Body = {
    intake?: IntakeRecord;
    sessionId?: string;
    /**
     * Optional demo cohort persona id (e.g. "anika-patel"). When
     * present, threaded into every span emitted by this handler so
     * /demo/analytics can filter Care Router decisions + grounding
     * spans by persona. Production callers omit this field and the
     * filter just stays empty on analytics; nothing else branches.
     */
    personaId?: string;
    /**
     * Optional short origin tag (e.g. "agentforce-chat") identifying
     * the surface that completed the intake. Stamped on every span so
     * the trace viewer can tell a chat-originated handoff from the
     * /demo/routing "Run Care Router" button. Sanitized to a strict
     * slug so no free text / PHI can ride in on this attribute.
     */
    origin?: string;
    /**
     * Optional validated-instrument assessment. When present and on the
     * allow-list, the Assessment Agent's deterministic score drives
     * IntakeRecord.severity (and the red-flag screen) — so the Care Router
     * decision is backed by a real instrument score rather than a
     * self-reported band. Additive: absent = today's behavior, unchanged.
     */
    assessment?: AssessmentResponse;
    /**
     * Optional coverage/eligibility verification. When an explicit
     * coverageQuery is provided — OR the intake carries patientInsurance —
     * the Benefits & Coverage Verification (EBV) Agent runs a deterministic
     * synthetic eligibility check and the summary is attached to the trace
     * and the response meta so a real coverage check can precede routing.
     * Set `coverage: false` to opt out even when patientInsurance is present.
     * Additive: absent = today's behavior, unchanged.
     */
    coverage?: { query?: CoverageQuery; memberId?: string } | false;
    /**
     * Optional appointment booking. When present, after the Care Router
     * returns an MSCP pathway with recommended provider(s), the Appointment
     * Scheduling Agent books the visit against a deterministic synthetic
     * calendar and the booking summary is attached to the trace + response
     * meta — closing the intake → routing → booking → engagement loop. The
     * modality defaults to the pathway's (virtual → telehealth, in-person),
     * and the provider defaults to the top recommendation unless a
     * providerId is given. Additive: absent = today's behavior, unchanged.
     */
    scheduling?: {
      book?: boolean;
      providerId?: string;
      providerName?: string;
      modality?: Modality;
      requestedDate?: string;
      requestedSlotStart?: string;
    } | false;
    /**
     * Optional post-visit care plan. When requested (carePlan: true or an
     * object), after the Care Router returns a pathway the Care Plan Agent
     * DETERMINISTICALLY instantiates a menopause care plan from a defined
     * template and attaches a (live-Claude, scripted-fallback) progress summary
     * to the trace + response meta. Strictly additive: absent = today's behavior
     * unchanged. Set `carePlan: false` to opt out explicitly.
     */
    carePlan?: boolean | { onHrt?: boolean };
    /**
     * Optional after-visit clinical summary. When requested (clinicalSummary:
     * true), after the Care Router returns a pathway (and any care plan) the
     * Clinical Summary Agent DETERMINISTICALLY assembles a context from the
     * lifecycle outputs and composes a patient after-visit summary + clinician
     * handoff (live-Claude, scripted-fallback), attaching them to the trace +
     * response meta. Strictly additive: absent = today's behavior unchanged.
     * Set `clinicalSummary: false` to opt out explicitly.
     */
    clinicalSummary?: boolean;
    /**
     * Optional patient education & health coaching. When requested (education:
     * true or an object), after the Care Router returns a pathway (and any care
     * plan) the Patient Education & Health Coaching Agent DETERMINISTICALLY
     * selects an evidence-sourced education curriculum from the intake + upstream
     * signals and coaches the patient (live-Claude, scripted-fallback), attaching
     * it to the trace + response meta. General education only, consent-gated.
     * Strictly additive: absent = today's behavior unchanged. Set
     * `education: false` to opt out explicitly.
     */
    education?:
      | boolean
      | {
          carePlanFocusAreas?: string[];
          careGapMeasures?: string[];
          onHrt?: boolean;
          hasCoachingConsent?: boolean;
        };
    /**
     * Optional health-related social needs (SDOH) screening. When present, the
     * SDOH Screening Agent DETERMINISTICALLY screens the patient with a
     * validated instrument (the CMS AHC-HRSN core-domain tool), flags the
     * positive social-need domains, escalates a positive interpersonal-safety
     * screen to a human social worker, and drafts CONSENT-GATED community-resource
     * referrals (never an autonomous enrollment). SDOH is SEPARATE from clinical
     * severity — it raises a whole-person care-coordination flag, NOT an intake
     * severity — so this composes WITHOUT changing the routing decision. Strictly
     * additive: absent = today's behavior unchanged.
     */
    sdoh?: {
      screener?: SdohScreener;
      responses?: SdohScreeningResponse["responses"];
      patientConsent?: boolean;
    };
  };
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = body.sessionId ?? newTaskId("session");
  const taskId = newTaskId("intake-to-router");
  const personaId =
    typeof body.personaId === "string" && body.personaId.length > 0
      ? body.personaId
      : undefined;
  // Strict slug so this attribute can never carry free text / PHI.
  const origin =
    typeof body.origin === "string" && /^[a-z0-9-]{1,40}$/.test(body.origin)
      ? body.origin
      : undefined;

  // Optional validated-instrument scoring. When a body.assessment for an
  // allow-listed instrument is present, the Assessment Agent's deterministic
  // score drives IntakeRecord.severity (and the red-flag screen) before the
  // intake hands off — a real score behind the routing decision. Best-effort:
  // a malformed assessment must never break intake routing.
  let intake: IntakeRecord = body.intake ?? {};
  let assessmentSpanId: string | undefined;
  let assessmentMeta: Record<string, unknown> | undefined;
  if (body.assessment && isAllowlistedInstrument(body.assessment.instrument)) {
    try {
      const result = scoreAssessment(body.assessment);
      const signal = assessmentToIntakeSignal(result);
      intake = {
        ...intake,
        severity: signal.severity,
        redFlagsAcknowledged: signal.redFlagsAcknowledged
      };
      const assessmentSpan = recordInstantSpan({
        taskId,
        agentId: "assessment-agent",
        operation: "assessment.score",
        protocol: "rest",
        attributes: {
          instrument: result.instrument,
          instrumentName: result.instrumentName,
          total: result.total,
          maxTotal: result.maxTotal,
          severityBand: result.severityBand,
          normalizedSeverity: result.normalizedSeverity,
          redFlag: result.redFlags.length > 0,
          validatedInstrument: true,
          scoringMethod: "deterministic",
          ...(personaId ? { personaId } : {}),
          ...(origin ? { origin } : {})
        }
      });
      assessmentSpanId = assessmentSpan.id;
      assessmentMeta = {
        instrument: result.instrument,
        total: result.total,
        maxTotal: result.maxTotal,
        severityBand: result.severityBand,
        normalizedSeverity: signal.severity,
        redFlag: result.redFlags.length > 0,
        severityDrivenByAssessment: true
      };
    } catch {
      // Best-effort: leave the intake untouched on a malformed assessment.
    }
  }

  // Optional coverage/eligibility verification (EBV). Runs when an explicit
  // coverageQuery is supplied OR the intake carries patientInsurance (unless
  // explicitly opted out with coverage:false). The eligibility summary is
  // attached to the trace + response meta so a real coverage check can
  // precede routing. Best-effort + strictly additive: a failure here must
  // never break intake routing, and absent = today's behavior unchanged.
  let coverageSpanId: string | undefined;
  let coverageMeta: Record<string, unknown> | undefined;
  const coverageOptedOut = body.coverage === false;
  const explicitCoverage = body.coverage || undefined;
  const shouldVerifyCoverage =
    !coverageOptedOut &&
    Boolean(explicitCoverage?.query || intake.patientInsurance);
  if (shouldVerifyCoverage) {
    try {
      const query: CoverageQuery =
        explicitCoverage?.query ??
        coverageQueryFromIntake(intake, {
          memberId: explicitCoverage?.memberId
        });
      const coverage = verifyCoverage(query);
      const summary = coverageSummary(coverage);
      const coverageSpan = recordInstantSpan({
        taskId,
        parentSpanId: assessmentSpanId,
        agentId: "benefits-verification-agent",
        operation: "benefits.verify",
        protocol: "rest",
        attributes: {
          payer: summary.payerName,
          planName: summary.planName,
          eligibilityStatus: summary.eligibilityStatus,
          network: summary.network,
          deductibleTotal: summary.deductibleTotal,
          deductibleMet: summary.deductibleMet,
          deductibleRemaining: summary.deductibleRemaining,
          coinsuranceRate: summary.coinsuranceRate,
          ...(summary.copay !== undefined ? { copay: summary.copay } : {}),
          estimatedVisitCost: summary.estimatedVisitCost,
          estimatedPatientResponsibility: summary.estimatedPatientResponsibility,
          ebvTransactionId: summary.ebvTransactionId,
          sourced: summary.sourced,
          synthetic: true,
          ...(personaId ? { personaId } : {}),
          ...(origin ? { origin } : {})
        }
      });
      coverageSpanId = coverageSpan.id;
      coverageMeta = { ...summary, coverageVerifiedBeforeRouting: true };
    } catch {
      // Best-effort: leave routing untouched on a malformed coverage query.
    }
  }

  // Optional SDOH / HRSN screening (additive, whole-person care). When a
  // body.sdoh for an allow-listed screener is present, the SDOH Screening Agent
  // DETERMINISTICALLY screens the patient, escalates the interpersonal-safety
  // red flag to a human social worker, and drafts CONSENT-GATED community-
  // resource referrals — never an autonomous enrollment. SDOH is SEPARATE from
  // clinical severity: it raises a care-coordination flag and NEVER mutates the
  // intake severity, so the Care Router decision is unchanged. Best-effort +
  // strictly additive: a malformed screening must never break intake routing.
  let sdohSpanId: string | undefined;
  let sdohMeta: Record<string, unknown> | undefined;
  if (body.sdoh && isAllowlistedSdohScreener(body.sdoh.screener)) {
    try {
      const result = screenSocialNeeds({
        screener: body.sdoh.screener,
        responses: body.sdoh.responses ?? {}
      });
      const signal = sdohToIntakeSignal(result);
      const patientConsent = body.sdoh.patientConsent === true;
      const referrals = draftCommunityReferralsForResult(result, {
        patientConsent
      });
      const sdohSpan = recordInstantSpan({
        taskId,
        parentSpanId: coverageSpanId ?? assessmentSpanId,
        agentId: "sdoh-screening-agent",
        operation: "sdoh.screen",
        protocol: "rest",
        attributes: {
          screener: result.screener,
          positiveDomainCount: result.positiveDomainCount,
          positiveDomains: result.positiveDomains,
          safetyEscalation: signal.safetyEscalation,
          usesValidatedSdohScreener: true,
          scoringMethod: "deterministic",
          phiAccessed: true,
          ...(personaId ? { personaId } : {}),
          ...(origin ? { origin } : {})
        }
      });
      sdohSpanId = sdohSpan.id;
      // A positive interpersonal-safety screen is a mandatory human escalation.
      if (result.redFlags.length > 0) {
        recordInstantSpan({
          taskId,
          parentSpanId: sdohSpan.id,
          agentId: "sdoh-screening-agent",
          operation: "sdoh.safety.escalate",
          protocol: "internal",
          status: "error",
          attributes: {
            screener: result.screener,
            redFlags: result.redFlags.map((f) => f.code),
            handoffTo: "social-worker",
            requiresHumanEscalation: true,
            phiAccessed: true,
            ...(personaId ? { personaId } : {}),
            ...(origin ? { origin } : {})
          }
        });
      }
      for (const referral of referrals) {
        recordInstantSpan({
          taskId,
          parentSpanId: sdohSpan.id,
          agentId: "sdoh-screening-agent",
          operation: "sdoh.refer",
          protocol: "rest",
          attributes: {
            resourceId: referral.resourceId,
            domain: referral.domain,
            handoffTo: referral.handoffTo,
            suppressedForNoConsent: referral.suppressedForNoConsent,
            requiresHumanApproval: referral.requiresHumanApproval,
            autonomousEnrollment: referral.autonomousEnrollment,
            sent: referral.sent,
            phiAccessed: true,
            ...(personaId ? { personaId } : {}),
            ...(origin ? { origin } : {})
          }
        });
      }
      sdohMeta = {
        screener: result.screener,
        positiveDomains: result.positiveDomains,
        positiveDomainCount: result.positiveDomainCount,
        safetyEscalation: signal.safetyEscalation,
        referralsDrafted: referrals.length,
        referrals: referrals.map((r) => ({
          resourceId: r.resourceId,
          resourceLabel: r.resourceLabel,
          domain: r.domain,
          suppressedForNoConsent: r.suppressedForNoConsent,
          handoffTo: r.handoffTo
        })),
        // SDOH never drives clinical severity — it is whole-person care that
        // composes alongside the routing decision without changing it.
        sdohSeparateFromClinicalSeverity: true
      };
    } catch {
      // Best-effort: leave intake routing untouched on a malformed screening.
    }
  }

  const intakeSpan = recordInstantSpan({
    taskId,
    parentSpanId: sdohSpanId ?? coverageSpanId ?? assessmentSpanId,
    agentId: "agentforce-intake",
    operation: "intake.complete",
    protocol: "rest",
    attributes: {
      capturedFields: Object.values(intake).filter((v) => v !== undefined).length,
      redFlag: intake.redFlagsAcknowledged === "yes",
      ageBand: intake.ageBand,
      primarySymptom: intake.primarySymptom,
      severity: intake.severity,
      patientZipProvided: Boolean(intake.patientZip),
      ...(personaId ? { personaId } : {}),
      ...(origin ? { origin } : {})
    }
  });

  // 1. Identity resolution via Data 360 -- maps the partial intake
  //    identity to the unified patient id. Prefer real-org resolution
  //    when SF is configured; degrade silently to the deterministic mock
  //    on any failure so the trace never breaks for a transient network
  //    blip against the org.
  const idStartedAt = Date.now();
  let identitySource: "real" | "mock" = "mock";
  let identity = resolveIdentity({
    preferredName: intake.preferredName,
    ageBand: intake.ageBand,
    cycleStatus: intake.cycleStatus
  });
  if (isSalesforceConfigured()) {
    try {
      const real = await resolveIdentityFromOrg({
        preferredName: intake.preferredName,
        ageBand: intake.ageBand,
        cycleStatus: intake.cycleStatus
      });
      if (real) {
        identity = real;
        identitySource = "real";
      }
    } catch (err) {
      warnSalesforceDegradationOnce("intake.identity.resolve", err);
    }
  }
  const idFinishedAt = Date.now();
  const identitySpan = recordInstantSpan({
    taskId,
    parentSpanId: intakeSpan.id,
    agentId: "salesforce-data-360",
    operation: "data360.identity.resolve",
    protocol: "rest",
    attributes: {
      _source: identitySource,
      unifiedPatientId: identity.unifiedPatientId,
      confidence: identity.confidence,
      matchedSources: identity.matchedSources,
      resolutionRuleset: identity.resolutionRuleset,
      durationMs: idFinishedAt - idStartedAt,
      ...(personaId ? { personaId } : {}),
      ...(origin ? { origin } : {})
    }
  });

  // 2. Federated grounding query. Prefer real Health Cloud grounding
  //    (Phase 1: Contact + CareProgramEnrollee + CarePlan + Case); fall
  //    back to the deterministic mock. The returned shape is identical
  //    so the Care Router code path doesn't branch.
  const groundingStartedAt = Date.now();
  const { source: groundingSource, grounding } = await getGroundingContextPreferReal({
    patientId: identity.unifiedPatientId || DEMO_DATA360_PATIENT_ID,
    hint: {
      ageBand: intake.ageBand,
      primarySymptom: intake.primarySymptom,
      cycleStatus: intake.cycleStatus
    }
  });
  const groundingFinishedAt = Date.now();
  recordInstantSpan({
    taskId,
    parentSpanId: identitySpan.id,
    agentId: "salesforce-data-360",
    operation: "data360.grounding.federated-query",
    protocol: "rest",
    attributes: {
      _source: groundingSource,
      unifiedPatientId: grounding.unifiedPatientId,
      computedInsightsCount: grounding.groundingProvenance.computedInsightsCount,
      sourcesQueried: grounding.groundingProvenance.sourcesQueried,
      cohort: grounding.cohortComparison.cohortName,
      cohortSize: grounding.cohortComparison.cohortSize,
      patientPercentile: grounding.cohortComparison.patientPercentile,
      patientPercentileBasis: grounding.cohortComparison.basis,
      lastClinicianContactDaysAgo: grounding.lastClinicianContact.daysAgo,
      durationMs: groundingFinishedAt - groundingStartedAt,
      ...(personaId ? { personaId } : {}),
      ...(origin ? { origin } : {})
    }
  });

  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;
  const careRouterUrl = `${base}/api/agents/care-router`;

  try {
    const task = await sendA2ATask(careRouterUrl, {
      id: taskId,
      sessionId,
      message: userMessage(
        "Please route this menopause intake to the appropriate care pathway. Longitudinal context attached from Salesforce Data 360.",
        { intake, data360Grounding: grounding, data360Identity: identity }
      ),
      metadata: {
        parentSpanId: intakeSpan.id,
        ...(personaId ? { personaId } : {}),
        ...(origin ? { origin } : {})
      }
    });

    const decisionPart = task.artifacts?.[0]?.parts?.find(
      (p) => p.type === "data"
    );
    const decision =
      decisionPart && decisionPart.type === "data" ? decisionPart.data : null;

    // Optional booking step (additive). When scheduling is requested and the
    // routing decision recommends MSCP provider(s), the Appointment
    // Scheduling Agent books the visit against the deterministic synthetic
    // calendar and the summary is attached to the trace + response meta —
    // the intake → routing → booking → engagement close. Best-effort: a
    // failure here must never break the routing response, and absent =
    // today's behavior unchanged.
    let schedulingMeta: Record<string, unknown> | undefined;
    const schedulingOptedOut = body.scheduling === false;
    const schedulingReq = body.scheduling || undefined;
    const wantsBooking =
      !schedulingOptedOut &&
      Boolean(schedulingReq && (schedulingReq.book ?? true));
    if (wantsBooking && decision && typeof decision === "object") {
      try {
        const d = decision as {
          pathway?: string;
          recommendedProviders?: {
            modality?: "virtual" | "in-person";
            providers?: Array<{ npi?: string; name?: string }>;
          };
        };
        const topProvider = d.recommendedProviders?.providers?.[0];
        const providerId = schedulingReq?.providerId || topProvider?.npi;
        // Only book when we have a concrete provider to book with.
        if (providerId) {
          const modality: Modality =
            schedulingReq?.modality ?? modalityForPathway(d.pathway);
          const request: SchedulingRequest = {
            providerId,
            providerName: schedulingReq?.providerName || topProvider?.name,
            modality,
            ...(schedulingReq?.requestedSlotStart
              ? { requestedSlotStart: schedulingReq.requestedSlotStart }
              : {}),
            ...(schedulingReq?.requestedDate
              ? { requestedDate: schedulingReq.requestedDate }
              : {})
          };
          const booking = bookAppointment(request);
          const summary = bookingSummary(booking);
          recordInstantSpan({
            taskId,
            parentSpanId: intakeSpan.id,
            agentId: "appointment-scheduling-agent",
            operation: "scheduling.book",
            protocol: "rest",
            attributes: {
              providerId: summary.providerId,
              providerName: summary.providerName,
              modality: summary.modality,
              serviceAppointmentId: summary.serviceAppointmentId,
              slotStart: summary.slotStart,
              slotEnd: summary.slotEnd,
              status: summary.status,
              requestedSlotIsFree: true,
              slotWithinProviderAvailability: true,
              synthetic: true,
              ...(personaId ? { personaId } : {}),
              ...(origin ? { origin } : {})
            }
          });
          schedulingMeta = { ...summary, bookedAfterRouting: true, nextAgent: "engagement-agent" };
        }
      } catch {
        // Best-effort: leave routing untouched on a scheduling failure.
      }
    }

    // Optional post-visit care plan (additive). When requested and the routing
    // decision carries a pathway, the Care Plan Agent DETERMINISTICALLY
    // instantiates a menopause care plan from a defined template and attaches a
    // (live-Claude, scripted-fallback) progress summary to the trace + response
    // meta — the routing → care-plan close. Best-effort + strictly additive: a
    // failure here must never break the routing response, and absent = today's
    // behavior unchanged.
    let carePlanMeta: Record<string, unknown> | undefined;
    // Hoisted so the optional clinical-summary step below can compose the
    // instantiated plan into the after-visit summary without re-deriving it.
    let instantiatedCarePlan: InstantiatedCarePlan | undefined;
    const carePlanOptedOut = body.carePlan === false;
    const carePlanReq =
      body.carePlan && typeof body.carePlan === "object" ? body.carePlan : undefined;
    const wantsCarePlan = !carePlanOptedOut && Boolean(body.carePlan);
    if (wantsCarePlan && decision && typeof decision === "object") {
      try {
        const pathway =
          ((decision as { pathway?: CarePathway }).pathway ?? "mscp-virtual-visit") as CarePathway;
        const plan = instantiateCarePlan(
          carePlanContextFromIntake(intake, { pathway }, { onHrt: carePlanReq?.onHrt })
        );
        instantiatedCarePlan = plan;
        const instantiateSpan = recordInstantSpan({
          taskId,
          parentSpanId: intakeSpan.id,
          agentId: "care-plan-agent",
          operation: "careplan.instantiate",
          protocol: "a2a",
          attributes: {
            templateId: plan.templateId,
            pathway: plan.pathway,
            severity: plan.severity,
            goals: plan.goals.length,
            interventions: plan.interventions.length,
            followUpIntervalDays: plan.followUp.intervalDays,
            planTracesToTemplate: true,
            synthetic: true,
            ...(personaId ? { personaId } : {}),
            ...(origin ? { origin } : {})
          }
        });
        const summary = await summarizeCarePlan(plan);
        recordInstantSpan({
          taskId,
          parentSpanId: instantiateSpan.id,
          agentId: "care-plan-agent",
          operation: "careplan.summarize",
          protocol: "a2a",
          attributes: {
            templateId: plan.templateId,
            provider: summary.modelProvenance.provider,
            model: summary.modelProvenance.model,
            via: summary.via,
            ...(summary.fallbackReason ? { fallbackReason: summary.fallbackReason } : {}),
            nonPrescriptive: true,
            ...(personaId ? { personaId } : {}),
            ...(origin ? { origin } : {})
          }
        });
        carePlanMeta = {
          templateId: plan.templateId,
          templateLabel: plan.templateLabel,
          summaryVia: summary.via,
          summary: summary.summary,
          ...(summary.fallbackReason ? { fallbackReason: summary.fallbackReason } : {}),
          carePlanAfterRouting: true
        };
      } catch {
        // Best-effort: leave routing untouched on a care-plan failure.
      }
    }

    // Optional after-visit clinical summary (additive). When requested and the
    // routing decision carries a pathway, the Clinical Summary Agent
    // DETERMINISTICALLY assembles a context from the lifecycle outputs (intake +
    // pathway + any instantiated care plan) and composes a patient after-visit
    // summary + clinician handoff (live-Claude, scripted-fallback), attaching
    // them to the trace + response meta — the routing → summary close. It
    // touches clinical context, so its spans set phiAccessed:true. Best-effort +
    // strictly additive: a failure here must never break the routing response,
    // and absent = today's behavior unchanged.
    let clinicalSummaryMeta: Record<string, unknown> | undefined;
    const wantsClinicalSummary = body.clinicalSummary === true;
    if (wantsClinicalSummary && decision && typeof decision === "object") {
      try {
        const pathway = (decision as { pathway?: CarePathway }).pathway;
        const context = assembleClinicalSummaryContext({
          intake,
          ...(pathway ? { pathway } : {}),
          ...(carePlanReq?.onHrt !== undefined ? { onHrt: carePlanReq.onHrt } : {}),
          ...(instantiatedCarePlan ? { carePlan: instantiatedCarePlan } : {}),
          ...(personaId ? { personaId } : {})
        });
        const assembleSpan = recordInstantSpan({
          taskId,
          parentSpanId: intakeSpan.id,
          agentId: "clinical-summary-agent",
          operation: "clinical-summary.assemble",
          protocol: "a2a",
          attributes: {
            sourceRecords: context.sourceRecords.length,
            summaryTracesToSourceRecords: context.sourceRecords.length > 0,
            hasCarePlan: Boolean(context.carePlan),
            careGaps: context.careGaps.length,
            phiAccessed: true,
            synthetic: true,
            ...(personaId ? { personaId } : {}),
            ...(origin ? { origin } : {})
          }
        });
        const summary = await summarizeClinical(context);
        recordInstantSpan({
          taskId,
          parentSpanId: assembleSpan.id,
          agentId: "clinical-summary-agent",
          operation: "clinical-summary.summarize",
          protocol: "a2a",
          attributes: {
            sourceRecords: summary.sourceRecords.length,
            provider: summary.modelProvenance.provider,
            model: summary.modelProvenance.model,
            via: summary.via,
            ...(summary.fallbackReason ? { fallbackReason: summary.fallbackReason } : {}),
            nonPrescriptive: true,
            phiAccessed: true,
            ...(personaId ? { personaId } : {}),
            ...(origin ? { origin } : {})
          }
        });
        clinicalSummaryMeta = {
          patientSummary: summary.patientSummary,
          clinicianHandoff: summary.clinicianHandoff,
          sourceRecords: summary.sourceRecords,
          summaryVia: summary.via,
          ...(summary.fallbackReason ? { fallbackReason: summary.fallbackReason } : {}),
          clinicalSummaryAfterRouting: true
        };
      } catch {
        // Best-effort: leave routing untouched on a clinical-summary failure.
      }
    }

    // Optional patient education & health coaching (additive). When requested,
    // the Patient Education Agent DETERMINISTICALLY selects an evidence-sourced
    // curriculum from the intake + upstream Care Plan focus areas / care gaps and
    // coaches the patient (live-Claude, scripted-fallback). It touches clinical
    // context, so its spans set phiAccessed:true, and every coaching draft is
    // consent-gated + human-approval-gated (never auto-sent). Best-effort +
    // strictly additive: a failure here must never break the routing response,
    // and absent = today's behavior unchanged.
    let educationMeta: Record<string, unknown> | undefined;
    const educationOptedOut = body.education === false;
    const educationReq =
      body.education && typeof body.education === "object" ? body.education : undefined;
    const wantsEducation = !educationOptedOut && Boolean(body.education);
    if (wantsEducation) {
      try {
        const curriculum = buildEducationCurriculum(
          educationContextFromIntake(intake, {
            onHrt: educationReq?.onHrt ?? carePlanReq?.onHrt,
            ...(educationReq?.carePlanFocusAreas
              ? { carePlanFocusAreas: educationReq.carePlanFocusAreas }
              : {}),
            ...(educationReq?.careGapMeasures
              ? { careGapMeasures: educationReq.careGapMeasures }
              : {})
          })
        );
        const coachingOutreachHasConsent = educationReq?.hasCoachingConsent !== false;
        const curateSpan = recordInstantSpan({
          taskId,
          parentSpanId: intakeSpan.id,
          agentId: "patient-education-agent",
          operation: "patient-education.curate",
          protocol: "a2a",
          attributes: {
            modulesSelected: curriculum.moduleIds.length,
            modules: curriculum.moduleIds,
            focusAreas: curriculum.focusAreas,
            educationTracesToEvidenceSource: true,
            staysWithinEducationScope: true,
            phiAccessed: true,
            synthetic: true,
            ...(personaId ? { personaId } : {}),
            ...(origin ? { origin } : {})
          }
        });
        const coaching = await coachEducation(curriculum);
        recordInstantSpan({
          taskId,
          parentSpanId: curateSpan.id,
          agentId: "patient-education-agent",
          operation: "patient-education.coach",
          protocol: "a2a",
          attributes: {
            provider: coaching.modelProvenance.provider,
            model: coaching.modelProvenance.model,
            via: coaching.via,
            ...(coaching.fallbackReason ? { fallbackReason: coaching.fallbackReason } : {}),
            coachingOutreachHasConsent,
            staysWithinEducationScope: true,
            requiresHumanApproval: true,
            sent: false,
            phiAccessed: true,
            ...(personaId ? { personaId } : {}),
            ...(origin ? { origin } : {})
          }
        });
        educationMeta = {
          moduleIds: curriculum.moduleIds,
          focusAreas: curriculum.focusAreas,
          coachingMessage: coaching.coachingMessage,
          coachingVia: coaching.via,
          ...(coaching.fallbackReason ? { fallbackReason: coaching.fallbackReason } : {}),
          educationAfterRouting: true
        };
      } catch {
        // Best-effort: leave routing untouched on a patient-education failure.
      }
    }

    return NextResponse.json({
      meta: {
        _note:
          "A2A handoff: Agentforce intake -> Data 360 identity resolution -> Data 360 federated grounding query -> Pause Care Router. Open /demo/agent-fabric?taskId=" +
          taskId +
          " to see the four-span multi-agent trace.",
        _taskId: taskId,
        _sessionId: sessionId,
        _careRouterUrl: careRouterUrl,
        _data360UnifiedPatientId: identity.unifiedPatientId,
        _data360IdentitySource: identitySource,
        _data360GroundingSource: groundingSource,
        _salesforceConfigured: isSalesforceConfigured(),
        ...(assessmentMeta ? { _assessment: assessmentMeta } : {}),
        ...(coverageMeta ? { _coverage: coverageMeta } : {}),
        ...(sdohMeta ? { _sdoh: sdohMeta } : {}),
        ...(schedulingMeta ? { _scheduling: schedulingMeta } : {}),
        ...(carePlanMeta ? { _carePlan: carePlanMeta } : {}),
        ...(clinicalSummaryMeta ? { _clinicalSummary: clinicalSummaryMeta } : {}),
        ...(educationMeta ? { _education: educationMeta } : {})
      },
      taskId,
      sessionId,
      task,
      decision,
      ...(assessmentMeta ? { assessment: assessmentMeta } : {}),
      ...(coverageMeta ? { coverage: coverageMeta } : {}),
      ...(sdohMeta ? { sdoh: sdohMeta } : {}),
      ...(schedulingMeta ? { scheduling: schedulingMeta } : {}),
      ...(carePlanMeta ? { carePlan: carePlanMeta } : {}),
      ...(clinicalSummaryMeta ? { clinicalSummary: clinicalSummaryMeta } : {}),
      ...(educationMeta ? { education: educationMeta } : {}),
      data360: {
        source: { identity: identitySource, grounding: groundingSource },
        identity,
        grounding
      }
    });
  } catch (err) {
    recordInstantSpan({
      taskId,
      parentSpanId: intakeSpan.id,
      agentId: "care-router-claude",
      operation: "a2a.tasks/send.transport-error",
      protocol: "a2a",
      status: "error",
      attributes: {
        error: (err as Error).message,
        ...(personaId ? { personaId } : {}),
        ...(origin ? { origin } : {})
      }
    });
    return NextResponse.json(
      {
        meta: { _taskId: taskId, _sessionId: sessionId },
        error: (err as Error).message
      },
      { status: 502 }
    );
  }
}
