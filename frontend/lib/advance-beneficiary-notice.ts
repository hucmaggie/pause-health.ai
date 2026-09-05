/**
 * Advance Beneficiary Notice (Medicare ABN) — the deterministic, transparent patient-access layer
 * that decides, for a Medicare service likely to be DENIED as not-reasonable-and-necessary (or
 * statutorily excluded), whether a signed pre-service ABN (Form CMS-R-131) is REQUIRED, whether
 * the beneficiary may be billed for the service, and which liability modifier applies (GA / GZ /
 * GY) — never autonomously assigning patient financial liability.
 *
 * Deterministic, dependency-free domain core the Advance Beneficiary Notice Agent
 * (app/api/agents/advance-beneficiary-notice) wraps — a patient-access / benefits-verification
 * service on the patient/clinical plane of Pause's Agent Fabric. Given a proposed service (the
 * cited Medicare coverage rule, whether the service meets the coverage criteria or exceeds a
 * frequency limit, and whether an ABN was issued and signed BEFORE the service), it
 * DETERMINISTICALLY assesses coverage (likely-covered / likely-non-covered / statutorily-excluded),
 * decides whether an ABN is required, computes whether a valid pre-service ABN is on file, decides
 * whether the beneficiary may be billed, assigns the CMS liability modifier, and decides the
 * disposition — every non-covered decision citing its coverage rule.
 *
 *   Inbound:  an AbnServiceRequest { requestRef, coverageRuleId, serviceType, meetsCoverageCriteria?,
 *             frequencyExceeded?, abnIssued, abnSignedBeforeService, serviceRendered? }
 *   Outbound: an AbnDetermination { coverageAssessment, abnRequired, abnValid, patientMayBeBilled,
 *             modifier, disposition, requiresHumanReview, autoAssignedLiability:false, reason,
 *             synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other patient-access / financial agents: distinct
 * from the Good Faith Estimate agent (the No Surprises Act SELF-PAY / uninsured pre-service
 * estimate), the Balance Billing agent (the No Surprises Act CLAIM-time surprise-bill prohibition),
 * the Benefits & Coverage Verification (EBV) agent (plan eligibility), and the Financial Assistance
 * agent (501(r) charity care): this decides one narrow Medicare question — is a signed pre-service
 * ABN required before a likely-denied service, and may the beneficiary be billed for it.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every non-coverage decision cites a recorded Medicare coverage rule.
 * ─────────────────────────────────────────────────────────────────────
 *  A coverage / ABN decision must cite a recorded Medicare coverage rule (LCD/NCD-style) from the
 *  catalog — an ad-hoc / un-sourced rule (a missing or off-catalog rule id) is not a real coverage
 *  determination. abnCoverageRuleSourced() reports the honest signal the Agent Fabric enforces via
 *  policy.abn.coverage-rule-sourced. (Mirrors the Good Faith Estimate Agent's charge-master-sourced
 *  and the Timely Filing Agent's filing-limit-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: a likely-non-covered service requires a pre-service ABN.
 * ─────────────────────────────────────────────────────────────────────
 *  When a service is likely NON-covered (fails its coverage criteria), a signed ABN issued BEFORE
 *  the service is MANDATORY (abnRequired:true) — a determination that a likely-non-covered service
 *  needs no ABN understates the beneficiary's exposure and is how a surprise Medicare denial lands
 *  on the patient. abnRequiredWhenNoncovered() reports the honest signal the Agent Fabric enforces
 *  via policy.abn.abn-required-when-noncovered. (The load-bearing completeness/correctness gate —
 *  mirrors the Good Faith Estimate Agent's expected-items-complete.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: patient financial liability is never assigned autonomously.
 * ─────────────────────────────────────────────────────────────────────
 *  The beneficiary may be billed for a likely-non-covered service ONLY when a valid pre-service
 *  ABN is on file (the GA modifier); without a valid ABN the provider — not the patient — is
 *  liable (the GZ modifier / write-off). And any non-covered / excluded determination is a
 *  RECOMMENDATION requiring human review before liability is assigned — the agent NEVER
 *  autonomously bills the beneficiary. abnNoAutonomousBeneficiaryLiability() reports the honest
 *  signal the Agent Fabric enforces via policy.abn.no-autonomous-beneficiary-liability. (Mirrors
 *  the Balance Billing Agent's no-autonomous-balance-bill and the Timely Filing Agent's
 *  no-autonomous-write-off posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — covered OR non-covered OR excluded — is a SAFE, honest OUTPUT: the task
 *  COMPLETES (a non-covered / excluded determination carries requiresHumanReview:true). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (an un-sourced coverage
 *  rule, a likely-non-covered service marked as needing no ABN, or a beneficiary billed without a
 *  valid ABN / an auto-assigned liability) — which the Agent Fabric rejects before it can leave
 *  the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified Medicare coverage engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The coverage rules, categories, and modifier logic below are clearly-labeled ILLUSTRATIVE
 *  synthetics chosen to model the SHAPE of the ABN decision deterministically in the demo — they
 *  are NOT real Medicare coverage. Real ABN decisions are governed by the Medicare National /
 *  Local Coverage Determinations (NCD/LCD), the Social Security Act §1862(a), the CMS Medicare
 *  Claims Processing Manual (Ch. 30), and Form CMS-R-131. There is NO randomness and NO clock
 *  anywhere here: the determination is a pure function of the request's own fields, so the same
 *  service always yields the same coverage assessment / ABN requirement / modifier / disposition
 *  — which is what lets the demo, the seeded trace, and the tests agree.
 */

