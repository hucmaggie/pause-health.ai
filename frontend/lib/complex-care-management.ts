/**
 * Complex Care Management (CCM) — deterministic eligibility confirmation,
 * monthly time-in-service tracking, and CPT-code billing-package assembly
 * for a Medicare CCM program.
 *
 * Deterministic, dependency-free domain core the Complex Care Management
 * Agent (app/api/agents/complex-care-management) wraps — the Salesforce
 * "Agentforce for Health" / Health Cloud CCM analog on Pause's Agent
 * Fabric. Medicare pays a monthly per-beneficiary fee under CPT 99490 /
 * 99491 (non-complex CCM: 20+ min/mo) and CPT 99487 / 99489 (complex CCM:
 * 60+ min/mo, with moderate/high complexity decision-making) — but only if
 * the patient is ELIGIBLE (2+ chronic conditions from a catalog, consent
 * on file), the TIME is documented per care-coordination activity type,
 * and the BILLING PACKAGE is assembled and reviewed by a human quality
 * team. Getting any of those three wrong is the classic CCM audit finding.
 *
 *   Inbound:  CcmMonthContext (a synthetic patientRef — clearly labeled
 *             illustrative — the patient's demographic flags, chronic-
 *             condition list, consent-on-file flag, month, and a list of
 *             per-activity time entries)
 *   Outbound: CcmMonthReport { patientRef, month, eligibility (with the
 *             specific catalog citations), timeSummary (per activity
 *             type + total minutes), billingPackage (state:'ready-for-
 *             quality-team-review', cptCode, requiresQualityTeamApproval,
 *             submitted:false), synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: eligibility traces to the catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every CCM eligibility claim must trace to the defined
 *  CHRONIC_CONDITION_CATALOG (a patient must have ≥ 2 conditions from the
 *  catalog), the Medicare-coverage flag (on-file), the age gate
 *  (illustrative Medicare eligibility), and the patient consent flag
 *  (documented). Fabricating eligibility — inventing chronic conditions,
 *  or claiming coverage without a flag — fails.
 *  eligibilityTracesToCatalog() reports the honest signal the Agent Fabric
 *  enforces via policy.ccm.eligibility-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no autonomous CMS billing.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent may only ASSEMBLE a billing package for human quality-team
 *  review — it may NEVER autonomously submit a CCM claim to CMS. Every
 *  assembleCcmBillingPackage() output is requiresQualityTeamApproval:true /
 *  submitted:false; a caller-asserted plan that claims already-submitted or
 *  bypasses approval is a violation. Mirrors the HEDIS Agent's no-
 *  autonomous-submission, the Prior Authorization Agent's no-autonomous-
 *  submission, and the ACP Agent's no-autonomous-directive-change posture.
 *  billingRequiresHumanApproval() reports the honest signal the Agent
 *  Fabric enforces via policy.ccm.no-autonomous-billing.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: time entries add up, and every activity
 *  type is catalog-sourced.
 * ─────────────────────────────────────────────────────────────────────
 *  Every logged minute must trace to a defined care-coordination activity
 *  type in CCM_ACTIVITY_CATALOG (medication reconciliation, care-plan
 *  update, patient communication, referrals + follow-up, care-team coord,
 *  patient-education outreach, resource navigation). The reported total
 *  must equal the sum of the per-entry minutes (no phantom minutes). Time
 *  inflation is the classic CCM audit finding this guard closes.
 *  timeEntriesAddUp() reports the honest signal the Agent Fabric enforces
 *  via policy.ccm.time-integrity.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified CCM billing engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The chronic-condition catalog, CCM activity catalog, CPT code
 *  thresholds, and Medicare eligibility flags below are ILLUSTRATIVE
 *  synthetic/demo values that model the SHAPE of a CCM program — they are
 *  NOT CMS Chapter 12 / MLN Booklet 909188 CCM billing, an actual CPT
 *  coding manual, or a live Medicare claim-submission system. The
 *  patientRefs are synthetic / de-identified. There is NO randomness and
 *  NO clock anywhere here: eligibility, time totals, and CPT selection are
 *  pure functions of the caller-provided context, so the same context
 *  always yields the same report — which is what lets the demo, the seeded
 *  trace, and the tests agree.
 */

