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
