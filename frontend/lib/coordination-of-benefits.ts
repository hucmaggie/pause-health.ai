/**
 * Coordination of Benefits (COB) / Order-of-Benefits Determination — the
 * deterministic, transparent payer-side layer that decides WHICH plan pays first
 * when a patient carries more than one coverage.
 *
 * Deterministic, dependency-free domain core the Coordination of Benefits Agent
 * (app/api/agents/coordination-of-benefits) wraps — a plan-side payer & plan
 * operations service on Pause's Agent Fabric. Given a patient's set of COVERAGES
 * (each: how the patient is covered — as the subscriber/employee or as a
 * dependent — the plan type, whether the coverage is through current active
 * employment, the covering parent/subscriber's birthday for the birthday rule,
 * and the coverage start date), it DETERMINISTICALLY ORDERS the coverages
 * (primary → secondary → tertiary) by applying the NAIC-model order-of-benefits
 * rules + Medicare Secondary Payer + the birthday rule, citing the governing COB
 * rule for every ordering decision. It NEVER autonomously adjudicates or pays a
 * claim: an order-of-benefits determination is a RECOMMENDATION that sets payer
 * order, and it requires human cosign before it drives a claim's payment.
 *
 *   Inbound:  a CobRequest { patientRef, isDependentChild, coverages[],
 *             custodyDecreePrimaryCoverageId?, atTime }
 *   Outbound: a CobDetermination { orderedCoverages[], primaryCoverageId,
 *             citedRuleIds[], custodyDecreeApplied, requiresHumanCosign:true,
 *             reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other payer & plan operations
 * agents. It is distinct from the Claims Adjudication Assistant (first-pass
 * PER-CLAIM edits AFTER the payer order is known), the Benefits & Coverage
 * Verification / EBV agent (single-plan eligibility), and the Utilization Review
 * agent (medical necessity): this decides the ORDER OF BENEFITS ACROSS multiple
 * coverages BEFORE a claim is adjudicated.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: a custody / court decree overrides the birthday rule.
 * ─────────────────────────────────────────────────────────────────────
 *  When an active court decree / custody arrangement assigns primary responsibility
 *  for a dependent child's health coverage to a specific parent's plan, THAT plan is
 *  primary — the decree ALWAYS overrides the birthday rule (the default tie-break for
 *  a child covered under both parents). A determination that ignores an active decree
 *  is blocked. cobDecreeHonored() reports the honest signal the Agent Fabric enforces
 *  via policy.cob.custody-decree-overrides-birthday. (Mirrors the Data Retention
 *  Agent's legal-hold-overrides-purge — a legal instrument overrides the default rule.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: every ordering decision is rule-sourced.
 * ─────────────────────────────────────────────────────────────────────
 *  Every ordered coverage must cite a recorded COB rule from the rule catalog —
 *  there is no ad-hoc, un-sourced ordering. cobRuleCited() reports the honest signal
 *  the Agent Fabric enforces via policy.cob.order-of-benefits-rule-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous adjudication (human-cosign-gated).
 * ─────────────────────────────────────────────────────────────────────
 *  A COB determination sets payer ORDER only — it NEVER autonomously adjudicates,
 *  pays, or adjusts a claim. The determination carries requiresHumanCosign:true, and a
 *  determination that would autonomously drive claim payment is blocked.
 *  cobHumanCosigned() reports the honest signal the Agent Fabric enforces via
 *  policy.cob.no-autonomous-adjudication.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified coordination-of-benefits engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The COB rule catalog, plan types, and payer labels below are ILLUSTRATIVE
 *  synthetic/demo values chosen to model the SHAPE of a governed order-of-benefits
 *  control — they are NOT a certified COB product, and REAL coordination of benefits
 *  is governed by the NAIC COB Model Regulation, 42 CFR 411 (Medicare Secondary
 *  Payer), 42 CFR 433.139 (Medicaid third-party liability), ERISA plan documents,
 *  and state insurance code, all of which differ. The patient / coverage references
 *  are synthetic / de-identified. There is NO randomness and NO clock anywhere here:
 *  the ordering is a pure function of the coverages + the request's own `atTime`, so
 *  the same request always yields the same order + cited rules — which is what lets
 *  the demo, the seeded trace, and the tests agree.
 */