/**
 * A single chronic condition in the illustrative catalog. CCM requires
 * ≥ 2 conditions from the catalog. Illustrative — NOT ICD-10 / HCC-mapped.
 */
export type ChronicCondition = {
  /** Stable catalog id every claimed condition references. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Illustrative rationale for inclusion in the CCM catalog. */
  rationale: string;
  /** Always true — the catalog is an illustrative synthetic. */
  synthetic: true;
};

/**
 * The illustrative chronic-condition catalog — menopause/midlife-relevant
 * conditions that models the SHAPE of a CCM chronic-condition list without
 * being certified.
 */
export const CHRONIC_CONDITION_CATALOG: ChronicCondition[] = [
  {
    id: "condition.hypertension",
    label: "Hypertension",
    rationale:
      "A leading midlife chronic condition and a CV-risk driver; management crosses PCP + cardiology.",
    synthetic: true
  },
  {
    id: "condition.type-2-diabetes",
    label: "Type 2 Diabetes",
    rationale:
      "Chronic; requires ongoing medication management, labs, and lifestyle coordination.",
    synthetic: true
  },
  {
    id: "condition.osteoporosis",
    label: "Osteoporosis",
    rationale:
      "Menopause-relevant; requires DEXA follow-up, medication management, and fall-risk coordination.",
    synthetic: true
  },
  {
    id: "condition.chronic-anxiety-or-depression",
    label: "Chronic Anxiety or Depression",
    rationale:
      "Chronic behavioral-health condition that intersects with the menopause transition.",
    synthetic: true
  },
  {
    id: "condition.chronic-migraine",
    label: "Chronic Migraine",
    rationale:
      "Requires ongoing medication management and specialist coordination; frequently menopause-linked.",
    synthetic: true
  },
  {
    id: "condition.hypothyroidism",
    label: "Hypothyroidism",
    rationale:
      "Chronic endocrine condition; ongoing labs + medication titration + PCP coordination.",
    synthetic: true
  },
  {
    id: "condition.chronic-kidney-disease",
    label: "Chronic Kidney Disease",
    rationale:
      "Chronic; requires nephrology coordination and medication-dose adjustment.",
    synthetic: true
  },
  {
    id: "condition.hyperlipidemia",
    label: "Hyperlipidemia",
    rationale:
      "CV-risk driver requiring ongoing labs, statin management, and lifestyle coordination.",
    synthetic: true
  }
];

const CHRONIC_CONDITION_BY_ID = new Map<string, ChronicCondition>(
  CHRONIC_CONDITION_CATALOG.map((c) => [c.id, c])
);

/** Is `id` a defined chronic-condition catalog id? */
export function isChronicCondition(id: unknown): boolean {
  return typeof id === "string" && CHRONIC_CONDITION_BY_ID.has(id);
}

/** Look up a chronic condition by id (undefined for an off-catalog id). */
export function getChronicCondition(id: string): ChronicCondition | undefined {
  return CHRONIC_CONDITION_BY_ID.get(id);
}

/**
 * A single CCM care-coordination activity type — every logged minute must
 * cite one of these. Illustrative — NOT a certified CMS activity list.
 */
export type CcmActivityType = {
  /** Stable catalog id every time entry references. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Illustrative rationale for inclusion in the CCM activity catalog. */
  rationale: string;
  /** Always true — the catalog is an illustrative synthetic. */
  synthetic: true;
};

/**
 * The illustrative CCM care-coordination activity catalog. Every logged
 * minute must trace to one of these — the "we-just-called-it-care-coord"
 * catch-all is deliberately excluded.
 */
