/**
 * Patient Financial Assistance & Charity Care — the deterministic, transparent
 * patient-access layer that screens a self-pay / underinsured patient for hospital
 * financial assistance (charity care) under an IRS 501(r) Financial Assistance Policy
 * (FAP), grounded in the HHS Federal Poverty Level (FPL) guidelines.
 *
 * Deterministic, dependency-free domain core the Patient Financial Assistance & Charity
 * Care Agent (app/api/agents/financial-assistance) wraps — a patient-access service on
 * the patient/clinical plane of Pause's Agent Fabric, a sibling to the Benefits &
 * Coverage Verification (EBV) agent (EBV verifies what the patient's plan covers; this
 * screens the self-pay / patient-responsibility remainder for charity care). Given a
 * household size + annual income (+ the FPL year, an optional presumptive-eligibility
 * signal, whether the FAP application is complete, and whether an extraordinary
 * collection action is being requested), it DETERMINISTICALLY computes the household's
 * income as a percentage of the FPL, cites the governing FAP tier from a schedule, and
 * classifies the patient as full-charity / partial-charity / not-eligible with a
 * discount percentage. It NEVER autonomously DENIES assistance (a not-eligible
 * determination is a RECOMMENDATION requiring human review with written notice + appeal
 * rights), and it NEVER lets an extraordinary collection action (ECA) proceed before
 * financial-assistance screening is complete.
 *
 *   Inbound:  a FinancialAssistanceRequest { patientRef, householdSize, annualIncome,
 *             fplYear, presumptiveReasonId?, applicationComplete, ecaRequested }
 *   Outbound: a FinancialAssistanceDetermination { fplBase, fplPercent, assistanceTier,
 *             tierId, discountPct, presumptivelyEligible, screeningComplete, ecaAllowed,
 *             requiresHumanReview, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the Benefits & Coverage Verification / EBV
 * agent (which verifies plan eligibility + estimates the covered visit cost): this
 * screens the patient-responsibility remainder for CHARITY CARE, a different question
 * than what the plan covers. It is also distinct from the SDOH Screening agent (which
 * screens for health-related social needs).
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: no extraordinary collection action before screening.
 * ─────────────────────────────────────────────────────────────────────
 *  An extraordinary collection action (ECA — sending a bill to collections, reporting
 *  to a credit agency, a lien, etc.) may NEVER proceed before financial-assistance
 *  screening is complete. IRS 501(r)(6) requires a hospital to make reasonable efforts
 *  to determine FAP eligibility BEFORE any ECA. ecaGatedOnScreening() reports the honest
 *  signal the Agent Fabric enforces via policy.finassist.no-eca-before-screening.
 *  (Mirrors the Data Retention Agent's legal-hold-overrides-purge and the Overpayment &
 *  Recovery Agent's within-lookback-window — a legal precondition bounds the action.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: every determination is FAP-schedule-sourced.
 * ─────────────────────────────────────────────────────────────────────
 *  Every determination must cite the governing FAP tier from the schedule (or a
 *  recorded presumptive-eligibility reason) — there is no ad-hoc, un-sourced eligibility
 *  decision. finAssistScheduleCited() reports the honest signal the Agent Fabric enforces
 *  via policy.finassist.fap-schedule-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous denial (human-review-gated).
 * ─────────────────────────────────────────────────────────────────────
 *  A not-eligible determination is a DENIAL of charity care — a RECOMMENDATION requiring
 *  human review with written notice + appeal rights (501(r)(4)), never an autonomous
 *  denial. finAssistHumanReviewed() reports the honest signal the Agent Fabric enforces
 *  via policy.finassist.no-autonomous-denial.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE RECOMMENDATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  GRANTING full or partial charity — and even a not-eligible RECOMMENDATION — are SAFE,
 *  honest OUTPUTS: the task COMPLETES (a not-eligible determination carries
 *  requiresHumanReview:true and never an autonomous denial). A GOVERNANCE BLOCK is when a
 *  caller PRESENTS an offending DETERMINATION (an ECA asserted before screening is
 *  complete, a determination with no cited FAP tier, or an autonomous denial) — which the
 *  Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified financial-assistance system.
 * ─────────────────────────────────────────────────────────────────────
 *  The FAP tier schedule, discount percentages, FPL table, and presumptive-eligibility
 *  reasons below are ILLUSTRATIVE synthetic/demo values chosen to model the SHAPE of a
 *  governed charity-care control — they are NOT a certified financial-assistance product,
 *  and a REAL hospital FAP is governed by IRS 501(r) + its implementing regulations
 *  (26 CFR 1.501(r)), the annually-published HHS Federal Poverty Guidelines, and each
 *  hospital's Board-approved FAP + state charity-care law (eligibility thresholds,
 *  AGB / amounts-generally-billed limits, presumptive-eligibility rules, and ECA notice
 *  periods all differ). The patient reference + amounts are synthetic / de-identified.
 *  There is NO randomness and NO clock anywhere here: the determination is a pure
 *  function of the household size + income + FPL year + the request's own flags (no
 *  Date.now()), so the same request always yields the same tier + discount + eligibility
 *  — which is what lets the demo, the seeded trace, and the tests agree.
 */

