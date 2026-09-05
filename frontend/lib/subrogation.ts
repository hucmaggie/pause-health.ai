/**
 * Subrogation / Third-Party Liability (TPL) — the deterministic, transparent recovery layer that
 * decides, for an INJURY-related claim the plan already paid, whether the plan has a subrogation /
 * reimbursement interest in a liable third party's settlement, cites the recorded legal BASIS,
 * computes a BOUNDED recoverable lien amount (never more than the plan paid, never more than the
 * settlement, reduced by the made-whole and common-fund doctrines), and hands it to a subrogation
 * specialist / plan counsel to act on — NEVER autonomously asserting or perfecting a lien or
 * reducing the member's recovery.
 *
 * Deterministic, dependency-free domain core the Subrogation Agent (app/api/agents/subrogation)
 * wraps — a claims / payer-operations service on the payer & plan-operations plane of Pause's Agent
 * Fabric. When a plan pays claims for an injury caused by a liable third party (an auto accident, a
 * slip-and-fall, a defective product, a work injury), the plan generally has a subrogation /
 * reimbursement RIGHT to recover its payments out of the third party's settlement. Given a
 * subrogation case (whether the claim is injury-related, the accident type, whether a liable third
 * party is identified, the amount the plan PAID on the injury claims, the cited subrogation basis,
 * the third-party settlement amount if known, and whether the made-whole / common-fund doctrines
 * apply), it DETERMINISTICALLY decides eligibility, computes the bounded recoverable amount, and
 * decides the disposition.
 *
 *   Inbound:  a SubrogationRequest { caseRef, patientRef, injuryRelated, accidentType,
 *             thirdPartyLiable, planPaidAmount, basisId, settlementAmount?, madeWholeApplies?,
 *             commonFundApplies?, attorneyFeeRate? }
 *   Outbound: a SubrogationDetermination { eligible, basisId, basisType, recoverableAmount,
 *             reductions[], disposition, requiresHumanReview:true|false, autoAssertedLien:false,
 *             reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other payer-operations agents: distinct from the
 * Claims Adjudication Assistant (per-claim edits / medical necessity), the Coordination of Benefits
 * agent (the ORDER of coverages that both cover the member), the Claims Overpayment & Recovery agent
 * (POST-payment clawback of a plan's OWN overpayment), the Timely Filing agent (was the claim filed
 * in time), and the FWA agent (suspected fraud): this recovers the plan's injury-claim payments from
 * a LIABLE THIRD PARTY's settlement.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every recovery decision cites a recorded legal basis.
 * ─────────────────────────────────────────────────────────────────────
 *  A subrogation interest exists only under a recorded legal basis — an ERISA plan reimbursement
 *  clause, a state subrogation statute, a workers-comp lien. The cited basis must resolve in the
 *  recorded catalog; an ad-hoc / off-catalog basis is not a real legal right. subrogationBasisSourced()
 *  reports the honest signal the Agent Fabric enforces via policy.subrogation.basis-sourced. (Mirrors
 *  the Overpayment Recovery Agent's reason-catalog-sourced and the Timely Filing Agent's
 *  filing-limit-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the recoverable never exceeds what the plan paid (or the settlement).
 * ─────────────────────────────────────────────────────────────────────
 *  The plan may recover at most what it PAID, and never more than the third-party settlement — a
 *  subrogation lien is reimbursement, not profit. subrogationRecoverableWithinPaid() recomputes the
 *  bound from the determination's own fields and verifies the asserted recoverable does not exceed
 *  the plan's paid amount or the settlement (and is not negative); it reports the honest signal the
 *  Agent Fabric enforces via policy.subrogation.recoverable-within-paid. (The load-bearing
 *  correctness gate — mirrors the Good Faith Estimate Agent's math-consistent and the Timely Filing
 *  Agent's deadline-computed.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a lien is never autonomously asserted.
 * ─────────────────────────────────────────────────────────────────────
 *  A subrogation determination is a RECOMMENDATION requiring a subrogation specialist / plan
 *  counsel to review — the agent never autonomously asserts or perfects a lien, reduces the member's
 *  settlement, or recovers funds. subrogationNoAutonomousLien() reports the honest signal the Agent
 *  Fabric enforces via policy.subrogation.no-autonomous-lien. (Mirrors the Overpayment Recovery
 *  Agent's no-autonomous-clawback and the Balance Billing Agent's no-autonomous-balance-bill posture
 *  — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — eligible OR not — is a SAFE, honest OUTPUT: the task COMPLETES (an eligible
 *  case carries requiresHumanReview:true). A GOVERNANCE BLOCK is when a caller PRESENTS an offending
 *  DETERMINATION (an off-catalog basis, a recoverable exceeding the plan's paid amount / the
 *  settlement, or an autonomously-asserted / unreviewed lien) — which the Agent Fabric rejects
 *  before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified subrogation engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The basis catalog and the made-whole / common-fund reductions below are clearly-labeled
 *  ILLUSTRATIVE synthetics chosen to model the SHAPE of a subrogation determination deterministically
 *  in the demo. Real subrogation is governed by the plan document (for a self-funded ERISA plan,
 *  29 U.S.C. §1132(a)(3) and cases such as US Airways v. McCutchen and Montanile v. Board of
 *  Trustees), state subrogation / made-whole / common-fund law, and state workers-compensation
 *  statutes. There is NO randomness and NO clock anywhere here: the determination is a pure function
 *  of the request's own fields, so the same case always yields the same eligibility / recoverable /
 *  disposition — which is what lets the demo, the seeded trace, and the tests agree.
 */