export const CCM_ACTIVITY_CATALOG: CcmActivityType[] = [
  {
    id: "activity.medication-reconciliation",
    label: "Medication reconciliation",
    rationale:
      "Reviewing and reconciling the patient's medication list — a defined CCM activity.",
    synthetic: true
  },
  {
    id: "activity.care-plan-update",
    label: "Care-plan update",
    rationale:
      "Reviewing and updating the patient's electronic care plan.",
    synthetic: true
  },
  {
    id: "activity.patient-communication",
    label: "Patient communication (phone / secure message)",
    rationale:
      "Phone calls, secure messages with the patient or caregiver — a CCM-billable communication.",
    synthetic: true
  },
  {
    id: "activity.referral-followup",
    label: "Referral placement + follow-up",
    rationale:
      "Placing referrals and following up on referral outcomes and specialist communication.",
    synthetic: true
  },
  {
    id: "activity.care-team-coordination",
    label: "Care-team coordination",
    rationale:
      "Coordinating between clinicians on the multi-disciplinary care team.",
    synthetic: true
  },
  {
    id: "activity.patient-education-outreach",
    label: "Patient education outreach",
    rationale:
      "Sending education materials + follow-up on comprehension and adherence.",
    synthetic: true
  },
  {
    id: "activity.community-resource-navigation",
    label: "Community-resource navigation",
    rationale:
      "Helping the patient access community resources (SDOH-related), transportation, food assistance.",
    synthetic: true
  }
];

const CCM_ACTIVITY_BY_ID = new Map<string, CcmActivityType>(
  CCM_ACTIVITY_CATALOG.map((a) => [a.id, a])
);

/** Is `id` a defined CCM activity catalog id? */
export function isCcmActivity(id: unknown): boolean {
  return typeof id === "string" && CCM_ACTIVITY_BY_ID.has(id);
}

/** Look up a CCM activity by id (undefined for an off-catalog id). */
export function getCcmActivity(id: string): CcmActivityType | undefined {
  return CCM_ACTIVITY_BY_ID.get(id);
}

/**
 * The illustrative Medicare eligibility age (65). The Medicare-eligible age
 * is 65 in the US; the value is a clearly-labeled synthetic for the demo.
 */
export const MEDICARE_ELIGIBLE_AGE = 65;

/**
 * Illustrative CCM billing thresholds (in monthly minutes). NOT CMS billing
 * rules — a clearly-labeled synthetic that models the SHAPE of the CPT
 * threshold ladder (99490 → 99491 → 99487 → 99489).
 */
export const CCM_BILLING_THRESHOLDS = {
  /** Below this → NOT_BILLABLE (no CPT). */
  notBillableBelow: 20,
  /** 20-39 min → CPT 99490 (non-complex CCM). */
  cpt99490: 20,
  /** 40-59 min → CPT 99491 (non-complex CCM, extended). */
  cpt99491: 40,
  /** 60-89 min → CPT 99487 (complex CCM, base). */
  cpt99487: 60,
  /** ≥ 90 min → CPT 99489 (complex CCM, add-on). */
  cpt99489: 90
} as const;

/** A single per-activity time entry. */
export type CcmTimeEntry = {
  /** The CCM activity catalog id (must be on the catalog). */
  activityId: string;
  /** Minutes spent on this activity in the month (integer, ≥ 1). */
  minutes: number;
  /** Illustrative note about the activity (never PHI-free-text in production). */
  note: string;
};

/**
 * The structured signals the CCM planner reads. `patientRef` is a synthetic,
 * de-identified id — clearly labeled illustrative. All fields are accepted
 * as data (no clock, no randomness).
 */