/** The charity-care classification the agent produces for a patient. */
export type AssistanceTier = "full-charity" | "partial-charity" | "not-eligible";

/**
 * A single FAP tier in the schedule — an FPL bracket mapped to a charity-care discount.
 * Illustrative/synthetic; NOT a certified FAP (see the header).
 */
export type FapTier = {
  /** Stable catalog id (cited on every determination). */
  id: string;
  /** Human-readable tier label. */
  label: string;
  /** The classification this tier grants. */
  tier: AssistanceTier;
  /** Inclusive upper bound of the FPL% bracket (Infinity for the top tier). */
  maxFplPercent: number;
  /** The discount applied to the patient-responsibility balance (0–100). */
  discountPct: number;
  /** Illustrative description. Demo-honest. */
  description: string;
};

/**
 * The FAP tier schedule — ordered by FPL bracket, ascending. Every determination cites
 * one of these (or a presumptive reason). Illustrative/synthetic; NOT a certified FAP
 * (see the header). Real FAP tiers + thresholds are Board-approved and jurisdiction-specific.
 */
export const FAP_SCHEDULE: FapTier[] = [
  {
    id: "fap.tier.full-charity",
    label: "Full charity (≤200% FPL)",
    tier: "full-charity",
    maxFplPercent: 200,
    discountPct: 100,
    description:
      "Household income at or below 200% of the Federal Poverty Level → 100% write-off of the patient-responsibility balance. (Illustrative.)"
  },
  {
    id: "fap.tier.partial-75",
    label: "Partial charity — 75% discount (201–300% FPL)",
    tier: "partial-charity",
    maxFplPercent: 300,
    discountPct: 75,
    description:
      "Household income 201–300% of the FPL → 75% discount on the patient-responsibility balance. (Illustrative.)"
  },
  {
    id: "fap.tier.partial-50",
    label: "Partial charity — 50% discount (301–400% FPL)",
    tier: "partial-charity",
    maxFplPercent: 400,
    discountPct: 50,
    description:
      "Household income 301–400% of the FPL → 50% discount on the patient-responsibility balance. (Illustrative.)"
  },
  {
    id: "fap.tier.not-eligible",
    label: "Not eligible (>400% FPL)",
    tier: "not-eligible",
    maxFplPercent: Infinity,
    discountPct: 0,
    description:
      "Household income above 400% of the FPL → not eligible for charity care under this illustrative FAP. A DENIAL requiring human review + written notice + appeal rights. (Illustrative.)"
  }
];

const FAP_TIER_BY_ID = new Map(FAP_SCHEDULE.map((t) => [t.id, t]));

