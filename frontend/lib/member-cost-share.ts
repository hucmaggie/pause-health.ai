/**
 * Member Cost-Share / EOB Calculation — the deterministic, transparent benefits layer that splits an
 * adjudicated in-network claim's ALLOWED AMOUNT into the member's cost-share (deductible +
 * coinsurance) and the plan-paid portion, running the classic deductible → coinsurance →
 * out-of-pocket-maximum WATERFALL against the member's plan benefit design and current accumulators —
 * producing the EOB cost-share BREAKDOWN a claims system / human finalizes, never autonomously
 * posting a charge to the member.
 *
 * Deterministic, dependency-free domain core the Member Cost-Share Agent
 * (app/api/agents/member-cost-share) wraps — a claims / payer-operations service on the payer & plan
 * operations plane of Pause's Agent Fabric. Given a cost-share request (a claim reference, a member
 * reference, the member's plan id, the adjudicated allowed amount, and the member's current
 * accumulators — deductible-met and out-of-pocket-met to date), it DETERMINISTICALLY loads the plan
 * benefit design (deductible, coinsurance rate, out-of-pocket maximum) and runs the cost-share
 * waterfall: the deductible is applied first (up to the remaining deductible), the remainder is split
 * by the coinsurance rate (the member's share), and the member's total is capped at the remaining
 * out-of-pocket maximum — the plan pays the rest.
 *
 *   Inbound:  a CostShareRequest { claimRef, memberRef, planId, allowedAmount, deductibleMet, oopMet }
 *   Outbound: a CostShareDetermination { planName, allowedAmount, deductibleApplied,
 *             coinsuranceApplied, oopCapReduction, memberResponsibility, planPaid, coinsuranceRate,
 *             deductibleRemainingAfter, oopRemainingAfter, requiresAdjudicationReview:true,
 *             autoPostedCharge:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other payer-operations agents: distinct from the
 * Claims Adjudication agent (WHAT the allowed amount / medical necessity is — it produces the allowed
 * amount this agent consumes), the Coordination of Benefits agent (the ORDER of coverages), the
 * Subrogation agent (recovery from a liable third party), the Good Faith Estimate agent (the
 * pre-service, uninsured / self-pay estimate), and the Balance Billing agent (surprise-bill
 * protection at claim time): this splits the ALREADY-adjudicated allowed amount into member vs.
 * plan responsibility using the member's benefit design + accumulators.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the benefit design traces to a recorded plan catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  The deductible, coinsurance rate, and out-of-pocket maximum must come from the member's recorded
 *  plan — an ad-hoc / off-catalog plan cannot be correctly cost-shared. costShareBenefitSourced()
 *  reports the honest signal the Agent Fabric enforces via policy.costshare.benefit-design-sourced.
 *  (Mirrors the Good Faith Estimate Agent's charge-master-sourced and the Deal Desk Agent's
 *  pricing-catalog-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the split adds up and is bounded.
 * ─────────────────────────────────────────────────────────────────────
 *  The member responsibility + the plan-paid must equal the allowed amount, the member share must be
 *  non-negative and never exceed the allowed amount or the remaining out-of-pocket maximum, and the
 *  member total must equal the deductible + coinsurance less the OOP-cap reduction — a split that
 *  doesn't add up is how a member is silently over-charged. costShareMathConsistent() recomputes the
 *  split from the determination's own fields and verifies it; it reports the honest signal the Agent
 *  Fabric enforces via policy.costshare.math-consistent. (The load-bearing correctness gate — mirrors
 *  the Good Faith Estimate Agent's math-consistent and the Subrogation Agent's recoverable-within-paid.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the member is never autonomously charged.
 * ─────────────────────────────────────────────────────────────────────
 *  The EOB cost-share is an ESTIMATE / BREAKDOWN — the agent never posts a charge, an invoice, or a
 *  balance to the member; the claims system / a human finalizes it. costShareNoAutonomousCharge()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.costshare.no-autonomous-member-charge. (Mirrors the Balance Billing Agent's
 *  no-autonomous-balance-bill and the Advance Beneficiary Notice Agent's
 *  no-autonomous-beneficiary-liability posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — whatever the member's share works out to — is a SAFE, honest OUTPUT: the task
 *  COMPLETES (it carries requiresAdjudicationReview:true, autoPostedCharge:false). A GOVERNANCE BLOCK
 *  is when a caller PRESENTS an offending DETERMINATION (an off-catalog plan, a split that doesn't add
 *  up, or an autonomously-posted charge) — which the Agent Fabric rejects before it can leave the
 *  fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified claims / adjudication system.
 * ─────────────────────────────────────────────────────────────────────
 *  The plan catalog + the deductible / coinsurance / OOP-max waterfall below are clearly-labeled
 *  ILLUSTRATIVE synthetics chosen to model the SHAPE of an EOB cost-share deterministically in the
 *  demo — they are NOT a complete implementation (no copays, tiering, family accumulators,
 *  out-of-network penalties, or benefit exclusions). Real cost-share is governed by the member's
 *  certificate of coverage / SBC, the payer's adjudication system, and applicable state / federal
 *  law. There is NO randomness and NO clock anywhere here: the split is a pure function of the
 *  request's own fields + the plan, so the same claim always yields the same cost-share — which is
 *  what lets the demo, the seeded trace, and the tests agree.
 */