export type CcmMonthContext = {
  patientRef: string;
  /** ISO month string (YYYY-MM). */
  month: string;
  /** Patient age. */
  age?: number;
  /** Whether the patient's Medicare coverage is on file. */
  medicareCoverageOnFile?: boolean;
  /** Whether patient CCM consent is documented. */
  consentOnFile?: boolean;
  /** The chronic conditions on file (each must be catalog-sourced). */
  chronicConditions?: readonly string[];
  /** The per-activity time entries logged this month. */
  timeEntries?: readonly CcmTimeEntry[];
  /**
   * Illustrative complexity flag — moderate/high complexity decision-making
   * is required for CPT 99487 / 99489 billing. Non-complex sits on 99490 /
   * 99491.
   */
  complexity?: "non-complex" | "moderate-or-high";
};

/** The eligibility-check result. */
export type CcmEligibility = {
  /** True when every catalog-sourced eligibility criterion is met. */
  eligible: boolean;
  /** The chronic-condition ids from the catalog the patient has on file. */
  qualifyingConditions: readonly string[];
  /** True iff the patient has ≥ 2 catalog-sourced conditions. */
  hasTwoOrMoreConditions: boolean;
  /** True iff the patient is Medicare-eligible age (≥ MEDICARE_ELIGIBLE_AGE). */
  meetsAgeGate: boolean;
  /** True iff the Medicare-coverage flag is on file. */
  medicareCoverageOnFile: boolean;
  /** True iff CCM consent is documented. */
  consentOnFile: boolean;
  /** Human-readable list of failure reasons (empty when eligible:true). */
  ineligibilityReasons: readonly string[];
};

/** A per-activity time roll-up entry. */
export type CcmTimeSummaryEntry = {
  activityId: string;
  activityLabel: string;
  minutes: number;
};

/** The monthly time summary. */
export type CcmTimeSummary = {
  /** Per-activity roll-up sorted by activityId ascending. */
  perActivity: readonly CcmTimeSummaryEntry[];
  /** Sum of all activity minutes. */
  totalMinutes: number;
  /** Every activityId on the entries traces to CCM_ACTIVITY_CATALOG. */
  everyActivityIsCatalogSourced: boolean;
};

/** The CPT-code the monthly total maps to. */
export type CcmCptCode =
  | "NOT_BILLABLE"
  | "99490"
  | "99491"
  | "99487"
  | "99489";

/** The billing-package state. NEVER "submitted" without human approval. */
export type CcmBillingPackageState = "not-billable" | "ready-for-quality-team-review";

/** The billing package the agent assembles. */
export type CcmBillingPackage = {
  state: CcmBillingPackageState;
  patientRef: string;
  month: string;
  totalMinutes: number;
  cptCode: CcmCptCode;
  complexity: "non-complex" | "moderate-or-high";
  /** Always true — every submission requires human approval. */
  requiresQualityTeamApproval: true;
  /** Always false — the agent NEVER autonomously submits to CMS. */
  submitted: false;
  /** Illustrative synthetic package id (never a real CMS claim id). */
  packageId: string;
  /** Human-readable body (rule-based / templated — never a live-model narrative). */
  body: string;
};

/** The monthly CCM report the agent returns. */
export type CcmMonthReport = {
  patientRef: string;
  month: string;
  eligibility: CcmEligibility;
  timeSummary: CcmTimeSummary;
  billingPackage: CcmBillingPackage | null;
  /** Always true — the catalog + refs are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note. */
  note: string;
};

/**
 * Evaluate CCM eligibility for a patient-month. DETERMINISTIC — a pure
 * function of the context. Every criterion traces to the illustrative
 * catalog / policy: ≥ 2 chronic conditions from CHRONIC_CONDITION_CATALOG,
 * age ≥ MEDICARE_ELIGIBLE_AGE, Medicare-coverage flag on file, consent on
 * file.
 */
