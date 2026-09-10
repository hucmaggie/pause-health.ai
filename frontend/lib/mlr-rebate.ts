/**
 * Medical Loss Ratio (MLR) Rebate Calculation — the deterministic, transparent payer-operations layer
 * that computes a plan's Medical Loss Ratio for a market, decides whether it meets the ACA standard,
 * and — when it falls short — APPORTIONS the total rebate owed across the plan's subscribers
 * penny-exactly (largest-remainder / Hamilton method), never autonomously DISBURSING a rebate; a
 * treasury / compliance reviewer confirms and issues every payment.
 *
 * Deterministic, dependency-free domain core the MLR Rebate Agent (app/api/agents/mlr-rebate) wraps —
 * a claims / payer-operations service on the payer & plan operations plane of Pause's Agent Fabric.
 * UNLIKE the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the OIG Exclusion agent's identity
 * MATCHING, or the Drug Interaction agent's pairwise LOOKUP, the heart of this service is a
 * RATIO-vs-THRESHOLD test + an EXACT PROPORTIONAL APPORTIONMENT. The ACA (45 CFR Part 158) requires
 * insurers to spend a minimum share of premium on claims + quality improvement (80% individual /
 * small-group, 85% large-group); when they don't, the shortfall is rebated to subscribers.
 *
 *   Inbound:  an MlrRebateRequest { requestRef, planRef, market, earnedPremium, incurredClaims,
 *             qualityImprovementExpense, taxesAndFees, subscribers[] }
 *   Outbound: an MlrRebateDetermination { market, standard, adjustedPremium, mlrNumerator, mlr,
 *             meetsStandard, totalRebate, allocations[], allocatedTotal, requiresTreasuryReview:true,
 *             autoDisbursed:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other payer-operations agents: distinct from the Claims
 * Adjudication agent (WHAT the allowed amount is), the Member Cost-Share agent (SPLITTING one claim's
 * allowed amount into member vs. plan), the Coordination of Benefits agent (the ORDER of coverages),
 * the Overpayment & Recovery agent (clawing back an overpayment), and the Subrogation agent (recovery
 * from a liable third party): this computes a PLAN-YEAR-LEVEL rebate owed to subscribers under the ACA
 * MLR rule and apportions it fairly.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the applicable MLR standard traces to the recorded market catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  A rebate is credible only if the standard it is measured against is the correct one for the market
 *  — the applied standard must resolve in the recorded MLR_STANDARDS catalog and match the market; an
 *  off-catalog market or a mis-stated standard is how a rebate is wrongly triggered or wrongly avoided.
 *  mlrInputsSourced() reports the honest signal the Agent Fabric enforces via
 *  policy.mlr.inputs-sourced. (Mirrors the Member Cost-Share Agent's benefit-design-sourced and the
 *  Good Faith Estimate Agent's charge-master-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the MLR and the apportionment are exact.
 * ─────────────────────────────────────────────────────────────────────
 *  The reported MLR must equal (claims + quality improvement) / (earned premium − taxes & fees), the
 *  total rebate must equal max(0, standard − MLR) × earned premium, and the per-subscriber allocations
 *  must sum EXACTLY to the total rebate (to the penny) with every allocation non-negative. A rebate
 *  that doesn't add up — or an apportionment that loses / invents pennies — is a compliance and
 *  accounting defect. mlrAllocationConsistent() recomputes the ratio, the total, and the penny-exact
 *  sum; it reports the honest signal the Agent Fabric enforces via policy.mlr.allocation-consistent.
 *  (The load-bearing correctness gate — mirrors the Member Cost-Share Agent's math-consistent and the
 *  Risk Adjustment Agent's score-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the rebate is never autonomously disbursed.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent CALCULATES — it never DISBURSES / pays a rebate on its own (a movement of money to
 *  members that must be authorized); every determination is a RECOMMENDATION requiring a treasury /
 *  compliance reviewer to confirm and issue payment. mlrNoAutonomousDisbursement() reports the honest
 *  signal the Agent Fabric enforces via policy.mlr.no-autonomous-disbursement. (Mirrors the Member
 *  Cost-Share Agent's no-autonomous-member-charge and the OIG Exclusion Agent's
 *  no-autonomous-block-or-clear posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — a rebate owed OR the standard met (no rebate) — is a SAFE, honest OUTPUT: the
 *  task COMPLETES (it carries requiresTreasuryReview:true, autoDisbursed:false). A GOVERNANCE BLOCK is
 *  when a caller PRESENTS an offending DETERMINATION (an off-catalog standard, an inconsistent MLR /
 *  apportionment, or an autonomously-disbursed / unreviewed determination) — which the Agent Fabric
 *  rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  NON-PHI: this is aggregate financial data, and it is NOT a certified MLR filing system.
 * ─────────────────────────────────────────────────────────────────────
 *  This agent works on AGGREGATE, plan-year financial figures + a subscriber premium roster — it does
 *  NOT touch patient health information, so it is NOT on the HIPAA-audit policy (phiAccessed:false).
 *  The market standards + the simplified MLR formula below are clearly-labeled ILLUSTRATIVE synthetics
 *  chosen to model the SHAPE of an ACA MLR rebate deterministically in the demo — real MLR reporting
 *  uses the full NAIC MLR Annual Reporting Form, credibility adjustments, multi-year averaging,
 *  permitted adjustments to incurred claims + earned premium, and the applicable federal / state
 *  regulations (45 CFR Part 158). There is NO randomness and NO clock anywhere here: the determination
 *  is a pure function of the request's own fields, so the same plan year always yields the same MLR /
 *  rebate / apportionment — which is what lets the demo, the seeded trace, and the tests agree.
 */