/**
 * The presumptive-eligibility reason catalog — signals that grant full charity
 * regardless of documented income (a patient who is Medicaid-eligible, experiencing
 * homelessness, deceased with no estate, or SNAP-enrolled is presumptively eligible).
 * Illustrative/synthetic; NOT a certified presumptive-eligibility set (see the header).
 */
export const PRESUMPTIVE_REASONS: { id: string; label: string; description: string }[] = [
  {
    id: "presumptive.medicaid-eligible",
    label: "Medicaid-eligible / enrolled",
    description:
      "The patient is enrolled in or eligible for Medicaid → presumptively eligible for full charity. (Illustrative.)"
  },
  {
    id: "presumptive.homelessness",
    label: "Experiencing homelessness",
    description:
      "The patient is documented as experiencing homelessness → presumptively eligible for full charity. (Illustrative.)"
  },
  {
    id: "presumptive.snap-enrolled",
    label: "SNAP / food-assistance enrolled",
    description:
      "The patient is enrolled in SNAP or another means-tested program → presumptively eligible for full charity. (Illustrative.)"
  },
  {
    id: "presumptive.deceased-no-estate",
    label: "Deceased with no estate",
    description:
      "The patient is deceased with no estate to bill → presumptively eligible for full charity. (Illustrative.)"
  }
];

const PRESUMPTIVE_REASON_IDS = new Set<string>(PRESUMPTIVE_REASONS.map((r) => r.id));

/** The id of the tier a presumptively-eligible patient is granted. */
export const PRESUMPTIVE_FULL_CHARITY_TIER_ID = "fap.tier.full-charity";

/**
 * The illustrative Federal Poverty Level base table (annual income) by household size.
 * Synthetic/demo values approximating the shape of the HHS Federal Poverty Guidelines
 * for the 48 contiguous states — NOT the certified, annually-published guidelines (see
 * the header). Households larger than the table extrapolate by FPL_INCREMENT per person.
 */
export const FPL_TABLE: Record<number, number> = {
  1: 15060,
  2: 20440,
  3: 25820,
  4: 31200,
  5: 36580,
  6: 41960,
  7: 47340,
  8: 52720
};

/** Per-additional-person increment above the largest tabulated household. */
export const FPL_INCREMENT = 5380;

/** Is `id` a recognized FAP tier id? */
export function isFapTier(id: unknown): boolean {
  return typeof id === "string" && FAP_TIER_BY_ID.has(id);
}

/** Is `id` a recognized presumptive-eligibility reason id? */
export function isPresumptiveReason(id: unknown): boolean {
  return typeof id === "string" && PRESUMPTIVE_REASON_IDS.has(id);
}

/**
 * The Federal Poverty Level (annual income) for a household size. Deterministic: the
 * table for 1–8, then FPL_INCREMENT per additional person. A non-positive size falls
 * back to the 1-person base.
 */
export function fplForHousehold(householdSize: number): number {
  const size = Number.isFinite(householdSize) ? Math.floor(householdSize) : 1;
  if (size <= 1) return FPL_TABLE[1];
  if (FPL_TABLE[size] !== undefined) return FPL_TABLE[size];
  return FPL_TABLE[8] + FPL_INCREMENT * (size - 8);
}

/** A financial-assistance / charity-care screening request. */
export type FinancialAssistanceRequest = {
  /** Synthetic, de-identified patient reference. */
  patientRef: string;
  /** Household size (persons). */
  householdSize: number;
  /** Annual household income (illustrative dollars). */
  annualIncome: number;
  /** The FPL guideline year the screen is run against (illustrative, e.g. 2025). */
  fplYear: number;
  /** An optional presumptive-eligibility reason id (grants full charity when recognized). */
  presumptiveReasonId?: string;
  /** Whether the FAP application is complete (documentation received). */
  applicationComplete: boolean;
  /** Whether an extraordinary collection action (ECA) is being requested on the account. */
  ecaRequested: boolean;
};