export function evaluateCcmEligibility(ctx: CcmMonthContext): CcmEligibility {
  const qualifyingConditions =
    ctx.chronicConditions?.filter((id) => isChronicCondition(id)) ?? [];
  const hasTwoOrMoreConditions = qualifyingConditions.length >= 2;
  const meetsAgeGate =
    typeof ctx.age === "number" && ctx.age >= MEDICARE_ELIGIBLE_AGE;
  const medicareCoverageOnFile = ctx.medicareCoverageOnFile === true;
  const consentOnFile = ctx.consentOnFile === true;

  const reasons: string[] = [];
  if (!hasTwoOrMoreConditions) {
    reasons.push(
      `fewer than 2 catalog-sourced chronic conditions on file (${qualifyingConditions.length} found)`
    );
  }
  if (!meetsAgeGate) {
    reasons.push(
      `age ${ctx.age ?? "unknown"} below Medicare eligibility age (${MEDICARE_ELIGIBLE_AGE})`
    );
  }
  if (!medicareCoverageOnFile) {
    reasons.push("Medicare coverage flag not on file");
  }
  if (!consentOnFile) {
    reasons.push("CCM consent not on file");
  }

  return {
    eligible:
      hasTwoOrMoreConditions && meetsAgeGate && medicareCoverageOnFile && consentOnFile,
    qualifyingConditions,
    hasTwoOrMoreConditions,
    meetsAgeGate,
    medicareCoverageOnFile,
    consentOnFile,
    ineligibilityReasons: reasons
  };
}

/**
 * Compute the monthly time summary from the per-activity entries.
 * DETERMINISTIC — off-catalog activity ids are surfaced via
 * everyActivityIsCatalogSourced (a violation signal) but the roll-up still
 * completes so the caller can see what was logged.
 */
export function summarizeCcmTime(
  entries: readonly CcmTimeEntry[] | undefined
): CcmTimeSummary {
  const list = entries ?? [];
  const perActivityMap = new Map<string, { label: string; minutes: number }>();
  for (const entry of list) {
    const catalog = getCcmActivity(entry.activityId);
    const label = catalog?.label ?? entry.activityId;
    const existing = perActivityMap.get(entry.activityId) ?? { label, minutes: 0 };
    existing.minutes += entry.minutes > 0 ? entry.minutes : 0;
    perActivityMap.set(entry.activityId, existing);
  }
  const perActivity: CcmTimeSummaryEntry[] = [...perActivityMap.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a > b ? 1 : -1))
    .map(([activityId, v]) => ({
      activityId,
      activityLabel: v.label,
      minutes: v.minutes
    }));
  const totalMinutes = perActivity.reduce((s, e) => s + e.minutes, 0);
  const everyActivityIsCatalogSourced = list.every((e) => isCcmActivity(e.activityId));
  return { perActivity, totalMinutes, everyActivityIsCatalogSourced };
}

/**
 * Map a monthly total to a CPT code by the illustrative ladder. Complex CCM
 * codes (99487/99489) require the moderate-or-high complexity flag.
 */
export function pickCptCode(
  totalMinutes: number,
  complexity: "non-complex" | "moderate-or-high"
): CcmCptCode {
  const t = CCM_BILLING_THRESHOLDS;
  if (totalMinutes < t.notBillableBelow) return "NOT_BILLABLE";
  if (complexity === "moderate-or-high") {
    if (totalMinutes >= t.cpt99489) return "99489";
    if (totalMinutes >= t.cpt99487) return "99487";
    // Not enough time for complex CCM but complexity claimed → non-complex fallback.
    if (totalMinutes >= t.cpt99491) return "99491";
    return "99490";
  }
  if (totalMinutes >= t.cpt99491) return "99491";
  return "99490";
}

/**
 * Assemble a billing package — always requires quality-team approval,
 * NEVER submitted autonomously.
 */