/** Round a dollar amount to whole cents. */
export function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Convert a dollar amount to an integer number of cents. */
function toCents(value: number): number {
  return Math.round(value * 100);
}

/** The insurance market, which determines the applicable MLR standard. */
export type MlrMarket = "individual" | "small-group" | "large-group";

/**
 * ILLUSTRATIVE, synthetic ACA MLR standards by market — clearly labeled. Individual and small-group
 * plans must hit 80%; large-group 85%. A reported standard must resolve here and match the market.
 */
export const MLR_STANDARDS: Record<MlrMarket, number> = {
  individual: 0.8,
  "small-group": 0.8,
  "large-group": 0.85
};

/** Look up the MLR standard for a market (undefined when off-catalog). */
export function getMlrStandard(market: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(MLR_STANDARDS, market)
    ? MLR_STANDARDS[market as MlrMarket]
    : undefined;
}

/** A subscriber on the plan's premium roster (the rebate is apportioned to premium contribution). */
export type MlrSubscriber = {
  /** Synthetic subscriber reference. */
  subscriberRef: string;
  /** The premium this subscriber paid over the plan year. */
  premiumPaid: number;
};

/** An MLR rebate calculation request. */
export type MlrRebateRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic plan reference. */
  planRef: string;
  /** The insurance market (keys MLR_STANDARDS). */
  market: MlrMarket;
  /** Total earned premium over the plan year. */
  earnedPremium: number;
  /** Total incurred claims over the plan year. */
  incurredClaims: number;
  /** Quality-improvement expense (counts toward the numerator). */
  qualityImprovementExpense: number;
  /** Taxes, licensing, and regulatory fees (subtracted from earned premium). */
  taxesAndFees: number;
  /** The subscriber premium roster the rebate is apportioned across. */
  subscribers: MlrSubscriber[];
};

/** A single subscriber's rebate allocation. */
export type MlrAllocation = {
  subscriberRef: string;
  premiumPaid: number;
  /** The rebate apportioned to this subscriber (penny-exact; sums to the total). */
  rebate: number;
};