/** Round to cents (avoids binary-float drift in the waterfall + the guards). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Money comparison tolerance. */
const EPSILON = 0.01;

/** A recorded plan benefit design (a catalog entry that grounds the cost-share waterfall). */
export type BenefitPlan = {
  /** Stable plan id. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** The individual annual deductible. */
  deductible: number;
  /** The individual annual out-of-pocket maximum. */
  oopMax: number;
  /** The member's coinsurance share after the deductible (e.g. 0.2 for 20%). */
  coinsuranceRate: number;
};

/**
 * ILLUSTRATIVE, synthetic plan-benefit catalog — clearly labeled, NOT a real benefit configuration.
 * Each request must reference one of these; the cost-share waterfall is grounded by the plan.
 */
export const BENEFIT_PLANS: BenefitPlan[] = [
  {
    id: "plan.bronze-hdhp",
    name: "Bronze HDHP (individual)",
    deductible: 6000,
    oopMax: 8000,
    coinsuranceRate: 0.3
  },
  {
    id: "plan.silver-ppo",
    name: "Silver PPO (individual)",
    deductible: 2500,
    oopMax: 7000,
    coinsuranceRate: 0.2
  },
  {
    id: "plan.gold-ppo",
    name: "Gold PPO (individual)",
    deductible: 1000,
    oopMax: 5000,
    coinsuranceRate: 0.1
  }
];

/** Look up a plan by id (undefined when off-catalog). */
export function getBenefitPlan(id: string): BenefitPlan | undefined {
  return BENEFIT_PLANS.find((p) => p.id === id);
}

/** A member cost-share request for one adjudicated claim. */
export type CostShareRequest = {
  /** Synthetic claim reference. */
  claimRef: string;
  /** Synthetic member reference. */
  memberRef: string;
  /** The member's plan id (must resolve in the catalog). */
  planId: string;
  /** The adjudicated allowed amount for the claim. */
  allowedAmount: number;
  /** The member's deductible met to date (accumulator). */
  deductibleMet: number;
  /** The member's out-of-pocket met to date (accumulator). */
  oopMet: number;
};

