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
  // Master patient index / identity resolution (transparent matching + no autonomous merge + no protected-class matching)
  matchTracesToFeatures?: boolean;
  mergeRequiresHumanReview?: boolean;
  excludesProtectedAttributesInMatching?: boolean;
  // Break-the-glass / emergency access governance (justification-required + minimum-necessary-time-boxed + mandatory-audit-review)
  accessHasJustification?: boolean;
  accessIsMinimumNecessaryTimeBoxed?: boolean;
  accessLoggedForReview?: boolean;
  // Data retention & records lifecycle management (legal-hold-overrides-purge + schedule-sourced + no-autonomous-purge)
  retentionRespectsLegalHold?: boolean;
  retentionRuleCited?: boolean;
  purgeHumanApproved?: boolean;
  // Coordination of benefits (custody-decree-overrides-birthday + order-of-benefits-rule-sourced + no-autonomous-adjudication)
  cobDecreeHonored?: boolean;
  cobRuleCited?: boolean;
  cobHumanCosigned?: boolean;
  // Claims overpayment & recovery (within-lookback-window + reason-catalog-sourced + no-autonomous-clawback)
  recoveryWithinLookback?: boolean;
  recoveryReasonCited?: boolean;
  recoveryClawbackHumanReviewed?: boolean;
  // Patient financial assistance & charity care (no-eca-before-screening + fap-schedule-sourced + no-autonomous-denial)
  ecaGatedOnScreening?: boolean;
  finAssistScheduleCited?: boolean;
  finAssistHumanReviewed?: boolean;
  // Lab result & critical-value notification (critical-value-notified + reference-range-sourced + no-autonomous-clinical-action)
  labCriticalValueNotified?: boolean;
  labRangeCited?: boolean;
  labClinicianReviewed?: boolean;
  // Good faith estimate (charge-master-sourced + expected-items-complete + estimate-not-binding)
  gfeChargeMasterSourced?: boolean;
  gfeExpectedItemsComplete?: boolean;
  gfeEstimateNotBinding?: boolean;
  // Balance billing protection (protection-basis-sourced + cost-share-in-network-basis + no-autonomous-balance-bill)
  balanceBillBasisCited?: boolean;
  balanceBillCostShareInNetwork?: boolean;
  balanceBillProhibitionHonored?: boolean;
  // De-identification & Safe Harbor (all-categories-screened + method-cited + no-release-of-reidentifiable)
  deidAllCategoriesScreened?: boolean;
  deidMethodCited?: boolean;
  deidNoReleaseOfReidentifiable?: boolean;
  // Immunization forecasting (schedule-sourced + contraindication-honored + no-autonomous-administration)
  immunizationScheduleCited?: boolean;
  immunizationContraindicationHonored?: boolean;
  immunizationNoAutonomousAdministration?: boolean;
  // Minimum Necessary (purpose-of-use-sourced + minimum-necessary-scoped + no-autonomous-over-disclosure)
  minNecPurposeSourced?: boolean;
  minNecScoped?: boolean;
  minNecNoAutonomousOverDisclosure?: boolean;
  // Audit Log Integrity (hash-chain-verified + sequence-complete + no-autonomous-redaction)
  auditLogHashChainVerified?: boolean;
  auditLogSequenceComplete?: boolean;
  auditLogNoAutonomousRedaction?: boolean;
  // Timely Filing (filing-limit-sourced + deadline-computed + no-autonomous-write-off)
  timelyFilingRuleSourced?: boolean;
  timelyFilingDeadlineComputed?: boolean;
  timelyFilingNoAutonomousWriteOff?: boolean;
  // Controlled Substance / PDMP (guideline-sourced + mme-computed + no-autonomous-prescribing-decision)
  controlledSubstanceGuidelineSourced?: boolean;
  controlledSubstanceMmeComputed?: boolean;
  controlledSubstanceNoAutonomousDecision?: boolean;
  // Advance Beneficiary Notice / Medicare ABN (coverage-rule-sourced + abn-required-when-noncovered + no-autonomous-beneficiary-liability)
  abnCoverageRuleSourced?: boolean;
  abnRequiredWhenNoncovered?: boolean;
  abnNoAutonomousBeneficiaryLiability?: boolean;
  // Accounting of Disclosures / HIPAA §164.528 (purpose-category-sourced + accountable-disclosures-complete + no-autonomous-suppression)
  accountingPurposeSourced?: boolean;
  accountingDisclosuresComplete?: boolean;
  accountingNoAutonomousSuppression?: boolean;
  // Subrogation / Third-Party Liability (basis-sourced + recoverable-within-paid + no-autonomous-lien)
  subrogationBasisSourced?: boolean;
  subrogationRecoverableWithinPaid?: boolean;
  subrogationNoAutonomousLien?: boolean;
  // Deal Desk / Quote Approval (pricing-catalog-sourced + discount-math-consistent + no-autonomous-out-of-guardrail-approval)
  dealDeskCatalogSourced?: boolean;
  dealDeskMathConsistent?: boolean;
  dealDeskNoAutonomousApproval?: boolean;
  // Right of Access / HIPAA §164.524 (ground-sourced + deadline-computed + no-autonomous-denial-or-release)
  accessGroundSourced?: boolean;
  accessDeadlineComputed?: boolean;
  accessNoAutonomousDenialOrRelease?: boolean;
  // Member Cost-Share / EOB (benefit-design-sourced + math-consistent + no-autonomous-member-charge)
  costShareBenefitSourced?: boolean;
  costShareMathConsistent?: boolean;
  costShareNoAutonomousCharge?: boolean;
  // OIG Exclusion / Sanctions Screening (match-record-sourced + match-not-overstated + no-autonomous-block-or-clear)
  exclusionMatchSourced?: boolean;
  exclusionMatchNotOverstated?: boolean;
  exclusionNoAutonomousBlockOrClear?: boolean;
  // Amendment / Correction (HIPAA §164.526) (ground-sourced + deadline-computed + no-autonomous-write-or-denial)
  amendmentGroundSourced?: boolean;
  amendmentDeadlineComputed?: boolean;
  amendmentNoAutonomousWrite?: boolean;
  // Information Blocking (21st Century Cures Act / 45 CFR Part 171) (exception-sourced + determination-not-overstated + no-autonomous-block-or-release)
  blockingExceptionSourced?: boolean;
  blockingDeterminationNotOverstated?: boolean;
  blockingNoAutonomousBlockOrRelease?: boolean;
  // Drug–Drug Interaction (DDI) Safety Check (interaction-sourced + severity-consistent + no-autonomous-hold-or-override)
  ddiInteractionSourced?: boolean;
  ddiSeverityConsistent?: boolean;
  ddiNoAutonomousHoldOrOverride?: boolean;
  // Medical Loss Ratio (MLR) Rebate Calculation (inputs-sourced + allocation-consistent + no-autonomous-disbursement)
  mlrInputsSourced?: boolean;
  mlrAllocationConsistent?: boolean;
  mlrNoAutonomousDisbursement?: boolean;
  // Eligibility & Enrollment (834) Reconciliation (reconciliation-complete + actions-sourced + no-autonomous-change)
  reconciliationComplete?: boolean;
  reconciliationActionsSourced?: boolean;
  reconciliationNoAutonomousChange?: boolean;
  // Care Pathway Sequencing (steps-sourced + sequence-valid + no-autonomous-execution)
  pathwayStepsSourced?: boolean;
  pathwaySequenceValid?: boolean;
  pathwayNoAutonomousExecution?: boolean;
  // Creditable Coverage Continuity (segments-sourced + math-consistent + no-autonomous-determination)
  coverageSegmentsSourced?: boolean;
  coverageMathConsistent?: boolean;
  coverageNoAutonomousDetermination?: boolean;
  // Access Anomaly Detection (events-sourced + window-count-consistent + no-autonomous-action)
  accessEventsSourced?: boolean;
  accessWindowCountConsistent?: boolean;
  accessNoAutonomousAction?: boolean;
  // Caseload Balancing / Care-Manager Panel Assignment (assignment-complete + capacity-respected + no-autonomous-assignment)
  caseloadAssignmentComplete?: boolean;
  caseloadCapacityRespected?: boolean;
  caseloadNoAutonomousAssignment?: boolean;
  // Schedule Conflict / Double-Booking Guard (intervals-sourced + conflict-free + no-autonomous-booking)
  scheduleIntervalsSourced?: boolean;
  scheduleConflictFree?: boolean;
  scheduleNoAutonomousBooking?: boolean;
  // Medication Name Safety / LASA (candidates-sourced + distances-consistent + no-autonomous-substitution)
  lasaCandidatesSourced?: boolean;
  lasaDistancesConsistent?: boolean;
  lasaNoAutonomousSubstitution?: boolean;
  // Claim Lifecycle / Status-Transition Guard (states-sourced + transition-consistent + no-autonomous-advance)
  claimStatesSourced?: boolean;
  claimTransitionConsistent?: boolean;
  claimNoAutonomousAdvance?: boolean;
  // Provider Benchmarking / Percentile Rank (cohort-sourced + stats-consistent + no-autonomous-tiering)
  benchmarkCohortSourced?: boolean;
  benchmarkStatsConsistent?: boolean;
  benchmarkNoAutonomousTiering?: boolean;
  // Household / Family-Unit Composition (links-sourced + partition-consistent + no-autonomous-merge)
  householdLinksSourced?: boolean;
  householdPartitionConsistent?: boolean;
  householdNoAutonomousMerge?: boolean;
  // Provider Identifier (NPI) Validation (identifiers-sourced + checksum-consistent + no-autonomous-reject)
  identifiersSourced?: boolean;
  checksumConsistent?: boolean;
  identifierNoAutonomousReject?: boolean;
  // Network Adequacy / Time-and-Distance (providers-sourced + distances-consistent + no-autonomous-network-change)
  providersSourced?: boolean;
  distancesConsistent?: boolean;
  noAutonomousNetworkChange?: boolean;
  // PCP Assignment / Member–Provider Stable Matching (matching-sourced + matching-stable + no-autonomous-assignment)
  matchingSourced?: boolean;
  matchingStable?: boolean;
  pcpNoAutonomousAssignment?: boolean;
  // Reportable / Notifiable Condition Case Classification (facts-sourced + classification-consistent + no-autonomous-report)
  caseFactsSourced?: boolean;
  classificationConsistent?: boolean;
  noAutonomousReport?: boolean;
  // Clinical Event Timeline Merge / Multi-Source Record Reconciliation (events-sourced + merge-consistent + no-autonomous-merge)
  timelineEventsSourced?: boolean;
  timelineMergeConsistent?: boolean;
  timelineNoAutonomousMerge?: boolean;
  // Clinical Quality-Measure Shift Detection / Statistical Process Control (observations-sourced + cusum-consistent + no-autonomous-intervention)
  qualityObservationsSourced?: boolean;
  qualityCusumConsistent?: boolean;
  qualityNoAutonomousIntervention?: boolean;
  // Care-Management Capacity Allocation / Outreach Prioritization (selections-sourced + allocation-optimal + no-autonomous-schedule)
  outreachSelectionsSourced?: boolean;
  outreachAllocationOptimal?: boolean;
  outreachNoAutonomousSchedule?: boolean;
  // Commercial KPI Trend & Projection / Least-Squares Regression (series-sourced + fit-consistent + no-autonomous-commit)
  kpiSeriesSourced?: boolean;
  kpiFitConsistent?: boolean;
  kpiNoAutonomousCommit?: boolean;
  // Care-Transition Routing / Least-Burden Path / Dijkstra Weighted Shortest Path (path-sourced + route-optimal + no-autonomous-routing)
  routePathSourced?: boolean;
  routeOptimal?: boolean;
  routeNoAutonomousRouting?: boolean;
  // Source-of-Truth Consensus / Golden-Record Field Reconciliation / Boyer–Moore Majority Vote (votes-sourced + consensus-consistent + no-autonomous-write)
  consensusVotesSourced?: boolean;
  consensusConsistent?: boolean;
  consensusNoAutonomousWrite?: boolean;
  // Clinical Code Taxonomy / Longest-Prefix Classification / Trie Prefix Match (classifications-sourced + classification-consistent + no-autonomous-recode)
  codeClassificationsSourced?: boolean;
  codeClassificationConsistent?: boolean;
  codeNoAutonomousRecode?: boolean;
  // Resource-Block Scheduling / Max-Value Non-Overlapping Selection / Weighted Interval Scheduling DP (selection-sourced + schedule-optimal + no-autonomous-booking)
  blockScheduleSourced?: boolean;
  blockScheduleOptimal?: boolean;
  blockScheduleNoAutonomousBooking?: boolean;
  // Commercial Peak-Window / Maximum Contiguous Net-Gain Detection / Kadane's Maximum-Subarray (window-sourced + window-optimal + no-autonomous-action)
  peakWindowSourced?: boolean;
  peakWindowOptimal?: boolean;
  peakWindowNoAutonomousAction?: boolean;
  // SLA Worklist Sequencing / Earliest-Deadline-First (EDF) Scheduling (schedule-sourced + edf-ordered + no-autonomous-dispatch)
  worklistScheduleSourced?: boolean;
  worklistEdfOrdered?: boolean;
  worklistNoAutonomousDispatch?: boolean;
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
  // Data-sharing / TEFCA (purpose catalog + no autonomous non-TPO release + participant verified)
  purposesTraceToCatalog?: boolean;
  releaseHonorsNonTpoConsent?: boolean;
  participantIdentityVerified?: boolean;
  // Referral management (cosign-gated outbound referrals)
  referralHasClinicianCosign?: boolean;
  // Member service / billing (claim-sourced billing answers)
  billingTracesToClaim?: boolean;
  // Prior authorization (clinician-gated, documentation-complete PA assembly)
  paHasClinicianApproval?: boolean;
  paDocumentationComplete?: boolean;
  // Risk adjustment & HCC coding (evidence-supported coding + clinician-validation + no autonomous submission)
  codesTraceToClinicalEvidence?: boolean;
  codingRequiresClinicianValidation?: boolean;
  noAutonomousCodeSubmission?: boolean;
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
    policyId: "policy.mpi.transparent-matching",
    signal: "matchTracesToFeatures",
    violatingValue: false,
    violationHint: "A match decision doesn't trace to the defined match-feature spec",
    reason:
      "A match decision did not trace to the defined match-feature spec (an opaque / off-spec / black-box match, an off-catalog feature, a score that doesn't sum from its matched features, or a classification that doesn't follow from the thresholds); every match decision must be explainable by citing the defined match features — the agent may not resolve identity on an opaque score"
  },
  {
    policyId: "policy.mpi.no-autonomous-merge",
    signal: "mergeRequiresHumanReview",
    violatingValue: false,
    violationHint: "Merges a pair below the auto-match threshold without human steward review",
    reason:
      "A merge / link below the auto-match threshold was performed autonomously (requiresHumanReview:false); a merge below the auto threshold must NOT be performed autonomously — it requires a human steward to review (there is never an 'auto-merged' state), and the agent may never autonomously merge a low-confidence pair"
  },
  {
    policyId: "policy.mpi.no-protected-class-matching",
    signal: "excludesProtectedAttributesInMatching",
    violatingValue: false,
    violationHint: "The matching feature set uses a protected-class attribute",
    reason:
      "The matching feature set used a protected-class attribute (race, ethnicity, religion, national origin, gender identity, sexual orientation, disability status, marital status) as a matching feature; identity matching may use only permitted demographic / administrative identifiers — a fairness / responsible-AI requirement"
  },
  {
    policyId: "policy.btg.justification-required",
    signal: "accessHasJustification",
    violatingValue: false,
    violationHint: "Grants emergency access with no recorded clinical justification",
    reason:
      "An emergency break-the-glass access was granted with no recorded, non-empty clinical justification; emergency access may never be granted without a recorded justification — the agent may only grant access that carries a documented clinical reason"
  },
  {
    policyId: "policy.btg.minimum-necessary-time-boxed",
    signal: "accessIsMinimumNecessaryTimeBoxed",
    violatingValue: false,
    violationHint: "Grants standing / full-record / non-expiring emergency access",
    reason:
      "An emergency access grant was standing / full-record / non-expiring (an over-broad or full-chart scope, or a grant with no expiry); every grant must be scoped to a minimum-necessary field set AND time-boxed with a derived expiry — the agent may never grant standing / broad / full-record access"
  },
  {
    policyId: "policy.btg.mandatory-audit-review",
    signal: "accessLoggedForReview",
    violatingValue: false,
    violationHint: "Grants un-audited / un-reviewed emergency access",
    reason:
      "An emergency access grant was not logged with a mandatory audit event and/or not flagged for post-access review; every emergency access must emit a mandatory audit event AND be flagged for mandatory post-access review — there is no un-audited break-the-glass access"
  },
  {
    policyId: "policy.retention.legal-hold-overrides-purge",
    signal: "retentionRespectsLegalHold",
    violatingValue: false,
    violationHint: "Marks a record on active legal hold as eligible-for-purge",
    reason:
      "A records-disposition decision marked a record eligible-for-purge (or asserted a purge) while it was under an active legal hold; a legal hold ALWAYS overrides a purge — a held record must be `hold`, never eligible-for-purge, no matter how far past its retention expiry it is. Purging a record under legal hold is spoliation of evidence"
  },
  {
    policyId: "policy.retention.schedule-sourced",
    signal: "retentionRuleCited",
    violatingValue: false,
    violationHint: "A disposition doesn't cite a recorded retention rule",
    reason:
      "A records-disposition decision (retain / eligible-for-purge / hold) did not cite a recorded retention rule from the schedule catalog (an ad-hoc / un-sourced disposition, a missing or off-catalog rule id); every disposition must trace to a defined retention schedule — the agent may not dispose of a record on an ad-hoc, un-sourced rule"
  },
  {
    policyId: "policy.retention.no-autonomous-purge",
    signal: "purgeHumanApproved",
    violatingValue: false,
    violationHint: "Executes an autonomous / unapproved purge",
    reason:
      "A records-disposition decision asserted an autonomous / unapproved purge (an eligible-for-purge disposition not gated on human approval); a destructive purge may NEVER be executed autonomously — an eligible-for-purge is a RECOMMENDATION requiring human approval (requiresHumanApproval:true), and a purge only happens after a human approves it. Mirrors the Master Patient Index Agent's no-autonomous-merge and the Break-the-Glass Agent's minimum-necessary posture — the safe answer is enforced"
  },
  {
    policyId: "policy.cob.custody-decree-overrides-birthday",
    signal: "cobDecreeHonored",
    violatingValue: false,
    violationHint: "Ignores an active custody decree naming a dependent child's primary coverage",
    reason:
      "A coordination-of-benefits determination ignored an active custody / court decree that assigns primary responsibility for a dependent child's health coverage to a specific parent's plan (the birthday rule silently overrode the decree); a custody decree ALWAYS overrides the birthday rule — the decree-named plan must be primary. Mirrors the Data Retention Agent's legal-hold-overrides-purge posture — a legal instrument overrides the default rule, and the safe answer is enforced"
  },
  {
    policyId: "policy.cob.order-of-benefits-rule-sourced",
    signal: "cobRuleCited",
    violatingValue: false,
    violationHint: "An ordered coverage doesn't cite a recorded order-of-benefits rule",
    reason:
      "A coordination-of-benefits determination ordered a coverage without citing a recorded COB rule from the rule catalog (an ad-hoc / un-sourced ordering, a missing or off-catalog rule id); every ordering decision must trace to a defined order-of-benefits rule (custody-decree, Medicaid-payer-of-last-resort, Medicare-secondary-payer, subscriber-before-dependent, active-before-inactive, the birthday rule, or the longer-coverage tie-break) — the agent may not order coverages on an ad-hoc, un-sourced rule. Mirrors the Data Retention Agent's schedule-sourced and the Claims Adjudication Agent's edit-catalog-sourced posture"
  },
  {
    policyId: "policy.cob.no-autonomous-adjudication",
    signal: "cobHumanCosigned",
    violatingValue: false,
    violationHint: "A COB determination would autonomously adjudicate / pay a claim",
    reason:
      "A coordination-of-benefits determination was asserted to autonomously adjudicate, pay, or adjust a claim (requiresHumanCosign:false); a COB determination sets payer ORDER only — it is a RECOMMENDATION requiring human cosign before it drives a claim's payment, and the agent may NEVER autonomously adjudicate. Mirrors the Claims Adjudication Agent's no-autonomous-denial and the Utilization Review Agent's no-autonomous-denial posture — the safe answer is enforced"
  },
  {
    policyId: "policy.recovery.within-lookback-window",
    signal: "recoveryWithinLookback",
    violatingValue: false,
    violationHint: "Recovers an overpayment past its statutory lookback window",
    reason:
      "A claims-overpayment-recovery decision asserted a claim as recoverable while it was past its statutory lookback window (paid date + the reason's lookback days); an overpayment past its lookback window is NEVER recoverable — clawing back a payment beyond the statutory lookback is an unlawful recoupment under the ACA §6402 / CMS recovery rules / ERISA / state insurance code. Mirrors the Data Retention Agent's legal-hold-overrides-purge and the Utilization Review Agent's SLA-integrity posture — a window bounds the action"
  },
  {
    policyId: "policy.recovery.reason-catalog-sourced",
    signal: "recoveryReasonCited",
    violatingValue: false,
    violationHint: "A recovery doesn't cite a recorded recovery reason",
    reason:
      "A claims-overpayment-recovery decision did not cite a recorded recovery reason from the catalog (an ad-hoc / un-sourced clawback, a missing or off-catalog reason id); every recovery must trace to a defined recovery reason (duplicate-payment, cob-primary-elsewhere, retroactive-termination, pricing-error, services-not-rendered) — the agent may not recover an overpayment on an ad-hoc, un-sourced reason. Mirrors the Data Retention Agent's schedule-sourced and the Claims Adjudication Agent's edit-catalog-sourced posture"
  },
  {
    policyId: "policy.recovery.no-autonomous-clawback",
    signal: "recoveryClawbackHumanReviewed",
    violatingValue: false,
    violationHint: "Executes an autonomous / unreviewed clawback",
    reason:
      "A claims-overpayment-recovery decision asserted an autonomous / unreviewed clawback (a recoverable determination not gated on human review); a recovery may NEVER be executed autonomously — a recoverable overpayment is a RECOMMENDATION requiring human review with member/provider notice (requiresHumanReview:true), and an offset/clawback only happens after a human reviews it. Mirrors the Fraud, Waste & Abuse Agent's no-autonomous-denial and the Data Retention Agent's no-autonomous-purge posture — the safe answer is enforced"
  },
  {
    policyId: "policy.finassist.no-eca-before-screening",
    signal: "ecaGatedOnScreening",
    violatingValue: false,
    violationHint: "Runs a collection action before financial screening is complete",
    reason:
      "A patient-financial-assistance decision asserted an extraordinary collection action (ECA — collections, credit reporting, a lien) while financial-assistance screening was NOT complete; under IRS 501(r)(6) a hospital must make reasonable efforts to determine FAP (charity-care) eligibility BEFORE any ECA — a collection action may never precede screening. Mirrors the Data Retention Agent's legal-hold-overrides-purge and the Overpayment & Recovery Agent's within-lookback-window posture — a legal precondition bounds the action"
  },
  {
    policyId: "policy.finassist.fap-schedule-sourced",
    signal: "finAssistScheduleCited",
    violatingValue: false,
    violationHint: "An eligibility decision doesn't cite a recorded FAP tier",
    reason:
      "A patient-financial-assistance decision did not cite a recorded FAP tier from the schedule (an ad-hoc / un-sourced eligibility decision, a missing or off-catalog tier id); every charity-care determination must trace to a defined FAP tier (full-charity, partial-charity, or not-eligible) or a recorded presumptive-eligibility reason — the agent may not grant or deny assistance on an ad-hoc, un-sourced basis. Mirrors the Data Retention Agent's schedule-sourced and the Overpayment & Recovery Agent's reason-catalog-sourced posture"
  },
  {
    policyId: "policy.finassist.no-autonomous-denial",
    signal: "finAssistHumanReviewed",
    violatingValue: false,
    violationHint: "Autonomously denies charity care",
    reason:
      "A patient-financial-assistance decision asserted an autonomous denial (a not-eligible determination not gated on human review); a denial of charity care may NEVER be issued autonomously — a not-eligible determination is a RECOMMENDATION requiring human review with written notice + appeal rights under IRS 501(r)(4) (requiresHumanReview:true), and granting charity is a benefit but denying it is legally consequential. Mirrors the Overpayment & Recovery Agent's no-autonomous-clawback, the Utilization Review Agent's no-autonomous-denial, and the Claims Adjudication Agent's no-autonomous-denial posture — the safe answer is enforced"
  },
  {
    policyId: "policy.lab.critical-value-notified",
    signal: "labCriticalValueNotified",
    violatingValue: false,
    violationHint: "Suppresses a critical (panic) lab value without notification",
    reason:
      "A lab-result decision asserted a CRITICAL (panic) value that does NOT require provider notification (a suppressed / auto-closed critical result); a critical value may NEVER be suppressed — CLIA §493.1291(g) requires the laboratory to immediately alert the responsible provider of a critical value, so every critical result must trigger mandatory clinician notification (requiresProviderNotification:true). Mirrors the Care Coordination Handoff Agent's SBAR-completeness posture — a life-safety obligation that cannot be skipped"
  },
  {
    policyId: "policy.lab.reference-range-sourced",
    signal: "labRangeCited",
    violatingValue: false,
    violationHint: "A classification doesn't cite a recorded reference range",
    reason:
      "A lab-result decision did not cite a recorded analyte reference range from the catalog (an ad-hoc / un-sourced result interpretation, a missing or off-catalog analyte id); every classification must trace to a defined analyte reference range + critical thresholds (potassium, sodium, glucose, calcium, hemoglobin) — the agent may not interpret a result without a cited range. Mirrors the Overpayment & Recovery Agent's reason-catalog-sourced and the Data Retention Agent's schedule-sourced posture"
  },
  {
    policyId: "policy.lab.no-autonomous-clinical-action",
    signal: "labClinicianReviewed",
    violatingValue: false,
    violationHint: "Autonomously acts on an abnormal / critical result",
    reason:
      "A lab-result decision asserted an autonomous action on a non-normal result (an abnormal / critical result not gated on clinician review); the agent may NEVER autonomously act on a result — it does not order a test, prescribe, treat, or change a care plan, and every non-normal result is a flag escalated for clinician review (requiresClinicianReview:true). Mirrors the Utilization Review Agent's no-autonomous-denial and the Risk Adjustment Agent's no-autonomous-submission posture — the safe answer is enforced"
  },
  {
    policyId: "policy.gfe.charge-master-sourced",
    signal: "gfeChargeMasterSourced",
    violatingValue: false,
    violationHint: "A line item isn't priced from the charge master",
    reason:
      "A good-faith-estimate decision included a line item that is not charge-master-sourced (an off-catalog service id or an amount that doesn't match the charge master — an ad-hoc / fabricated charge); every priced line item must trace to a recorded charge-master entry at the catalog amount (established-visit, comprehensive consult, hormone panel, DEXA, pelvic ultrasound, HRT admin). Mirrors the Overpayment & Recovery Agent's reason-catalog-sourced and the Lab Result Agent's reference-range-sourced posture"
  },
  {
    policyId: "policy.gfe.expected-items-complete",
    signal: "gfeExpectedItemsComplete",
    violatingValue: false,
    violationHint: "The estimate omits a reasonably-expected item",
    reason:
      "A good-faith-estimate decision omitted a reasonably-expected item (the primary service or one of its expected co-items is missing from the line items) — an incomplete estimate UNDERSTATES the total and misleads the patient; the No Surprises Act (45 CFR 149.610) requires the convening provider to include items/services reasonably expected to be furnished. Mirrors the Care Coordination Handoff Agent's SBAR-completeness and the Lab Result Agent's critical-value-notified posture — a completeness obligation that cannot be skipped"
  },
  {
    policyId: "policy.gfe.estimate-not-binding",
    signal: "gfeEstimateNotBinding",
    violatingValue: false,
    violationHint: "The estimate is presented as a binding bill",
    reason:
      "A good-faith-estimate decision was presented as a binding / final bill (binding:true); a GFE is an ESTIMATE requiring patient confirmation, NEVER a final charge — and if the actual bill exceeds the GFE by $400 or more the patient has NSA dispute rights. Mirrors the Lab Result Agent's no-autonomous-clinical-action and the Financial Assistance Agent's no-autonomous-denial posture — the agent recommends, a human confirms"
  },
  {
    policyId: "policy.balancebill.protection-basis-sourced",
    signal: "balanceBillBasisCited",
    violatingValue: false,
    violationHint: "A protection decision doesn't cite a recorded basis",
    reason:
      "A balance-billing decision did not cite a recorded No Surprises Act protection basis (an ad-hoc / un-sourced protection call, a missing or off-catalog basis id); every determination must trace to a defined protection basis (emergency, out-of-network at an in-network facility, air ambulance, ground ambulance, in-network). Mirrors the Overpayment & Recovery Agent's reason-catalog-sourced and the Good Faith Estimate Agent's charge-master-sourced posture"
  },
  {
    policyId: "policy.balancebill.cost-share-in-network-basis",
    signal: "balanceBillCostShareInNetwork",
    violatingValue: false,
    violationHint: "A protected patient's cost-share is based on the billed charge",
    reason:
      "A balance-billing decision based a PROTECTED patient's cost-share on the out-of-network billed charge instead of the in-network (Qualifying Payment Amount) basis; for a protected claim the patient's cost-sharing must be computed on the recognized in-network amount (QPA), never the billed charge — basing it on the billed charge over-charges the patient (45 CFR 149.110–149.130). Mirrors the Overpayment & Recovery Agent's within-lookback-window posture — a legal basis bounds the dollar figure"
  },
  {
    policyId: "policy.balancebill.no-autonomous-balance-bill",
    signal: "balanceBillProhibitionHonored",
    violatingValue: false,
    violationHint: "A balance bill is allowed on a protected claim",
    reason:
      "A balance-billing decision allowed a balance bill on a PROTECTED claim; a protected claim can NEVER be balance-billed — the difference between the billed charge and the allowed amount may not be billed to the patient, and a balance bill is never issued autonomously against a protected patient. Mirrors the Overpayment & Recovery Agent's no-autonomous-clawback and the Lab Result Agent's no-autonomous-clinical-action posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.deid.all-categories-screened",
    signal: "deidAllCategoriesScreened",
    violatingValue: false,
    violationHint: "A de-identification screen skipped a Safe Harbor category",
    reason:
      "A de-identification determination did not screen all eighteen HIPAA Safe Harbor identifier categories (a category was neither present as a field nor attested absent); an incomplete screen may hide a re-identifying identifier, so a dataset cannot be claimed de-identified without accounting for every category (45 CFR 164.514(b)(2)). Mirrors the Good Faith Estimate Agent's expected-items-complete and the Lab Result Agent's critical-value-notified posture — a completeness obligation that cannot be skipped"
  },
  {
    policyId: "policy.deid.method-cited",
    signal: "deidMethodCited",
    violatingValue: false,
    violationHint: "A de-identification decision cites no recognized method",
    reason:
      "A de-identification determination did not cite a recognized method — neither HIPAA Safe Harbor (§164.514(b)(2)) nor a qualified Expert Determination with a cited determination reference (§164.514(b)(1)); there is no ad-hoc, un-cited de-identification. Mirrors the Data Retention Agent's schedule-sourced and the Balance Billing Agent's protection-basis-sourced posture — every decision traces to a defined method"
  },
  {
    policyId: "policy.deid.no-release-of-reidentifiable",
    signal: "deidNoReleaseOfReidentifiable",
    violatingValue: false,
    violationHint: "A dataset with a remaining identifier was marked de-identified / released",
    reason:
      "A de-identification determination marked a dataset de-identified / release-approved while an identifier category still remains (a retained identifier, or a generalization that does not satisfy Safe Harbor); a re-identifiable dataset is NOT de-identified and may never be released as de-identified — releasing re-identifiable data requires human review under a data use agreement. Mirrors the Balance Billing Agent's no-autonomous-balance-bill and the Master Patient Index Agent's no-autonomous-merge posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.immunization.schedule-sourced",
    signal: "immunizationScheduleCited",
    violatingValue: false,
    violationHint: "A vaccine recommendation cites no recorded schedule rule",
    reason:
      "An immunization forecast produced a vaccine recommendation that does not cite a recorded ACIP schedule rule (an ad-hoc / un-sourced recommendation, a missing or off-catalog rule id); every forecast entry must trace to a defined schedule rule. Mirrors the Lab Result Agent's reference-range-sourced and the Data Retention Agent's schedule-sourced posture"
  },
  {
    policyId: "policy.immunization.contraindication-honored",
    signal: "immunizationContraindicationHonored",
    violatingValue: false,
    violationHint: "A contraindicated vaccine was recommended",
    reason:
      "An immunization forecast RECOMMENDED (due / overdue) a vaccine for which the patient has a recorded contraindication; a contraindicated vaccine must be withheld and flagged, never recommended — recommending it is a patient-safety hazard. Mirrors the Lab Result Agent's critical-value-notified posture — a clinical-safety obligation that cannot be skipped"
  },
  {
    policyId: "policy.immunization.no-autonomous-administration",
    signal: "immunizationNoAutonomousAdministration",
    violatingValue: false,
    violationHint: "Due / overdue vaccines without a required clinician order",
    reason:
      "An immunization forecast reported due / overdue vaccines but did not require a clinician order; a due / overdue vaccine is a RECOMMENDATION requiring a clinician order — the agent never administers, orders, or records a vaccine autonomously. Mirrors the Lab Result Agent's no-autonomous-clinical-action and the Balance Billing Agent's no-autonomous-balance-bill posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.minnec.purpose-of-use-sourced",
    signal: "minNecPurposeSourced",
    violatingValue: false,
    violationHint: "A disclosure cites no recorded purpose-of-use",
    reason:
      "A minimum-necessary determination cited no recorded purpose-of-use (an ad-hoc / un-sourced disclosure, a missing or off-catalog purpose id); every disclosure decision must trace to a defined purpose-of-use rule. Mirrors the De-Identification Agent's method-cited and the Data Retention Agent's schedule-sourced posture"
  },
  {
    policyId: "policy.minnec.minimum-necessary-scoped",
    signal: "minNecScoped",
    violatingValue: false,
    violationHint: "A released field is beyond the minimum-necessary scope",
    reason:
      "A minimum-necessary determination RELEASED a field whose category is beyond what the stated purpose-of-use permits; no field beyond the minimum necessary may be disclosed — releasing an out-of-scope field over-discloses PHI (45 CFR 164.502(b) / 164.514(d)). Mirrors the De-Identification Agent's no-release-of-reidentifiable posture — a privacy obligation that cannot be skipped"
  },
  {
    policyId: "policy.minnec.no-autonomous-over-disclosure",
    signal: "minNecNoAutonomousOverDisclosure",
    violatingValue: false,
    violationHint: "An over-scope / bulk disclosure without a required human review",
    reason:
      "A minimum-necessary determination that is not-minimum-necessary as submitted (fields had to be withheld) or that is a bulk / cohort disclosure did not require human review; an over-scope or bulk disclosure is a RECOMMENDATION requiring human review — it is never autonomously released. Mirrors the De-Identification Agent's no-release-of-reidentifiable and the Balance Billing Agent's no-autonomous-balance-bill posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.auditlog.hash-chain-verified",
    signal: "auditLogHashChainVerified",
    violatingValue: false,
    violationHint: "An audit log marked verified over a broken hash chain",
    reason:
      "An audit-log integrity determination marked a log VERIFIED while its hash chain is not intact (a recomputed hash or a prevHash link does not match); a single broken link is tampering, and a verified label over a broken chain HIDES it. Mirrors the Minimum Necessary Agent's minimum-necessary-scoped posture — an integrity obligation that cannot be skipped"
  },
  {
    policyId: "policy.auditlog.sequence-complete",
    signal: "auditLogSequenceComplete",
    violatingValue: false,
    violationHint: "An audit log marked verified with a sequence gap",
    reason:
      "An audit-log integrity determination marked a log VERIFIED while its sequence is not complete (a gap in the sequence numbers); a gap means an entry was deleted, and a verified label over a gap HIDES the deleted record. The load-bearing completeness gate for a tamper-evident audit trail"
  },
  {
    policyId: "policy.auditlog.no-autonomous-redaction",
    signal: "auditLogNoAutonomousRedaction",
    violatingValue: false,
    violationHint: "An audit log was autonomously redacted / repaired",
    reason:
      "An audit-log integrity determination claimed it repaired / rewrote / re-sealed the log; the agent VERIFIES and FLAGS — it never deletes, rewrites, or repairs an audit entry (that would destroy evidence), and a broken log is flagged for human forensic review. Mirrors the Data Retention Agent's no-autonomous-purge and the Minimum Necessary Agent's no-autonomous-over-disclosure posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.timelyfiling.filing-limit-sourced",
    signal: "timelyFilingRuleSourced",
    violatingValue: false,
    violationHint: "A timeliness decision with no recorded filing-limit rule",
    reason:
      "A timely-filing determination cited no recorded payer filing-limit rule (a missing or off-catalog rule id); an ad-hoc / un-sourced limit is not a real deadline. Mirrors the Overpayment Recovery Agent's reason-catalog-sourced and the Data Retention Agent's schedule-sourced posture"
  },
  {
    policyId: "policy.timelyfiling.deadline-computed",
    signal: "timelyFilingDeadlineComputed",
    violatingValue: false,
    violationHint: "A filing deadline that does not match the computed date of service + limit",
    reason:
      "A timely-filing determination's stated deadline does not equal the date of service + the rule's limit in days; a guessed / hidden deadline is how a claim is wrongly called timely or untimely. The load-bearing correctness gate — mirrors the Good Faith Estimate Agent's math-consistent"
  },
  {
    policyId: "policy.timelyfiling.no-autonomous-write-off",
    signal: "timelyFilingNoAutonomousWriteOff",
    violatingValue: false,
    violationHint: "An untimely claim autonomously written off or not routed for review",
    reason:
      "A timely-filing determination marked the claim written-off, or reported an untimely claim without requiring human review; an untimely claim is a RECOMMENDATION (appeal with an exception, or a write-off decision) requiring human review — the agent never autonomously writes off the balance or bills the patient. Mirrors the Overpayment Recovery Agent's no-autonomous-clawback and the Balance Billing Agent's no-autonomous-balance-bill posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.controlledsubstance.guideline-sourced",
    signal: "controlledSubstanceGuidelineSourced",
    violatingValue: false,
    violationHint: "A controlled-substance risk finding with no recorded guideline",
    reason:
      "A controlled-substance determination cited no recorded guideline (a missing or off-catalog guideline id); an ad-hoc / un-sourced MME threshold is not a real clinical standard. Mirrors the Immunization Agent's schedule-sourced and the Lab Result Agent's reference-range-sourced posture"
  },
  {
    policyId: "policy.controlledsubstance.mme-computed",
    signal: "controlledSubstanceMmeComputed",
    violatingValue: false,
    violationHint: "A total MME/day that does not match the computed proposed + concurrent sum",
    reason:
      "A controlled-substance determination's stated total MME/day does not equal the proposed opioid contribution + the concurrent opioid MME/day; a guessed / hidden dose is how an over-threshold prescription is wrongly called safe. The load-bearing correctness gate — mirrors the Timely Filing Agent's deadline-computed and the Good Faith Estimate Agent's math-consistent"
  },
  {
    policyId: "policy.controlledsubstance.no-autonomous-prescribing-decision",
    signal: "controlledSubstanceNoAutonomousDecision",
    violatingValue: false,
    violationHint: "A controlled-substance decision auto-approved / auto-denied without review",
    reason:
      "A controlled-substance determination auto-decided (autoDecision:true), or reported an elevated / high-risk finding without requiring prescriber review; a risk finding is a RECOMMENDATION requiring prescriber review — the agent never autonomously approves, denies, dispenses, or writes the prescription. Mirrors the Immunization Agent's no-autonomous-administration and the Lab Result Agent's no-autonomous-clinical-action posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.abn.coverage-rule-sourced",
    signal: "abnCoverageRuleSourced",
    violatingValue: false,
    violationHint: "An ABN / coverage decision with no recorded Medicare coverage rule",
    reason:
      "An advance-beneficiary-notice determination cited no recorded Medicare coverage rule (a missing or off-catalog rule id); an ad-hoc / un-sourced coverage decision is not a real determination. Mirrors the Good Faith Estimate Agent's charge-master-sourced and the Timely Filing Agent's filing-limit-sourced posture"
  },
  {
    policyId: "policy.abn.abn-required-when-noncovered",
    signal: "abnRequiredWhenNoncovered",
    violatingValue: false,
    violationHint: "A likely-non-covered service marked as needing no ABN",
    reason:
      "An advance-beneficiary-notice determination assessed a service as likely NON-covered but did not require a signed pre-service ABN (abnRequired:false); a likely-denied Medicare service requires a signed ABN issued BEFORE the service, and understating this is how a surprise denial lands on the beneficiary. The load-bearing completeness gate — mirrors the Good Faith Estimate Agent's expected-items-complete"
  },
  {
    policyId: "policy.abn.no-autonomous-beneficiary-liability",
    signal: "abnNoAutonomousBeneficiaryLiability",
    violatingValue: false,
    violationHint: "Beneficiary billed for a non-covered service without a valid ABN, or liability auto-assigned",
    reason:
      "An advance-beneficiary-notice determination assigned patient financial liability autonomously (autoAssignedLiability:true), billed the beneficiary for a likely-non-covered service WITHOUT a valid pre-service ABN, or assigned liability on a non-covered / excluded service without requiring human review; the beneficiary may be billed for a non-covered service ONLY with a valid pre-service ABN (the GA modifier), otherwise the PROVIDER is liable (the GZ modifier), and every liability decision is a RECOMMENDATION requiring human review. Mirrors the Balance Billing Agent's no-autonomous-balance-bill and the Timely Filing Agent's no-autonomous-write-off posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.accounting.purpose-category-sourced",
    signal: "accountingPurposeSourced",
    violatingValue: false,
    violationHint: "A disclosure cites an off-catalog purpose-of-disclosure",
    reason:
      "An accounting-of-disclosures determination classified a disclosure whose purpose-of-disclosure is off-catalog (a missing or unrecognized purpose id); an ad-hoc purpose cannot be correctly classified as accountable or excluded under §164.528. Mirrors the Minimum Necessary Agent's purpose-of-use-sourced and the Data Retention Agent's schedule-sourced posture"
  },
  {
    policyId: "policy.accounting.accountable-disclosures-complete",
    signal: "accountingDisclosuresComplete",
    violatingValue: false,
    violationHint: "An accountable, in-window disclosure was dropped from the accounting",
    reason:
      "An accounting-of-disclosures determination omitted an accountable, in-window disclosure (a non-TPO, non-authorized disclosure within the lookback window classified as anything other than in-accounting); dropping an accountable disclosure understates the accounting and defeats the patient's §164.528 right. The load-bearing completeness gate — mirrors the Good Faith Estimate Agent's expected-items-complete and the Audit Log Integrity Agent's sequence-complete"
  },
  {
    policyId: "policy.accounting.no-autonomous-suppression",
    signal: "accountingNoAutonomousSuppression",
    violatingValue: false,
    violationHint: "A logged disclosure was autonomously suppressed / the accounting auto-released",
    reason:
      "An accounting-of-disclosures determination claimed it suppressed / redacted / deleted a logged disclosure (autonomousSuppression:true), or did not require privacy-officer review before release; the agent CLASSIFIES and ASSEMBLES — it never deletes or suppresses a logged disclosure (that would falsify the accounting and destroy evidence), and the accounting is a RECOMMENDATION requiring privacy-officer review. Mirrors the Audit Log Integrity Agent's no-autonomous-redaction and the Minimum Necessary Agent's no-autonomous-over-disclosure posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.subrogation.basis-sourced",
    signal: "subrogationBasisSourced",
    violatingValue: false,
    violationHint: "A subrogation recovery decision with no recorded legal basis",
    reason:
      "A subrogation / third-party-liability determination cited no recorded subrogation basis (a missing or off-catalog basis id); a subrogation interest exists only under a recorded legal basis (an ERISA plan reimbursement clause, a state subrogation statute, a workers-comp lien), and an ad-hoc / un-sourced basis is not a real legal right. Mirrors the Claims Overpayment & Recovery Agent's reason-catalog-sourced and the Timely Filing Agent's filing-limit-sourced posture"
  },
  {
    policyId: "policy.subrogation.recoverable-within-paid",
    signal: "subrogationRecoverableWithinPaid",
    violatingValue: false,
    violationHint: "A recoverable lien exceeding the plan's paid amount or the settlement",
    reason:
      "A subrogation / third-party-liability determination asserted a recoverable amount that is negative, exceeds the plan's paid amount, or exceeds the third-party settlement; a subrogation lien is REIMBURSEMENT, not profit — the plan may recover at most what it PAID and never more than the member's settlement. The load-bearing correctness gate — mirrors the Good Faith Estimate Agent's math-consistent and the Timely Filing Agent's deadline-computed"
  },
  {
    policyId: "policy.subrogation.no-autonomous-lien",
    signal: "subrogationNoAutonomousLien",
    violatingValue: false,
    violationHint: "A lien autonomously asserted, or an eligible case with no human review",
    reason:
      "A subrogation / third-party-liability determination autonomously asserted / perfected a lien (autoAssertedLien:true), or found a subrogation interest (eligible:true) without requiring human review; a subrogation determination is a RECOMMENDATION requiring a subrogation specialist / plan counsel to review, and the agent never autonomously asserts or perfects a lien, reduces the member's settlement, or recovers funds. Mirrors the Claims Overpayment & Recovery Agent's no-autonomous-clawback and the Balance Billing Agent's no-autonomous-balance-bill posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.dealdesk.pricing-catalog-sourced",
    signal: "dealDeskCatalogSourced",
    violatingValue: false,
    violationHint: "A quote line prices an off-catalog product",
    reason:
      "A deal-desk quote decision priced a line whose product is off-catalog (a missing or unrecognized product id); an ad-hoc product cannot be correctly priced or guardrailed against the recorded price book. Mirrors the Provider Contracting Agent's contract-type-catalog-sourced and the Good Faith Estimate Agent's charge-master-sourced posture"
  },
  {
    policyId: "policy.dealdesk.discount-math-consistent",
    signal: "dealDeskMathConsistent",
    violatingValue: false,
    violationHint: "A quote's totals do not equal the recomputed line sums",
    reason:
      "A deal-desk quote decision's list / net / discount totals or effective discount do not equal the recomputed sums of its line items; a guessed / hidden total is how an out-of-guardrail quote is dressed up as compliant. The load-bearing correctness gate — mirrors the Good Faith Estimate Agent's math-consistent and the Subrogation Agent's recoverable-within-paid"
  },
  {
    policyId: "policy.dealdesk.no-autonomous-out-of-guardrail-approval",
    signal: "dealDeskNoAutonomousApproval",
    violatingValue: false,
    violationHint: "An out-of-guardrail quote marked auto-approved",
    reason:
      "A deal-desk quote decision auto-approved (autoApproved:true) — or did not require deal-desk approval for — a quote with a line whose discount exceeds its product's max auto-approve guardrail; an out-of-guardrail discount is a RECOMMENDATION that must escalate to a human deal-desk owner, never an autonomous approval. Mirrors the Account Management Agent's human-owner-before-contract-change and the Provider Contracting Agent's no-autonomous-term-change posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.access.ground-sourced",
    signal: "accessGroundSourced",
    violatingValue: false,
    violationHint: "A denial cites an off-catalog §164.524 ground",
    reason:
      "A right-of-access determination denied (in part or full) on a cited ground that is off-catalog (a missing or unrecognized exception id); a §164.524 denial is permitted only on a recorded statutory ground, and an ad-hoc / un-sourced ground is not a lawful basis to withhold a patient's own record. Mirrors the Accounting of Disclosures Agent's purpose-category-sourced and the Minimum Necessary Agent's purpose-of-use-sourced posture"
  },
  {
    policyId: "policy.access.deadline-computed",
    signal: "accessDeadlineComputed",
    violatingValue: false,
    violationHint: "A response deadline that isn't request-date + 30/60 days",
    reason:
      "A right-of-access determination's response deadline (or days-until) does not equal the request date + 30 days (+ 30 more when the single extension is invoked); a guessed / mis-stated deadline is how an access request quietly runs past its §164.524 legal clock. The load-bearing correctness gate — mirrors the Timely Filing Agent's deadline-computed and the Good Faith Estimate Agent's math-consistent"
  },
  {
    policyId: "policy.access.no-autonomous-denial-or-release",
    signal: "accessNoAutonomousDenialOrRelease",
    violatingValue: false,
    violationHint: "A record autonomously released, or a determination with no human review",
    reason:
      "A right-of-access determination autonomously released the record (autoReleased:true) or did not require human review (requiresHumanReview:false); the agent ADJUDICATES — it never releases the record (a privacy risk) or issues a denial (a legal act with appeal rights) on its own, and every determination is a RECOMMENDATION requiring a records / privacy officer to fulfill or review. Mirrors the Accounting of Disclosures Agent's no-autonomous-suppression and the Minimum Necessary Agent's no-autonomous-over-disclosure posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.costshare.benefit-design-sourced",
    signal: "costShareBenefitSourced",
    violatingValue: false,
    violationHint: "A cost-share computed from an off-catalog plan",
    reason:
      "A member cost-share determination computed the split from an off-catalog plan (a missing or unrecognized plan id); the deductible, coinsurance rate, and out-of-pocket maximum must come from the member's recorded plan benefit design, and an ad-hoc plan cannot be correctly cost-shared. Mirrors the Good Faith Estimate Agent's charge-master-sourced and the Deal Desk Agent's pricing-catalog-sourced posture"
  },
  {
    policyId: "policy.costshare.math-consistent",
    signal: "costShareMathConsistent",
    violatingValue: false,
    violationHint: "A cost-share split that doesn't add up or is unbounded",
    reason:
      "A member cost-share determination's split does not add up — the member responsibility + plan-paid ≠ the allowed amount, the member share is negative or exceeds the allowed / remaining OOP maximum, or the member total ≠ deductible + coinsurance less the OOP-cap reduction; a split that doesn't add up is how a member is silently over-charged. The load-bearing correctness gate — mirrors the Good Faith Estimate Agent's math-consistent and the Subrogation Agent's recoverable-within-paid"
  },
  {
    policyId: "policy.costshare.no-autonomous-member-charge",
    signal: "costShareNoAutonomousCharge",
    violatingValue: false,
    violationHint: "A member charge posted, or a determination with no adjudication review",
    reason:
      "A member cost-share determination posted a charge / invoice / balance to the member (autoPostedCharge:true) or did not require adjudication review (requiresAdjudicationReview:false); the EOB cost-share is an ESTIMATE / BREAKDOWN — the claims system / a human finalizes it, and the agent never posts a charge to the member. Mirrors the Balance Billing Agent's no-autonomous-balance-bill and the Advance Beneficiary Notice Agent's no-autonomous-beneficiary-liability posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.exclusion.match-record-sourced",
    signal: "exclusionMatchSourced",
    violatingValue: false,
    violationHint: "An exclusion match with no sourced LEIE record",
    reason:
      "An exclusion-screening determination reported a match (not no-match) without citing a matchedExclusionId that resolves in the recorded LEIE catalog; a match asserted without a sourced exclusion record is not a lawful basis to hold a payment. Mirrors the Right of Access Agent's ground-sourced and the Subrogation Agent's basis-sourced posture"
  },
  {
    policyId: "policy.exclusion.match-not-overstated",
    signal: "exclusionMatchNotOverstated",
    violatingValue: false,
    violationHint: "A match strength stronger than the identifier signals support",
    reason:
      "An exclusion-screening determination reported a match strength stronger than its identifier signals support — a confirmed match requires an NPI match OR a full-name AND date-of-birth match, and a name coincidence must never be reported as confirmed; overstating a match is how a legitimate provider's payment is wrongly held on a shared name. The load-bearing correctness gate — mirrors the Member Cost-Share Agent's math-consistent and the Subrogation Agent's recoverable-within-paid"
  },
  {
    policyId: "policy.exclusion.no-autonomous-block-or-clear",
    signal: "exclusionNoAutonomousBlockOrClear",
    violatingValue: false,
    violationHint: "A payment blocked / a party cleared autonomously",
    reason:
      "An exclusion-screening determination autonomously blocked a payment (autoBlockedPayment:true), cleared a party (autoCleared:true), or did not require compliance review (requiresComplianceReview:false); the screening is a RECOMMENDATION — a compliance officer confirms the identity and acts, because a wrongful block denies a legitimate provider income and a wrongful clear risks paying a sanctioned party. Mirrors the Advance Beneficiary Notice Agent's no-autonomous-beneficiary-liability and the Member Cost-Share Agent's no-autonomous-member-charge posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.amendment.ground-sourced",
    signal: "amendmentGroundSourced",
    violatingValue: false,
    violationHint: "An amendment denial on an off-catalog ground",
    reason:
      "An amendment (§164.526) determination denied the request (or asserted a denial ground) that is off-catalog — a §164.526 denial is permitted only on a recorded statutory ground (not-originator, not-in-designated-record-set, not-available-for-access, accurate-and-complete), and an ad-hoc / un-sourced ground is not a lawful basis to refuse a patient's amendment. Mirrors the Right of Access Agent's ground-sourced and the Accounting of Disclosures Agent's purpose-category-sourced posture"
  },
  {
    policyId: "policy.amendment.deadline-computed",
    signal: "amendmentDeadlineComputed",
    violatingValue: false,
    violationHint: "An amendment response deadline that isn't request-date + 60/90 days",
    reason:
      "An amendment (§164.526) determination's response deadline (or days-until) does not equal the request date + 60 days (+ 30 more when the single extension is invoked); a guessed / mis-stated deadline is how an amendment request quietly runs past its §164.526 legal clock. The load-bearing correctness gate — mirrors the Right of Access Agent's deadline-computed and the Timely Filing Agent's deadline-computed"
  },
  {
    policyId: "policy.amendment.no-autonomous-write-or-denial",
    signal: "amendmentNoAutonomousWrite",
    violatingValue: false,
    violationHint: "An amendment made / denied autonomously, or with no human review",
    reason:
      "An amendment (§164.526) determination autonomously amended the record (autoAmended:true — a data write to the medical record that ripples to every holder the PHI was shared with), denied the request (autoDenied:true — a legal act carrying the patient's statement-of-disagreement rights), or did not require human review (requiresHumanReview:false); the agent ADJUDICATES — every determination is a RECOMMENDATION requiring a records / privacy officer to act on or review. Mirrors the Right of Access Agent's no-autonomous-denial-or-release and the Minimum Necessary Agent's no-autonomous-over-disclosure posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.information-blocking.exception-sourced",
    signal: "blockingExceptionSourced",
    violatingValue: false,
    violationHint: "An information-blocking exception claimed off-catalog",
    reason:
      "An information-blocking (45 CFR Part 171) determination claimed an exception that is off-catalog — a practice escapes the Cures Act information-blocking rule only on a recorded exception (preventing harm, privacy, security, infeasibility, health IT performance, content & manner, fees, licensing), and an ad-hoc / un-sourced exception is not a lawful basis to interfere with EHI. Mirrors the Right of Access Agent's ground-sourced and the Amendment Agent's ground-sourced posture"
  },
  {
    policyId: "policy.information-blocking.determination-not-overstated",
    signal: "blockingDeterminationNotOverstated",
    violatingValue: false,
    violationHint: "An exception reported as met while a required condition is missing",
    reason:
      "An information-blocking (45 CFR Part 171) determination reported an exception as satisfied (or under-reported its missing conditions) when a required condition of that exception is not met; each exception's conditions must ALL be satisfied, and an overstated 'exception met' is how unlawful interference is dressed up as a compliant practice. The load-bearing correctness gate — mirrors the OIG Exclusion Agent's match-not-overstated and the Member Cost-Share Agent's math-consistent"
  },
  {
    policyId: "policy.information-blocking.no-autonomous-block-or-release",
    signal: "blockingNoAutonomousBlockOrRelease",
    violatingValue: false,
    violationHint: "EHI withheld or released autonomously, or with no compliance review",
    reason:
      "An information-blocking (45 CFR Part 171) determination autonomously withheld EHI (autoBlockedEhi:true — which could itself be information blocking, or delay urgent care), force-released EHI (autoReleasedEhi:true — which could breach privacy), or did not require compliance review (requiresComplianceReview:false); the agent ADJUDICATES — every determination is a RECOMMENDATION requiring a compliance officer to confirm and act. Mirrors the OIG Exclusion Agent's no-autonomous-block-or-clear and the Right of Access Agent's no-autonomous-denial-or-release posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.ddi.interaction-sourced",
    signal: "ddiInteractionSourced",
    violatingValue: false,
    violationHint: "A reported drug interaction that isn't in the knowledge base",
    reason:
      "A drug–drug interaction determination reported an interaction that is off-catalog, or dressed a mismatched severity onto a recorded interaction — every flagged interaction must resolve in the recorded knowledge base with a matching pair + severity, because a fabricated interaction erodes clinician trust and drives alert fatigue. Mirrors the Controlled Substance Agent's guideline-sourced and the Immunization Agent's schedule-sourced posture"
  },
  {
    policyId: "policy.ddi.severity-consistent",
    signal: "ddiSeverityConsistent",
    violatingValue: false,
    violationHint: "An overall severity that doesn't match the detected interactions",
    reason:
      "A drug–drug interaction determination's overall severity does not equal the highest cataloged severity among the detected interactions; an INFLATED severity drives wrongful order cancellation and alert fatigue, and a SUPPRESSED severity hides a contraindication. The load-bearing correctness gate — mirrors the Member Cost-Share Agent's math-consistent and the OIG Exclusion Agent's match-not-overstated"
  },
  {
    policyId: "policy.ddi.no-autonomous-hold-or-override",
    signal: "ddiNoAutonomousHoldOrOverride",
    violatingValue: false,
    violationHint: "An order held or an alert overridden autonomously, or with no clinician review",
    reason:
      "A drug–drug interaction determination autonomously held / cancelled the order (autoHeldOrder:true — which could deny needed therapy), overrode the interaction alert (autoOverrodeAlert:true — which could push through a contraindicated combination), or did not require clinician review (requiresClinicianReview:false); the agent SCREENS — every finding is a RECOMMENDATION requiring a pharmacist / prescriber to act on or review. Mirrors the Controlled Substance Agent's no-autonomous-prescribing-decision and the Lab Result Agent's no-autonomous-clinical-action posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.mlr.inputs-sourced",
    signal: "mlrInputsSourced",
    violatingValue: false,
    violationHint: "An MLR standard that isn't the recorded one for the market",
    reason:
      "A Medical Loss Ratio rebate determination applied a standard that is off-catalog or does not match its market — the applicable standard (80% individual / small-group, 85% large-group) must resolve in the recorded MLR_STANDARDS catalog for the market, because a mis-stated standard wrongly triggers or wrongly avoids a rebate. Mirrors the Member Cost-Share Agent's benefit-design-sourced and the Good Faith Estimate Agent's charge-master-sourced posture"
  },
  {
    policyId: "policy.mlr.allocation-consistent",
    signal: "mlrAllocationConsistent",
    violatingValue: false,
    violationHint: "An MLR / rebate that doesn't add up or an apportionment that loses pennies",
    reason:
      "A Medical Loss Ratio rebate determination's MLR does not equal (claims + quality improvement) / (earned premium − taxes & fees), its total rebate does not equal max(0, standard − MLR) × earned premium, or the per-subscriber allocations do not sum EXACTLY (to the penny) to the total rebate (or an allocation is negative) — a rebate that doesn't add up, or an apportionment that loses / invents pennies, is a compliance and accounting defect. The load-bearing correctness gate — mirrors the Member Cost-Share Agent's math-consistent and the Risk Adjustment Agent's score-consistent"
  },
  {
    policyId: "policy.mlr.no-autonomous-disbursement",
    signal: "mlrNoAutonomousDisbursement",
    violatingValue: false,
    violationHint: "A rebate disbursed autonomously, or with no treasury review",
    reason:
      "A Medical Loss Ratio rebate determination autonomously disbursed the rebate (autoDisbursed:true — a movement of money to members that must be authorized) or did not require treasury review (requiresTreasuryReview:false); the agent CALCULATES — every determination is a RECOMMENDATION requiring a treasury / compliance reviewer to confirm and issue payment. Mirrors the Member Cost-Share Agent's no-autonomous-member-charge and the OIG Exclusion Agent's no-autonomous-block-or-clear posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.enrollment.reconciliation-complete",
    signal: "reconciliationComplete",
    violatingValue: false,
    violationHint: "A reconciliation that drops, duplicates, or miscounts a member",
    reason:
      "An enrollment reconciliation determination does not account for every member exactly once — the per-kind counts must sum to the number of actions, the total-members count must equal the number of actions, the counts must match the actual per-kind tallies, and no member may appear twice. A dropped member is the worst failure mode (a terminated employee who keeps coverage, or a new hire who never gets enrolled). The load-bearing correctness gate — mirrors the Member Cost-Share Agent's math-consistent and the MLR Rebate Agent's allocation-consistent"
  },
  {
    policyId: "policy.enrollment.actions-sourced",
    signal: "reconciliationActionsSourced",
    violatingValue: false,
    violationHint: "A fabricated discrepancy or a mis-shaped reconciliation action",
    reason:
      "An enrollment reconciliation determination carries a fabricated discrepancy or a mis-shaped action — every UPDATE must carry at least one genuinely-differing field (each delta's source value actually differs from its carrier value), and every NO-CHANGE / ENROLL / TERMINATE must carry none; an 'update' whose fields don't actually differ, or a 'no-change' that hides a real difference, drives wrong enrollment writes. Mirrors the OIG Exclusion Agent's match-not-overstated and the Drug Interaction Agent's interaction-sourced posture"
  },
  {
    policyId: "policy.enrollment.no-autonomous-change",
    signal: "reconciliationNoAutonomousChange",
    violatingValue: false,
    violationHint: "An enrollment change applied autonomously, or with no benefits-admin review",
    reason:
      "An enrollment reconciliation determination autonomously applied the enrollment changes (autoApplied:true — enrolling / terminating / updating a member is a coverage decision that must be authorized) or did not require benefits-admin review (requiresBenefitsAdminReview:false); the agent RECONCILES — every determination is a RECOMMENDATION requiring a benefits administrator to confirm and post. Mirrors the Member Cost-Share Agent's no-autonomous-member-charge and the MLR Rebate Agent's no-autonomous-disbursement posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.pathway.steps-sourced",
    signal: "pathwayStepsSourced",
    violatingValue: false,
    violationHint: "A fabricated / dangling step id in the sequencing output",
    reason:
      "A care pathway sequencing determination references a step id — in its ordered sequence, stage map, reported cycle members, or missing-prerequisite holders — that is not one of the submitted pathway steps; a fabricated / dangling step id would order or flag care that doesn't exist. Every referenced step id must resolve to a submitted step. Mirrors the Drug Interaction Agent's interaction-sourced and the Enrollment Reconciliation Agent's actions-sourced posture"
  },
  {
    policyId: "policy.pathway.sequence-valid",
    signal: "pathwaySequenceValid",
    violatingValue: false,
    violationHint: "A sequence that violates a prerequisite, drops a step, or asserts an impossible order",
    reason:
      "A care pathway sequencing determination is inconsistent with its steps — when reported SEQUENCED, the ordered steps must be a complete permutation of the pathway's steps (none dropped or duplicated) and every step must appear AFTER all of its prerequisites (ordering a treatment step before its safety-screening prerequisite is the worst failure mode); when reported un-sequenceable (a cycle or a missing prerequisite), no order may be asserted. The load-bearing correctness gate — mirrors the Member Cost-Share Agent's math-consistent and the Enrollment Reconciliation Agent's reconciliation-complete"
  },
  {
    policyId: "policy.pathway.no-autonomous-execution",
    signal: "pathwayNoAutonomousExecution",
    violatingValue: false,
    violationHint: "A pathway step executed autonomously, or with no clinician review",
    reason:
      "A care pathway sequencing determination autonomously executed a step (autoExecuted:true — ordering a lab, a screening, or a therapy is a clinical action that must be authorized) or did not require clinician review (requiresClinicianReview:false); the agent SEQUENCES — every determination is a RECOMMENDATION requiring a clinician to confirm and order. Mirrors the Drug Interaction Agent's no-autonomous-hold-or-override and the Lab Result Agent's no-autonomous-clinical-action posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.coverage.segments-sourced",
    signal: "coverageSegmentsSourced",
    violatingValue: false,
    violationHint: "A merged coverage span not backed by a submitted segment, or a dropped segment",
    reason:
      "A coverage continuity determination has a merged span that does not trace to submitted segments — each span's start / end must come from a real segment boundary, and every submitted segment must fall within a merged span. Fabricated coverage (a span not backed by a segment) would wrongly certify continuity; dropped coverage would wrongly find a break. Mirrors the Care Pathway Agent's steps-sourced and the Drug Interaction Agent's interaction-sourced posture"
  },
  {
    policyId: "policy.coverage.math-consistent",
    signal: "coverageMathConsistent",
    violatingValue: false,
    violationHint: "A miscounted covered-day total, a mis-measured gap, or a break flag off its threshold",
    reason:
      "A coverage continuity determination's math does not add up — the merged spans must be ordered + non-overlapping (each start ≤ end, strictly gapped from the previous), the total covered days must equal the sum of the spans' inclusive lengths, each reported gap must equal the exact day distance between consecutive spans, and the significant-break flag must equal whether any gap exceeds the threshold. A miscounted total, a mis-measured gap, or a mismatched break flag drives a wrong creditable-coverage determination. The load-bearing correctness gate — mirrors the Member Cost-Share Agent's math-consistent and the MLR Rebate Agent's allocation-consistent"
  },
  {
    policyId: "policy.coverage.no-autonomous-determination",
    signal: "coverageNoAutonomousDetermination",
    violatingValue: false,
    violationHint: "A coverage determination issued autonomously, or with no eligibility review",
    reason:
      "A coverage continuity determination autonomously issued a creditable-coverage determination (autoDetermined:true — issuing a determination, denying special enrollment, or imposing a late-enrollment penalty is a coverage decision that must be authorized) or did not require eligibility review (requiresEligibilityReview:false); the agent MEASURES — every determination is a RECOMMENDATION requiring an eligibility reviewer to confirm. Mirrors the Enrollment Reconciliation Agent's no-autonomous-change and the MLR Rebate Agent's no-autonomous-disbursement posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.access.events-sourced",
    signal: "accessEventsSourced",
    violatingValue: false,
    violationHint: "A peak-window access event not backed by a submitted event, or a phantom count",
    reason:
      "An access-anomaly finding has a peak window whose events do not trace to submitted access events — the peak window's event ids must be a subset of the submitted events and its count must equal the number of those ids. A fabricated access (an event in the peak not backed by a submitted one) would manufacture a false anomaly; a phantom count would overstate the spike. Mirrors the Coverage Continuity Agent's segments-sourced and the Audit Log Integrity Agent's hash-chain-verified posture"
  },
  {
    policyId: "policy.access.window-count-consistent",
    signal: "accessWindowCountConsistent",
    violatingValue: false,
    violationHint: "A miscounted peak, an over-wide window, or an anomaly flag off its threshold",
    reason:
      "An access-anomaly finding's window count does not add up — recomputing the sliding-window peak from the events must reproduce the reported peak count, the peak window's events must all fall within a span of at most windowMinutes, and the anomaly flag must equal whether the peak exceeds the threshold. A miscounted peak, a window wider than the configured length, or a mismatched anomaly flag drives a wrong finding. The load-bearing correctness gate — mirrors the Coverage Continuity Agent's math-consistent and the Audit Log Integrity Agent's sequence-complete"
  },
  {
    policyId: "policy.access.no-autonomous-action",
    signal: "accessNoAutonomousAction",
    violatingValue: false,
    violationHint: "An access / employment action taken autonomously, or with no privacy review",
    reason:
      "An access-anomaly finding autonomously took an access / employment action (autoLockedAccount:true or autoRevokedAccess:true — locking an account, revoking access, or disciplining a workforce member is an action that must be authorized) or did not require privacy review (requiresPrivacyReview:false); the agent MEASURES — every flag is a RECOMMENDATION requiring a privacy officer to review. Mirrors the Coverage Continuity Agent's no-autonomous-determination and the Audit Log Integrity Agent's no-autonomous-redaction posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.caseload.assignment-complete",
    signal: "caseloadAssignmentComplete",
    violatingValue: false,
    violationHint: "A dropped or double-counted member — not accounted for exactly once",
    reason:
      "A caseload-balancing allocation does not account for every member exactly once — the assigned set and the waitlisted set must be disjoint and together cover every submitted member (no dropped member, no double-assignment), and the reported counts must match. A dropped member is a patient who falls through the cracks with no manager owning their care; a double-assigned member is confused ownership. The completeness gate — mirrors the Enrollment Reconciliation Agent's reconciliation-complete and the Accounting of Disclosures Agent's accountable-disclosures-complete"
  },
  {
    policyId: "policy.caseload.capacity-respected",
    signal: "caseloadCapacityRespected",
    violatingValue: false,
    violationHint: "An over-loaded manager, a miscounted load, or an unjust waitlist",
    reason:
      "A caseload-balancing allocation violates capacity — each manager's assigned acuity must equal the sum of their assigned members' acuities, must not exceed their capacity, and the remaining capacity must be exact; and every waitlisted member's acuity must exceed EVERY manager's final remaining capacity (a member waitlisted while a manager had room is a wrong, unsafe allocation). An over-loaded panel is a patient-safety risk. The load-bearing correctness gate — mirrors the Access Anomaly Agent's window-count-consistent and the Member Cost-Share Agent's math-consistent"
  },
  {
    policyId: "policy.caseload.no-autonomous-assignment",
    signal: "caseloadNoAutonomousAssignment",
    violatingValue: false,
    violationHint: "An assignment committed autonomously, or with no care-lead review",
    reason:
      "A caseload-balancing allocation autonomously committed an assignment (autoAssigned:true — committing an assignment, reassigning a patient, or overriding a manager's caseload is a care-ownership decision that must be authorized) or did not require care-lead review (requiresCareLeadReview:false); the agent RECOMMENDS — every allocation is a RECOMMENDATION requiring a care-management lead to confirm. Mirrors the Care Team Agent's no-autonomous-assignment and the Coverage Continuity Agent's no-autonomous-determination posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.schedule.intervals-sourced",
    signal: "scheduleIntervalsSourced",
    violatingValue: false,
    violationHint: "A fabricated / dropped appointment — not every request accounted for exactly once",
    reason:
      "A scheduling-conflict determination has an appointment — scheduled or waitlisted — that does not trace to a submitted request, or does not account for every request exactly once: every scheduled / conflicting appointment's id, member, start, and end must match a submitted interval, and the scheduled set and the conflict set must be disjoint and together cover every submitted request (no fabricated appointment, no dropped patient, no double-count). A fabricated appointment invents a booking; a dropped patient is turned away silently. The sourced + completeness gate — mirrors the Caseload Balancing Agent's assignment-complete and the Coverage Continuity Agent's segments-sourced"
  },
  {
    policyId: "policy.schedule.conflict-free",
    signal: "scheduleConflictFree",
    violatingValue: false,
    violationHint: "A double-booked resource, or a request waitlisted while it actually fit",
    reason:
      "A scheduling-conflict determination is not conflict-free — the scheduled appointments must be pairwise NON-overlapping (no double-booking on the resource), every waitlisted appointment must genuinely overlap the scheduled appointment named in its conflictsWith, and the counts must add up. A scheduled pair that overlaps double-books the resource; a request waitlisted while it actually fit turns a patient away for nothing. The load-bearing correctness gate — mirrors the Caseload Balancing Agent's capacity-respected and the Access Anomaly Agent's window-count-consistent"
  },
  {
    policyId: "policy.schedule.no-autonomous-booking",
    signal: "scheduleNoAutonomousBooking",
    violatingValue: false,
    violationHint: "An appointment booked / cancelled / bumped autonomously, or with no scheduler review",
    reason:
      "A scheduling-conflict determination autonomously booked, cancelled, or bumped an appointment (autoBooked:true — each is a scheduling action that must be authorized) or did not require scheduler review (requiresSchedulerReview:false); the agent RECOMMENDS — every schedule is a RECOMMENDATION requiring a scheduler to confirm. Mirrors the Caseload Balancing Agent's no-autonomous-assignment and the Appointment Scheduling Agent's governance posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.lasa.candidates-sourced",
    signal: "lasaCandidatesSourced",
    violatingValue: false,
    violationHint: "A fabricated or mislabeled look-alike candidate not backed by the catalog",
    reason:
      "A medication-name-safety finding names a candidate — the nearest match or a confusable look-alike — that does not trace to a catalog drug: every candidate's drugId must be in the catalog and its echoed name must equal that drug's catalog name. A fabricated candidate invents a look-alike that doesn't exist; a mislabeled one attaches the wrong name. The sourced gate — mirrors the Drug–Drug Interaction Agent's interaction-sourced and the Schedule Conflict Agent's intervals-sourced"
  },
  {
    policyId: "policy.lasa.distances-consistent",
    signal: "lasaDistancesConsistent",
    violatingValue: false,
    violationHint: "A miscomputed distance, a wrong nearest match, an omitted look-alike, or a bad disposition",
    reason:
      "A medication-name-safety finding's edit distances do not add up — recomputing the Levenshtein distance from the prescribed name to the catalog must reproduce the reported nearest match, every reported distance, the exact-match flag, the confusable set (exactly those within the threshold), and the disposition. A miscomputed distance, a wrong nearest match, an omitted or spurious look-alike, or a disposition that doesn't follow drives a wrong finding — the whole point is the arithmetic. The load-bearing correctness gate — mirrors the Schedule Conflict Agent's conflict-free and the Access Anomaly Agent's window-count-consistent"
  },
  {
    policyId: "policy.lasa.no-autonomous-substitution",
    signal: "lasaNoAutonomousSubstitution",
    violatingValue: false,
    violationHint: "A drug substituted / corrected / dispensed autonomously, or with no pharmacist review",
    reason:
      "A medication-name-safety finding autonomously substituted, corrected, or dispensed a drug (autoSubstituted:true — each is a clinical action that must be authorized) or did not require pharmacist review (requiresPharmacistReview:false); the agent FLAGS — every finding is a RECOMMENDATION requiring a pharmacist to confirm the intended medication. Mirrors the Drug–Drug Interaction Agent's no-autonomous-hold-or-override and the Schedule Conflict Agent's no-autonomous-booking posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.claim.states-sourced",
    signal: "claimStatesSourced",
    violatingValue: false,
    violationHint: "A fabricated lifecycle state or an invented legal transition not in the state machine",
    reason:
      "A claim-lifecycle finding names a status — in the allowed-next set or in the shortest path — that is not a defined state of the state machine, or a shortest-path step that is not a real transition. A fabricated state invents a lifecycle stage that doesn't exist; a fabricated edge invents a legal move that isn't allowed. The sourced gate — mirrors the Care Pathway Agent's steps-sourced and the Medication Name Safety Agent's candidates-sourced"
  },
  {
    policyId: "policy.claim.transition-consistent",
    signal: "claimTransitionConsistent",
    violatingValue: false,
    violationHint: "A wrong direct-edge / reachability flag, a wrong path length, or a bad disposition",
    reason:
      "A claim-lifecycle finding's transition logic does not add up — recomputing the transition table + the BFS from the machine must reproduce the reported direct-edge flag, the reachability flag, the allowed-next set, the shortest-path length + endpoints, and the disposition. A wrong direct-edge flag would wave through an illegal transition (skipping adjudication) or block a legal one; a wrong reachability / path would misroute the claim. The load-bearing correctness gate — mirrors the Care Pathway Agent's sequence-valid and the Medication Name Safety Agent's distances-consistent"
  },
  {
    policyId: "policy.claim.no-autonomous-advance",
    signal: "claimNoAutonomousAdvance",
    violatingValue: false,
    violationHint: "A claim advanced / paid / finalized autonomously, or with no adjuster review",
    reason:
      "A claim-lifecycle finding autonomously advanced the claim, posted a payment, or finalized a denial (autoAdvanced:true — each is a payer action that must be authorized) or did not require adjuster review (requiresAdjusterReview:false); the agent VALIDATES — every finding is a RECOMMENDATION requiring an adjuster to confirm the transition. Mirrors the Timely Filing Agent's no-autonomous-write-off and the Overpayment Recovery Agent's no-autonomous-clawback posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.benchmark.cohort-sourced",
    signal: "benchmarkCohortSourced",
    violatingValue: false,
    violationHint: "A phantom / omitted peer, a malformed cohort member, or a mis-sized denominator",
    reason:
      "A provider-benchmarking finding's peer cohort is not intact — every cohort member must be a well-formed { providerId, numeric value }, the reported cohort size must equal the actual cohort, and the target value must be numeric. A phantom or omitted peer silently mis-sizes the denominator and misrepresents the percentile. The sourced gate — mirrors the Claim Lifecycle Agent's states-sourced and the Access Anomaly Agent's events-sourced"
  },
  {
    policyId: "policy.benchmark.stats-consistent",
    signal: "benchmarkStatsConsistent",
    violatingValue: false,
    violationHint: "A miscomputed percentile / median, or a band / disposition that doesn't follow",
    reason:
      "A provider-benchmarking finding's statistics do not add up — recomputing the rank statistics from the cohort must reproduce the reported counts, percentile rank, direction-adjusted effective percentile, median, performance band, and disposition. A miscomputed percentile or a band that doesn't follow mis-tiers the provider — the whole point is the arithmetic. The load-bearing correctness gate — mirrors the Claim Lifecycle Agent's transition-consistent and the Member Cost-Share Agent's math-consistent"
  },
  {
    policyId: "policy.benchmark.no-autonomous-tiering",
    signal: "benchmarkNoAutonomousTiering",
    violatingValue: false,
    violationHint: "A provider tiered / penalized / de-networked autonomously, or with no network review",
    reason:
      "A provider-benchmarking finding autonomously tiered the provider, adjusted their payment, or removed them from the network (autoTiered:true — each is a commercially consequential action that must be authorized) or did not require network review (requiresNetworkReview:false); the agent BENCHMARKS — every finding is a RECOMMENDATION requiring a network manager to confirm. Mirrors the Provider Contracting Agent's no-autonomous-term-change and the Timely Filing Agent's no-autonomous-write-off posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.household.links-sourced",
    signal: "householdLinksSourced",
    violatingValue: false,
    violationHint: "A phantom relationship link, or a household that doesn't partition the members",
    reason:
      "A household-composition finding is not built from the submitted batch — every relationship link must connect two SUBMITTED members (no phantom relationship to a member not in the batch), and the households must PARTITION exactly the submitted members (each member in exactly one household, all covered, none invented). A phantom link or a dropped / invented member silently mis-groups a family. The sourced + completeness gate — mirrors the Enrollment Reconciliation Agent's reconciliation-complete and the Caseload Balancing Agent's assignment-complete"
  },
  {
    policyId: "policy.household.partition-consistent",
    signal: "householdPartitionConsistent",
    violatingValue: false,
    violationHint: "A grouping that doesn't match the connected components of the links",
    reason:
      "A household-composition finding's grouping does not add up — recomputing the union-find from the members + links must reproduce the reported households, household count, largest-household size, member count, and disposition. A wrong grouping (two unlinked members merged, or two linked members split apart) mis-applies a family accumulator or leaks one member's data to another. The load-bearing correctness gate — mirrors the Provider Benchmarking Agent's stats-consistent and the Claim Lifecycle Agent's transition-consistent"
  },
  {
    policyId: "policy.household.no-autonomous-merge",
    signal: "householdNoAutonomousMerge",
    violatingValue: false,
    violationHint: "Member records merged / enrollment changed autonomously, or with no steward review",
    reason:
      "A household-composition finding autonomously merged member records, changed enrollment, or applied a family accumulator (autoMerged:true — each is a consequential action that must be authorized) or did not require steward review (requiresStewardReview:false); the agent PROPOSES a grouping — every finding is a RECOMMENDATION requiring a data steward to confirm. Mirrors the Enrollment Reconciliation Agent's no-autonomous-change and the Master-Patient-Index Agent's no-autonomous-merge posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.identifier.identifiers-sourced",
    signal: "identifiersSourced",
    violatingValue: false,
    violationHint: "A fabricated validation result, or a dropped / miscounted identifier",
    reason:
      "An identifier-validation run does not report what was submitted — every result must correspond to a SUBMITTED identifier (same NPI, same order; no fabricated result, no dropped identifier), the reported total must equal the identifier count, the per-kind counts must sum to the total, and the batch disposition must follow. A dropped or invented identifier silently mis-states the integrity of the batch. The sourced + completeness gate — mirrors the Household Composition Agent's links-sourced and the Enrollment Reconciliation Agent's reconciliation-complete"
  },
  {
    policyId: "policy.identifier.checksum-consistent",
    signal: "checksumConsistent",
    violatingValue: false,
    violationHint: "A miscomputed Luhn check digit — a mistyped NPI waved through, or a correct one failed",
    reason:
      "An identifier-validation finding's checksums do not add up — recomputing each identifier's format classification and Luhn (CMS mod-10 over the 80840 prefix) check digit from the NPI itself must reproduce the reported disposition, expected check digit, and per-kind counts. A miscomputed checksum waves through a mistyped NPI (a claim rejection waiting to happen) or fails a correct one. The load-bearing correctness gate — mirrors the Provider Benchmarking Agent's stats-consistent and the OIG Exclusion Agent's match-not-overstated"
  },
  {
    policyId: "policy.identifier.no-autonomous-reject",
    signal: "identifierNoAutonomousReject",
    violatingValue: false,
    violationHint: "A claim / provider rejected or a number corrected autonomously, or with no steward review",
    reason:
      "An identifier-validation finding autonomously rejected a claim, removed a provider from the directory, or corrected a number (autoRejected:true — each is a consequential action that must be authorized) or did not require steward review (requiresStewardReview:false); the agent VALIDATES and FLAGS — every finding is a RECOMMENDATION requiring a data steward to confirm. Mirrors the Provider Credentialing Agent's no-referral-to-expired-or-sanctioned and the Enrollment Reconciliation Agent's no-autonomous-change posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.adequacy.providers-sourced",
    signal: "providersSourced",
    violatingValue: false,
    violationHint: "A phantom in-network provider, or a dropped / miscounted required-specialty provider",
    reason:
      "A network-adequacy finding is not built from the submitted in-network providers — every evaluated provider must be a SUBMITTED one (same id, coordinates, and the required specialty; no phantom provider fabricating coverage that isn't in the network), every submitted provider of that specialty must be evaluated (none dropped), the counts must agree, and the nearest must be one of the evaluated. A phantom nearby provider turns a real access GAP into false adequacy. The sourced + completeness gate — mirrors the Identifier Validation Agent's identifiers-sourced and the Household Composition Agent's links-sourced"
  },
  {
    policyId: "policy.adequacy.distances-consistent",
    signal: "distancesConsistent",
    violatingValue: false,
    violationHint: "A mis-measured great-circle distance — a gap understated, or a false gap",
    reason:
      "A network-adequacy finding's distances do not add up — recomputing the haversine great-circle distance from the member to each evaluated provider's own coordinates must reproduce every reported distance, the ascending order, the nearest provider, the nearest distance, and the adequacy disposition against the standard. A mis-measured distance understates a gap (falsely certifying adequacy so a member can't reach care) or overstates one. The load-bearing correctness gate — mirrors the Medication Name Safety Agent's distances-consistent and the Provider Benchmarking Agent's stats-consistent"
  },
  {
    policyId: "policy.adequacy.no-autonomous-network-change",
    signal: "noAutonomousNetworkChange",
    violatingValue: false,
    violationHint: "The network certified / a gap closed / a provider added autonomously, or with no network review",
    reason:
      "A network-adequacy finding autonomously certified the network as adequate to a regulator, closed a gap, or added / removed a provider (autoCertified:true — each is a consequential action that must be authorized) or did not require network review (requiresNetworkReview:false); the agent ASSESSES adequacy — every finding is a RECOMMENDATION requiring a network manager to confirm. Mirrors the Provider Benchmarking Agent's no-autonomous-tiering and the Provider Credentialing Agent's no-referral-to-expired-or-sanctioned posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.pcp.matching-sourced",
    signal: "matchingSourced",
    violatingValue: false,
    violationHint: "A phantom member / provider, or a miscounted assignment",
    reason:
      "A PCP-matching determination is not built from the submitted panel — there must be one assignment per SUBMITTED member (all present, none dropped or invented), every assigned provider must be a SUBMITTED provider, the provider loads must echo the submitted capacities and match the actual assignment counts, and the matched / unmatched tallies must add up. A phantom assignment (a member not in the panel, or a provider not in the network) corrupts the panel. The sourced + completeness gate — mirrors the Network Adequacy Agent's providers-sourced and the Caseload Balancing Agent's assignment-complete"
  },
  {
    policyId: "policy.pcp.matching-stable",
    signal: "matchingStable",
    violatingValue: false,
    violationHint: "An unstable matching — a blocking pair, a capacity violation, or a mis-recompute",
    reason:
      "A PCP-matching determination is not stable — recomputing the member-proposing Gale–Shapley deferred acceptance from the echoed preferences + capacities must reproduce the reported assignment and each member's reported preference rank, no provider may be over capacity, and there must be NO blocking pair (a member and provider who both prefer each other over their current assignment). An unstable matching unravels as the pair defects, leaving a patient without a real PCP. The load-bearing correctness gate — mirrors the Network Adequacy Agent's distances-consistent and the Household Composition Agent's partition-consistent"
  },
  {
    policyId: "policy.pcp.no-autonomous-assignment",
    signal: "pcpNoAutonomousAssignment",
    violatingValue: false,
    violationHint: "An assignment committed / a patient reassigned autonomously, or with no coordinator review",
    reason:
      "A PCP-matching determination autonomously committed an assignment, reassigned a patient, or overrode a provider's panel (autoAssigned:true — each is a care-ownership decision that must be authorized) or did not require coordinator review (requiresCoordinatorReview:false); the agent PROPOSES a matching — every matching is a RECOMMENDATION requiring a care-coordination lead to confirm. Mirrors the Caseload Balancing Agent's no-autonomous-assignment and the Care Team Agent's no-autonomous-assignment posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.reportable.facts-sourced",
    signal: "caseFactsSourced",
    violatingValue: false,
    violationHint: "A fabricated criterion, or a mis-enumerated case definition",
    reason:
      "A reportable-condition classification is not built from the submitted case definition + facts — every leaf predicate in the criteria trees must reference a SUBMITTED fact (no fabricated criterion inventing a requirement the definition never stated), the reported classification results must be exactly the definition's classifications in order, the referenced-fact set must match the definition's actual leaves, and the reported classification must be a defined one (or not-a-case). A fabricated criterion over- or under-states the case definition. The sourced + completeness gate — mirrors the PCP Matching Agent's matching-sourced and the Network Adequacy Agent's providers-sourced"
  },
  {
    policyId: "policy.reportable.classification-consistent",
    signal: "classificationConsistent",
    violatingValue: false,
    violationHint: "A mis-evaluated criteria tree — an over- or under-reported condition",
    reason:
      "A reportable-condition classification is not consistent with its logic — recomputing the RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION (nested all-of / any-of / not over the case's facts) of each classification's criteria tree must reproduce each reported met flag, the selected classification (the highest-precedence tree that holds, else not-a-case), and the reportable flag. A mis-evaluated tree raises a false alarm to public health (over-reports) or misses a notifiable case (under-reports). The load-bearing correctness gate — mirrors the PCP Matching Agent's matching-stable and the Care Pathway Agent's sequence-valid"
  },
  {
    policyId: "policy.reportable.no-autonomous-report",
    signal: "noAutonomousReport",
    violatingValue: false,
    violationHint: "A case reported to public health autonomously, or with no epi review",
    reason:
      "A reportable-condition classification autonomously reported the case to a public-health authority (autoReported:true — a consequential legal action that must be authorized) or did not require epidemiologist review (requiresEpiReview:false); the agent CLASSIFIES — every classification is a RECOMMENDATION requiring an epidemiologist / infection-preventionist to confirm before any report is filed. Mirrors the Adverse-Event Reporting Agent's human-review posture and the HEDIS Agent's no-autonomous-submission — the harmful action is enforced-off"
  },
  {
    policyId: "policy.timeline.events-sourced",
    signal: "timelineEventsSourced",
    violatingValue: false,
    violationHint: "A fabricated event, a dropped event, or a miscounted source contribution",
    reason:
      "A timeline merge is not built from the submitted streams — every timeline entry must trace to a SUBMITTED stream event (same source + eventId + timestamp + kind; no fabricated event), every submitted event must appear EXACTLY ONCE (none dropped, none double-listed), the per-source contributions must echo the submitted counts + actual kept / duplicate tallies, and the kept + duplicate + total counts must add up. A fabricated or dropped event silently corrupts the clinical record. The sourced + completeness gate — mirrors the Enrollment Reconciliation Agent's reconciliation-complete and the Caseload Balancing Agent's assignment-complete"
  },
  {
    policyId: "policy.timeline.merge-consistent",
    signal: "timelineMergeConsistent",
    violatingValue: false,
    violationHint: "A mis-ordered timeline or a wrong duplicate flag",
    reason:
      "A timeline merge is not consistent with its logic — recomputing the K-WAY MERGE OF SORTED STREAMS from the submitted streams must reproduce the reported chronological order (timestamps non-decreasing, ties broken by source then eventId) and the reported duplicate flags (an event flagged duplicate genuinely repeats an earlier kept event with the same content key; a kept event genuinely does not). A mis-ordered timeline hides a trend and a mis-flagged duplicate fakes a double dose. The load-bearing correctness gate — mirrors the Reportable Condition Agent's classification-consistent and the Care Pathway Agent's sequence-valid"
  },
  {
    policyId: "policy.timeline.no-autonomous-merge",
    signal: "timelineNoAutonomousMerge",
    violatingValue: false,
    violationHint: "A timeline written back / a duplicate purged autonomously, or with no steward review",
    reason:
      "A timeline merge autonomously wrote the merged timeline back to a source system of record, purged a duplicate, or overwrote a chart (autoWritten:true — each is a data-integrity action that must be authorized) or did not require steward review (requiresStewardReview:false); the agent MERGES — every merge is a RECOMMENDATION requiring a data steward to confirm. Mirrors the Enrollment Reconciliation Agent's no-autonomous-change and the Audit Log Integrity Agent's read-only posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.quality.observations-sourced",
    signal: "qualityObservationsSourced",
    violatingValue: false,
    violationHint: "A fabricated charted point, a dropped observation, or a missing parameter",
    reason:
      "A quality-measure control chart is not drawn from the submitted observations — every charted point must trace to a SUBMITTED observation (same index + value; no fabricated point), every submitted observation must appear EXACTLY ONCE (none dropped, none double-charted), and the chart parameters (target, slack, threshold) must be present numbers. A fabricated or dropped point silently rewrites the trend. The sourced + completeness gate — mirrors the Timeline Merge Agent's events-sourced and the Enrollment Reconciliation Agent's reconciliation-complete"
  },
  {
    policyId: "policy.quality.cusum-consistent",
    signal: "qualityCusumConsistent",
    violatingValue: false,
    violationHint: "A mis-charted CUSUM sum, a wrong alarm index, or a wrong signal",
    reason:
      "A quality-measure detection is not consistent with its logic — recomputing the two-sided TABULAR CUSUM from the submitted observations + parameters must reproduce every charted SH_i / SL_i, the first-alarm index, the alarm direction, the signal (in-control / shift-up-detected / shift-down-detected), and the peak sums. A mis-charted CUSUM fakes a shift that isn't there or hides one that is. The load-bearing correctness gate — mirrors the Timeline Merge Agent's merge-consistent and the Provider Benchmarking Agent's stats-consistent"
  },
  {
    policyId: "policy.quality.no-autonomous-intervention",
    signal: "qualityNoAutonomousIntervention",
    violatingValue: false,
    violationHint: "A corrective action / recall campaign launched autonomously, or with no quality review",
    reason:
      "A quality-measure detection autonomously launched a corrective action, a recall / outreach campaign, or a process change (autoActioned:true — each is a consequential action that must be authorized) or did not require quality review (requiresQualityReview:false); the agent DETECTS — every signal is a RECOMMENDATION requiring a quality reviewer to confirm. Mirrors the HEDIS Agent's no-autonomous-submission and the Care Gap Agent's human-review posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.outreach.selections-sourced",
    signal: "outreachSelectionsSourced",
    violatingValue: false,
    violationHint: "A fabricated intervention, a dropped candidate, or a miscounted tally",
    reason:
      "An outreach allocation is not built from the submitted candidates — every selected AND deferred intervention must trace to a SUBMITTED candidate (same id + cost + benefit; no fabricated intervention), every submitted candidate must appear EXACTLY ONCE across selected ∪ deferred (none dropped, none double-counted, none in both), and the reported tallies (total cost, total benefit, remaining capacity) must add up. A fabricated or dropped intervention silently rewrites the plan. The sourced + completeness gate — mirrors the Caseload Balancing Agent's assignment-complete and the Timeline Merge Agent's events-sourced"
  },
  {
    policyId: "policy.outreach.allocation-optimal",
    signal: "outreachAllocationOptimal",
    violatingValue: false,
    violationHint: "A sub-optimal or over-capacity allocation",
    reason:
      "An outreach allocation is not optimal or feasible — recomputing the 0/1 KNAPSACK dynamic-programming optimization over the submitted candidates + capacity must reproduce the reported maximum total benefit, and the reported selection must be FEASIBLE (its total cost within capacity) and OPTIMAL (its benefit equals the DP optimum). A sub-optimal allocation under-serves patients; an over-capacity one over-commits the team. The load-bearing correctness gate — mirrors the Caseload Balancing Agent's capacity-respected and the Quality Shift Agent's cusum-consistent"
  },
  {
    policyId: "policy.outreach.no-autonomous-schedule",
    signal: "outreachNoAutonomousSchedule",
    violatingValue: false,
    violationHint: "Outreach launched / plan committed autonomously, or with no care-lead review",
    reason:
      "An outreach allocation autonomously launched the outreach, committed the plan, or booked the interventions (autoScheduled:true — each is a care-delivery action that must be authorized) or did not require care-lead review (requiresCareLeadReview:false); the agent PRIORITIZES — every allocation is a RECOMMENDATION requiring a care lead to confirm, and a deferred intervention is deferred to a later cycle, never denied. Mirrors the Caseload Balancing Agent's no-autonomous-assignment and the Care Gap Agent's human-review posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.kpi.series-sourced",
    signal: "kpiSeriesSourced",
    violatingValue: false,
    violationHint: "A fabricated point, a dropped observation, or a missing parameter",
    reason:
      "A KPI-trend fit is not drawn from the submitted observations — every fitted point must trace to a SUBMITTED observation (same index + value; no fabricated point), every submitted observation must appear EXACTLY ONCE across the points (none dropped, none double-plotted), and the fit parameters (horizon, flatTolerance) must be present numbers. A fabricated or dropped point silently bends the line. The sourced + completeness gate — mirrors the Quality Shift Agent's observations-sourced and the Timeline Merge Agent's events-sourced"
  },
  {
    policyId: "policy.kpi.fit-consistent",
    signal: "kpiFitConsistent",
    violatingValue: false,
    violationHint: "A mis-fit line or a fabricated projection",
    reason:
      "A KPI-trend fit does not recompute — re-running the ordinary LEAST-SQUARES linear regression over the submitted observations must reproduce the reported slope, intercept, R², trend classification, projection, and every point's fitted value + residual. A mis-fit line or a fabricated projection misleads the plan. The load-bearing correctness gate — mirrors the Quality Shift Agent's cusum-consistent and the Provider Benchmarking Agent's stats-consistent"
  },
  {
    policyId: "policy.kpi.no-autonomous-commit",
    signal: "kpiNoAutonomousCommit",
    violatingValue: false,
    violationHint: "Projection committed as a forecast / quota autonomously, or with no analyst review",
    reason:
      "A KPI-trend fit autonomously committed the projection as an official forecast, adjusted a quota / target, or notified finance (autoCommitted:true — each is a consequential commercial action that must be authorized) or did not require analyst review (requiresAnalystReview:false); the agent PROJECTS — every projection is a RECOMMENDATION requiring a revenue analyst to confirm. Mirrors the Pipeline Management Agent's human-owner posture and the Account Management Agent's never-commit-a-contract posture — the harmful action is enforced-off"
  },
  {
    policyId: "policy.route.path-sourced",
    signal: "routePathSourced",
    violatingValue: false,
    violationHint: "A fabricated transition or a malformed path",
    reason:
      "A care route's reported path is not a real walk of the submitted graph — it must start at the start node, end at the goal, every consecutive pair must be a SUBMITTED edge (no fabricated transition), and the reported totalCost must equal the sum of those edges' weights; an honest no-route must carry an empty path, a null cost, and reachable:false. A fabricated edge invents a transition that isn't permitted. The sourced + well-formedness gate — mirrors the Claim Lifecycle Agent's states-sourced and the Care Pathway Agent's steps-sourced"
  },
  {
    policyId: "policy.route.route-optimal",
    signal: "routeOptimal",
    violatingValue: false,
    violationHint: "A sub-optimal route or a false 'unreachable'",
    reason:
      "A care route is not optimal (or honestly unreachable) — recomputing DIJKSTRA'S WEIGHTED SHORTEST PATH over the submitted edges must reproduce the reported minimum total burden, the reachable flag, and the disposition. A sub-optimal route over-burdens the patient; a false 'unreachable' strands them. The load-bearing correctness gate — mirrors the Claim Lifecycle Agent's transition-consistent and the Outreach Agent's allocation-optimal"
  },
  {
    policyId: "policy.route.no-autonomous-routing",
    signal: "routeNoAutonomousRouting",
    violatingValue: false,
    violationHint: "Transition initiated / setting booked autonomously, or with no care-lead review",
    reason:
      "A care route autonomously initiated the transition, booked the setting, or moved the patient (autoRouted:true — each is a care-delivery action that must be authorized) or did not require care-lead review (requiresCareLeadReview:false); the agent ROUTES on paper — every route is a RECOMMENDATION requiring a care lead to confirm. Mirrors the Care Gap Agent's human-review posture and the Outreach Agent's no-autonomous-schedule — the harmful action is enforced-off"
  },
  {
    policyId: "policy.consensus.votes-sourced",
    signal: "consensusVotesSourced",
    violatingValue: false,
    violationHint: "A fabricated or dropped source vote",
    reason:
      "A source-of-truth reconciliation's per-source attribution does not correspond exactly to the submitted votes — every agreement must trace to a SUBMITTED vote (same sourceId + value; no fabricated source), every submitted vote must be attributed exactly once (none dropped, none double-listed), and the reported total must equal the number of votes. A fabricated source stuffs the ballot; a dropped source disenfranchises a feed. The sourced + completeness gate — mirrors the Enrollment Reconciliation Agent's reconciliation-complete and the Timeline Merge Agent's events-sourced"
  },
  {
    policyId: "policy.consensus.consensus-consistent",
    signal: "consensusConsistent",
    violatingValue: false,
    violationHint: "A wrong winner, a false consensus, or a mis-flagged source",
    reason:
      "A source-of-truth reconciliation does not recompute — re-running the BOYER–MOORE MAJORITY VOTE over the submitted votes must reproduce the reported candidate, its count, the has-consensus flag, and the disposition, and every real source's agreement flag must equal (its value === the candidate). A wrong winner writes a minority value to the golden record; a false consensus over a plurality corrupts it. The load-bearing correctness gate — mirrors the Timeline Merge Agent's merge-consistent and the Identifier Validation Agent's checksum-consistent"
  },
  {
    policyId: "policy.consensus.no-autonomous-write",
    signal: "consensusNoAutonomousWrite",
    violatingValue: false,
    violationHint: "Golden record written / promoted autonomously, or with no steward review",
    reason:
      "A source-of-truth reconciliation autonomously wrote the consensus value to the golden record / master data, overwrote a source system, or promoted a value to system-of-record (autoWritten:true — each is a data-integrity action that must be authorized) or did not require steward review (requiresStewardReview:false); the agent RECONCILES on paper — every reconciliation is a RECOMMENDATION requiring a data steward to confirm. Mirrors the Timeline Merge Agent's no-autonomous-merge and the Enrollment Reconciliation Agent's no-autonomous-change — the harmful action is enforced-off"
  },
  {
    policyId: "policy.code.classifications-sourced",
    signal: "codeClassificationsSourced",
    violatingValue: false,
    violationHint: "A fabricated / dropped code or an invented category",
    reason:
      "A code-taxonomy classification batch does not correspond exactly to the submitted codes — there must be exactly one classification per submitted code, in the same order (no fabricated code, none dropped, none duplicated), every matched prefix must be a SUBMITTED taxonomy prefix (no invented category), each classification must be self-consistent (a category iff a matched prefix), the reported counts must add up (classified + unclassified = total = codes), and the disposition must follow. A fabricated code or invented category corrupts the value-set mapping. The sourced + completeness gate — mirrors the Identifier Validation Agent's identifiers-sourced and the Enrollment Reconciliation Agent's reconciliation-complete"
  },
  {
    policyId: "policy.code.classification-consistent",
    signal: "codeClassificationConsistent",
    violatingValue: false,
    violationHint: "A wrong bucket or a missed match",
    reason:
      "A code-taxonomy classification does not recompute — rebuilding the TRIE (PREFIX TREE) from the taxonomy and re-running the LONGEST-PREFIX MATCH over each submitted code must reproduce the reported category + matched prefix. A wrong bucket mis-maps a code; a missed match drops it from a value set it belongs to. The load-bearing correctness gate — mirrors the Identifier Validation Agent's checksum-consistent and the Source Consensus Agent's consensus-consistent"
  },
  {
    policyId: "policy.code.no-autonomous-recode",
    signal: "codeNoAutonomousRecode",
    violatingValue: false,
    violationHint: "Claim re-coded / codes submitted autonomously, or with no coder review",
    reason:
      "A code-taxonomy classification autonomously re-coded a claim, submitted the codes, or overwrote the coded record (autoApplied:true — each is a consequential coding action that must be authorized) or did not require coder review (requiresCoderReview:false); the agent CLASSIFIES on paper — every classification is a RECOMMENDATION requiring a coder to confirm. Mirrors the Identifier Validation Agent's no-autonomous-reject and the Enrollment Reconciliation Agent's no-autonomous-change — the harmful action is enforced-off"
  },
  {
    policyId: "policy.block-schedule.selection-sourced",
    signal: "blockScheduleSourced",
    violatingValue: false,
    violationHint: "A fabricated block or a double-booked resource",
    reason:
      "A resource-block schedule is not a real, feasible subset of the submitted requests — every selected id must be a SUBMITTED request (no fabricated block, none double-counted), the selected windows must be pairwise NON-OVERLAPPING (the resource is never double-booked), the reported totalWeight must equal the sum of the selected weights, the counts must add up (scheduled + contended = total = requests), and the disposition must follow. A fabricated block or a double-booked resource corrupts the schedule. The sourced + feasibility gate — mirrors the Scheduling Conflict Agent's intervals-sourced + conflict-free and the Care Routing Agent's path-sourced"
  },
  {
    policyId: "policy.block-schedule.schedule-optimal",
    signal: "blockScheduleOptimal",
    violatingValue: false,
    violationHint: "A sub-optimal schedule that leaves clinical value unbooked",
    reason:
      "A resource-block schedule is not optimal — re-running the WEIGHTED INTERVAL SCHEDULING DYNAMIC PROGRAM over the submitted requests must reproduce the reported totalWeight and the same all-scheduled / contended disposition. A sub-optimal schedule silently leaves clinical value unbooked — a request that SHOULD have been scheduled sits contended so the resource delivers less than it could. The load-bearing correctness gate — mirrors the Care Routing Agent's route-optimal and the Outreach Prioritization Agent's selection-optimal"
  },
  {
    policyId: "policy.block-schedule.no-autonomous-booking",
    signal: "blockScheduleNoAutonomousBooking",
    violatingValue: false,
    violationHint: "Block booked / bumped autonomously, or with no scheduler review",
    reason:
      "A resource-block schedule autonomously booked, bumped, or confirmed a block (autoBooked:true — each is a scheduling action that must be authorized) or did not require scheduler review (requiresSchedulerReview:false); the agent SELECTS on paper — every schedule is a RECOMMENDATION requiring a scheduler to confirm. Mirrors the Scheduling Conflict Agent's no-autonomous-booking and the Caseload Balancing Agent's no-autonomous-assignment — the harmful action is enforced-off"
  },
  {
    policyId: "policy.peak-window.window-sourced",
    signal: "peakWindowSourced",
    violatingValue: false,
    violationHint: "A fabricated / out-of-range window or an overstated sum",
    reason:
      "A peak-window finding is not a real, self-honest sub-range of the submitted series — the reported window must be a REAL contiguous sub-range (0 <= startIndex <= endIndex < n), its reported windowLength must match (end − start + 1), its reported windowSum must equal the ACTUAL sum of the series over that range, and hasPositiveWindow / disposition must follow the sum's sign. A window that runs off the series or overstates its own sum is a fabricated finding. The sourced + self-honesty gate — mirrors the Care Routing Agent's path-sourced and the Resource Scheduling Agent's selection-sourced"
  },
  {
    policyId: "policy.peak-window.window-optimal",
    signal: "peakWindowOptimal",
    violatingValue: false,
    violationHint: "A sub-optimal window that under-reports the true peak run",
    reason:
      "A peak-window finding is not optimal — re-running KADANE'S MAXIMUM-SUBARRAY over the submitted series must reproduce the reported windowSum and the same positive-window / no-positive-window disposition. A sub-optimal window under-reports the true peak run — the business misses the real momentum stretch. The load-bearing correctness gate — mirrors the Care Routing Agent's route-optimal and the Resource Scheduling Agent's schedule-optimal"
  },
  {
    policyId: "policy.peak-window.no-autonomous-action",
    signal: "peakWindowNoAutonomousAction",
    violatingValue: false,
    violationHint: "Finding committed / quota adjusted autonomously, or with no analyst review",
    reason:
      "A peak-window finding autonomously committed the finding as an official metric, adjusted a quota / target, or notified finance (autoActioned:true — each is a consequential commercial action that must be authorized) or did not require analyst review (requiresAnalystReview:false); the agent DETECTS on paper — every window is a RECOMMENDATION requiring a revenue analyst to confirm. Mirrors the KPI Trend Agent's no-autonomous-commit and the Provider Benchmarking Agent's no-autonomous-tiering — the harmful action is enforced-off"
  },
  {
    policyId: "policy.worklist.schedule-sourced",
    signal: "worklistScheduleSourced",
    violatingValue: false,
    violationHint: "A fabricated case or a mis-chained completion time",
    reason:
      "An SLA worklist schedule is not a real, self-consistent accounting of the submitted cases — the scheduled list must be a PERMUTATION of the submitted tasks (each submitted case once — no fabricated case, none dropped or double-worked), each entry must echo its case's duration + deadline, the completion times must chain (first starts at 0, each starts when the previous finishes, each completion = start + duration), each late flag must equal completion > deadline, the counts must add up, and the disposition must follow. A fabricated case or a mis-chained completion time corrupts the schedule. The sourced + self-consistency gate — mirrors the Resource Scheduling Agent's selection-sourced and the Scheduling Conflict Agent's intervals-sourced"
  },
  {
    policyId: "policy.worklist.edf-ordered",
    signal: "worklistEdfOrdered",
    violatingValue: false,
    violationHint: "A non-EDF order that needlessly breaches deadlines",
    reason:
      "An SLA worklist schedule is not earliest-deadline-first — re-running the EARLIEST-DEADLINE-FIRST (EDF) discipline over the submitted cases must reproduce the reported ORDER (cases sequenced by deadline ascending, tie-break by case id). A non-EDF order needlessly breaches deadlines that a correct order would have met — the whole point of the discipline. The load-bearing correctness gate — mirrors the Resource Scheduling Agent's schedule-optimal and the Care Routing Agent's route-optimal"
  },
  {
    policyId: "policy.worklist.no-autonomous-dispatch",
    signal: "worklistNoAutonomousDispatch",
    violatingValue: false,
    violationHint: "Case dispatched / started / reassigned autonomously, or with no reviewer review",
    reason:
      "An SLA worklist schedule autonomously dispatched, started, or reassigned a case (autoDispatched:true — each is a work-assignment action that must be authorized) or did not require reviewer review (requiresReviewerReview:false); the agent SEQUENCES on paper — every worklist is a RECOMMENDATION requiring a supervisor to confirm. Mirrors the Resource Scheduling Agent's no-autonomous-booking and the Caseload Balancing Agent's no-autonomous-assignment — the harmful action is enforced-off"
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
    policyId: "policy.data-sharing.purpose-catalog-sourced",
    signal: "purposesTraceToCatalog",
    violatingValue: false,
    violationHint: "Data-sharing decision cites an off-catalog exchange purpose / network / rule / reason",
    reason:
      "A data-sharing decision cited an exchange purpose outside EXCHANGE_PURPOSES (treatment / payment / operations / patient-request / public-health / research), an exchange network outside EXCHANGE_NETWORKS (TEFCA QHIN / Carequality / CommonWell / Direct Secure Messaging), an applied rule outside DATA_SHARING_RULES, or a reason code outside DATA_SHARING_REASON_CODES — every exchange must trace to the catalog; a bespoke exchange purpose doesn't map to a HIPAA disclosure permission and would open the network to unauthorized aggregation"
  },
  {
    policyId: "policy.data-sharing.no-autonomous-non-tpo-release",
    signal: "releaseHonorsNonTpoConsent",
    violatingValue: false,
    violationHint: "PHI released for a non-TPO purpose without an active consent scope",
    reason:
      "A data-sharing decision authorized release of PHI for a non-TPO purpose (research / public-health / patient-request / any off-catalog use) without an active patient consent scope on file for that exact purpose — this is a HIPAA §164.506 violation and the documented breach pattern behind the majority of OCR enforcement actions. The safe answer when consent is missing is decision:'blocked-consent-required-non-tpo' routed to consent-capture. TPO purposes (treatment / payment / operations) do NOT need consent, but every other purpose does"
  },
  {
    policyId: "policy.data-sharing.participant-verified",
    signal: "participantIdentityVerified",
    violatingValue: false,
    violationHint: "Data-sharing release authorized to an unverified requester participant",
    reason:
      "A data-sharing decision authorized release of PHI to a requester whose identity is not attested against the TEFCA / Carequality / CommonWell participant registry — under 45 CFR 171 + the TEFCA Common Agreement a QHIN / participant / sub-participant must be identity-attested before a cross-org exchange is authorized. Releasing to an unverified counterparty is a federated-identity trust failure that opens the network to spoofing and unauthorized aggregation. The safe answer is decision:'blocked-participant-unverified' routed to participant-registry-verification"
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
    policyId: "policy.riskadj.evidence-supported-coding",
    signal: "codesTraceToClinicalEvidence",
    violatingValue: false,
    violationHint: "Presents a confirmed/suspected HCC as supported without documented clinical evidence",
    reason:
      "A confirmed / suspected HCC did not trace to documented clinical evidence in the catalog (a fabricated / unsupported code presented as supported, or an off-catalog HCC); every confirmed / suspected HCC must trace to the documented clinical evidence that supports it — the agent may not upcode by asserting a condition the record does not support"
  },
  {
    policyId: "policy.riskadj.clinician-validation-required",
    signal: "codingRequiresClinicianValidation",
    violatingValue: false,
    violationHint: "Uses a suspected code as final without clinician validation",
    reason:
      "Attempted to finalize / submit a suspected risk-adjustment code without a clinician's validation; every suspected code is a recommendation only and requires a human clinician to confirm it before use — the agent may only surface a suspected code for clinician validation"
  },
  {
    policyId: "policy.riskadj.no-autonomous-submission",
    signal: "noAutonomousCodeSubmission",
    violatingValue: false,
    violationHint: "Autonomously submits codes or adjusts a claim / RAF",
    reason:
      "Attempted to autonomously submit risk-adjustment codes or adjust a claim / RAF for reimbursement; the agent is a recommender + integrity checker and may NEVER submit a code or adjust a claim on its own — a code submission is a human action after clinician validation"
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