/** The deterministic MLR rebate determination the agent returns. */
export type MlrRebateDetermination = {
  requestRef: string;
  planRef: string;
  market: MlrMarket;
  /** The applicable MLR standard (0.80 / 0.85). */
  standard: number;
  /** Earned premium (echoed for a self-contained consistency guard). */
  earnedPremium: number;
  /** Incurred claims (echoed). */
  incurredClaims: number;
  /** Quality-improvement expense (echoed). */
  qualityImprovementExpense: number;
  /** Taxes & fees (echoed). */
  taxesAndFees: number;
  /** Earned premium − taxes & fees (the MLR denominator). */
  adjustedPremium: number;
  /** Incurred claims + quality improvement (the MLR numerator). */
  mlrNumerator: number;
  /** The Medical Loss Ratio, to 4 decimals. */
  mlr: number;
  /** Whether the MLR meets / exceeds the standard (no rebate owed when true). */
  meetsStandard: boolean;
  /** The total rebate owed = max(0, standard − MLR) × earned premium, to the penny. */
  totalRebate: number;
  /** The per-subscriber apportionment (penny-exact; sums to totalRebate). */
  allocations: MlrAllocation[];
  /** The sum of the allocations (equals totalRebate). */
  allocatedTotal: number;
  /** Always true — every rebate is confirmed + issued by a treasury / compliance reviewer. */
  requiresTreasuryReview: true;
  /** Always false — the agent never autonomously disburses a rebate. */
  autoDisbursed: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the standards + formula are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * Apportion a total (in cents) across weights using the LARGEST-REMAINDER (Hamilton) method: every
 * share gets the floor of its exact proportional amount, then the leftover cents go one-at-a-time to
 * the shares with the largest fractional remainders (ties broken by index for determinism). The result
 * sums EXACTLY to the total — no penny is lost or invented.
 */
export function apportionLargestRemainder(totalCents: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0 || totalCents <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (totalCents * w) / weightSum);
  const floors = exact.map((x) => Math.floor(x));
  let distributed = floors.reduce((s, x) => s + x, 0);
  let leftover = totalCents - distributed;

  // Order indices by descending fractional remainder, ties by ascending index.
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));

  const result = floors.slice();
  let k = 0;
  while (leftover > 0 && k < order.length) {
    result[order[k].i] += 1;
    leftover -= 1;
    k += 1;
  }
  void distributed;
  return result;
}

/**
 * The deterministic MLR rebate function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own fields (no randomness, no clock). It computes the MLR, decides whether the
 * standard is met, computes the total rebate owed, and apportions it penny-exactly across the
 * subscriber roster. Nothing is disbursed here — every determination is handed to a treasury /
 * compliance reviewer.
 */
export function evaluateMlrRebate(request: MlrRebateRequest): MlrRebateDetermination {
  const standard = getMlrStandard(request.market) ?? 0;
  const subscribers = Array.isArray(request.subscribers) ? request.subscribers : [];

  const adjustedPremium = roundCents(request.earnedPremium - request.taxesAndFees);
  const mlrNumerator = roundCents(request.incurredClaims + request.qualityImprovementExpense);
  const mlrRaw = adjustedPremium > 0 ? mlrNumerator / adjustedPremium : 0;
  const mlr = Math.round((mlrRaw + Number.EPSILON) * 10000) / 10000;

  const meetsStandard = mlr >= standard;
  const shortfall = meetsStandard ? 0 : standard - mlr;
  const totalRebate = roundCents(shortfall * request.earnedPremium);

  const weights = subscribers.map((s) => toCents(s.premiumPaid));
  const allocatedCents = apportionLargestRemainder(toCents(totalRebate), weights);
  const allocations: MlrAllocation[] = subscribers.map((s, i) => ({
    subscriberRef: s.subscriberRef,
    premiumPaid: s.premiumPaid,
    rebate: roundCents(allocatedCents[i] / 100)
  }));
  const allocatedTotal = roundCents(
    allocations.reduce((sum, a) => sum + a.rebate, 0)
  );

  const outcomePhrase = meetsStandard
    ? `MLR ${(mlr * 100).toFixed(2)}% meets the ${(standard * 100).toFixed(0)}% ${request.market} standard — no rebate owed`
    : `MLR ${(mlr * 100).toFixed(2)}% is below the ${(standard * 100).toFixed(0)}% ${request.market} standard — rebate ${totalRebate.toFixed(2)} owed, apportioned across ${allocations.length} subscriber(s)`;

  const reason = `MLR ${request.requestRef} for ${request.planRef} (${request.market}): numerator ${mlrNumerator.toFixed(2)} / adjusted premium ${adjustedPremium.toFixed(2)} = ${(mlr * 100).toFixed(2)}%; ${outcomePhrase}.`;

  return {
    requestRef: request.requestRef,
    planRef: request.planRef,
    market: request.market,
    standard,
    earnedPremium: roundCents(request.earnedPremium),
    incurredClaims: roundCents(request.incurredClaims),
    qualityImprovementExpense: roundCents(request.qualityImprovementExpense),
    taxesAndFees: roundCents(request.taxesAndFees),
    adjustedPremium,
    mlrNumerator,
    mlr,
    meetsStandard,
    totalRebate,
    allocations,
    allocatedTotal,
    requiresTreasuryReview: true,
    autoDisbursed: false,
    reason,
    synthetic: true,
    note:
      `MLR ${request.requestRef}: ${outcomePhrase}. ` +
      "NON-PHI — aggregate plan-year financials + a subscriber premium roster, no patient health information. Synthetic/illustrative ACA MLR standards + simplified formula (no NAIC MLR Annual Reporting Form, credibility adjustments, multi-year averaging, or permitted claim / premium adjustments) — NOT a certified MLR filing system; real MLR reporting is governed by 45 CFR Part 158. The agent never disburses a rebate on its own — a treasury / compliance reviewer confirms and issues every payment."
  };
}

