/**
 * Single source of truth for the governance pre-flight's task signals.
 *
 * This module is intentionally dependency-free (no registry, no trace store)
 * so it can be imported by BOTH the server-side evaluator in agent-fabric.ts
 * AND the client-side "Governance pre-flight" panel on /demo/agent-fabric
 * without dragging the whole in-memory fabric into the browser bundle.
 *
 * The evaluator builds its block checks from BOOLEAN_BLOCK_SIGNALS, and the UI
 * builds its toggles from the same list, so the two can never advertise a
 * different set of signals than the gate actually evaluates.
 */

/**
 * The signals a caller can present about an inbound task. Every field is
 * optional and, by convention, a policy fires ONLY when its signal is
 * explicitly present and violating -- never when the signal is absent -- so
 * partial fixtures (and the /demo evaluator form) don't trip a gate merely by
 * omitting a field.
 */
export type GovernanceTask = {
  // Patient-facing intake (data plane)
  containsFreeTextPii?: boolean;
  // Care Router (clinical decision)
  hasRedFlagScreen?: boolean;
  requestedModel?: string;
  hasRationaleField?: boolean;
  commitsClinicalActionWithoutClinician?: boolean;
  // Integration / data substrate (Pause MCP, MuleSoft)
  usesUnlistedMcpTool?: boolean;
  payloadIsFhirR5?: boolean;
  // MCP Bridge (A2A ↔ MCP egress host)
  connectsToAllowlistedRemote?: boolean;
  forwardsBearerCrossOrigin?: boolean;
  // Data 360 grounding & activation
  bulkIngestsPhi?: boolean;
  hasAiDecisionSupportConsent?: boolean;
  segmentActivationChannelAllowlisted?: boolean;
  // Patient-lifecycle acquisition/engagement (prospecting, engagement, inbound)
  hasContactConsent?: boolean;
  autonomousSend?: boolean;
  respectsQuietHoursAndChannel?: boolean;
  hasLeadOptInAndSource?: boolean;
  identityResolved?: boolean;
  // Qualification
  usesProtectedClassCriteria?: boolean;
  // Assessment (validated-instrument scoring)
  administersValidatedInstrumentOnly?: boolean;
  // SDOH / HRSN screening (whole-person care)
  usesValidatedSdohScreener?: boolean;
  sdohReferralHasConsent?: boolean;
  // Benefits & coverage verification (EBV)
  eligibilityTracesToSource?: boolean;
  // Appointment scheduling (care coordination)
  requestedSlotIsFree?: boolean;
  slotWithinProviderAvailability?: boolean;
  // Care gap closure (preventive care)
  gapsTraceToClinicalMeasure?: boolean;
  // Care plan (template-instantiated plan)
  planTracesToTemplate?: boolean;
  // Clinical summary (after-visit summary + clinician handoff)
  summaryTracesToSourceRecords?: boolean;
  // Patient education & health coaching (evidence-sourced education + coaching)
  educationTracesToEvidenceSource?: boolean;
  staysWithinEducationScope?: boolean;
  coachingOutreachHasConsent?: boolean;
  // Medication adherence (nudge-only refill/adherence prompts)
  refillRequiresHumanApproval?: boolean;
  // Remote patient monitoring & symptom-trend tracking (longitudinal readings)
  readingsTraceToSource?: boolean;
  escalationRoutedToHuman?: boolean;
  monitoringHasConsent?: boolean;
  // Population health & risk stratification (panel/cohort-level triage)
  riskScoreTracesToFactors?: boolean;
  excludesProtectedAttributes?: boolean;
  tierReviewedByHuman?: boolean;
  // Consent & preferences management (authoritative consent ledger + decisions)
  consentTracesToRecord?: boolean;
  honorsRevocation?: boolean;
  respectsConsentScope?: boolean;
  // Clinical trials & research matching (criteria-sourced eligibility + consent-gated outreach)
  eligibilityTracesToCriteria?: boolean;
  researchConsentPresent?: boolean;
  enrollmentRequiresHuman?: boolean;
  // Language access & health equity (qualified-interpreter-only + approved-source materials)
  usesQualifiedInterpreter?: boolean;
  materialsTraceToApprovedSource?: boolean;
  noMachineTranslationForConsent?: boolean;
  // HEDIS & quality reporting (catalog-sourced measures + exclusions + human-approved submission)
  measuresTraceToCatalog?: boolean;
  exclusionsTraceToCatalog?: boolean;
  submissionRequiresHumanApproval?: boolean;
  // Advance care planning (catalog-sourced directives + human-signoff + LEP interpreter)
  directivesTraceToCatalog?: boolean;
  directiveChangeRequiresHumanSignoff?: boolean;
  languageAccessSatisfied?: boolean;
  // Care team & case management (catalog-sourced roles + case-manager approval + PCP anchor)
  rolesTraceToCatalog?: boolean;
  teamChangeRequiresCaseManager?: boolean;
  teamIncludesPcp?: boolean;
  // Transitions of care (reconciliation-source + no autonomous med change + follow-up scheduled)
  medicationsTraceToApprovedSource?: boolean;
  reconciliationChangeRequiresClinician?: boolean;
  followUpScheduledNotRecommended?: boolean;
  // Grievance & appeals (human-queue resolution + deadline integrity + PHI-safe routing)
  caseResolutionRequiresHumanQueue?: boolean;
  deadlineTracesToCatalog?: boolean;
  routingSummaryIsPhiSafe?: boolean;
  // Provider credentialing & directory (source-integrity + no-expired-referral + NSA freshness)
  credentialsTraceToVerifiedSource?: boolean;
  noReferralToExpiredOrSanctioned?: boolean;
  directoryIsFresh?: boolean;
  // Quality-measure attribution (methodology-catalog + contract-terms + tie-break-documented)
  attributionsTraceToCatalog?: boolean;
  attributionsHonorContractTerms?: boolean;
  attributionTieBreaksAreDocumented?: boolean;
  // Complex care management (eligibility-catalog + no autonomous billing + time-integrity)
  eligibilityTracesToCatalog?: boolean;
  billingRequiresHumanApproval?: boolean;
  timeEntriesAddUp?: boolean;
  // Claims adjudication (edit-catalog + adjudicator-cosign + reason-code integrity)
  editsTraceToCatalog?: boolean;
  denialRequiresAdjudicatorCosign?: boolean;
  decisionsCiteReasonCodes?: boolean;
  // Formulary & drug utilization review (catalog + step-therapy + no autonomous override)
  rulesTraceToCatalog?: boolean;
  stepTherapyIsHonored?: boolean;
  exceptionRequiresClinicianCosign?: boolean;
  // Fraud, Waste & Abuse detection (pattern-catalog + SIU-review + no protected-class factors)
  patternsTraceToCatalog?: boolean;
  reportRequiresSiuReview?: boolean;
  noProtectedClassFactors?: boolean;
  // Clinical trial payments (schedule-catalog + coordinator cosign + participant consent)
  paymentsTraceToCatalog?: boolean;
  deviationRequiresCoordinatorCosign?: boolean;
  paymentHasParticipantConsent?: boolean;
  // Utilization review (criteria-catalog + clinician cosign + SLA integrity)
  criteriaTraceToCatalog?: boolean;
  denialRequiresClinicianCosign?: boolean;
  slaTracesToCatalog?: boolean;
  // Provider contracting (contract-type catalog + owner cosign + benchmark methodology)
  contractsTraceToCatalog?: boolean;
  contractChangeRequiresOwnerCosign?: boolean;
  benchmarksTraceToMethodology?: boolean;
  // Care coordination handoff (SBAR completeness + credentialed receiver + transfer consent)
  sbarIsComplete?: boolean;
  receivingClinicianIsCredentialed?: boolean;
  handoffHasConsent?: boolean;
  // Adverse-event reporting (event catalog + regulatory cosign + reporter verified)
  eventsTraceToCatalog?: boolean;
  submissionRequiresRegulatoryTeamCosign?: boolean;
  reporterIdentityVerified?: boolean;
  // Referral management (cosign-gated outbound referrals)
  referralHasClinicianCosign?: boolean;
  // Member service / billing (claim-sourced billing answers)
  billingTracesToClaim?: boolean;
  // Prior authorization (clinician-gated, documentation-complete PA assembly)
  paHasClinicianApproval?: boolean;
  paDocumentationComplete?: boolean;
  // Commercial plane (pipeline, account management)
  accessesPhi?: boolean;
  forecastSourcedFromCrm?: boolean;
  commitsContractChangeWithoutHumanOwner?: boolean;
};