/** The deterministic financial-assistance determination the agent returns. */
export type FinancialAssistanceDetermination = {
  /** Synthetic, de-identified patient reference. */
  patientRef: string;
  /** The household size evaluated. */
  householdSize: number;
  /** The annual income evaluated. */
  annualIncome: number;
  /** The FPL guideline year evaluated. */
  fplYear: number;
  /** The FPL base (annual income threshold) for this household size. */
  fplBase: number;
  /** The household income as a percentage of the FPL (rounded to a whole percent). */
  fplPercent: number;
  /** The charity-care classification. */
  assistanceTier: AssistanceTier;
  /** The cited FAP tier id (always a recognized tier). */
  tierId: string;
  /** The cited FAP tier label. */
  tierLabel: string;
  /** The discount applied to the patient-responsibility balance (0–100). */
  discountPct: number;
  /** True when granted via a recorded presumptive-eligibility reason. */
  presumptivelyEligible: boolean;
  /** The presumptive reason id, when applicable. */
  presumptiveReasonId?: string;
  /** True when financial screening is complete (application complete or presumptively eligible). */
  screeningComplete: boolean;
  /** True only when an ECA may proceed (requested AND screening complete AND not eligible for charity). */
  ecaAllowed: boolean;
  /** True whenever the determination is a denial (not-eligible) requiring human review. */
  requiresHumanReview: boolean;
  /** Human-readable reason (cites the deciding factor). */
  reason: string;
  /** Always true — the FAP schedule + FPL table are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Stable reason phrases (kept as constants for testability). */
export const FIN_ASSIST_REASON_TEXT = {
  presumptive:
    "presumptively eligible for full charity via a recorded presumptive-eligibility reason — granted regardless of documented income",
  fullCharity:
    "household income at or below the full-charity FPL threshold — full charity (a benefit granted; no denial)",
  partialCharity:
    "household income within a partial-charity FPL bracket — a discount granted (a benefit; no denial)",
  notEligible:
    "household income above the FAP's top FPL threshold — a DENIAL of charity care, a RECOMMENDATION requiring human review with written notice + appeal rights; never an autonomous denial",
  unscheduled:
    "no FAP tier for this determination — a determination must cite a recorded FAP tier from the schedule"
} as const;

/**
 * Map an FPL percentage to the governing FAP tier (the first tier whose inclusive upper
 * bound the percentage falls within). Always returns a tier (the top tier is unbounded).
 */
export function fapTierForFplPercent(fplPercent: number): FapTier {
  for (const tier of FAP_SCHEDULE) {
    if (fplPercent <= tier.maxFplPercent) return tier;
  }
  return FAP_SCHEDULE[FAP_SCHEDULE.length - 1];
}

/**
 * The deterministic financial-assistance function — the heart of the service.
 * DETERMINISTIC: a pure function of the household size + income + FPL year + the
 * request's own flags (no randomness, no clock). It computes the FPL base + percentage,
 * resolves the governing FAP tier (or a presumptive-eligibility grant), and produces a
 * classification:
 *   - a recorded presumptive reason → `full-charity` (presumptivelyEligible:true);
 *   - income within a charity bracket → `full-charity` / `partial-charity` (a benefit granted);
 *   - income above the top threshold → `not-eligible` (a DENIAL, requiresHumanReview:true).
 * An ECA is allowed ONLY when requested AND screening is complete AND the patient is not
 * eligible for charity — the agent never lets a collection action precede screening.
 * Every determination cites a recorded FAP tier. Charity is never granted or denied
 * autonomously here — this produces a recommendation, not a posted adjustment.
 */
export function evaluateFinancialAssistance(
  request: FinancialAssistanceRequest
): FinancialAssistanceDetermination {
  const fplBase = fplForHousehold(request.householdSize);
  const fplPercent =
    fplBase > 0 ? Math.round(((request.annualIncome ?? 0) / fplBase) * 100) : 0;

  const presumptivelyEligible = isPresumptiveReason(request.presumptiveReasonId);

  const synthNote =
    "Synthetic/illustrative FAP tier schedule, discount percentages, FPL table, and presumptive-eligibility reasons — NOT a certified financial-assistance system; a real hospital FAP is governed by IRS 501(r) / 26 CFR 1.501(r), the HHS Federal Poverty Guidelines, and the hospital's Board-approved FAP + state charity-care law.";

  const base = {
    patientRef: request.patientRef,
    householdSize: request.householdSize,
    annualIncome: request.annualIncome,
    fplYear: request.fplYear,
    fplBase,
    fplPercent,
    synthetic: true as const
  };

  // Presumptive eligibility → full charity, regardless of documented income.
  if (presumptivelyEligible) {
    const tier = FAP_TIER_BY_ID.get(PRESUMPTIVE_FULL_CHARITY_TIER_ID)!;
    return {
      ...base,
      assistanceTier: "full-charity",
      tierId: tier.id,
      tierLabel: tier.label,
      discountPct: 100,
      presumptivelyEligible: true,
      presumptiveReasonId: request.presumptiveReasonId,
      screeningComplete: true,
      ecaAllowed: false,
      requiresHumanReview: false,
      reason: FIN_ASSIST_REASON_TEXT.presumptive,
      note:
        `Patient ${request.patientRef}: presumptively eligible (${request.presumptiveReasonId}) → FULL CHARITY. ` +
        synthNote
    };
  }

  const tier = fapTierForFplPercent(fplPercent);
  const screeningComplete = request.applicationComplete === true;
  const notEligible = tier.tier === "not-eligible";
  // An ECA may proceed only when requested, screening is complete, and the patient is
  // not eligible for charity. Screening incomplete → ECA never allowed (the 501(r)(6) gate).
  const ecaAllowed = request.ecaRequested === true && screeningComplete && notEligible;

  const reason =
    tier.tier === "full-charity"
      ? FIN_ASSIST_REASON_TEXT.fullCharity
      : tier.tier === "partial-charity"
        ? FIN_ASSIST_REASON_TEXT.partialCharity
        : FIN_ASSIST_REASON_TEXT.notEligible;

  return {
    ...base,
    assistanceTier: tier.tier,
    tierId: tier.id,
    tierLabel: tier.label,
    discountPct: tier.discountPct,
    presumptivelyEligible: false,
    screeningComplete,
    ecaAllowed,
    requiresHumanReview: notEligible,
    reason,
    note:
      `Patient ${request.patientRef}: household of ${request.householdSize}, income ${request.annualIncome} vs FPL base ${fplBase} → ${fplPercent}% FPL → ${tier.label} (${tier.discountPct}% discount). ` +
      (notEligible
        ? "A DENIAL requiring human review with written notice + appeal rights. "
        : "") +
      synthNote
  };
}

/**
 * No-ECA-before-screening check: does the determination avoid an extraordinary
 * collection action before financial screening is complete? True unless a determination
 * asserts ecaAllowed while screeningComplete is false — the guard that catches a
 * caller-asserted collection action taken before FAP screening. Anything
 * evaluateFinancialAssistance() produces satisfies it (ecaAllowed requires
 * screeningComplete). This is the honest signal the route reports to
 * policy.finassist.no-eca-before-screening. A non-object input is a violation.
 */
export function ecaGatedOnScreening(
  determination:
    | Pick<FinancialAssistanceDetermination, "ecaAllowed" | "screeningComplete">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return !(determination.ecaAllowed === true && determination.screeningComplete === false);
}

/**
 * FAP-schedule-sourced check: does the determination cite a recorded FAP tier? True when
 * the tierId is a recognized FAP tier; the guard that catches a caller-asserted ad-hoc
 * eligibility decision with no cited tier (a missing or off-catalog tier id). Anything
 * evaluateFinancialAssistance() produces satisfies it. This is the honest signal the
 * route reports to policy.finassist.fap-schedule-sourced. A non-object input is a violation.
 */
export function finAssistScheduleCited(
  determination: Pick<FinancialAssistanceDetermination, "tierId"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return isFapTier(determination.tierId);
}

/**
 * No-autonomous-denial check: is a denial human-review-gated? True for any determination
 * that is not a denial, and for a not-eligible determination that carries
 * requiresHumanReview:true; the guard that catches a caller-asserted AUTONOMOUS denial (a
 * not-eligible determination not gated on human review). Anything
 * evaluateFinancialAssistance() produces satisfies it (a not-eligible is always
 * requiresHumanReview:true). This is the honest signal the route reports to
 * policy.finassist.no-autonomous-denial. A non-object input is a violation.
 */
export function finAssistHumanReviewed(
  determination:
    | Pick<FinancialAssistanceDetermination, "assistanceTier" | "requiresHumanReview">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (determination.assistanceTier !== "not-eligible") return true;
  return determination.requiresHumanReview === true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent
 * Fabric trace + the response `meta`. Carries no free-text PHI (refs, the tier, the
 * percentage, and the flags only).
 */
export function financialAssistanceSummary(
  determination: FinancialAssistanceDetermination
): {
  patientRef: string;
  fplPercent: number;
  assistanceTier: AssistanceTier;
  tierId: string;
  discountPct: number;
  presumptivelyEligible: boolean;
  screeningComplete: boolean;
  ecaAllowed: boolean;
  requiresHumanReview: boolean;
  synthetic: boolean;
} {
  return {
    patientRef: determination.patientRef,
    fplPercent: determination.fplPercent,
    assistanceTier: determination.assistanceTier,
    tierId: determination.tierId,
    discountPct: determination.discountPct,
    presumptivelyEligible: determination.presumptivelyEligible,
    screeningComplete: determination.screeningComplete,
    ecaAllowed: determination.ecaAllowed,
    requiresHumanReview: determination.requiresHumanReview,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request (illustrative). A household of 3 at ~116% FPL →
 * full charity. Synthetic / de-identified.
 */
export const DEMO_FINANCIAL_ASSISTANCE_REQUEST: FinancialAssistanceRequest = {
  patientRef: "finassist-patient-001",
  householdSize: 3,
  annualIncome: 30000,
  fplYear: 2025,
  applicationComplete: true,
  ecaRequested: false
};

/**
 * A representative demo partial-charity request (illustrative). A household of 2 at
 * ~254% FPL → 75% discount. Synthetic / de-identified.
 */
export const DEMO_FINANCIAL_ASSISTANCE_PARTIAL_REQUEST: FinancialAssistanceRequest = {
  patientRef: "finassist-patient-002",
  householdSize: 2,
  annualIncome: 52000,
  fplYear: 2025,
  applicationComplete: true,
  ecaRequested: false
};

/**
 * A representative demo presumptive-eligibility request (illustrative). A Medicaid-
 * eligible patient → full charity regardless of documented income. Synthetic / de-identified.
 */
export const DEMO_FINANCIAL_ASSISTANCE_PRESUMPTIVE_REQUEST: FinancialAssistanceRequest = {
  patientRef: "finassist-patient-003",
  householdSize: 4,
  annualIncome: 48000,
  fplYear: 2025,
  presumptiveReasonId: "presumptive.medicaid-eligible",
  applicationComplete: false,
  ecaRequested: false
};

/**
 * A representative demo not-eligible request (illustrative). A household of 1 at ~465%
 * FPL → not eligible; a DENIAL requiring human review. Synthetic / de-identified.
 */
export const DEMO_FINANCIAL_ASSISTANCE_NOT_ELIGIBLE_REQUEST: FinancialAssistanceRequest = {
  patientRef: "finassist-patient-004",
  householdSize: 1,
  annualIncome: 70000,
  fplYear: 2025,
  applicationComplete: true,
  ecaRequested: false
};