/** How the patient is covered on a given plan. */
export type CoverageRole = "subscriber" | "dependent";

/**
 * The plan type of a coverage. Illustrative/synthetic; the ordering logic only
 * distinguishes the government payers (medicare / medicaid) from private group
 * coverage (commercial-group / cobra / retiree).
 */
export type CoveragePlanType =
  | "commercial-group"
  | "cobra"
  | "retiree"
  | "medicare"
  | "medicaid";

/**
 * A single coverage a patient carries. Everything the deterministic
 * order-of-benefits comparator needs. Synthetic / de-identified.
 */
export type Coverage = {
  /** Stable, synthetic coverage id (e.g. "coverage-mom-ppo"). */
  coverageId: string;
  /** Illustrative payer label (e.g. "Acme Commercial PPO"). Synthetic. */
  payerName: string;
  /** The plan type — government payers order differently from group coverage. */
  planType: CoveragePlanType;
  /** How the PATIENT is covered on this plan (subscriber/employee vs dependent). */
  role: CoverageRole;
  /** Is this coverage through CURRENT active employment? (COBRA/retiree = false.) */
  activeEmployment: boolean;
  /** Employer of 20+ employees — for the Medicare Secondary Payer determination. */
  employerSize20Plus?: boolean;
  /**
   * The covering parent's / subscriber's birthday as "MM-DD" (month/day only — the
   * birthday rule uses only the day of the year, never the birth YEAR / age). Used
   * for a dependent child covered under both parents.
   */
  subscriberBirthday?: string;
  /** The plan's effective / coverage start date (ISO) — for the longer-coverage tie-break. */
  coverageStartDate?: string;
};

/** A single COB rule in the catalog — the governing rule an ordering decision cites. */
export type CobRule = {
  /** Stable catalog id (cited on every ordered coverage). */
  id: string;
  /** Human-readable rule label. */
  label: string;
  /** Illustrative description of what this rule governs. Demo-honest. */
  description: string;
};

/**
 * The COB rule catalog — every ordering decision must cite one of these.
 * Illustrative/synthetic; NOT a certified COB rule set (see the header). Real COB
 * is governed by the NAIC COB Model Regulation, MSP, and Medicaid TPL.
 */
export const COB_RULES: CobRule[] = [
  {
    id: "rule.cob.custody-decree-overrides-birthday",
    label: "Custody / court decree overrides the birthday rule",
    description:
      "When an active court decree / custody arrangement assigns primary responsibility for a dependent child's health coverage to a specific parent's plan, THAT plan is primary — overriding the birthday rule. (Illustrative — real decree handling follows the NAIC COB Model Regulation and the terms of the specific decree.)"
  },
  {
    id: "rule.cob.medicaid-payer-of-last-resort",
    label: "Medicaid is the payer of last resort",
    description:
      "Medicaid is ALWAYS secondary to any other coverage — it pays only after every other liable plan (42 CFR 433.139 third-party liability). (Illustrative.)"
  },
  {
    id: "rule.cob.medicare-secondary-payer",
    label: "Medicare Secondary Payer",
    description:
      "When the patient has group coverage through current active employment at an employer of 20+ employees, the group health plan is PRIMARY and Medicare is SECONDARY; otherwise Medicare is primary (42 CFR 411 Medicare Secondary Payer). (Illustrative.)"
  },
  {
    id: "rule.cob.subscriber-before-dependent",
    label: "A plan covering you as the subscriber is primary over one covering you as a dependent",
    description:
      "A plan that covers the patient as the subscriber / employee is primary over a plan that covers the same patient as a dependent. (Illustrative — NAIC COB Model Regulation order of benefits.)"
  },
  {
    id: "rule.cob.active-employee-before-inactive",
    label: "Active-employee coverage is primary over COBRA / retiree coverage",
    description:
      "A plan covering the patient through current active employment is primary over a plan covering them as a laid-off / COBRA / retired member. (Illustrative.)"
  },
  {
    id: "rule.cob.birthday-rule",
    label: "The birthday rule",
    description:
      "For a dependent child covered under both parents' plans, the plan of the parent whose birthday (month/day, NOT year) falls earlier in the calendar year is primary. (Illustrative — NAIC COB Model Regulation.)"
  },
  {
    id: "rule.cob.longer-coverage-tiebreak",
    label: "Longer-coverage tie-break",
    description:
      "When no other rule breaks the tie, the plan that has covered the patient longer (earlier coverage start date) is primary; a residual exact tie is broken deterministically by coverage id (documented, never a coin-flip). (Illustrative — NAIC COB Model Regulation length-of-coverage tie-break.)"
  },
  {
    id: "rule.cob.sole-coverage-primary",
    label: "Sole coverage is primary",
    description:
      "A patient with a single coverage on file has that coverage as primary by default — there is nothing to coordinate. (Illustrative.)"
  }
];