/**
 * Inputs-sourced check: does the applied standard resolve in the recorded MLR_STANDARDS catalog and
 * match the market? True when the market is on-catalog and the determination's standard equals the
 * recorded standard; the guard that catches an off-catalog market or a mis-stated standard (how a
 * rebate is wrongly triggered or avoided). Anything evaluateMlrRebate() produces satisfies it PROVIDED
 * the market is on-catalog. This is the honest signal the route reports to policy.mlr.inputs-sourced.
 * A non-object / malformed input is a violation.
 */
export function mlrInputsSourced(
  decision: { market?: string; standard?: number } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const recorded = typeof decision.market === "string" ? getMlrStandard(decision.market) : undefined;
  if (recorded === undefined) return false;
  if (typeof decision.standard === "number" && decision.standard !== recorded) return false;
  return true;
}

/**
 * Allocation-consistent check: are the MLR, the total rebate, and the apportionment all exact? True
 * only when the MLR equals (claims + quality improvement) / (earned premium − taxes & fees), the total
 * rebate equals max(0, standard − MLR) × earned premium, every allocation is non-negative, and the
 * allocations sum EXACTLY (to the penny) to the total rebate. The load-bearing correctness gate.
 * Anything evaluateMlrRebate() produces satisfies it. This is the honest signal the route reports to
 * policy.mlr.allocation-consistent. A non-object / malformed input is a violation.
 */