/** Round to cents (avoids binary-float drift in the recoverable math + the guards). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Money-comparison tolerance (half a cent). */
const MONEY_EPSILON = 0.005;

/** The kind of accident / injury that gives rise to a third-party liability. */
export type AccidentType =
  | "auto"
  | "workers-comp"
  | "premises-liability"
  | "product-liability"
  | "none";

/** The legal source of a subrogation / reimbursement right. */
export type SubrogationBasisType =
  | "erisa-plan-clause"
  | "state-subrogation-statute"
  | "workers-comp-statute"
  | "contractual";

/** A recorded subrogation basis (a catalog entry that grounds the legal right). */
export type SubrogationBasis = {
  /** Stable basis id. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** The legal source type. */
  type: SubrogationBasisType;
  /** Whether this basis grounds a recovery right. */
  allowsRecovery: boolean;
};

/**
 * ILLUSTRATIVE, synthetic subrogation-basis catalog — clearly labeled, NOT a complete legal
 * implementation. Each recovery decision must cite one of these.
 */
export const SUBROGATION_BASES: SubrogationBasis[] = [
  {
    id: "basis.erisa-plan-reimbursement",
    label: "ERISA self-funded plan reimbursement / subrogation clause",
    type: "erisa-plan-clause",
    allowsRecovery: true
  },
  {
    id: "basis.state-subrogation-statute",
    label: "State subrogation statute (fully-insured plan)",
    type: "state-subrogation-statute",
    allowsRecovery: true
  },
  {
    id: "basis.workers-comp-lien",
    label: "Workers' compensation statutory lien",
    type: "workers-comp-statute",
    allowsRecovery: true
  },
  {
    id: "basis.contractual-reimbursement",
    label: "Contractual reimbursement provision (member agreement)",
    type: "contractual",
    allowsRecovery: true
  }
];

/** Look up a subrogation basis by id (undefined when off-catalog). */
export function getSubrogationBasis(id: string): SubrogationBasis | undefined {
  return SUBROGATION_BASES.find((b) => b.id === id);
}

/** A subrogation / TPL case request. */
export type SubrogationRequest = {
  /** Synthetic case reference. */
  caseRef: string;
  /** Synthetic patient reference. */
  patientRef: string;
  /** Whether the claim(s) arose from an accident / injury. */
  injuryRelated: boolean;
  /** The accident type. */
  accidentType: AccidentType;
  /** Whether a liable third party has been identified. */
  thirdPartyLiable: boolean;
  /** What the plan PAID on the injury-related claims. */
  planPaidAmount: number;
  /** The cited subrogation basis id. */
  basisId: string;
  /** The third-party settlement amount, if known. */
  settlementAmount?: number;
  /** Whether the made-whole doctrine applies (member not yet fully compensated). */
  madeWholeApplies?: boolean;
  /** Whether the common-fund doctrine applies (recovery reduced by pro-rata attorney fees). */
  commonFundApplies?: boolean;
  /** The attorney-fee rate for the common-fund reduction (e.g. 0.33). */
  attorneyFeeRate?: number;
};