export function assembleCcmBillingPackage(input: {
  patientRef: string;
  month: string;
  totalMinutes: number;
  complexity: "non-complex" | "moderate-or-high";
}): CcmBillingPackage {
  const cptCode = pickCptCode(input.totalMinutes, input.complexity);
  const state: CcmBillingPackageState =
    cptCode === "NOT_BILLABLE" ? "not-billable" : "ready-for-quality-team-review";
  const packageId = `ccm-pkg-${input.patientRef}-${input.month}`;
  const body =
    cptCode === "NOT_BILLABLE"
      ? `Not billable this month: ${input.totalMinutes}min < ${CCM_BILLING_THRESHOLDS.notBillableBelow}min threshold; no CPT code assembled.`
      : `CCM billing package ${packageId} assembled — CPT ${cptCode} for ${input.totalMinutes}min in ${input.month} (${input.complexity} complexity). READY FOR HUMAN QUALITY-TEAM REVIEW — the agent NEVER autonomously submits a CMS claim.`;
  return {
    state,
    patientRef: input.patientRef,
    month: input.month,
    totalMinutes: input.totalMinutes,
    cptCode,
    complexity: input.complexity,
    requiresQualityTeamApproval: true,
    submitted: false,
    packageId,
    body
  };
}

/**
 * Produce the deterministic monthly CCM report. A pure function of the
 * context (no clock, no randomness).
 */
export function assembleCcmMonthReport(ctx: CcmMonthContext): CcmMonthReport {
  const eligibility = evaluateCcmEligibility(ctx);
  const timeSummary = summarizeCcmTime(ctx.timeEntries);
  const complexity = ctx.complexity ?? "non-complex";
  const billingPackage = eligibility.eligible
    ? assembleCcmBillingPackage({
        patientRef: ctx.patientRef,
        month: ctx.month,
        totalMinutes: timeSummary.totalMinutes,
        complexity
      })
    : null;

  const note = eligibility.eligible
    ? `CCM report for ${ctx.patientRef} · ${ctx.month} · ${eligibility.qualifyingConditions.length} qualifying conditions · ${timeSummary.totalMinutes}min logged · ${
        billingPackage?.cptCode
      } billing package assembled for HUMAN QUALITY-TEAM REVIEW (never autonomously submitted). Every logged minute traces to the CCM activity catalog; the time total is the sum of the entries. Synthetic — illustrative catalog + refs, not certified CCM billing.`
    : `CCM report for ${ctx.patientRef} · ${ctx.month}: not eligible — ${eligibility.ineligibilityReasons.join("; ")}. No billing package assembled. Synthetic — illustrative catalog + refs, not certified CCM billing.`;

  return {
    patientRef: ctx.patientRef,
    month: ctx.month,
    eligibility,
    timeSummary,
    billingPackage,
    synthetic: true,
    note
  };
}

/**
 * Eligibility-catalog check: does the eligibility report cite only catalog-
 * sourced chronic conditions and pass every eligibility gate? True when
 * every qualifying condition is on CHRONIC_CONDITION_CATALOG. The guard
 * that catches a caller-asserted eligibility with an off-catalog condition.
 * This is the honest signal the route reports to
 * policy.ccm.eligibility-catalog-sourced. A non-object input is a violation.
 */