/** The Medicare coverage category a rule governs. */
export type MedicareCoverageCategory =
  | "reasonable-necessary"
  | "frequency-limited"
  | "statutorily-excluded";

/** A recorded Medicare coverage rule (an LCD/NCD-style catalog entry). */
export type MedicareCoverageRule = {
  /** Stable rule id. */
  id: string;
  /** The service the rule governs (informational). */
  serviceType: string;
  /** The coverage category that drives the ABN logic. */
  category: MedicareCoverageCategory;
  /** Human-readable description. */
  description: string;
};

/**
 * ILLUSTRATIVE, synthetic Medicare coverage catalog — clearly labeled, NOT real coverage. Real
 * coverage comes from the Medicare NCD/LCD, the Social Security Act §1862(a), and CMS guidance.
 */
export const MEDICARE_COVERAGE_RULES: MedicareCoverageRule[] = [
  {
    id: "rule.abn.vitamin-d-testing",
    serviceType: "Vitamin D screening lab",
    category: "reasonable-necessary",
    description:
      "Reasonable & necessary only with a qualifying clinical indication (illustrative LCD)."
  },
  {
    id: "rule.abn.dexa-bone-density",
    serviceType: "DEXA bone-density scan",
    category: "frequency-limited",
    description:
      "Bone-mass measurement — covered once every 24 months; a more frequent scan requires documented medical necessity (illustrative)."
  },
  {
    id: "rule.abn.cosmetic-procedure",
    serviceType: "Cosmetic procedure",
    category: "statutorily-excluded",
    description:
      "Statutorily excluded from Medicare — Social Security Act §1862(a)(10) (illustrative)."
  }
];

/** Look up a coverage rule by id (undefined when off-catalog). */
export function getCoverageRule(id: string): MedicareCoverageRule | undefined {
  return MEDICARE_COVERAGE_RULES.find((r) => r.id === id);
}

/** The coverage assessment for the proposed service. */
export type CoverageAssessment =
  | "likely-covered"
  | "likely-non-covered"
  | "statutorily-excluded";

/** The CMS liability modifier appended to the claim line. */
export type AbnModifier = "none" | "GA" | "GZ" | "GY";

/** The disposition after the ABN decision. */
export type AbnDisposition =
  | "proceed-covered"
  | "issue-abn-before-service"
  | "bill-beneficiary-with-abn"
  | "notify-statutory-exclusion";

