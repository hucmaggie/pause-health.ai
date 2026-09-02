/**
 * Claims Overpayment & Recovery — the deterministic, transparent post-payment
 * integrity layer that decides whether a paid claim was OVERPAID and, if so, whether
 * the overpayment is still RECOVERABLE within the statutory lookback window.
 *
 * Deterministic, dependency-free domain core the Claims Overpayment & Recovery Agent
 * (app/api/agents/overpayment-recovery) wraps — a plan-side payer & plan operations
 * service on Pause's Agent Fabric. Given a PAID claim (what was paid, what should
 * have been paid, the recovery reason, and the paid date evaluated against a provided
 * asOfDate), it DETERMINISTICALLY computes the overpayment amount, cites the
 * governing recovery reason from a catalog, derives the recovery deadline from the
 * paid date + the reason's lookback window, and classifies the claim as recoverable /
 * not-recoverable-within-window / no-overpayment. It NEVER autonomously claws back or
 * offsets a payment: a recoverable overpayment is a RECOMMENDATION requiring human
 * review (with member/provider notice), and a claim past its statutory lookback
 * window is NEVER marked recoverable.
 *
 *   Inbound:  a RecoveryRequest { claimId, memberRef, providerRef, paidAmount,
 *             correctAmount, reasonId, paidDate, asOfDate }
 *   Outbound: a RecoveryDetermination { overpaymentAmount, recoverable,
 *             recoveryReasonId, recoveryDeadline, withinLookbackWindow,
 *             requiresHumanReview, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other payer & plan operations agents.
 * It is distinct from the Claims Adjudication Assistant (first-pass PRE-payment
 * adjudication), the Fraud, Waste & Abuse Detection agent (suspected fraud patterns),
 * and the Coordination of Benefits agent (which decides payer ORDER): this is the
 * POST-payment recovery of a legitimate overpayment already made.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: a recovery must be within the statutory lookback window.
 * ─────────────────────────────────────────────────────────────────────
 *  An overpayment is only recoverable while it is within the reason's lookback window
 *  (paid date + lookback days). A claim past its window is NEVER marked recoverable —
 *  clawing back beyond the statutory lookback is an unlawful recoupment.
 *  recoveryWithinLookback() reports the honest signal the Agent Fabric enforces via
 *  policy.recovery.within-lookback-window. (Mirrors the Data Retention Agent's
 *  legal-hold-overrides-purge and the UR Agent's SLA-integrity — a window bounds the action.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: every recovery is reason-catalog-sourced.
 * ─────────────────────────────────────────────────────────────────────
 *  Every recovery must cite a recorded recovery reason from the catalog — there is no
 *  ad-hoc, un-sourced clawback. recoveryReasonCited() reports the honest signal the
 *  Agent Fabric enforces via policy.recovery.reason-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous clawback (human-review-gated).
 * ─────────────────────────────────────────────────────────────────────
 *  A recoverable overpayment is a RECOMMENDATION requiring human review (with member/
 *  provider notice) — the agent never autonomously claws back or offsets a payment.
 *  recoveryClawbackHumanReviewed() reports the honest signal the Agent Fabric enforces
 *  via policy.recovery.no-autonomous-clawback.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE RECOMMENDATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A `recoverable` RECOMMENDATION (an overpayment within its lookback window) is a
 *  SAFE, honest OUTPUT: the agent recommends recovery with requiresHumanReview:true and
 *  the task COMPLETES — it is NOT a block, and it never means money was clawed back. A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (a recovery
 *  asserted past the lookback window, a recovery with no cited reason, or an autonomous
 *  clawback) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified payment-integrity system.
 * ─────────────────────────────────────────────────────────────────────
 *  The recovery reason catalog, lookback windows, and reason ids below are ILLUSTRATIVE
 *  synthetic/demo values chosen to model the SHAPE of a governed overpayment-recovery
 *  control — they are NOT a certified payment-integrity product, and REAL overpayment
 *  recovery is governed by the ACA §6402 60-day overpayment rule, CMS overpayment
 *  recovery rules, ERISA, and state insurance code (recoupment notice + timeframe +
 *  appeal requirements all differ by state). The claim / member / provider references
 *  are synthetic / de-identified. There is NO randomness and NO clock anywhere here:
 *  the determination is a pure function of the claim's amounts + dates + the request's
 *  own asOfDate (time taken as data — no Date.now()), so the same request always yields
 *  the same overpayment + cited reason + recoverability — which is what lets the demo,
 *  the seeded trace, and the tests agree.
 */