export function mlrAllocationConsistent(
  decision:
    | {
        standard?: number;
        earnedPremium?: number;
        incurredClaims?: number;
        qualityImprovementExpense?: number;
        taxesAndFees?: number;
        mlr?: number;
        totalRebate?: number;
        allocations?: Array<{ rebate?: number }>;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const {
    standard,
    earnedPremium,
    incurredClaims,
    qualityImprovementExpense,
    taxesAndFees,
    mlr,
    totalRebate
  } = decision;
  for (const v of [
    standard,
    earnedPremium,
    incurredClaims,
    qualityImprovementExpense,
    taxesAndFees,
    mlr,
    totalRebate
  ]) {
    if (typeof v !== "number" || Number.isNaN(v)) return false;
  }

  // Recompute the MLR.
  const adjustedPremium = roundCents((earnedPremium as number) - (taxesAndFees as number));
  const numerator = roundCents(
    (incurredClaims as number) + (qualityImprovementExpense as number)
  );
  const recomputedMlrRaw = adjustedPremium > 0 ? numerator / adjustedPremium : 0;
  const recomputedMlr = Math.round((recomputedMlrRaw + Number.EPSILON) * 10000) / 10000;
  if (recomputedMlr !== (mlr as number)) return false;

  // Recompute the total rebate.
  const shortfall = recomputedMlr >= (standard as number) ? 0 : (standard as number) - recomputedMlr;
  const recomputedTotal = roundCents(shortfall * (earnedPremium as number));
  if (recomputedTotal !== roundCents(totalRebate as number)) return false;

  // Verify the apportionment: non-negative and penny-exact.
  const allocations = Array.isArray(decision.allocations) ? decision.allocations : [];
  let sumCents = 0;
  for (const a of allocations) {
    const rebate = a && typeof a.rebate === "number" ? a.rebate : NaN;
    if (Number.isNaN(rebate) || rebate < 0) return false;
    sumCents += Math.round(rebate * 100);
  }
  if (sumCents !== Math.round((totalRebate as number) * 100)) return false;
  return true;
}

/**
 * No-autonomous-disbursement check: did the agent avoid autonomously disbursing the rebate? True
 * unless the determination reports it autonomously disbursed (autoDisbursed:true) or does not require
 * treasury review (requiresTreasuryReview:false). Anything evaluateMlrRebate() produces satisfies it.
 * This is the honest signal the route reports to policy.mlr.no-autonomous-disbursement. A non-object
 * input is a violation.
 */
export function mlrNoAutonomousDisbursement(
  decision:
    | { autoDisbursed?: boolean; requiresTreasuryReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoDisbursed === true) return false;
  if (decision.requiresTreasuryReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric trace +
 * the response `meta`.
 */
export function mlrRebateSummary(decision: MlrRebateDetermination): {
  requestRef: string;
  planRef: string;
  market: MlrMarket;
  mlr: number;
  meetsStandard: boolean;
  totalRebate: number;
  subscriberCount: number;
  requiresTreasuryReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: decision.requestRef,
    planRef: decision.planRef,
    market: decision.market,
    mlr: decision.mlr,
    meetsStandard: decision.meetsStandard,
    totalRebate: decision.totalRebate,
    subscriberCount: decision.allocations.length,
    requiresTreasuryReview: decision.requiresTreasuryReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: an individual-market plan whose MLR (77.89%) falls below the 80%
 * standard → a $21,100.00 rebate apportioned across three subscribers (8,440 / 7,385 / 5,275).
 * Synthetic.
 */
export const DEMO_MLR_REBATE_REQUEST: MlrRebateRequest = {
  requestRef: "mlr-001",
  planRef: "plan-ind-2025",
  market: "individual",
  earnedPremium: 1_000_000,
  incurredClaims: 700_000,
  qualityImprovementExpense: 40_000,
  taxesAndFees: 50_000,
  subscribers: [
    { subscriberRef: "sub-A", premiumPaid: 400_000 },
    { subscriberRef: "sub-B", premiumPaid: 350_000 },
    { subscriberRef: "sub-C", premiumPaid: 250_000 }
  ]
};

/**
 * A representative demo request: a large-group plan whose MLR (89.58%) exceeds the 85% standard → the
 * standard is met, no rebate owed. Synthetic.
 */
export const DEMO_MLR_REBATE_MEETS_REQUEST: MlrRebateRequest = {
  requestRef: "mlr-002",
  planRef: "plan-lg-2025",
  market: "large-group",
  earnedPremium: 1_000_000,
  incurredClaims: 800_000,
  qualityImprovementExpense: 60_000,
  taxesAndFees: 40_000,
  subscribers: [
    { subscriberRef: "sub-D", premiumPaid: 600_000 },
    { subscriberRef: "sub-E", premiumPaid: 400_000 }
  ]
};

/**
 * A representative demo request: a small-group plan whose MLR (78.32%) falls below the 80% standard →
 * an $8,400.00 rebate apportioned across four subscribers with UNEVEN premiums, which exercises the
 * largest-remainder penny distribution (the leftover cent lands on the largest fractional remainder).
 * Synthetic.
 */
export const DEMO_MLR_REBATE_SMALL_GROUP_REQUEST: MlrRebateRequest = {
  requestRef: "mlr-003",
  planRef: "plan-sg-2025",
  market: "small-group",
  earnedPremium: 500_000,
  incurredClaims: 360_000,
  qualityImprovementExpense: 12_000,
  taxesAndFees: 25_000,
  subscribers: [
    { subscriberRef: "sub-F", premiumPaid: 173_333 },
    { subscriberRef: "sub-G", premiumPaid: 151_000 },
    { subscriberRef: "sub-H", premiumPaid: 101_667 },
    { subscriberRef: "sub-I", premiumPaid: 74_000 }
  ]
};