const COB_RULE_IDS = new Set<string>(COB_RULES.map((r) => r.id));
const COB_RULE_BY_ID = new Map(COB_RULES.map((r) => [r.id, r]));

/** Is `id` a recognized COB rule id? */
export function isCobRule(id: unknown): boolean {
  return typeof id === "string" && COB_RULE_IDS.has(id);
}

/** Look up a COB rule's label (falls back to the raw id if unknown). */
export function cobRuleLabel(id: string): string {
  return COB_RULE_BY_ID.get(id)?.label ?? id;
}

/** A coordination-of-benefits / order-of-benefits determination request. */
export type CobRequest = {
  /** Synthetic, de-identified patient reference (e.g. "cob-patient-001"). */
  patientRef: string;
  /**
   * Whether the patient is a DEPENDENT CHILD covered under more than one parent —
   * the condition under which the birthday rule (and the custody-decree override)
   * apply.
   */
  isDependentChild: boolean;
  /** The coverages the patient carries (ordered by the engine). */
  coverages: Coverage[];
  /**
   * When set for a dependent child, the coverage id a court decree / custody
   * arrangement names as primary — it ALWAYS overrides the birthday rule.
   */
  custodyDecreePrimaryCoverageId?: string;
  /**
   * The explicit evaluation time (ISO-8601) — taken as data, not a clock read.
   * The ordering is pure over the coverages; atTime is carried for provenance.
   */
  atTime: string;
};

/** A single coverage in the determined order-of-benefits ranking. */
export type OrderedCoverage = {
  coverageId: string;
  payerName: string;
  planType: CoveragePlanType;
  role: CoverageRole;
  /** 1 = primary, 2 = secondary, 3 = tertiary, … */
  rank: number;
  /** The governing COB rule that placed this coverage at its rank (always recognized). */
  decidingRuleId: string;
  /** The governing COB rule's human-readable label. */
  decidingRuleLabel: string;
};

/** The deterministic order-of-benefits determination the agent returns. */
export type CobDetermination = {
  /** Synthetic, de-identified patient reference this determination is about. */
  patientRef: string;
  /** Whether the patient is a dependent child (the birthday-rule condition). */
  isDependentChild: boolean;
  /** The coverages ordered primary → secondary → tertiary, each citing its rule. */
  orderedCoverages: OrderedCoverage[];
  /** The primary coverage's id (empty only when there is no coverage on file). */
  primaryCoverageId: string;
  /** When set for a dependent child, the decree-named primary coverage id. */
  custodyDecreePrimaryCoverageId?: string;
  /** True when a custody decree decided the primary (it overrode the birthday rule). */
  custodyDecreeApplied: boolean;
  /** Every distinct COB rule cited across the ordering. */
  citedRuleIds: string[];
  /**
   * Always true — a COB determination sets payer ORDER only; it is a RECOMMENDATION
   * requiring human cosign before it drives a claim's payment. The agent never
   * autonomously adjudicates or pays.
   */
  requiresHumanCosign: boolean;
  /** Human-readable reason (cites the primary payer + the deciding rule). */
  reason: string;
  /** Always true — the COB rule catalog, plan types, and payers are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Stable reason phrases (kept as constants for testability). */
export const COB_REASON = {
  noCoverage:
    "no coverage on file — there is nothing to coordinate",
  soleCoverage:
    "a single coverage on file is primary by default — there is nothing to coordinate"
} as const;

/** Is this group coverage MSP-primary (primary over Medicare)? */
function groupIsMspPrimary(c: Coverage): boolean {
  return c.activeEmployment === true && c.employerSize20Plus === true;
}

/** Parse a birthday "MM-DD" into a comparable day-of-year ordinal (0 when unparseable). */
function birthdayOrdinal(mmdd: string | undefined): number {
  if (!mmdd) return Number.POSITIVE_INFINITY;
  const m = /^(\d{2})-(\d{2})$/.exec(mmdd);
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]) * 100 + Number(m[2]);
}