export function eligibilityTracesToCatalog(
  input:
    | {
        qualifyingConditions?: readonly string[];
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  const conditions = input.qualifyingConditions ?? [];
  if (!Array.isArray(conditions)) return false;
  return conditions.every((id) => isChronicCondition(id));
}

/**
 * Human-approval check: does the billing package require human approval and
 * remain not-submitted? True for anything assembleCcmBillingPackage()
 * produces. The guard that catches a caller-asserted submitted:true or
 * requiresQualityTeamApproval:false. This is the honest signal the route
 * reports to policy.ccm.no-autonomous-billing. A non-object input is a
 * violation, unless the input is null (no billing package — trivially safe).
 */
export function billingRequiresHumanApproval(
  pkg:
    | { requiresQualityTeamApproval?: boolean; submitted?: boolean; state?: string }
    | null
    | undefined
): boolean {
  if (pkg === null) return true; // no package to submit → trivially safe.
  if (!pkg || typeof pkg !== "object") return false;
  if (pkg.requiresQualityTeamApproval !== true) return false;
  if (pkg.submitted === true) return false;
  return true;
}

/**
 * Time-integrity check: does every logged minute cite a catalog-sourced
 * activity, and does the reported total equal the sum of the entries?
 * True when both are satisfied. The guard that catches a caller-asserted
 * phantom-minute inflation or an off-catalog activity. This is the honest
 * signal the route reports to policy.ccm.time-integrity. A non-object
 * input is a violation.
 */
export function timeEntriesAddUp(
  input:
    | {
        entries?: readonly { activityId?: string; minutes?: number }[];
        totalMinutes?: number;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  const entries = input.entries ?? [];
  if (!Array.isArray(entries)) return false;
  if (!entries.every((e) => isCcmActivity(e.activityId))) return false;
  const sum = entries.reduce(
    (s, e) => s + (typeof e.minutes === "number" && e.minutes > 0 ? e.minutes : 0),
    0
  );
  return sum === input.totalMinutes;
}

/**
 * A representative eligible-patient demo (illustrative). A 68-year-old
 * Medicare-eligible patient with hypertension + osteoporosis + hypothyroidism,
 * consent on file, and 35min of catalog-sourced activities across two
 * activities — so the CPT 99490 → 99491 boundary case is demonstrable.
 */
export const DEMO_ELIGIBLE_PATIENT: CcmMonthContext = {
  patientRef: "ccm-patient-001",
  month: "2026-07",
  age: 68,
  medicareCoverageOnFile: true,
  consentOnFile: true,
  chronicConditions: [
    "condition.hypertension",
    "condition.osteoporosis",
    "condition.hypothyroidism"
  ],
  timeEntries: [
    {
      activityId: "activity.medication-reconciliation",
      minutes: 15,
      note: "reviewed HRT + statin + levothyroxine list"
    },
    {
      activityId: "activity.care-plan-update",
      minutes: 10,
      note: "updated care plan for the year"
    },
    {
      activityId: "activity.patient-communication",
      minutes: 10,
      note: "phone check-in on adherence"
    }
  ],
  complexity: "non-complex"
};

/**
 * A representative complex-CCM demo — 72min across catalog-sourced activities
 * plus moderate-or-high complexity → CPT 99487.
 */
export const DEMO_COMPLEX_PATIENT: CcmMonthContext = {
  patientRef: "ccm-patient-002",
  month: "2026-07",
  age: 71,
  medicareCoverageOnFile: true,
  consentOnFile: true,
  chronicConditions: [
    "condition.hypertension",
    "condition.type-2-diabetes",
    "condition.chronic-kidney-disease",
    "condition.hyperlipidemia"
  ],
  timeEntries: [
    { activityId: "activity.medication-reconciliation", minutes: 20, note: "reconciled a fresh discharge med list" },
    { activityId: "activity.care-team-coordination", minutes: 20, note: "coordinated PCP + nephrology + cardiology" },
    { activityId: "activity.patient-communication", minutes: 20, note: "phone + secure message follow-up" },
    { activityId: "activity.referral-followup", minutes: 12, note: "closed the loop on the nephrology referral" }
  ],
  complexity: "moderate-or-high"
};

/**
 * A representative ineligible-patient demo (illustrative). Age 52 (below the
 * Medicare eligibility age), so eligibility fails cleanly and no billing
 * package is assembled.
 */
export const DEMO_INELIGIBLE_PATIENT: CcmMonthContext = {
  patientRef: "ccm-patient-003",
  month: "2026-07",
  age: 52,
  medicareCoverageOnFile: false,
  consentOnFile: false,
  chronicConditions: ["condition.hypertension"],
  timeEntries: []
};