/** The recoverability classification the agent produces for a paid claim. */
export type RecoveryClassification =
  | "recoverable"
  | "not-recoverable-within-window"
  | "no-overpayment";

/**
 * A single recovery reason in the catalog — a documented cause of overpayment mapped
 * to its statutory lookback window. Illustrative/synthetic; NOT a certified recovery
 * reason set (see the header — real recovery windows are jurisdiction-specific).
 */
export type RecoveryReason = {
  /** Stable catalog id (cited on every determination). */
  id: string;
  /** Human-readable reason label. */
  label: string;
  /** The lookback window, in whole days, this reason may be recovered within. */
  lookbackDays: number;
  /** Illustrative description of what this reason governs. Demo-honest. */
  description: string;
};

/**
 * The recovery reason catalog — every recovery must cite one of these. Illustrative/
 * synthetic; NOT a certified reason set (see the header). Real recovery reasons +
 * windows are governed by ACA §6402, CMS rules, ERISA, and state insurance code.
 */
export const RECOVERY_REASONS: RecoveryReason[] = [
  {
    id: "reason.recovery.duplicate-payment",
    label: "Duplicate payment",
    lookbackDays: 365,
    description:
      "The same claim / service was paid more than once. Recoverable within a 1-year lookback. (Illustrative.)"
  },
  {
    id: "reason.recovery.cob-primary-elsewhere",
    label: "Another payer was primary (coordination of benefits)",
    lookbackDays: 730,
    description:
      "A coordination-of-benefits determination establishes another payer was primary, so this plan overpaid as if primary. Recoverable within a 2-year lookback. (Illustrative — pairs with the Coordination of Benefits agent.)"
  },
  {
    id: "reason.recovery.retroactive-termination",
    label: "Retroactive coverage termination",
    lookbackDays: 365,
    description:
      "The member's coverage was retroactively terminated before the date of service, so the claim should not have been paid. Recoverable within a 1-year lookback. (Illustrative.)"
  },
  {
    id: "reason.recovery.pricing-error",
    label: "Contracted-rate pricing error",
    lookbackDays: 540,
    description:
      "The claim was paid at the wrong contracted rate (fee-schedule misapplication). The overpayment is the difference. Recoverable within an 18-month lookback. (Illustrative.)"
  },
  {
    id: "reason.recovery.services-not-rendered",
    label: "Services documented as not rendered",
    lookbackDays: 1095,
    description:
      "A post-payment records review documents that a paid service was not rendered. Recoverable within a 3-year lookback. (Illustrative — distinct from suspected fraud, which routes to the FWA agent's SIU.)"
  }
];

const REASON_BY_ID = new Map(RECOVERY_REASONS.map((r) => [r.id, r]));
const RECOVERY_REASON_IDS = new Set<string>(RECOVERY_REASONS.map((r) => r.id));

/** Is `id` a recognized recovery-reason id? */
export function isRecoveryReason(id: unknown): boolean {
  return typeof id === "string" && RECOVERY_REASON_IDS.has(id);
}

/** Look up a recovery reason by id (undefined for an off-catalog id). */
export function getRecoveryReason(id: string): RecoveryReason | undefined {
  return REASON_BY_ID.get(id);
}