/** A single reduction applied to the recoverable amount (for transparency). */
export type RecoverableReduction = {
  label: string;
  amount: number;
};

/** How the case is dispositioned. */
export type SubrogationDisposition =
  | "no-subrogation-interest"
  | "notify-made-whole-bar"
  | "assert-lien-with-review";

/** The deterministic subrogation determination the agent returns. */
export type SubrogationDetermination = {
  /** Synthetic case reference. */
  caseRef: string;
  /** Synthetic patient reference. */
  patientRef: string;
  /** The cited basis id. */
  basisId: string;
  /** The basis type ('unknown' when off-catalog). */
  basisType: SubrogationBasisType | "unknown";
  /** Whether the plan has a subrogation interest. */
  eligible: boolean;
  /** Whether the claim is injury-related. */
  injuryRelated: boolean;
  /** Whether a liable third party is identified. */
  thirdPartyLiable: boolean;
  /** The accident type. */
  accidentType: AccidentType;
  /** What the plan paid. */
  planPaidAmount: number;
  /** The settlement amount (null when unknown). */
  settlementAmount: number | null;
  /** Whether the made-whole doctrine applies. */
  madeWholeApplies: boolean;
  /** Whether the common-fund doctrine applies. */
  commonFundApplies: boolean;
  /** The attorney-fee rate used for the common-fund reduction (0 when N/A). */
  attorneyFeeRate: number;
  /** The bounded recoverable amount (≤ plan paid, ≤ settlement, ≥ 0). */
  recoverableAmount: number;
  /** The reductions applied, for transparency. */
  reductions: RecoverableReduction[];
  /** The disposition. */
  disposition: SubrogationDisposition;
  /** Whether the case requires human (specialist / counsel) review — true for every eligible case. */
  requiresHumanReview: boolean;
  /** Always false — the agent never autonomously asserts / perfects a lien. */
  autoAssertedLien: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the basis catalog + reductions are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * The deterministic subrogation function — the heart of the service. DETERMINISTIC: a pure function
 * of the request's own fields (no randomness, no clock). It decides eligibility (injury-related AND
 * a liable third party AND a real accident AND a recovery-allowing basis), then computes the bounded
 * recoverable — capped at the plan's paid amount, capped again at the settlement, barred by the
 * made-whole doctrine, and reduced by the common-fund attorney-fee share — and decides the
 * disposition. Nothing is asserted here — the determination is a recommendation requiring review.
 */