/** The boolean-valued keys of GovernanceTask (everything but requestedModel). */
export type BooleanSignalKey = {
  [K in keyof GovernanceTask]-?: GovernanceTask[K] extends boolean | undefined
    ? K
    : never;
}[keyof GovernanceTask];

export type BooleanBlockSignal = {
  policyId: string;
  signal: BooleanSignalKey;
  /** The boolean value that constitutes a violation of the policy. */
  violatingValue: boolean;
  /** Short, human description of what the violating state looks like. */
  violationHint: string;
  /** Reason surfaced on the blockingViolations list when it fires. */
  reason: string;
};

/**
 * Every enforced-block policy whose check is a simple boolean signal. The one
 * exception -- policy.model.anthropic-claude-sonnet-allowlisted -- is a
 * string+regex check handled specially in the evaluator and UI.
 */
export const MODEL_ALLOWLIST_POLICY_ID =
  "policy.model.anthropic-claude-sonnet-allowlisted";

export const BOOLEAN_BLOCK_SIGNALS: BooleanBlockSignal[] = [
  {
    policyId: "policy.phi.no-free-text-pii",
    signal: "containsFreeTextPii",
    violatingValue: true,
    violationHint: "Intake payload carries free-text PII",
    reason:
      "Intake payload carried free-text PII; only structured fields are permitted"
  },
  {
    policyId: "policy.intake.red-flag-mandatory",
    signal: "hasRedFlagScreen",
    violatingValue: false,
    violationHint: "Task omits the red-flag screen field",
    reason: "Task did not include a red-flag screen field"
  },
  {
    policyId: "policy.clinical.rationale-required",
    signal: "hasRationaleField",
    violatingValue: false,
    violationHint: "Routing decision carries no rationale",
    reason:
      "Task did not carry a rationale field; every routing decision must include human-readable rationale"
  },
  {
    policyId: "policy.clinical.no-prescribing",
    signal: "commitsClinicalActionWithoutClinician",
    violatingValue: true,
    violationHint: "Commits a clinical action without a clinician",
    reason:
      "Attempted to write a prescription/order or commit a clinical action without a human clinician"
  },
  {
    policyId: "policy.mcp.tools-allowlisted",
    signal: "usesUnlistedMcpTool",
    violatingValue: true,
    violationHint: "Invokes an MCP tool outside the allow-list",
    reason: "Invoked an MCP tool outside the declared Pause tool allow-list"
  },
  {
    policyId: "policy.data.fhir-r5-only",
    signal: "payloadIsFhirR5",
    violatingValue: false,
    violationHint: "Clinical payload is not FHIR R5",
    reason: "Clinical payload crossing the MuleSoft tiers was not FHIR R5"
  },
  {
    policyId: "policy.mcp-bridge.remote-allowlist",
    signal: "connectsToAllowlistedRemote",
    violatingValue: false,
    violationHint: "Connects to an unlisted MCP remote",
    reason:
      "MCP Bridge attempted to connect to a remote that is neither the loopback nor in PAUSE_MCP_HOST_REMOTES"
  },
  {
    policyId: "policy.mcp-bridge.tool-allowlist",
    signal: "usesUnlistedMcpTool",
    violatingValue: true,
    violationHint: "Invokes an unlisted tool through the bridge",
    reason: "MCP Bridge invoked a tool outside the declared Pause allow-list"
  },
  {
    policyId: "policy.mcp-bridge.no-cross-origin-bearer",
    signal: "forwardsBearerCrossOrigin",
    violatingValue: true,
    violationHint: "Forwards a bearer to a cross-origin remote",
    reason:
      "MCP Bridge attempted to forward an inbound bearer token to a cross-origin external MCP server"
  },
  {
    policyId: "policy.data360.zero-copy-federation",
    signal: "bulkIngestsPhi",
    violatingValue: true,
    violationHint: "Bulk-ingests PHI into Salesforce",
    reason:
      "Attempted a bulk PHI ingestion into Salesforce instead of zero-copy federation"
  },
  {
    policyId: "policy.data360.consent-required-before-grounding",
    signal: "hasAiDecisionSupportConsent",
    violatingValue: false,
    violationHint: "Grounds without an ai-decision-support consent",
    reason:
      "Grounding call lacked an active 'ai-decision-support' consent in the Data 360 consent ledger"
  },
  {
    policyId: "policy.data360.segment-activation-allowlist",
    signal: "segmentActivationChannelAllowlisted",
    violatingValue: false,
    violationHint: "Activates a segment to an off-allowlist channel",
    reason:
      "Segment activation targeted a channel outside the approved downstream allow-list"
  },
  {
    policyId: "policy.qualification.rationale-required",
    signal: "hasRationaleField",
    violatingValue: false,
    violationHint: "Qualification decision carries no rationale",
    reason: "Qualification decision did not carry a human-readable rationale"
  },
  {
    policyId: "policy.qualification.no-protected-class-criteria",
    signal: "usesProtectedClassCriteria",
    violatingValue: true,
    violationHint: "Uses a protected-class attribute as a criterion",
    reason: "Qualification used a protected-class attribute as a criterion"
  },
  {
    policyId: "policy.assessment.validated-instrument-only",
    signal: "administersValidatedInstrumentOnly",
    violatingValue: false,
    violationHint: "Administers an instrument outside the validated allow-list",
    reason:
      "Attempted to administer/score an instrument outside the validated allow-list (MRS, Greene, PHQ-9, ISI)"
  },
  {
    policyId: "policy.sdoh.validated-screener-only",
    signal: "usesValidatedSdohScreener",
    violatingValue: false,
    violationHint: "Administers an SDOH screener outside the validated allow-list",
    reason:
      "Attempted to administer/score an SDOH/HRSN screener outside the validated allow-list (the CMS AHC-HRSN core-domain screening tool)"
  },
  {
    policyId: "policy.sdoh.consent-before-referral",
    signal: "sdohReferralHasConsent",
    violatingValue: false,
    violationHint: "Drafts a community referral without the patient's consent",
    reason:
      "Attempted to draft a community-resource referral without the patient's explicit consent; a community referral requires patient consent and is never an autonomous enrollment — the agent may only draft a consent-gated referral for human action"
  },
  {
    policyId: "policy.benefits.eligibility-source-integrity",
    signal: "eligibilityTracesToSource",
    violatingValue: false,
    violationHint: "Coverage result doesn't trace to a payer/clearinghouse EBV response",
    reason:
      "Returned coverage/eligibility result did not trace to a payer/clearinghouse EBV response (no source provenance); the agent may not fabricate coverage without a source"
  },
  {
    policyId: "policy.scheduling.no-double-book",
    signal: "requestedSlotIsFree",
    violatingValue: false,
    violationHint: "Requested appointment slot is already taken",
    reason:
      "Requested appointment slot is already taken; the scheduler will not double-book an already-booked slot"
  },
  {
    policyId: "policy.scheduling.honor-provider-availability",
    signal: "slotWithinProviderAvailability",
    violatingValue: false,
    violationHint: "Slot falls outside the provider's published availability",
    reason:
      "Requested appointment slot falls outside the provider's published availability; the scheduler only books published slots"
  },
  {
    policyId: "policy.caregap.clinical-measure-sourced",
    signal: "gapsTraceToClinicalMeasure",
    violatingValue: false,
    violationHint: "A care gap doesn't derive from a defined clinical measure",
    reason:
      "A care gap acted on did not derive from a defined clinical measure (an off-catalog / fabricated gap); every care gap must trace to a defined clinical measure"
  },
  {
    policyId: "policy.careplan.template-sourced",
    signal: "planTracesToTemplate",
    violatingValue: false,
    violationHint: "An instantiated care plan doesn't derive from a defined template",
    reason:
      "The instantiated care plan did not derive from a defined CarePlanTemplate (an off-catalog / fabricated plan); every care plan must trace to a defined template"
  },
  {
    policyId: "policy.clinical-summary.source-record-sourced",
    signal: "summaryTracesToSourceRecords",
    violatingValue: false,
    violationHint: "A summary asserts a fact/record absent from the assembled context",
    reason:
      "The after-visit summary / clinician handoff did not trace to the source records the context was assembled from (a fabricated / off-context assertion, or none at all); every summary must trace to a defined source record and may not fabricate a clinical fact"
  },
  {
    policyId: "policy.education.evidence-sourced",
    signal: "educationTracesToEvidenceSource",
    violatingValue: false,
    violationHint: "An education module doesn't derive from a defined evidence source",
    reason:
      "The education/coaching content did not trace to a defined evidence-sourced education module (an off-catalog / fabricated topic); every education module must trace to a defined evidence source"
  },
  {
    policyId: "policy.education.no-medical-advice",
    signal: "staysWithinEducationScope",
    violatingValue: false,
    violationHint: "Strays into diagnosis, medication dosing, or individualized medical advice",
    reason:
      "The coaching content strayed beyond general education into diagnosis, medication dosing, or individualized medical advice; the agent may only deliver general, evidence-sourced education and lifestyle coaching"
  },
  {
    policyId: "policy.education.consent-before-outreach",
    signal: "coachingOutreachHasConsent",
    violatingValue: false,
    violationHint: "Pushes coaching outreach without the patient's consent",
    reason:
      "Attempted a coaching outreach push without the patient's consent; any coaching push is consent-gated and human-approval-gated — the agent may only draft consent-gated coaching for human review"
  },
  {
    policyId: "policy.medication.no-autonomous-refill",
    signal: "refillRequiresHumanApproval",
    violatingValue: false,
    violationHint: "Submits/orders a refill without human approval",
    reason:
      "Attempted to autonomously submit/order a medication refill without human approval; the agent may only draft a nudge — a refill requires a human-in-the-loop"
  },
  {
    policyId: "policy.rpm.reading-source-integrity",
    signal: "readingsTraceToSource",
    violatingValue: false,
    violationHint: "A monitoring reading doesn't trace to a device/self-report source",
    reason:
      "A longitudinal monitoring reading did not trace to a device/self-report source (a fabricated / off-source reading, or an off-catalog metric); every reading must trace to a recognized source and a defined monitored metric — the agent may not act on fabricated readings"
  },
  {
    policyId: "policy.rpm.no-autonomous-escalation",
    signal: "escalationRoutedToHuman",
    violatingValue: false,
    violationHint: "Acts on a trend autonomously instead of routing to a clinician",
    reason:
      "Attempted to act on a worsening / red-flag trend autonomously; every escalation must be routed to a human clinician for review (routedTo:'clinician-review') — the agent may never take an autonomous clinical action (auto-ordering, auto-medication, auto-titration)"
  },
  {
    policyId: "policy.rpm.consent-to-monitor",
    signal: "monitoringHasConsent",
    violatingValue: false,
    violationHint: "Monitors / reaches out without the patient's monitoring consent",
    reason:
      "Attempted longitudinal monitoring / trend outreach without the patient's consent to be monitored; remote monitoring is consent-gated — the agent may only monitor a patient who has consented"
  },
  {
    policyId: "policy.pophealth.transparent-risk-model",
    signal: "riskScoreTracesToFactors",
    violatingValue: false,
    violationHint: "A patient's risk tier doesn't trace to the documented risk-factor spec",
    reason:
      "A patient's risk tier did not trace to the documented risk-factor spec (an opaque / off-spec / black-box score, or a tier that doesn't follow from the factors); every patient's tier must be explainable by citing the defined risk factors — the agent may not stratify on an opaque score"
  },
  {
    policyId: "policy.pophealth.no-protected-class-factors",
    signal: "excludesProtectedAttributes",
    violatingValue: false,
    violationHint: "The risk model uses a protected-class attribute as a scoring factor",
    reason:
      "The risk model used a protected-class attribute (race, ethnicity, gender identity, religion, national origin, disability status, sexual orientation, marital status) as a scoring factor; the risk model may score only on permitted clinical / care-management factors — a fairness / responsible-AI requirement"
  },
  {
    policyId: "policy.pophealth.no-autonomous-care-decision",
    signal: "tierReviewedByHuman",
    violatingValue: false,
    violationHint: "A risk tier triggers an autonomous care action instead of human review",
    reason:
      "A risk tier triggered an autonomous care action instead of being routed for human / care-manager review; a risk tier is a prioritization signal only — every tier→action requires human review (routedTo:'care-manager-review'), the agent may never take an autonomous care decision"
  },
  {
    policyId: "policy.consent.recorded-source",
    signal: "consentTracesToRecord",
    violatingValue: false,
    violationHint: "A consent state doesn't trace to a recorded consent event/basis",
    reason:
      "A consent state did not trace to a recorded consent event/basis (an asserted-but-unrecorded consent, an off-catalog scope, an unrecognized status, or a missing recorded source); every consent state must trace to a recorded event with a source — the authoritative consent ledger may not hold asserted, unrecorded consent"
  },
  {
    policyId: "policy.consent.honor-revocation",
    signal: "honorsRevocation",
    violatingValue: false,
    violationHint: "A decision ALLOWS outreach against a revoked / expired consent",
    reason:
      "A consent decision would ALLOW outreach / data-use against a scope whose consent is revoked or expired; a revocation (or expiry) must be honored immediately — the service may never allow a decision against a revoked / expired consent"
  },
  {
    policyId: "policy.consent.no-scope-override",
    signal: "respectsConsentScope",
    violatingValue: false,
    violationHint: "A decision overrides a withheld scope or a scope never granted",
    reason:
      "A consent decision would ALLOW against a scope the patient withheld, or a scope the patient never granted (no record); a decision may not override a withheld scope or borrow consent across scopes — an allow requires a granted, current consent record for that exact scope"
  },
  {
    policyId: "policy.trials.eligibility-criteria-sourced",
    signal: "eligibilityTracesToCriteria",
    violatingValue: false,
    violationHint: "An eligibility determination doesn't trace to a defined study criterion",
    reason:
      "A trial-eligibility determination did not trace to the study catalog's defined criteria (a fabricated / ad-hoc / off-catalog eligibility); every eligibility determination must trace to a defined criterion — the agent may not invent eligibility"
  },
  {
    policyId: "policy.trials.research-consent-required",
    signal: "researchConsentPresent",
    violatingValue: false,
    violationHint: "Drafts trial outreach / enrollment without the patient's research consent",
    reason:
      "Attempted a trial outreach / enrollment step without the patient's research consent; trial outreach is research-consent-gated — the agent may only draft an active outreach when the patient's research consent is present (it defers to the `research` consent scope), otherwise it withholds outreach"
  },
  {
    policyId: "policy.trials.no-autonomous-enrollment",
    signal: "enrollmentRequiresHuman",
    violatingValue: false,
    violationHint: "Enrolls a patient autonomously instead of requiring informed consent + a human",
    reason:
      "Attempted to enroll a patient in a study autonomously; the agent may NEVER enroll a patient on its own — enrollment requires informed consent AND a human (requiresHuman:true, enrolled:false), the agent only drafts a consent-gated invitation to consider"
  },
  {
    policyId: "policy.langaccess.qualified-interpreter-only",
    signal: "usesQualifiedInterpreter",
    violatingValue: false,
    violationHint: "Uses an untrained / ad-hoc / family interpreter for clinical communication",
    reason:
      "A clinical-interpretation plan would use an untrained / ad-hoc / family interpreter (or machine translation) for clinical communication or consent; clinical interpretation must use a QUALIFIED medical interpreter — when none is available the agent escalates to a human coordinator, it never substitutes an unqualified option"
  },
  {
    policyId: "policy.langaccess.translated-material-source-integrity",
    signal: "materialsTraceToApprovedSource",
    violatingValue: false,
    violationHint: "An in-language material doesn't trace to the approved translated-materials catalog",
    reason:
      "An in-language patient material presented as official did not trace to the approved translated-materials catalog (an unverified / ad-hoc translation, or an off-catalog document); every in-language material must trace to an approved translated source — the agent may not present an ad-hoc translation as official"
  },
  {
    policyId: "policy.langaccess.no-machine-translation-for-consent",
    signal: "noMachineTranslationForConsent",
    violatingValue: false,
    violationHint: "Uses machine translation for clinical consent or clinical decision communication",
    reason:
      "A plan would use machine / auto translation for clinical consent or clinical decision communication; machine translation may never be used for clinical consent or clinical decision communication — those go through a qualified human interpreter or an approved translated document"
  },
  {
    policyId: "policy.hedis.measure-catalog-sourced",
    signal: "measuresTraceToCatalog",
    violatingValue: false,
    violationHint: "A HEDIS measure in the report is not on the defined measure catalog",
    reason:
      "A HEDIS quality measure in the panel report did not trace to the defined HEDIS measure catalog (an off-catalog / fabricated measure); every measure in a quality report must trace to a defined catalog entry — the agent may not score a fabricated measure"
  },
  {
    policyId: "policy.hedis.exclusion-integrity",
    signal: "exclusionsTraceToCatalog",
    violatingValue: false,
    violationHint: "An applied exclusion is not on the measure's catalog exclusion list",
    reason:
      "An applied denominator exclusion did not trace to a defined exclusion on the target measure's catalog spec (an ad-hoc / unlisted exclusion); every exclusion must be catalog-sourced — inflating a rate by shrinking the denominator with an unlisted exclusion is a HEDIS-integrity violation"
  },
  {
    policyId: "policy.hedis.no-autonomous-submission",
    signal: "submissionRequiresHumanApproval",
    violatingValue: false,
    violationHint: "Submits a HEDIS package without human quality-team approval",
    reason:
      "Attempted to submit a HEDIS quality-measure package without human quality-team approval; the agent may only assemble a human-approval-gated draft — a submission to a payer / CMS / quality registry requires a human quality team in the loop"
  },
  {
    policyId: "policy.acp.directive-source-integrity",
    signal: "directivesTraceToCatalog",
    violatingValue: false,
    violationHint: "A claimed advance directive doesn't trace to the directive catalog + an approved source + a recorded execution date",
    reason:
      "A claimed advance directive on file did not trace to the defined ACP directive catalog with an approved directive-source label and a recorded execution date (an off-catalog directive id, a verbal / ad-hoc source, or a missing execution date); every directive claimed on file must be catalog-sourced with a documented source — the agent may not fabricate a directive to inflate ACP completeness"
  },
  {
    policyId: "policy.acp.no-autonomous-directive-change",
    signal: "directiveChangeRequiresHumanSignoff",
    violatingValue: false,
    violationHint: "Applies an advance-directive change without clinician + patient sign-off",
    reason:
      "Attempted to autonomously create, update, or override an advance directive; a directive is a legal / clinical instrument — the agent may only draft a conversation prompt or a change proposal, and every directive change requires clinician AND patient sign-off (requiresClinicianAndPatientSignoff:true, applied:false)"
  },
  {
    policyId: "policy.acp.language-access-integrity",
    signal: "languageAccessSatisfied",
    violatingValue: false,
    violationHint: "Drafts an active ACP conversation for an LEP patient with no qualified-interpreter plan",
    reason:
      "Attempted to draft an active advance-care-planning conversation for a limited-English-proficiency (LEP) patient with no documented qualified-interpreter plan; an ACP conversation is legally consequential and must not be held in a language the patient cannot participate in — for an LEP patient the agent defers to the Language Access & Health Equity agent and WITHHOLDS the prompt (a safe completed answer) until a qualified-interpreter plan is documented"
  },
  {
    policyId: "policy.careteam.role-catalog-sourced",
    signal: "rolesTraceToCatalog",
    violatingValue: false,
    violationHint: "A care-team role isn't on the defined care-role catalog",
    reason:
      "A care-team role (on the roster or in the needed-roles set) did not trace to the defined care-role catalog (a fabricated discipline / role label); every team role must be catalog-sourced — the agent may not invent a role to pad a roster or claim coverage for a needed role that doesn't exist"
  },
  {
    policyId: "policy.careteam.no-autonomous-assignment",
    signal: "teamChangeRequiresCaseManager",
    violatingValue: false,
    violationHint: "Adds or removes a team member without case-manager approval",
    reason:
      "Attempted to autonomously add or remove a care-team member (or reassign the case manager) without the assigned case manager's approval; the agent may only draft a team-change proposal — every roster change requires case-manager sign-off (requiresCaseManagerApproval:true, applied:false)"
  },
  {
    policyId: "policy.careteam.pcp-required",
    signal: "teamIncludesPcp",
    violatingValue: false,
    violationHint: "The roster ships without an accountable PCP anchor",
    reason:
      "The assembled care team did not include a primary care physician (role.pcp) — the PCP is the continuity-of-care anchor every specialist coordinates around; a legitimate multi-disciplinary team must include an accountable PCP, and a roster without one is rejected before it can leave the fabric"
  },
  {
    policyId: "policy.toc.reconciliation-source-integrity",
    signal: "medicationsTraceToApprovedSource",
    violatingValue: false,
    violationHint: "A reconciliation medication doesn't cite an approved source",
    reason:
      "A medication on the transitions-of-care reconciliation (pre-admit or discharge) did not cite an approved medication source (an unapproved / verbal / ad-hoc / undocumented source); every med on the reconciliation must trace to an approved source — the agent may not let a fabricated medication slip into the reconciliation"
  },
  {
    policyId: "policy.toc.no-autonomous-medication-change",
    signal: "reconciliationChangeRequiresClinician",
    violatingValue: false,
    violationHint: "Commits a medication add / remove / dose-change without clinician sign-off",
    reason:
      "Attempted to autonomously commit a medication add / remove / dose-change on the transitions-of-care reconciliation; the agent may only draft reconciliation notes — every medication change requires clinician sign-off (requiresClinicianSignoff:true, applied:false)"
  },
  {
    policyId: "policy.toc.follow-up-scheduled-not-recommended",
    signal: "followUpScheduledNotRecommended",
    violatingValue: false,
    violationHint: "A follow-up is marked complete without a real scheduled slot",
    reason:
      "A transitions-of-care follow-up was marked scheduled/complete without a real slot (slotStart + providerRef); a follow-up must be a scheduled appointment, not a text recommendation — the safe interim answer is state:'awaiting-schedule' with a handoff to the Appointment Scheduling agent, but the agent may never claim a 'recommended' follow-up is complete"
  },
  {
    policyId: "policy.grievance.no-autonomous-resolution",
    signal: "caseResolutionRequiresHumanQueue",
    violatingValue: false,
    violationHint: "Resolves / approves / denies a grievance or appeal without human queue action",
    reason:
      "Attempted to autonomously resolve, approve, or deny a grievance / appeal case; the agent may only draft a case and route it to a human queue (member-services / clinical-review / compliance) — every resolution requires human queue action (requiresHumanQueueAction:true, applied:false), a denial-appeal decision in particular needs a clinician + compliance sign-off"
  },
  {
    policyId: "policy.grievance.deadline-integrity",
    signal: "deadlineTracesToCatalog",
    violatingValue: false,
    violationHint: "Case deadline doesn't trace to the case-type catalog + received date, or exceeds the regulatory maximum",
    reason:
      "A grievance / appeal case deadline did not trace to the case-type catalog + received date, or was silently extended past the regulatory maximum; every case must have a deadline within the catalog-defined window — silently extending a regulatory deadline past the maximum breaches Medicare Advantage Chapter 13 / state-insurance-code timelines"
  },
  {
    policyId: "policy.grievance.no-phi-in-routing-summary",
    signal: "routingSummaryIsPhiSafe",
    violatingValue: false,
    violationHint: "The routing summary passed to a downstream queue contains free-text PHI",
    reason:
      "The routing summary handed to the receiving human queue (member-services / clinical-review / compliance) contained free-text PHI (patient full name, DOB, address, MRN, diagnosis codes, medication names, symptom detail) or an extra free-text key; the routing summary must be STRUCTURED only (memberRef + caseType + urgency + queue + deadlineDate + phiSafe) so it can be delivered via lower-trust channels (Slack, email, ticketing) without leaking PHI"
  },
  {
    policyId: "policy.credentialing.source-integrity",
    signal: "credentialsTraceToVerifiedSource",
    violatingValue: false,
    violationHint: "A provider credential doesn't cite an approved verification source",
    reason:
      "A provider credential (state license / DEA / board certification / sanctions clearance / NPI) did not cite an approved verification source (state-medical-board, dea-registry, abms-board, oig-leie-sanctions, npi-registry) with a recorded verifiedOn date; every credential must trace to an approved source — the agent may not fabricate a 'verified' status from a verbal / self-reported / undocumented source"
  },
  {
    policyId: "policy.credentialing.no-referral-to-expired-or-sanctioned",
    signal: "noReferralToExpiredOrSanctioned",
    violatingValue: false,
    violationHint: "Refers / books to an expired / incomplete / sanctioned provider",
    reason:
      "Attempted to refer a patient to (or book an appointment with) a provider whose credentialing status is expired, incomplete, or sanctioned; the fabric may never hand a referral or scheduled appointment to a provider who is not currently credentialed and unsanctioned — this is where the ghost-network problem gets fixed at the network boundary"
  },
  {
    policyId: "policy.credentialing.no-surprises-act-directory-accuracy",
    signal: "directoryIsFresh",
    violatingValue: false,
    violationHint: "Directory record was last verified past the No-Surprises-Act freshness window",
    reason:
      "Returned a provider directory record as AUTHORITATIVE whose verifiedAsOf date is past the No-Surprises-Act 90-day accuracy window; stale directory data must not be returned as authoritative — the safe interim answer is to route the caller to a directory-refresh workflow"
  },
  {
    policyId: "policy.attribution.methodology-catalog-sourced",
    signal: "attributionsTraceToCatalog",
    violatingValue: false,
    violationHint: "An attribution's methodology or contract is off-catalog",
    reason:
      "An attribution's methodology or contract did not trace to the defined catalog (methodology.plurality-of-visits / methodology.pcp-of-record / methodology.prospective-medicare-advantage / methodology.contract-defined-window; contract.medicare-advantage-hedis-my2026 / contract.commercial-vbc-my2026); every attribution must trace to catalog-defined methodology + contract — the agent may not fabricate a bespoke attribution rule"
  },
  {
    policyId: "policy.attribution.no-conflicting-contract-terms",
    signal: "attributionsHonorContractTerms",
    violatingValue: false,
    violationHint: "An attribution keeps a patient the contract's terms explicitly exclude",
    reason:
      "An attribution asserted excludedByContract:false on a patient whose contract terms (age band, network status, or exclusion code) actually EXCLUDE them; every attribution must honor the contract's terms — an in-numerator attribution against explicit exclusions pollutes the contract's scorecard with patients the contract never covered"
  },
  {
    policyId: "policy.attribution.tie-break-documented",
    signal: "attributionTieBreaksAreDocumented",
    violatingValue: false,
    violationHint: "An attribution applied an undocumented / opaque tie-break rule",
    reason:
      "An attribution applied a tie-break rule outside the documented list (most-recent-visit-wins, provider-ref-lexical-ascending); every tie-break must be deterministic and documented — a coin-flip / opaque tie-break turns attribution into gameable non-determinism"
  },
  {
    policyId: "policy.ccm.eligibility-catalog-sourced",
    signal: "eligibilityTracesToCatalog",
    violatingValue: false,
    violationHint: "A CCM eligibility claim cites an off-catalog chronic condition",
    reason:
      "A CCM eligibility claim included a chronic condition outside the defined CHRONIC_CONDITION_CATALOG; every qualifying condition must trace to the catalog — the agent may not fabricate a chronic condition to reach the 2+ threshold"
  },
  {
    policyId: "policy.ccm.no-autonomous-billing",
    signal: "billingRequiresHumanApproval",
    violatingValue: false,
    violationHint: "Submits a CCM claim without human quality-team approval",
    reason:
      "Attempted to autonomously submit a Medicare CCM claim (CPT 99490 / 99491 / 99487 / 99489); the agent may only assemble a human-approval-gated billing package — CMS submission requires a human quality-team in the loop"
  },
  {
    policyId: "policy.ccm.time-integrity",
    signal: "timeEntriesAddUp",
    violatingValue: false,
    violationHint: "CCM time entries don't sum to the reported total, or a logged minute cites an off-catalog activity",
    reason:
      "A CCM time report failed integrity: either the per-activity entries did not sum to the reported total (phantom minutes — the classic CCM audit finding) or a logged minute cited an activity outside the defined CCM_ACTIVITY_CATALOG; every minute must trace to a catalog activity and the total must equal the sum of the entries"
  },
  {
    policyId: "policy.claims.edit-catalog-sourced",
    signal: "editsTraceToCatalog",
    violatingValue: false,
    violationHint: "An applied claim edit is not on the defined edit catalog",
    reason:
      "An applied claim edit did not trace to the defined CLAIM_EDIT_CATALOG (NCCI-PTP unbundling, LCD/NCD coverage, benefit-limit exhaustion, prior-auth missing, duplicate submission, out-of-network, timely-filing-window); every edit must be catalog-sourced — the agent may not fabricate a bespoke 'you owe us more' edit"
  },
  {
    policyId: "policy.claims.no-autonomous-denial",
    signal: "denialRequiresAdjudicatorCosign",
    violatingValue: false,
    violationHint: "Denies a claim without an adjudicator cosign",
    reason:
      "Attempted to autonomously finalize a claim denial (or bypass the adjudicator cosign gate); every denial must be DRAFTED for an adjudicator to cosign (requiresAdjudicatorCosign:true, cosigned:false) — a denial letter is legally consequential under CMS / ERISA / state insurance code and must have a human sign-off"
  },
  {
    policyId: "policy.claims.reason-code-integrity",
    signal: "decisionsCiteReasonCodes",
    violatingValue: false,
    violationHint: "A non-clean-pay decision doesn't cite a specific catalog reason code",
    reason:
      "A non-clean-pay claim decision (deny / pend) was returned without a specific catalog reason code, or with an off-catalog reason code; every non-clean-pay decision must cite a defined reason code from CLAIM_REASON_CODE_CATALOG — under Section 1557 / state insurance code / CMS, a denial notice must state the specific reason"
  },
  {
    policyId: "policy.formulary.catalog-sourced",
    signal: "rulesTraceToCatalog",
    violatingValue: false,
    violationHint: "A formulary drug or rule isn't on the defined catalog",
    reason:
      "A formulary review cited a drug outside FORMULARY_DRUG_CATALOG or a rule outside FORMULARY_RULE_CATALOG / off-catalog reason code; every proposed drug + applied rule + reason code must trace to the catalog — the agent may not fabricate a 'we-just-said-no' rule or claim a drug is on formulary when it isn't"
  },
  {
    policyId: "policy.formulary.step-therapy-honored",
    signal: "stepTherapyIsHonored",
    violatingValue: false,
    violationHint: "Step therapy is required but no documented prior-therapy trial is on file",
    reason:
      "The plan requires step therapy (a documented trial of a preferred agent) before the proposed drug, and no documented prior-therapy trial is on file (only self-reported / undocumented trials); step therapy must be honored — skipping it or approving on claimed-but-undocumented history is a common audit finding and payer-compliance failure"
  },
  {
    policyId: "policy.formulary.no-autonomous-override",
    signal: "exceptionRequiresClinicianCosign",
    violatingValue: false,
    violationHint: "Overrides a formulary exception without clinician cosign",
    reason:
      "Attempted to autonomously override a formulary exception, non-preferred drug, or manual tier-lower; a formulary exception is legally consequential (Medicare Advantage Chapter 6 + Part D requires a documented rationale from a prescriber) — every non-preferred decision must be DRAFTED for clinician cosign (requiresClinicianCosign:true, cosigned:false)"
  },
  {
    policyId: "policy.fwa.pattern-catalog-sourced",
    signal: "patternsTraceToCatalog",
    violatingValue: false,
    violationHint: "An FWA flag cites a pattern not on the defined catalog",
    reason:
      "An FWA flag was raised citing a pattern outside FWA_PATTERNS (unbundling, upcoding, duplicate-billing, quantity-outlier, impossible-day-billing, phantom-service); every flag must trace to a catalog pattern — the agent may not raise a category-of-one 'we just don't like this provider' flag masquerading as a rule"
  },
  {
    policyId: "policy.fwa.no-autonomous-denial",
    signal: "reportRequiresSiuReview",
    violatingValue: false,
    violationHint: "Denies a claim, opens an investigation, or freezes payment without SIU review",
    reason:
      "The FWA agent attempted to autonomously deny a claim, open an investigation, or freeze payment; suspected fraud is a serious allegation and requires SIU (Special Investigations Unit) human review — every report must be requiresSiuReview:true (when flagged) with investigationOpened:false / paymentFrozen:false. Denying a claim on unproven suspicion is a discrimination / due-process failure under Section 1557 / state insurance code"
  },
  {
    policyId: "policy.fwa.no-protected-class-factors",
    signal: "noProtectedClassFactors",
    violatingValue: false,
    violationHint: "The FWA engine uses a protected-class attribute as a detection factor",
    reason:
      "The FWA engine used a protected-class attribute (race, ethnicity, gender identity, religion, national origin, disability status, sexual orientation, marital status) or a provider-demographic proxy (provider race/ethnicity, clinic-neighborhood race composition) as a detection factor; bias in FWA is a well-documented compliance failure (algorithmic-audit reports of payer systems disproportionately targeting minority-owned clinics) — the engine may only score on catalog-defined patterns and non-protected peer-baseline metrics"
  },
  {
    policyId: "policy.trial-payments.schedule-catalog-sourced",
    signal: "paymentsTraceToCatalog",
    violatingValue: false,
    violationHint: "A trial payment cites an off-catalog trial / visit type / rule",
    reason:
      "A trial payment cited a trial outside TRIAL_PAYMENT_SCHEDULES, a visit type outside TRIAL_VISIT_TYPES, or an applied rule outside TRIAL_PAYMENT_RULES — every payment must trace to the IRB-approved catalog; the agent may not issue an ad-hoc 'we-decided-to-pay-more-because' payment"
  },
  {
    policyId: "policy.trial-payments.no-autonomous-irb-deviation",
    signal: "deviationRequiresCoordinatorCosign",
    violatingValue: false,
    violationHint: "Approves a non-schedule payment without study-coordinator cosign",
    reason:
      "Attempted to autonomously approve a non-standard payment (missed visit, out-of-range travel, extra procedure) without study-coordinator cosign; deviations from the IRB-approved schedule require human review — every non-schedule-approved decision must be requiresCoordinatorCosign:true / cosigned:false. An autonomous IRB deviation is a research-ethics failure that could invalidate the study"
  },
  {
    policyId: "policy.trial-payments.participant-consented",
    signal: "paymentHasParticipantConsent",
    violatingValue: false,
    violationHint: "Payment issued to a participant without research-payment consent",
    reason:
      "A payment was approved to a participant whose research-payment informed consent is not on file (or has been withdrawn); this is a Common Rule / 45 CFR 46 violation — payments to non-consented participants are a serious research-ethics violation. The safe answer when consent is missing is decision:'blocked-no-consent' with zero payment"
  },
  {
    policyId: "policy.ur.criteria-catalog-sourced",
    signal: "criteriaTraceToCatalog",
    violatingValue: false,
    violationHint: "A UR criterion / rule / reason code is off-catalog",
    reason:
      "A utilization-review decision cited a service outside UR_SERVICE_TYPES, a criterion outside the service's catalog criteria set, an applied rule outside UR_RULES, or a reason code outside UR_REASON_CODES — every applied criterion + rule + reason must trace to the medical-necessity catalog (MCG-analog / InterQual-analog); the agent may not invent a 'we-just-decided-you-don't-need-it' criterion"
  },
  {
    policyId: "policy.ur.no-autonomous-denial",
    signal: "denialRequiresClinicianCosign",
    violatingValue: false,
    violationHint: "Approves a denial-shaped UR decision without clinician cosign",
    reason:
      "Attempted to autonomously finalize a non-approved UR decision (pend-for-clinical-review, require-peer-to-peer) without clinician cosign; every non-approved decision must be requiresClinicianCosign:true / cosigned:false — a UR denial letter is legally consequential under Medicare Advantage / state utilization-review-agent codes with notice + due-process rights, and denying medical necessity on the agent's own authority is a Section 1557 / state-code violation"
  },
  {
    policyId: "policy.ur.sla-integrity",
    signal: "slaTracesToCatalog",
    violatingValue: false,
    violationHint: "SLA deadline doesn't trace to urgency catalog + received date, or was silently extended",
    reason:
      "A UR case SLA deadline did not trace to the catalog urgency window (standard 72h, urgent 24h, concurrent-review 24h) applied against the received asOfDate, or was silently extended past the regulatory maximum; every UR case deadline must trace to catalog + received date — silently extending a UR deadline breaches Medicare Advantage Chapter 4 / state UR-agent timelines, mirroring the Grievance & Appeals agent's deadline-integrity guard"
  },
  {
    policyId: "policy.contracting.contract-type-catalog-sourced",
    signal: "contractsTraceToCatalog",
    violatingValue: false,
    violationHint: "A contract cites an off-catalog contract type / methodology / rule / reason code",
    reason:
      "A provider-contracting decision cited a contract type outside CONTRACT_TYPES, a methodology outside BENCHMARK_METHODOLOGIES, an applied rule outside CONTRACTING_RULES, or a reason code outside CONTRACTING_REASON_CODES — every classified contract must trace to the catalog; a bespoke / off-catalog payment model would pollute every downstream benchmarking calculation"
  },
  {
    policyId: "policy.contracting.no-autonomous-term-change",
    signal: "contractChangeRequiresOwnerCosign",
    violatingValue: false,
    violationHint: "Commits a contract-term change without account-owner cosign",
    reason:
      "Attempted to autonomously commit a contract-term change (rate, quality-gate threshold, benchmark formula, network status) without account-owner cosign; every draft-term-change decision must be requiresAccountOwnerCosign:true / cosigned:false — a contract-term change is legally consequential under state insurance code + provider-contract law + CMS Medicare Advantage and requires a human account owner sign-off. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the UR Agent's no-autonomous-denial, the Formulary Agent's no-autonomous-override, and the Account Management Agent's human-owner-before-contract-change posture"
  },
  {
    policyId: "policy.contracting.benchmark-methodology-catalog-sourced",
    signal: "benchmarksTraceToMethodology",
    violatingValue: false,
    violationHint: "Quality-gate threshold or spend-drift tolerance doesn't trace to the methodology catalog",
    reason:
      "A provider contract's quality-gate threshold or spend-drift tolerance did not trace to the defined BENCHMARK_METHODOLOGIES catalog for the cited methodology id; every VBC contract must derive its quality gate + spend-drift tolerance from a catalog methodology — a bespoke / opaque / 'we-picked-a-number' benchmark polluts every downstream shared-savings / bonus / clawback calculation"
  },
  {
    policyId: "policy.handoff.sbar-completeness",
    signal: "sbarIsComplete",
    violatingValue: false,
    violationHint: "Handoff-accepted decision claimed with missing SBAR sections",
    reason:
      "A cross-setting handoff was marked handoff-accepted without a complete SBAR (situation, background, assessment, recommendation) — this violates Joint Commission National Patient Safety Goal 2 for standardized handoff communication; every accepted handoff must have all four SBAR sections populated, and the safe answer when incomplete is decision:'pend-sbar-incomplete' routed to sending-clinician-completion"
  },
  {
    policyId: "policy.handoff.receiving-clinician-credentialed",
    signal: "receivingClinicianIsCredentialed",
    violatingValue: false,
    violationHint: "Handoff routed to an expired / incomplete / sanctioned receiving clinician",
    reason:
      "A cross-setting handoff was marked handoff-accepted to a receiving clinician whose credentialing status is expired, incomplete, or sanctioned — this is a variant of the ghost-network problem and a Section 1557 / due-process failure. Mirrors the Provider Credentialing Agent's no-referral-to-expired-or-sanctioned posture; the safe answer is decision:'blocked-clinician-not-credentialed' routed to credentialing-remediation"
  },
  {
    policyId: "policy.handoff.consent-on-file",
    signal: "handoffHasConsent",
    violatingValue: false,
    violationHint: "Handoff on a consent-required transition without transfer consent on file",
    reason:
      "A cross-setting handoff on a transition type that requires patient consent (hospital→SNF, SNF→home, home→hospice, PCP→behavioral-health) was marked handoff-accepted without documented transfer consent — this is a HIPAA disclosure failure (sharing clinical information with the receiving setting requires the patient's consent). The safe answer when consent is missing is decision:'blocked-no-consent' routed to consent-capture"
  },
  {
    policyId: "policy.adverse-event.event-catalog-sourced",
    signal: "eventsTraceToCatalog",
    violatingValue: false,
    violationHint: "Adverse-event decision cites an off-catalog event type / seriousness / rule / reason",
    reason:
      "An adverse-event decision cited an event type outside ADVERSE_EVENT_TYPES, a seriousness tier outside SERIOUSNESS_TIERS, an applied rule outside ADVERSE_EVENT_RULES, or a reason code outside ADVERSE_EVENT_REASON_CODES — every event must trace to the catalog; a bespoke event type or made-up severity level would poison the pharmacovigilance signal and doesn't map to an FDA channel (MedWatch 3500 / 3500A / VAERS)"
  },
  {
    policyId: "policy.adverse-event.no-autonomous-submission",
    signal: "submissionRequiresRegulatoryTeamCosign",
    violatingValue: false,
    violationHint: "Submits a MedWatch / VAERS report without regulatory-team cosign",
    reason:
      "Attempted to autonomously submit a MedWatch (3500 / 3500A) or VAERS report to the FDA without regulatory-team cosign; every draft decision must be requiresRegulatoryTeamCosign:true / cosigned:false — FDA submissions are legally consequential under 21 CFR 314.80 (mandatory reporting) with sponsor / manufacturer / clinician liability. Mirrors the Claims Adjudication Agent's no-autonomous-denial, the UR Agent's no-autonomous-denial, the Trial Payments Agent's no-autonomous-irb-deviation, and the HEDIS Agent's no-autonomous-submission posture"
  },
  {
    policyId: "policy.adverse-event.reporter-verified",
    signal: "reporterIdentityVerified",
    violatingValue: false,
    violationHint: "Adverse-event submission drafted with an unverified / anonymous reporter",
    reason:
      "An adverse-event submission was drafted for an FDA report without an attested, identifiable reporter (name / credentials / contact); an anonymous or unverified reporter is not admissible under FDA reporting requirements and poisons the surveillance signal. The safe answer when reporter identity is not attested is decision:'blocked-reporter-unverified' routed to blocked-hold"
  },
  {
    policyId: "policy.referral.clinician-cosign",
    signal: "referralHasClinicianCosign",
    violatingValue: false,
    violationHint: "Sends an outbound referral without a clinician sign-off",
    reason:
      "Attempted to send an outbound referral without a clinician sign-off; an outbound referral requires a clinician cosign before it is sent — the agent may only draft a cosign-gated referral, and a clinician signs and sends it"
  },
  {
    policyId: "policy.billing.claim-data-sourced",
    signal: "billingTracesToClaim",
    violatingValue: false,
    violationHint: "Billing/claim answer doesn't trace to a claim/EOB record",
    reason:
      "Returned billing/claim answer did not trace to a synthetic claim/EOB record (no cited claim); the agent may not fabricate claim data — a billing answer must derive from a claim record"
  },
  {
    policyId: "policy.pa.no-autonomous-submission",
    signal: "paHasClinicianApproval",
    violatingValue: false,
    violationHint: "Submits a PA without clinician approval",
    reason:
      "Attempted to submit a prior authorization without a clinician's approval; the agent may only assemble a clinician-gated draft — a PA submission requires a human-in-the-loop clinician approval"
  },
  {
    policyId: "policy.pa.documentation-integrity",
    signal: "paDocumentationComplete",
    violatingValue: false,
    violationHint: "Submits a PA missing required supporting documentation",
    reason:
      "Attempted to submit a prior authorization missing required supporting documentation; a PA submission must include the required supporting documentation"
  },
  {
    policyId: "policy.marketing.consent-to-contact-required",
    signal: "hasContactConsent",
    violatingValue: false,
    violationHint: "Contacts a target without an active consent",
    reason: "Target lacks an active contact consent in the Data 360 consent ledger"
  },
  {
    policyId: "policy.marketing.human-approval-before-send",
    signal: "autonomousSend",
    violatingValue: true,
    violationHint: "Sends a message without human approval",
    reason: "Attempted to send a prospect/patient message without human approval"
  },
  {
    policyId: "policy.engagement.quiet-hours-and-channel-preference",
    signal: "respectsQuietHoursAndChannel",
    violatingValue: false,
    violationHint: "Touches outside quiet-hours / unpreferred channel",
    reason:
      "Engagement touch fell outside quiet-hours or used a channel the patient didn't opt into"
  },
  {
    policyId: "policy.lead.explicit-optin-and-source-required",
    signal: "hasLeadOptInAndSource",
    violatingValue: false,
    violationHint: "Lead lacks an explicit opt-in and/or source",
    reason:
      "Inbound lead lacked an explicit opt-in and/or a recorded acquisition source"
  },
  {
    policyId: "policy.lead.identity-resolution-before-create",
    signal: "identityResolved",
    violatingValue: false,
    violationHint: "Creates a lead before identity resolution",
    reason:
      "Inbound lead was not resolved against Data 360 Identity Resolution before creation"
  },
  {
    policyId: "policy.commercial.no-phi-in-commercial-plane",
    signal: "accessesPhi",
    violatingValue: true,
    violationHint: "Commercial agent reads patient PHI",
    reason: "Commercial-plane agent attempted to read patient PHI"
  },
  {
    policyId: "policy.commercial.forecast-integrity",
    signal: "forecastSourcedFromCrm",
    violatingValue: false,
    violationHint: "Forecast not sourced from CRM records",
    reason: "Forecast figures were not sourced from CRM opportunity records"
  },
  {
    policyId: "policy.commercial.human-owner-before-contract-change",
    signal: "commitsContractChangeWithoutHumanOwner",
    violatingValue: true,
    violationHint: "Changes a contract without a human owner",
    reason: "Attempted a contract/pricing change without a human account owner"
  }
];