/** A claims-overpayment / recovery evaluation request. */
export type RecoveryRequest = {
  /** Synthetic, de-identified claim id (e.g. "recovery-claim-001"). */
  claimId: string;
  /** Synthetic, de-identified member reference. */
  memberRef: string;
  /** Synthetic, de-identified provider reference. */
  providerRef: string;
  /** What the plan actually paid on the claim (illustrative dollars). */
  paidAmount: number;
  /** What the plan should have paid (illustrative dollars). */
  correctAmount: number;
  /** The recovery reason (a catalog id, or an off-catalog string). */
  reasonId: string;
  /** When the claim was paid (ISO-8601 date or datetime). */
  paidDate: string;
  /**
   * The explicit evaluation time (ISO-8601) — taken as data, not a clock read. A
   * claim is recoverable only while at/before its recovery deadline.
   */
  asOfDate: string;
};

/** The deterministic overpayment-recovery determination the agent returns. */
export type RecoveryDetermination = {
  /** Synthetic, de-identified claim id this determination is about. */
  claimId: string;
  /** Synthetic, de-identified member reference. */
  memberRef: string;
  /** Synthetic, de-identified provider reference. */
  providerRef: string;
  /** The recovery reason's cited id (always a recognized reason). */
  recoveryReasonId: string;
  /** The recovery reason's human-readable label. */
  recoveryReasonLabel: string;
  /** The computed overpayment amount (max(paid - correct, 0)). */
  overpaymentAmount: number;
  /** The recoverability classification. */
  recoverable: RecoveryClassification;
  /** The lookback window in days for the cited reason. */
  lookbackDays: number;
  /** The computed recovery deadline (paidDate + lookbackDays), ISO-8601. */
  recoveryDeadline: string;
  /** True when the request's asOfDate is at/before the recovery deadline. */
  withinLookbackWindow: boolean;
  /**
   * True whenever the classification is recoverable — a recovery is only ever a
   * recommendation requiring human review; the agent never autonomously claws back.
   */
  requiresHumanReview: boolean;
  /** Human-readable reason (cites the deciding factor). */
  reason: string;
  /** Always true — the reason catalog + windows are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Stable reason phrases (kept as constants for testability). */
export const RECOVERY_REASON_TEXT = {
  recoverable:
    "an overpayment within its statutory lookback window — recoverable (a RECOMMENDATION requiring human review with member/provider notice; the agent never autonomously claws back)",
  pastWindow:
    "an overpayment past its statutory lookback window — NOT recoverable; clawing back beyond the lookback is an unlawful recoupment",
  noOverpayment:
    "no overpayment — the paid amount does not exceed the correct amount, so there is nothing to recover",
  unscheduled:
    "no recovery reason for this cause — a recovery must cite a recorded reason from the catalog"
} as const;

/**
 * Add `days` whole days to an ISO timestamp, deterministically (no clock). Returns
 * the input unchanged if it is not a parseable timestamp.
 */
export function addDaysIso(atTime: string, days: number): string {
  const d = new Date(atTime);
  if (Number.isNaN(d.getTime())) return atTime;
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Is `asOfDate` at/before `deadline`? */
export function isWithinWindow(deadline: string, asOfDate: string): boolean {
  const dl = new Date(deadline).getTime();
  const t = new Date(asOfDate).getTime();
  if (Number.isNaN(dl) || Number.isNaN(t)) return false;
  return t <= dl;
}

/**
 * The deterministic overpayment-recovery function — the heart of the service.
 * DETERMINISTIC: a pure function of the claim's amounts + dates + the request's own
 * asOfDate (no randomness, no clock). It computes the overpayment, resolves the
 * recovery reason + its lookback window, derives the recovery deadline, and produces
 * a classification:
 *   - no overpayment (paid <= correct) → `no-overpayment`;
 *   - an overpayment WITHIN its lookback window → `recoverable` (a RECOMMENDATION,
 *     requiresHumanReview:true — never an autonomous clawback);
 *   - an overpayment PAST its lookback window → `not-recoverable-within-window`.
 * Every determination cites a recorded recovery reason. Money is never clawed back
 * here — this produces a recommendation, not a recoupment.
 */
export function evaluateRecovery(request: RecoveryRequest): RecoveryDetermination {
  const reason = getRecoveryReason(request.reasonId);
  const overpaymentAmount = Math.max(
    Math.round(((request.paidAmount ?? 0) - (request.correctAmount ?? 0)) * 100) / 100,
    0
  );

  const base = {
    claimId: request.claimId,
    memberRef: request.memberRef,
    providerRef: request.providerRef,
    overpaymentAmount,
    synthetic: true as const
  };

  const synthNote =
    "Synthetic/illustrative recovery reason catalog, lookback windows, and reason ids — NOT a certified payment-integrity system; real overpayment recovery is governed by the ACA §6402 60-day rule, CMS recovery rules, ERISA, and state insurance code.";

  // Off-catalog reason: fall back to the reason id itself but flag it as un-sourced by
  // citing the raw id; the guard recoveryReasonCited() will catch it. To keep a
  // well-formed determination we still compute a nominal window from a 0-day default.
  const lookbackDays = reason?.lookbackDays ?? 0;
  const recoveryDeadline = addDaysIso(request.paidDate, lookbackDays);
  const withinLookbackWindow = isWithinWindow(recoveryDeadline, request.asOfDate);
  const recoveryReasonId = reason?.id ?? request.reasonId;
  const recoveryReasonLabel = reason?.label ?? request.reasonId;

  if (overpaymentAmount <= 0) {
    return {
      ...base,
      recoveryReasonId,
      recoveryReasonLabel,
      recoverable: "no-overpayment",
      lookbackDays,
      recoveryDeadline,
      withinLookbackWindow,
      requiresHumanReview: false,
      reason: RECOVERY_REASON_TEXT.noOverpayment,
      note:
        `Claim ${request.claimId}: paid ${request.paidAmount} vs correct ${request.correctAmount} → NO OVERPAYMENT. ` +
        synthNote
    };
  }

  if (!withinLookbackWindow) {
    return {
      ...base,
      recoveryReasonId,
      recoveryReasonLabel,
      recoverable: "not-recoverable-within-window",
      lookbackDays,
      recoveryDeadline,
      withinLookbackWindow,
      requiresHumanReview: false,
      reason: RECOVERY_REASON_TEXT.pastWindow,
      note:
        `Claim ${request.claimId}: overpayment of ${overpaymentAmount} under ${recoveryReasonLabel} is PAST its recovery deadline ${recoveryDeadline} (lookback ${lookbackDays}d) → NOT RECOVERABLE. Clawing back beyond the statutory lookback is an unlawful recoupment. ` +
        synthNote
    };
  }

  return {
    ...base,
    recoveryReasonId,
    recoveryReasonLabel,
    recoverable: "recoverable",
    lookbackDays,
    recoveryDeadline,
    withinLookbackWindow,
    requiresHumanReview: true,
    reason: RECOVERY_REASON_TEXT.recoverable,
    note:
      `Claim ${request.claimId}: overpayment of ${overpaymentAmount} under ${recoveryReasonLabel} is within its recovery deadline ${recoveryDeadline} (lookback ${lookbackDays}d) → RECOVERABLE. This is a RECOMMENDATION requiring human review with member/provider notice — the agent never autonomously claws back a payment. ` +
      synthNote
  };
}

/**
 * Within-lookback-window check: does the determination avoid recovering past the
 * statutory lookback? True unless a determination asserts `recoverable` on a claim
 * whose window has closed — the guard that catches a caller-asserted clawback beyond
 * the lookback. Anything evaluateRecovery() produces satisfies it (a past-window claim
 * is `not-recoverable-within-window`). This is the honest signal the route reports to
 * policy.recovery.within-lookback-window. A non-object input is a violation.
 */
export function recoveryWithinLookback(
  determination:
    | Pick<RecoveryDetermination, "recoverable" | "withinLookbackWindow">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return !(
    determination.recoverable === "recoverable" &&
    determination.withinLookbackWindow === false
  );
}

/**
 * Reason-catalog-sourced check: does the determination cite a recorded recovery
 * reason? True when the recoveryReasonId is a recognized catalog reason; the guard
 * that catches a caller-asserted ad-hoc recovery with no cited reason (a missing or
 * off-catalog reason id). Anything evaluateRecovery() produces from a catalog reason
 * satisfies it. This is the honest signal the route reports to
 * policy.recovery.reason-catalog-sourced. A non-object input is a violation.
 */
export function recoveryReasonCited(
  determination: Pick<RecoveryDetermination, "recoveryReasonId"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return isRecoveryReason(determination.recoveryReasonId);
}

/**
 * No-autonomous-clawback check: is a recovery human-review-gated? True for any
 * determination that is not a recovery, and for a recoverable determination that
 * carries requiresHumanReview:true; the guard that catches a caller-asserted
 * AUTONOMOUS clawback (a recoverable determination marked as not requiring human
 * review). Anything evaluateRecovery() produces satisfies it (a recoverable is always
 * requiresHumanReview:true). This is the honest signal the route reports to
 * policy.recovery.no-autonomous-clawback. A non-object input is a violation.
 */
export function recoveryClawbackHumanReviewed(
  determination:
    | Pick<RecoveryDetermination, "recoverable" | "requiresHumanReview">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (determination.recoverable !== "recoverable") return true;
  return determination.requiresHumanReview === true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent
 * Fabric trace + the response `meta`. Carries no free-text PHI (refs, ids, the amount,
 * the classification, the cited reason, the deadline, and the flags only).
 */
export function recoverySummary(determination: RecoveryDetermination): {
  claimId: string;
  memberRef: string;
  providerRef: string;
  overpaymentAmount: number;
  recoverable: RecoveryClassification;
  recoveryReasonId: string;
  recoveryDeadline: string;
  withinLookbackWindow: boolean;
  requiresHumanReview: boolean;
  synthetic: boolean;
} {
  return {
    claimId: determination.claimId,
    memberRef: determination.memberRef,
    providerRef: determination.providerRef,
    overpaymentAmount: determination.overpaymentAmount,
    recoverable: determination.recoverable,
    recoveryReasonId: determination.recoveryReasonId,
    recoveryDeadline: determination.recoveryDeadline,
    withinLookbackWindow: determination.withinLookbackWindow,
    requiresHumanReview: determination.requiresHumanReview,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request (illustrative). A duplicate payment discovered within
 * its 1-year lookback → recoverable, requiring human review. Synthetic / de-identified.
 */
export const DEMO_RECOVERY_REQUEST: RecoveryRequest = {
  claimId: "recovery-claim-001",
  memberRef: "recovery-member-001",
  providerRef: "recovery-provider-001",
  paidAmount: 1200,
  correctAmount: 600,
  reasonId: "reason.recovery.duplicate-payment",
  paidDate: "2025-10-01",
  asOfDate: "2026-03-01T00:00:00Z"
};

/**
 * A representative demo COB-recovery request (illustrative). A coordination-of-benefits
 * determination establishes another payer was primary, so this plan overpaid as if
 * primary; within its 2-year lookback → recoverable. Synthetic / de-identified.
 */
export const DEMO_RECOVERY_COB_REQUEST: RecoveryRequest = {
  claimId: "recovery-claim-002",
  memberRef: "recovery-member-002",
  providerRef: "recovery-provider-002",
  paidAmount: 900,
  correctAmount: 300,
  reasonId: "reason.recovery.cob-primary-elsewhere",
  paidDate: "2025-01-15",
  asOfDate: "2026-03-01T00:00:00Z"
};

/**
 * A representative demo PAST-WINDOW request (illustrative). A retroactive-termination
 * overpayment discovered well past its 1-year lookback → not-recoverable-within-window
 * (clawing back beyond the statutory lookback is an unlawful recoupment). Synthetic /
 * de-identified.
 */
export const DEMO_RECOVERY_PAST_WINDOW_REQUEST: RecoveryRequest = {
  claimId: "recovery-claim-003",
  memberRef: "recovery-member-003",
  providerRef: "recovery-provider-003",
  paidAmount: 800,
  correctAmount: 0,
  reasonId: "reason.recovery.retroactive-termination",
  paidDate: "2023-01-01",
  asOfDate: "2026-03-01T00:00:00Z"
};