export function evaluateSubrogation(request: SubrogationRequest): SubrogationDetermination {
  const basis = getSubrogationBasis(request.basisId);
  const basisType: SubrogationBasisType | "unknown" = basis?.type ?? "unknown";
  const settlementAmount =
    typeof request.settlementAmount === "number" ? request.settlementAmount : null;
  const madeWholeApplies = request.madeWholeApplies === true;
  const commonFundApplies = request.commonFundApplies === true;
  const attorneyFeeRate =
    commonFundApplies && typeof request.attorneyFeeRate === "number"
      ? request.attorneyFeeRate
      : 0;

  const eligible =
    request.injuryRelated === true &&
    request.thirdPartyLiable === true &&
    request.accidentType !== "none" &&
    basis?.allowsRecovery === true;

  const reductions: RecoverableReduction[] = [];
  let recoverable = 0;

  if (eligible) {
    recoverable = round2(request.planPaidAmount);

    // Cap at the settlement (the plan cannot recover more than the member received).
    if (settlementAmount !== null && settlementAmount < recoverable) {
      reductions.push({
        label: "capped at the third-party settlement",
        amount: round2(recoverable - settlementAmount)
      });
      recoverable = round2(settlementAmount);
    }

    if (madeWholeApplies) {
      // The made-whole doctrine bars recovery until the member is fully compensated.
      if (recoverable > 0) {
        reductions.push({
          label: "made-whole doctrine bars recovery (member not yet made whole)",
          amount: recoverable
        });
      }
      recoverable = 0;
    } else if (commonFundApplies && attorneyFeeRate > 0) {
      // The common-fund doctrine reduces recovery by the pro-rata attorney fees.
      const reduction = round2(recoverable * attorneyFeeRate);
      reductions.push({
        label: `common-fund attorney-fee reduction (${Math.round(attorneyFeeRate * 100)}%)`,
        amount: reduction
      });
      recoverable = round2(recoverable - reduction);
    }
  }

  const disposition: SubrogationDisposition = !eligible
    ? "no-subrogation-interest"
    : madeWholeApplies
      ? "notify-made-whole-bar"
      : "assert-lien-with-review";

  const requiresHumanReview = eligible;

  const reason = !eligible
    ? `No subrogation interest for ${request.caseRef}: ` +
      `${!request.injuryRelated ? "claim is not injury-related" : request.accidentType === "none" ? "no accident type" : !request.thirdPartyLiable ? "no liable third party identified" : !basis ? "no recorded subrogation basis" : "the cited basis grounds no recovery right"}`
    : madeWholeApplies
      ? `Subrogation interest exists for ${request.caseRef} under ${basis?.label}, but the made-whole doctrine bars recovery until the member is fully compensated — notify and hold; specialist / counsel review required`
      : `Subrogation interest for ${request.caseRef} under ${basis?.label}: recoverable ${recoverable.toFixed(2)} of ${round2(request.planPaidAmount).toFixed(2)} paid${settlementAmount !== null ? ` (settlement ${settlementAmount.toFixed(2)})` : ""}; RECOMMENDED lien requires specialist / counsel review before assertion`;

  return {
    caseRef: request.caseRef,
    patientRef: request.patientRef,
    basisId: request.basisId,
    basisType,
    eligible,
    injuryRelated: request.injuryRelated,
    thirdPartyLiable: request.thirdPartyLiable,
    accidentType: request.accidentType,
    planPaidAmount: round2(request.planPaidAmount),
    settlementAmount: settlementAmount === null ? null : round2(settlementAmount),
    madeWholeApplies,
    commonFundApplies,
    attorneyFeeRate,
    recoverableAmount: recoverable,
    reductions,
    disposition,
    requiresHumanReview,
    autoAssertedLien: false,
    reason,
    synthetic: true,
    note:
      `Subrogation / TPL for ${request.caseRef}: ${eligible ? `eligible under ${basis?.label}, recoverable ${recoverable.toFixed(2)} of ${round2(request.planPaidAmount).toFixed(2)} paid` : "no subrogation interest"}, disposition ${disposition}. ` +
      "Synthetic/illustrative basis catalog + reductions — NOT a certified subrogation engine; real subrogation is governed by the plan document (for a self-funded ERISA plan, 29 U.S.C. §1132(a)(3) and cases such as US Airways v. McCutchen and Montanile), state subrogation / made-whole / common-fund law, and state workers-compensation statutes."
  };
}

/**
 * Basis-sourced check: does the determination cite a recorded subrogation basis? True only when the
 * basis id resolves in the catalog; the guard that catches an ad-hoc / off-catalog basis (which is
 * not a real legal right). Anything evaluateSubrogation() produces from a cataloged basis satisfies
 * it. This is the honest signal the route reports to policy.subrogation.basis-sourced. A non-object
 * input is a violation.
 */
export function subrogationBasisSourced(
  determination: { basisId?: string } | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (typeof determination.basisId !== "string") return false;
  return getSubrogationBasis(determination.basisId) !== undefined;
}

/**
 * Recoverable-within-paid check: is the asserted recoverable bounded? True unless the recoverable is
 * negative, exceeds the plan's paid amount, or (when a settlement is known) exceeds the settlement;
 * the guard that catches a subrogation lien asserted as PROFIT rather than reimbursement. Anything
 * evaluateSubrogation() produces satisfies it. This is the honest signal the route reports to
 * policy.subrogation.recoverable-within-paid. A non-object / non-numeric input is a violation.
 */