/** Parse an ISO date to a comparable epoch (Infinity when absent/unparseable). */
function startEpoch(iso: string | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Compare two coverages for a patient and return which is primary, plus the COB
 * rule that decided it. Deterministic precedence (first applicable rule wins):
 *   1. custody / court decree (dependent child) overrides everything,
 *   2. Medicaid is the payer of last resort,
 *   3. Medicare Secondary Payer,
 *   4. subscriber-before-dependent,
 *   5. active-employee-before-inactive,
 *   6. the birthday rule (dependent child),
 *   7. longer-coverage tie-break (earlier start; residual tie by coverage id).
 */
export function compareCoverages(
  a: Coverage,
  b: Coverage,
  ctx: { isDependentChild: boolean; custodyDecreePrimaryCoverageId?: string }
): { primary: Coverage; ruleId: string } {
  // 1. Custody / court decree overrides the birthday rule (dependent child only).
  if (ctx.isDependentChild && ctx.custodyDecreePrimaryCoverageId) {
    if (a.coverageId === ctx.custodyDecreePrimaryCoverageId) {
      return { primary: a, ruleId: "rule.cob.custody-decree-overrides-birthday" };
    }
    if (b.coverageId === ctx.custodyDecreePrimaryCoverageId) {
      return { primary: b, ruleId: "rule.cob.custody-decree-overrides-birthday" };
    }
  }

  // 2. Medicaid is always the payer of last resort.
  const aMedicaid = a.planType === "medicaid";
  const bMedicaid = b.planType === "medicaid";
  if (aMedicaid !== bMedicaid) {
    return {
      primary: aMedicaid ? b : a,
      ruleId: "rule.cob.medicaid-payer-of-last-resort"
    };
  }

  // 3. Medicare Secondary Payer.
  const aMedicare = a.planType === "medicare";
  const bMedicare = b.planType === "medicare";
  if (aMedicare !== bMedicare) {
    const medicare = aMedicare ? a : b;
    const group = aMedicare ? b : a;
    const groupPrimary = groupIsMspPrimary(group);
    return {
      primary: groupPrimary ? group : medicare,
      ruleId: "rule.cob.medicare-secondary-payer"
    };
  }

  // 4. A plan covering you as the subscriber beats one covering you as a dependent.
  if (a.role !== b.role) {
    return {
      primary: a.role === "subscriber" ? a : b,
      ruleId: "rule.cob.subscriber-before-dependent"
    };
  }

  // 5. Active-employment coverage beats COBRA / retiree / laid-off coverage.
  if (a.activeEmployment !== b.activeEmployment) {
    return {
      primary: a.activeEmployment ? a : b,
      ruleId: "rule.cob.active-employee-before-inactive"
    };
  }

  // 6. The birthday rule (dependent child under both parents).
  if (ctx.isDependentChild) {
    const aOrd = birthdayOrdinal(a.subscriberBirthday);
    const bOrd = birthdayOrdinal(b.subscriberBirthday);
    if (aOrd !== bOrd) {
      return { primary: aOrd < bOrd ? a : b, ruleId: "rule.cob.birthday-rule" };
    }
  }

  // 7. Longer-coverage tie-break — earlier start date; residual tie by coverage id.
  const aStart = startEpoch(a.coverageStartDate);
  const bStart = startEpoch(b.coverageStartDate);
  if (aStart !== bStart) {
    return { primary: aStart < bStart ? a : b, ruleId: "rule.cob.longer-coverage-tiebreak" };
  }
  return {
    primary: a.coverageId <= b.coverageId ? a : b,
    ruleId: "rule.cob.longer-coverage-tiebreak"
  };
}

/**
 * The deterministic order-of-benefits function — the heart of the service.
 * DETERMINISTIC: a pure function of the coverages + the request's own context (no
 * randomness, no clock). It orders the coverages primary → secondary → tertiary by
 * repeatedly applying compareCoverages, and cites the governing COB rule for every
 * ordering decision. It NEVER adjudicates or pays — it produces a payer-order
 * RECOMMENDATION (requiresHumanCosign:true).
 */
export function evaluateCoordinationOfBenefits(request: CobRequest): CobDetermination {
  const ctx = {
    isDependentChild: request.isDependentChild,
    custodyDecreePrimaryCoverageId: request.custodyDecreePrimaryCoverageId
  };
  const synthNote =
    "Synthetic/illustrative COB rule catalog, plan types, and payer labels — NOT a certified coordination-of-benefits engine; real COB is governed by the NAIC COB Model Regulation, Medicare Secondary Payer (42 CFR 411), Medicaid third-party liability (42 CFR 433.139), and state insurance code.";

  const base = {
    patientRef: request.patientRef,
    isDependentChild: request.isDependentChild,
    custodyDecreePrimaryCoverageId: request.custodyDecreePrimaryCoverageId,
    requiresHumanCosign: true,
    synthetic: true as const
  };

  const coverages = Array.isArray(request.coverages) ? request.coverages.slice() : [];

  if (coverages.length === 0) {
    return {
      ...base,
      orderedCoverages: [],
      primaryCoverageId: "",
      custodyDecreeApplied: false,
      citedRuleIds: [],
      reason: COB_REASON.noCoverage,
      note: `Patient ${request.patientRef} has no coverage on file → nothing to coordinate. ${synthNote}`
    };
  }

  // Deterministic selection sort using compareCoverages: repeatedly pick the coverage
  // that beats every other remaining coverage. (N is tiny — coverages per patient — so
  // an O(n^2) pass is both clearest and stable.)
  const remaining = coverages.slice();
  const ordered: Coverage[] = [];
  while (remaining.length > 0) {
    let best = remaining[0];
    for (let i = 1; i < remaining.length; i++) {
      best = compareCoverages(best, remaining[i], ctx).primary;
    }
    ordered.push(best);
    remaining.splice(
      remaining.findIndex((c) => c.coverageId === best.coverageId),
      1
    );
  }

  // Each coverage cites the rule by which the coverage ABOVE it wins: the primary
  // (rank 1) cites the rule by which it beats #2; every lower rank cites the rule by
  // which the rank above beats it. A sole coverage is primary by default.
  const decidingRuleForRank: string[] = ordered.map((c, idx) => {
    if (ordered.length === 1) return "rule.cob.sole-coverage-primary";
    if (idx === 0) return compareCoverages(ordered[0], ordered[1], ctx).ruleId;
    return compareCoverages(ordered[idx - 1], ordered[idx], ctx).ruleId;
  });

  const orderedCoverages: OrderedCoverage[] = ordered.map((c, idx) => ({
    coverageId: c.coverageId,
    payerName: c.payerName,
    planType: c.planType,
    role: c.role,
    rank: idx + 1,
    decidingRuleId: decidingRuleForRank[idx],
    decidingRuleLabel: cobRuleLabel(decidingRuleForRank[idx])
  }));

  const primary = orderedCoverages[0];
  const custodyDecreeApplied =
    request.isDependentChild === true &&
    typeof request.custodyDecreePrimaryCoverageId === "string" &&
    primary.coverageId === request.custodyDecreePrimaryCoverageId &&
    primary.decidingRuleId === "rule.cob.custody-decree-overrides-birthday";

  const citedRuleIds = Array.from(
    new Set(orderedCoverages.map((c) => c.decidingRuleId))
  );

  const reason =
    orderedCoverages.length === 1
      ? COB_REASON.soleCoverage
      : `${primary.payerName} (${primary.coverageId}) is PRIMARY under ${primary.decidingRuleLabel}; ${orderedCoverages.length} coverages coordinated`;

  return {
    ...base,
    orderedCoverages,
    primaryCoverageId: primary.coverageId,
    custodyDecreeApplied,
    citedRuleIds,
    reason,
    note:
      `Order of benefits for ${request.patientRef}: ` +
      orderedCoverages
        .map(
          (c) =>
            `#${c.rank} ${c.payerName} (${c.coverageId}) — ${c.decidingRuleLabel}`
        )
        .join("; ") +
      `. This is a payer-order RECOMMENDATION requiring human cosign — the agent never autonomously adjudicates or pays a claim. ` +
      synthNote
  };
}

/**
 * Rule-sourced check: does every ordered coverage cite a recognized COB rule? True
 * when the determination is well-formed and every orderedCoverages[].decidingRuleId
 * is a recognized COB rule; the guard that catches a caller-asserted ad-hoc ordering
 * with no cited rule (a missing or off-catalog rule id). Anything
 * evaluateCoordinationOfBenefits() produces satisfies it. This is the honest signal
 * the route reports to policy.cob.order-of-benefits-rule-sourced. A non-object input
 * is a violation.
 */
export function cobRuleCited(
  determination: Pick<CobDetermination, "orderedCoverages"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  const ordered = determination.orderedCoverages;
  if (!Array.isArray(ordered)) return false;
  return ordered.every((c) => c && isCobRule(c.decidingRuleId));
}

/**
 * Decree-overrides-birthday check: when a custody decree names a primary coverage
 * for a dependent child, is that coverage actually the determined primary? True
 * unless a dependent-child determination carries a custodyDecreePrimaryCoverageId
 * whose coverage is NOT the primary — the guard that catches an ordering that
 * ignores an active custody decree (the birthday rule silently overriding the
 * decree). Anything evaluateCoordinationOfBenefits() produces satisfies it (a decree
 * short-circuits the comparator). This is the honest signal the route reports to
 * policy.cob.custody-decree-overrides-birthday. A non-object input is a violation.
 */
export function cobDecreeHonored(
  determination:
    | Pick<
        CobDetermination,
        "isDependentChild" | "custodyDecreePrimaryCoverageId" | "primaryCoverageId"
      >
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (determination.isDependentChild !== true) return true;
  const decreeId = determination.custodyDecreePrimaryCoverageId;
  if (typeof decreeId !== "string" || decreeId.length === 0) return true;
  return determination.primaryCoverageId === decreeId;
}

/**
 * No-autonomous-adjudication check: is the determination gated on human cosign? True
 * for any determination carrying requiresHumanCosign:true; the guard that catches a
 * caller-asserted AUTONOMOUS adjudication (a determination that would drive claim
 * payment without a human). Anything evaluateCoordinationOfBenefits() produces
 * satisfies it (requiresHumanCosign is always true). This is the honest signal the
 * route reports to policy.cob.no-autonomous-adjudication. A non-object input is a
 * violation.
 */
export function cobHumanCosigned(
  determination: Pick<CobDetermination, "requiresHumanCosign"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return determination.requiresHumanCosign === true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the
 * Agent Fabric trace + the response `meta`. Carries no free-text PHI (refs, coverage
 * ids, plan types, ranks, and cited rule ids only).
 */
export function cobSummary(determination: CobDetermination): {
  patientRef: string;
  isDependentChild: boolean;
  primaryCoverageId: string;
  order: { coverageId: string; rank: number; planType: CoveragePlanType; decidingRuleId: string }[];
  citedRuleIds: string[];
  custodyDecreeApplied: boolean;
  requiresHumanCosign: boolean;
  synthetic: boolean;
} {
  return {
    patientRef: determination.patientRef,
    isDependentChild: determination.isDependentChild,
    primaryCoverageId: determination.primaryCoverageId,
    order: determination.orderedCoverages.map((c) => ({
      coverageId: c.coverageId,
      rank: c.rank,
      planType: c.planType,
      decidingRuleId: c.decidingRuleId
    })),
    citedRuleIds: determination.citedRuleIds,
    custodyDecreeApplied: determination.custodyDecreeApplied,
    requiresHumanCosign: determination.requiresHumanCosign,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request (illustrative). The patient is the subscriber on
 * their own employer PPO and is also covered as a dependent on their spouse's plan →
 * the plan that covers them as the SUBSCRIBER is primary (subscriber-before-
 * dependent). Synthetic / de-identified.
 */
export const DEMO_COB_REQUEST: CobRequest = {
  patientRef: "cob-patient-001",
  isDependentChild: false,
  coverages: [
    {
      coverageId: "coverage-own-ppo",
      payerName: "Acme Commercial PPO",
      planType: "commercial-group",
      role: "subscriber",
      activeEmployment: true,
      employerSize20Plus: true,
      coverageStartDate: "2020-01-01"
    },
    {
      coverageId: "coverage-spouse-hmo",
      payerName: "Beacon Spouse HMO",
      planType: "commercial-group",
      role: "dependent",
      activeEmployment: true,
      employerSize20Plus: true,
      coverageStartDate: "2019-06-01"
    }
  ],
  atTime: "2026-03-01T00:00:00Z"
};

/**
 * A representative demo BIRTHDAY-RULE request (illustrative). A dependent child is
 * covered under both parents' plans; the mother's birthday (03-14) falls earlier in
 * the calendar year than the father's (06-20), so the mother's plan is primary under
 * the birthday rule. Synthetic / de-identified.
 */
export const DEMO_COB_BIRTHDAY_REQUEST: CobRequest = {
  patientRef: "cob-patient-002",
  isDependentChild: true,
  coverages: [
    {
      coverageId: "coverage-mom-ppo",
      payerName: "Acme Mom PPO",
      planType: "commercial-group",
      role: "dependent",
      activeEmployment: true,
      employerSize20Plus: true,
      subscriberBirthday: "03-14",
      coverageStartDate: "2021-01-01"
    },
    {
      coverageId: "coverage-dad-hmo",
      payerName: "Beacon Dad HMO",
      planType: "commercial-group",
      role: "dependent",
      activeEmployment: true,
      employerSize20Plus: true,
      subscriberBirthday: "06-20",
      coverageStartDate: "2020-01-01"
    }
  ],
  atTime: "2026-03-01T00:00:00Z"
};

/**
 * A representative demo CUSTODY-DECREE request (illustrative). The same dependent
 * child covered under both parents — but an active court decree assigns primary
 * responsibility to the FATHER's plan, which overrides the birthday rule (the
 * mother's earlier birthday would otherwise win). Synthetic / de-identified.
 */
export const DEMO_COB_DECREE_REQUEST: CobRequest = {
  patientRef: "cob-patient-003",
  isDependentChild: true,
  custodyDecreePrimaryCoverageId: "coverage-dad-hmo",
  coverages: DEMO_COB_BIRTHDAY_REQUEST.coverages,
  atTime: "2026-03-01T00:00:00Z"
};

/**
 * A representative demo MEDICARE-SECONDARY-PAYER request (illustrative). A working-
 * aged patient is an active employee at a 20+-employee employer AND has Medicare →
 * the group health plan is PRIMARY and Medicare is SECONDARY (MSP). Synthetic /
 * de-identified.
 */
export const DEMO_COB_MSP_REQUEST: CobRequest = {
  patientRef: "cob-patient-004",
  isDependentChild: false,
  coverages: [
    {
      coverageId: "coverage-employer-group",
      payerName: "Acme Employer Group Plan",
      planType: "commercial-group",
      role: "subscriber",
      activeEmployment: true,
      employerSize20Plus: true,
      coverageStartDate: "2015-01-01"
    },
    {
      coverageId: "coverage-medicare-a-b",
      payerName: "Medicare Parts A & B",
      planType: "medicare",
      role: "subscriber",
      activeEmployment: false,
      coverageStartDate: "2024-01-01"
    }
  ],
  atTime: "2026-03-01T00:00:00Z"
};