/** A proposed-service ABN request. */
export type AbnServiceRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** The cited Medicare coverage rule id. */
  coverageRuleId: string;
  /** The service (informational; the rule carries the governing category). */
  serviceType: string;
  /** For a reasonable-necessary rule: whether the service meets the coverage criteria. */
  meetsCoverageCriteria?: boolean;
  /** For a frequency-limited rule: whether the frequency limit is exceeded. */
  frequencyExceeded?: boolean;
  /** Whether an ABN (Form CMS-R-131) was issued to the beneficiary. */
  abnIssued: boolean;
  /** Whether the ABN was signed BEFORE the service was rendered. */
  abnSignedBeforeService: boolean;
  /** Optional: whether the service has already been rendered (informational). */
  serviceRendered?: boolean;
};

/** The deterministic ABN determination the agent returns. */
export type AbnDetermination = {
  /** Synthetic request reference. */
  requestRef: string;
  /** The cited coverage rule id. */
  coverageRuleId: string;
  /** The service type. */
  serviceType: string;
  /** The cited rule's coverage category ('unknown' when the rule is off-catalog). */
  coverageCategory: MedicareCoverageCategory | "unknown";
  /** The coverage assessment. */
  coverageAssessment: CoverageAssessment;
  /** Whether a signed pre-service ABN is required (true for a likely-non-covered service). */
  abnRequired: boolean;
  /** Whether an ABN was issued. */
  abnIssued: boolean;
  /** Whether a valid pre-service ABN is on file (issued AND signed before the service). */
  abnValid: boolean;
  /** Whether the beneficiary may be billed for the service. */
  patientMayBeBilled: boolean;
  /** The CMS liability modifier. */
  modifier: AbnModifier;
  /** The disposition. */
  disposition: AbnDisposition;
  /** Whether the determination requires human review (any non-covered / excluded assessment). */
  requiresHumanReview: boolean;
  /** Always false — the agent never autonomously assigns beneficiary liability. */
  autoAssignedLiability: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the coverage rules are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * The deterministic ABN function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own fields + the cited coverage rule (no randomness, no clock). It assesses coverage,
 * decides whether an ABN is required, computes whether a valid pre-service ABN is on file, decides
 * whether the beneficiary may be billed, assigns the CMS liability modifier, and decides the
 * disposition. Nothing is billed here — a non-covered / excluded determination is a recommendation
 * requiring human review.
 */
export function evaluateAbn(request: AbnServiceRequest): AbnDetermination {
  const rule = getCoverageRule(request.coverageRuleId);
  const coverageCategory: MedicareCoverageCategory | "unknown" = rule?.category ?? "unknown";

  let coverageAssessment: CoverageAssessment;
  if (!rule) {
    // Off-catalog rule: cannot establish coverage — treat conservatively as likely-non-covered
    // (which the coverage-rule-sourced gate blocks anyway when asserted).
    coverageAssessment = "likely-non-covered";
  } else if (rule.category === "statutorily-excluded") {
    coverageAssessment = "statutorily-excluded";
  } else if (rule.category === "frequency-limited") {
    coverageAssessment = request.frequencyExceeded === true ? "likely-non-covered" : "likely-covered";
  } else {
    // reasonable-necessary
    coverageAssessment =
      request.meetsCoverageCriteria === false ? "likely-non-covered" : "likely-covered";
  }

  const abnRequired = coverageAssessment === "likely-non-covered";
  const abnIssued = request.abnIssued === true;
  const abnValid = abnIssued && request.abnSignedBeforeService === true;

  const patientMayBeBilled =
    coverageAssessment === "statutorily-excluded"
      ? true // statutorily-excluded services are the beneficiary's responsibility
      : coverageAssessment === "likely-non-covered"
        ? abnValid // billable to the beneficiary ONLY with a valid pre-service ABN
        : false; // likely-covered → billed to Medicare, no denial liability

  const modifier: AbnModifier =
    coverageAssessment === "likely-covered"
      ? "none"
      : coverageAssessment === "statutorily-excluded"
        ? "GY"
        : abnValid
          ? "GA" // waiver of liability (valid ABN on file)
          : "GZ"; // expected denial, no ABN — provider liable

  const disposition: AbnDisposition =
    coverageAssessment === "likely-covered"
      ? "proceed-covered"
      : coverageAssessment === "statutorily-excluded"
        ? "notify-statutory-exclusion"
        : abnValid
          ? "bill-beneficiary-with-abn"
          : "issue-abn-before-service";

  const requiresHumanReview = coverageAssessment !== "likely-covered";

  const reason = !rule
    ? `Request ${request.requestRef}: coverage rule '${request.coverageRuleId}' is not in the catalog — cannot establish coverage; human review required`
    : coverageAssessment === "likely-covered"
      ? `Request ${request.requestRef}: LIKELY COVERED under ${rule.id} — no ABN required; proceed and bill Medicare`
      : coverageAssessment === "statutorily-excluded"
        ? `Request ${request.requestRef}: STATUTORILY EXCLUDED under ${rule.id} — never covered by Medicare; the beneficiary is liable (modifier GY), a voluntary ABN is recommended; human review required`
        : abnValid
          ? `Request ${request.requestRef}: LIKELY NON-COVERED under ${rule.id} with a valid pre-service ABN on file → the beneficiary may be billed (modifier GA); human review required`
          : `Request ${request.requestRef}: LIKELY NON-COVERED under ${rule.id} with NO valid pre-service ABN → issue an ABN before the service; without one the PROVIDER is liable (modifier GZ) and the beneficiary may NOT be billed; human review required`;

  return {
    requestRef: request.requestRef,
    coverageRuleId: request.coverageRuleId,
    serviceType: request.serviceType,
    coverageCategory,
    coverageAssessment,
    abnRequired,
    abnIssued,
    abnValid,
    patientMayBeBilled,
    modifier,
    disposition,
    requiresHumanReview,
    autoAssignedLiability: false,
    reason,
    synthetic: true,
    note:
      `ABN check for ${request.requestRef}: ${coverageAssessment}, abnRequired=${abnRequired}, abnValid=${abnValid}, patientMayBeBilled=${patientMayBeBilled}, modifier ${modifier}, disposition ${disposition}. ` +
      "Synthetic/illustrative Medicare coverage rules — NOT a certified coverage engine; real ABN decisions are governed by the Medicare NCD/LCD, the Social Security Act §1862(a), the CMS Medicare Claims Processing Manual (Ch. 30), and Form CMS-R-131."
  };
}

/**
 * Coverage-rule-sourced check: does the determination cite a recorded Medicare coverage rule? True
 * only when the cited rule id resolves in the catalog; the guard that catches an ad-hoc /
 * un-sourced coverage decision. Anything evaluateAbn() produces from a cataloged rule satisfies it.
 * This is the honest signal the route reports to policy.abn.coverage-rule-sourced. A non-object
 * input is a violation.
 */
export function abnCoverageRuleSourced(
  determination: Pick<AbnDetermination, "coverageRuleId"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return getCoverageRule(determination.coverageRuleId) !== undefined;
}

/**
 * ABN-required-when-non-covered check: when the service is likely non-covered, does the
 * determination flag abnRequired:true? True unless a likely-non-covered determination claims no
 * ABN is required (which understates the beneficiary's exposure). Anything evaluateAbn() produces
 * satisfies it. This is the honest signal the route reports to
 * policy.abn.abn-required-when-noncovered. A non-object input is a violation.
 */
export function abnRequiredWhenNoncovered(
  determination:
    | { coverageAssessment?: CoverageAssessment; abnRequired?: boolean }
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (determination.coverageAssessment === "likely-non-covered" && determination.abnRequired === false) {
    return false;
  }
  return true;
}

/**
 * No-autonomous-beneficiary-liability check: did the agent avoid autonomously assigning patient
 * liability? True unless the determination auto-assigns liability, bills the beneficiary for a
 * likely-non-covered service WITHOUT a valid ABN, or assigns liability on a non-covered / excluded
 * service without requiring human review; the guard that catches an unsafe / autonomous liability
 * assignment. Anything evaluateAbn() produces satisfies it. This is the honest signal the route
 * reports to policy.abn.no-autonomous-beneficiary-liability. A non-object input is a violation.
 */
export function abnNoAutonomousBeneficiaryLiability(
  determination:
    | {
        coverageAssessment?: CoverageAssessment;
        patientMayBeBilled?: boolean;
        abnValid?: boolean;
        requiresHumanReview?: boolean;
        autoAssignedLiability?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (determination.autoAssignedLiability === true) return false;
  if (
    determination.coverageAssessment === "likely-non-covered" &&
    determination.patientMayBeBilled === true &&
    determination.abnValid !== true
  ) {
    return false;
  }
  if (
    determination.coverageAssessment !== undefined &&
    determination.coverageAssessment !== "likely-covered" &&
    determination.requiresHumanReview === false
  ) {
    return false;
  }
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric
 * trace + the response `meta`.
 */
export function abnSummary(determination: AbnDetermination): {
  requestRef: string;
  coverageRuleId: string;
  coverageAssessment: CoverageAssessment;
  abnRequired: boolean;
  abnValid: boolean;
  patientMayBeBilled: boolean;
  modifier: AbnModifier;
  disposition: AbnDisposition;
  requiresHumanReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: determination.requestRef,
    coverageRuleId: determination.coverageRuleId,
    coverageAssessment: determination.coverageAssessment,
    abnRequired: determination.abnRequired,
    abnValid: determination.abnValid,
    patientMayBeBilled: determination.patientMayBeBilled,
    modifier: determination.modifier,
    disposition: determination.disposition,
    requiresHumanReview: determination.requiresHumanReview,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request: a vitamin-D lab that MEETS its coverage criteria → likely-covered,
 * no ABN required, proceed. Synthetic.
 */
export const DEMO_ABN_REQUEST: AbnServiceRequest = {
  requestRef: "abn-req-001",
  coverageRuleId: "rule.abn.vitamin-d-testing",
  serviceType: "Vitamin D screening lab",
  meetsCoverageCriteria: true,
  abnIssued: false,
  abnSignedBeforeService: false
};

/**
 * A representative demo request: a vitamin-D lab that FAILS its coverage criteria with NO ABN on
 * file → likely-non-covered, ABN required before the service (modifier GZ; provider liable).
 * Synthetic.
 */
export const DEMO_ABN_NONCOVERED_REQUEST: AbnServiceRequest = {
  requestRef: "abn-req-002",
  coverageRuleId: "rule.abn.vitamin-d-testing",
  serviceType: "Vitamin D screening lab",
  meetsCoverageCriteria: false,
  abnIssued: false,
  abnSignedBeforeService: false
};

/**
 * A representative demo request: a DEXA scan exceeding its 24-month frequency limit WITH a valid
 * pre-service ABN on file → likely-non-covered, beneficiary billable (modifier GA), human review.
 * Synthetic.
 */
export const DEMO_ABN_WITH_ABN_REQUEST: AbnServiceRequest = {
  requestRef: "abn-req-003",
  coverageRuleId: "rule.abn.dexa-bone-density",
  serviceType: "DEXA bone-density scan",
  frequencyExceeded: true,
  abnIssued: true,
  abnSignedBeforeService: true
};

/**
 * A representative demo request: a statutorily-excluded cosmetic procedure → beneficiary liable
 * (modifier GY), voluntary ABN recommended, human review. Synthetic.
 */
export const DEMO_ABN_EXCLUDED_REQUEST: AbnServiceRequest = {
  requestRef: "abn-req-004",
  coverageRuleId: "rule.abn.cosmetic-procedure",
  serviceType: "Cosmetic procedure",
  abnIssued: false,
  abnSignedBeforeService: false
};