export function subrogationRecoverableWithinPaid(
  determination:
    | { recoverableAmount?: number; planPaidAmount?: number; settlementAmount?: number | null }
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  const { recoverableAmount, planPaidAmount, settlementAmount } = determination;
  if (typeof recoverableAmount !== "number" || typeof planPaidAmount !== "number") return false;
  if (recoverableAmount < -MONEY_EPSILON) return false;
  if (recoverableAmount > planPaidAmount + MONEY_EPSILON) return false;
  if (
    typeof settlementAmount === "number" &&
    recoverableAmount > settlementAmount + MONEY_EPSILON
  ) {
    return false;
  }
  return true;
}

/**
 * No-autonomous-lien check: did the agent avoid autonomously asserting a lien? True unless the
 * determination claims it auto-asserted a lien, or an eligible case does not require human review;
 * the guard that catches an autonomous / unreviewed lien assertion. Anything evaluateSubrogation()
 * produces satisfies it. This is the honest signal the route reports to
 * policy.subrogation.no-autonomous-lien. A non-object input is a violation.
 */
export function subrogationNoAutonomousLien(
  determination:
    | { autoAssertedLien?: boolean; eligible?: boolean; requiresHumanReview?: boolean }
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (determination.autoAssertedLien === true) return false;
  if (determination.eligible === true && determination.requiresHumanReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric
 * trace + the response `meta`.
 */
export function subrogationSummary(determination: SubrogationDetermination): {
  caseRef: string;
  basisId: string;
  eligible: boolean;
  planPaidAmount: number;
  recoverableAmount: number;
  disposition: SubrogationDisposition;
  requiresHumanReview: boolean;
  synthetic: boolean;
} {
  return {
    caseRef: determination.caseRef,
    basisId: determination.basisId,
    eligible: determination.eligible,
    planPaidAmount: determination.planPaidAmount,
    recoverableAmount: determination.recoverableAmount,
    disposition: determination.disposition,
    requiresHumanReview: determination.requiresHumanReview,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request: an auto-accident case under an ERISA plan clause, settlement above
 * what the plan paid → fully recoverable, review-gated. Synthetic.
 */
export const DEMO_SUBROGATION_REQUEST: SubrogationRequest = {
  caseRef: "subro-case-001",
  patientRef: "patient-subro-001",
  injuryRelated: true,
  accidentType: "auto",
  thirdPartyLiable: true,
  planPaidAmount: 42000,
  basisId: "basis.erisa-plan-reimbursement",
  settlementAmount: 150000
};

/**
 * A representative demo request: a premises-liability case where the common-fund doctrine reduces
 * recovery by a 33% attorney-fee share. Synthetic.
 */
export const DEMO_SUBROGATION_COMMONFUND_REQUEST: SubrogationRequest = {
  caseRef: "subro-case-002",
  patientRef: "patient-subro-002",
  injuryRelated: true,
  accidentType: "premises-liability",
  thirdPartyLiable: true,
  planPaidAmount: 30000,
  basisId: "basis.state-subrogation-statute",
  settlementAmount: 90000,
  commonFundApplies: true,
  attorneyFeeRate: 0.33
};

/**
 * A representative demo request: an eligible case where the made-whole doctrine BARS recovery
 * (member not yet fully compensated) → notify and hold. Synthetic.
 */
export const DEMO_SUBROGATION_MADEWHOLE_REQUEST: SubrogationRequest = {
  caseRef: "subro-case-003",
  patientRef: "patient-subro-003",
  injuryRelated: true,
  accidentType: "auto",
  thirdPartyLiable: true,
  planPaidAmount: 60000,
  basisId: "basis.erisa-plan-reimbursement",
  settlementAmount: 40000,
  madeWholeApplies: true
};

/**
 * A representative demo request: a non-injury claim with no liable third party → no subrogation
 * interest. Synthetic.
 */
export const DEMO_SUBROGATION_NONE_REQUEST: SubrogationRequest = {
  caseRef: "subro-case-004",
  patientRef: "patient-subro-004",
  injuryRelated: false,
  accidentType: "none",
  thirdPartyLiable: false,
  planPaidAmount: 5000,
  basisId: "basis.erisa-plan-reimbursement"
};