/** The deterministic cost-share determination the agent returns. */
export type CostShareDetermination = {
  claimRef: string;
  memberRef: string;
  planId: string;
  planName: string;
  allowedAmount: number;
  /** The portion applied to the remaining deductible. */
  deductibleApplied: number;
  /** The member's coinsurance on the post-deductible remainder (before the OOP cap). */
  coinsuranceApplied: number;
  /** The reduction from capping the member at the remaining OOP maximum (≥ 0). */
  oopCapReduction: number;
  /** The member's total responsibility (deductible + coinsurance − OOP-cap reduction). */
  memberResponsibility: number;
  /** The plan-paid portion (allowed − member responsibility). */
  planPaid: number;
  /** The plan's coinsurance rate (member share). */
  coinsuranceRate: number;
  /** The member's remaining deductible after this claim. */
  deductibleRemainingAfter: number;
  /** The member's remaining out-of-pocket maximum after this claim. */
  oopRemainingAfter: number;
  /** Always true — the breakdown is finalized by the claims system / a human. */
  requiresAdjudicationReview: true;
  /** Always false — the agent never posts a charge to the member. */
  autoPostedCharge: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the catalog + waterfall are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * The deterministic cost-share function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own fields + the plan (no randomness, no clock). It runs the deductible → coinsurance
 * → out-of-pocket-max waterfall and splits the allowed amount into member vs. plan responsibility.
 * Nothing is posted here — the breakdown is finalized by the claims system / a human.
 */
export function evaluateCostShare(request: CostShareRequest): CostShareDetermination {
  const plan = getBenefitPlan(request.planId);
  const coinsuranceRate = plan?.coinsuranceRate ?? 0;
  const deductible = plan?.deductible ?? 0;
  const oopMax = plan?.oopMax ?? 0;

  const allowedAmount = round2(Math.max(0, request.allowedAmount));
  const deductibleRemaining = round2(Math.max(0, deductible - request.deductibleMet));
  const oopRemaining = round2(Math.max(0, oopMax - request.oopMet));

  // Step A — deductible: the member pays up to the remaining deductible.
  const deductibleApplied = round2(Math.min(allowedAmount, deductibleRemaining));
  const postDeductible = round2(allowedAmount - deductibleApplied);

  // Step B — coinsurance: the member's share of the post-deductible remainder.
  const coinsuranceApplied = round2(postDeductible * coinsuranceRate);

  // Step C — member subtotal, then Step D — cap at the remaining OOP maximum.
  const memberSubtotal = round2(deductibleApplied + coinsuranceApplied);
  const memberResponsibility = plan
    ? round2(Math.min(memberSubtotal, oopRemaining))
    : 0;
  const oopCapReduction = round2(memberSubtotal - memberResponsibility);
  const planPaid = round2(allowedAmount - memberResponsibility);

  const deductibleRemainingAfter = round2(Math.max(0, deductibleRemaining - deductibleApplied));
  const oopRemainingAfter = round2(Math.max(0, oopRemaining - memberResponsibility));

  const reason = plan
    ? `Claim ${request.claimRef} for ${request.memberRef} on ${plan.name}: allowed ${allowedAmount.toFixed(2)} → member ${memberResponsibility.toFixed(2)} (deductible ${deductibleApplied.toFixed(2)} + coinsurance ${coinsuranceApplied.toFixed(2)}${oopCapReduction > 0 ? `, capped ${oopCapReduction.toFixed(2)} at the OOP max` : ""}), plan pays ${planPaid.toFixed(2)}. Estimate for adjudication review — no charge posted.`
    : `Claim ${request.claimRef} for ${request.memberRef}: plan ${request.planId} is off-catalog — cannot compute cost-share. Routed for review.`;

  return {
    claimRef: request.claimRef,
    memberRef: request.memberRef,
    planId: request.planId,
    planName: plan?.name ?? "unknown plan",
    allowedAmount,
    deductibleApplied: plan ? deductibleApplied : 0,
    coinsuranceApplied: plan ? coinsuranceApplied : 0,
    oopCapReduction: plan ? oopCapReduction : 0,
    memberResponsibility,
    planPaid: plan ? planPaid : allowedAmount,
    coinsuranceRate,
    deductibleRemainingAfter: plan ? deductibleRemainingAfter : 0,
    oopRemainingAfter: plan ? oopRemainingAfter : 0,
    requiresAdjudicationReview: true,
    autoPostedCharge: false,
    reason,
    synthetic: true,
    note:
      `Member cost-share for claim ${request.claimRef}: allowed ${allowedAmount.toFixed(2)}, member ${memberResponsibility.toFixed(2)}, plan ${(plan ? planPaid : allowedAmount).toFixed(2)}. ` +
      "PHI-bearing — the claim references the patient's care. Synthetic/illustrative plan catalog + deductible/coinsurance/OOP waterfall (no copays, tiering, family accumulators, or out-of-network penalties) — NOT a certified claims / adjudication system; real cost-share is governed by the member's certificate of coverage / SBC, the payer's adjudication system, and applicable law. The agent produces an EOB cost-share ESTIMATE — it never posts a charge to the member."
  };
}

/**
 * Benefit-design-sourced check: does the plan resolve in the recorded catalog? True only when the
 * determination's plan id is cataloged; the guard that catches an ad-hoc / off-catalog plan (which
 * cannot be correctly cost-shared). Anything evaluateCostShare() produces from a cataloged plan
 * satisfies it. This is the honest signal the route reports to policy.costshare.benefit-design-sourced.
 * A non-object input is a violation.
 */
export function costShareBenefitSourced(
  decision: { planId?: string } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (typeof decision.planId !== "string") return false;
  return getBenefitPlan(decision.planId) !== undefined;
}

/**
 * Math-consistent check: does the split add up and stay bounded? True unless member + plan ≠ allowed,
 * the member share is negative / exceeds the allowed, the member total ≠ deductible + coinsurance −
 * OOP-cap reduction, or (when the coinsurance rate is present) the coinsurance ≠ the rate applied to
 * the post-deductible remainder; the guard that catches a split that doesn't add up. Anything
 * evaluateCostShare() produces satisfies it. This is the honest signal the route reports to
 * policy.costshare.math-consistent. A non-object / malformed input is a violation.
 */
export function costShareMathConsistent(
  decision:
    | {
        allowedAmount?: number;
        deductibleApplied?: number;
        coinsuranceApplied?: number;
        oopCapReduction?: number;
        memberResponsibility?: number;
        planPaid?: number;
        coinsuranceRate?: number;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const {
    allowedAmount,
    deductibleApplied,
    coinsuranceApplied,
    oopCapReduction,
    memberResponsibility,
    planPaid
  } = decision;
  if (
    typeof allowedAmount !== "number" ||
    typeof deductibleApplied !== "number" ||
    typeof coinsuranceApplied !== "number" ||
    typeof oopCapReduction !== "number" ||
    typeof memberResponsibility !== "number" ||
    typeof planPaid !== "number"
  ) {
    return false;
  }
  // Non-negativity + bounds.
  if (deductibleApplied < -EPSILON || coinsuranceApplied < -EPSILON || oopCapReduction < -EPSILON) {
    return false;
  }
  if (memberResponsibility < -EPSILON || memberResponsibility > allowedAmount + EPSILON) return false;
  // The member+plan identity.
  if (Math.abs(memberResponsibility + planPaid - allowedAmount) > EPSILON) return false;
  // The waterfall identity: member = deductible + coinsurance − OOP-cap reduction.
  const expectedMember = round2(deductibleApplied + coinsuranceApplied - oopCapReduction);
  if (Math.abs(expectedMember - memberResponsibility) > EPSILON) return false;
  // The coinsurance is the rate applied to the post-deductible remainder.
  if (typeof decision.coinsuranceRate === "number") {
    const postDeductible = round2(allowedAmount - deductibleApplied);
    const expectedCoins = round2(postDeductible * decision.coinsuranceRate);
    if (Math.abs(expectedCoins - coinsuranceApplied) > EPSILON) return false;
  }
  return true;
}

/**
 * No-autonomous-member-charge check: did the agent avoid posting a charge to the member? True unless
 * the determination reports it posted a charge (autoPostedCharge:true) or does not require
 * adjudication review (requiresAdjudicationReview:false); the guard that catches an autonomously-
 * posted member charge. Anything evaluateCostShare() produces satisfies it. This is the honest signal
 * the route reports to policy.costshare.no-autonomous-member-charge. A non-object input is a violation.
 */
export function costShareNoAutonomousCharge(
  decision:
    | { autoPostedCharge?: boolean; requiresAdjudicationReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoPostedCharge === true) return false;
  if (decision.requiresAdjudicationReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric trace +
 * the response `meta`.
 */
export function costShareSummary(decision: CostShareDetermination): {
  claimRef: string;
  memberRef: string;
  planId: string;
  allowedAmount: number;
  memberResponsibility: number;
  planPaid: number;
  requiresAdjudicationReview: boolean;
  synthetic: boolean;
} {
  return {
    claimRef: decision.claimRef,
    memberRef: decision.memberRef,
    planId: decision.planId,
    allowedAmount: decision.allowedAmount,
    memberResponsibility: decision.memberResponsibility,
    planPaid: decision.planPaid,
    requiresAdjudicationReview: decision.requiresAdjudicationReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a member partway through the deductible → a mix of deductible +
 * coinsurance. Synthetic.
 */
export const DEMO_COST_SHARE_REQUEST: CostShareRequest = {
  claimRef: "claim-4471",
  memberRef: "member-8842",
  planId: "plan.silver-ppo",
  allowedAmount: 4000,
  deductibleMet: 2000,
  oopMet: 2000
};

/**
 * A representative demo request: a member near the out-of-pocket maximum → the member's share is
 * capped. Synthetic.
 */
export const DEMO_COST_SHARE_OOP_REQUEST: CostShareRequest = {
  claimRef: "claim-5590",
  memberRef: "member-7310",
  planId: "plan.silver-ppo",
  allowedAmount: 5000,
  deductibleMet: 2500,
  oopMet: 6500
};

/**
 * A representative demo request: a member who hasn't met any deductible → the whole allowed lands on
 * the member (still under the OOP max). Synthetic.
 */
export const DEMO_COST_SHARE_DEDUCTIBLE_REQUEST: CostShareRequest = {
  claimRef: "claim-6612",
  memberRef: "member-5521",
  planId: "plan.bronze-hdhp",
  allowedAmount: 800,
  deductibleMet: 0,
  oopMet: 0
};
