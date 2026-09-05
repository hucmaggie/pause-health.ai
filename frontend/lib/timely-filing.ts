/**
 * Timely Filing Compliance — the deterministic, transparent payer-operations layer that decides
 * whether a claim was submitted within its payer's TIMELY-FILING limit: it deterministically
 * computes the filing DEADLINE from the date of service + the payer's filing-limit window, checks
 * the submission date against it, honors a recognized filing-limit EXCEPTION when one is claimed,
 * and hands back an honest DISPOSITION — never autonomously writing off the balance.
 *
 * Deterministic, dependency-free domain core the Timely Filing Agent
 * (app/api/agents/timely-filing) wraps — a claims / payer-operations service on the payer &
 * plan-operations plane of Pause's Agent Fabric. Given a claim (a date of service, a submission
 * date, and the cited payer filing-limit rule), it DETERMINISTICALLY computes the filing deadline
 * (date of service + the rule's limit in days), compares the submission date to it, computes how
 * many days late an untimely claim is, honors a recognized filing-limit exception when one is
 * claimed, and decides the disposition (accept / appeal-with-exception / write-off-review).
 *
 *   Inbound:  a ClaimTimelinessRequest { claimRef, payerType, filingRuleId, serviceDate,
 *             submissionDate, claimType?, exceptionClaimed? }
 *   Outbound: a TimelyFilingDetermination { deadline, daysLate, timely, exceptionRecognized,
 *             disposition, requiresHumanReview, writtenOff:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other payer-operations agents: distinct from the
 * Claims Adjudication Assistant (per-claim edits / medical-necessity adjudication), the
 * Coordination of Benefits agent (payer ORDER across coverages), the Claims Overpayment &
 * Recovery agent (POST-payment clawback of a legitimate overpayment), the FWA Detection agent
 * (suspected fraud patterns), and the Utilization Review agent (medical necessity): this decides
 * one narrow, purely temporal question — was the claim FILED IN TIME.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every timeliness decision cites a recorded filing-limit rule.
 * ─────────────────────────────────────────────────────────────────────
 *  A timeliness decision must cite a recorded payer filing-limit rule from the catalog — an
 *  ad-hoc / un-sourced limit (a missing or off-catalog rule id) is not a real deadline.
 *  timelyFilingRuleSourced() reports the honest signal the Agent Fabric enforces via
 *  policy.timelyfiling.filing-limit-sourced. (Mirrors the Overpayment Recovery Agent's
 *  reason-catalog-sourced and the Data Retention Agent's schedule-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the deadline is computed, never guessed.
 * ─────────────────────────────────────────────────────────────────────
 *  The filing deadline must equal the date of service + the rule's limit in days — a determination
 *  whose stated deadline does not match the recomputed deadline is guessing (or hiding) the
 *  deadline, which is how a claim is wrongly called timely or untimely. timelyFilingDeadlineComputed()
 *  recomputes the deadline from the determination's own serviceDate + limitDays and reports the
 *  honest signal the Agent Fabric enforces via policy.timelyfiling.deadline-computed. (This is
 *  the load-bearing correctness gate — mirrors the Good Faith Estimate Agent's math-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: an untimely claim is never autonomously written off.
 * ─────────────────────────────────────────────────────────────────────
 *  An untimely claim is a RECOMMENDATION (file an appeal with an exception, or route to a
 *  write-off decision) requiring human review — the agent NEVER autonomously writes off the
 *  balance, adjusts it to zero, or bills the patient. A determination that marks a claim
 *  written-off, or that reports an untimely claim without requiring human review, is dishonest.
 *  timelyFilingNoAutonomousWriteOff() reports the honest signal the Agent Fabric enforces via
 *  policy.timelyfiling.no-autonomous-write-off. (Mirrors the Overpayment Recovery Agent's
 *  no-autonomous-clawback and the Balance Billing Agent's no-autonomous-balance-bill posture —
 *  the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — timely OR untimely — is a SAFE, honest OUTPUT: the task COMPLETES (an
 *  untimely claim carries requiresHumanReview:true). A GOVERNANCE BLOCK is when a caller PRESENTS
 *  an offending DETERMINATION (an un-sourced filing limit, a guessed deadline that does not match
 *  the computed one, or a written-off / unreviewed untimely claim) — which the Agent Fabric
 *  rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified timely-filing engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The filing-limit rules, day windows, and exception catalog below are clearly-labeled
 *  ILLUSTRATIVE synthetics chosen to model the SHAPE of timely-filing compliance deterministically
 *  in the demo — they are NOT the real limits. Real timely-filing limits are governed by each
 *  payer's provider contract, Medicare (generally 12 months / 42 CFR 424.44), state Medicaid
 *  rules, and state prompt-pay law, with documented exceptions. There is NO randomness and NO
 *  clock anywhere here: the deadline is computed from the request's own dates (dates taken as
 *  data — no Date.now()), so the same claim always yields the same deadline / timely / disposition
 *  — which is what lets the demo, the seeded trace, and the tests agree.
 */

/** Normalize an ISO date (date-only or full) to a UTC midnight epoch-ms. */
function toUtcDateMs(iso: string): number {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const DAY_MS = 86_400_000;

/** Add `days` to an ISO date, returning a date-only "YYYY-MM-DD" string. Deterministic (UTC). */
export function addDays(iso: string, days: number): string {
  return new Date(toUtcDateMs(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (positive if `toIso` is later). Deterministic (UTC). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtcDateMs(toIso) - toUtcDateMs(fromIso)) / DAY_MS);
}

/** A payer filing-limit rule. */
export type FilingRule = {
  /** Stable rule id. */
  id: string;
  /** The payer type the rule governs. */
  payerType: string;
  /** The filing limit, in days from the date of service. */
  limitDays: number;
  /** Human-readable description. */
  description: string;
  /** The exception ids recognized for this rule (extend the deadline / excuse lateness). */
  exceptionsAllowed: string[];
};

/** A recognized filing-limit exception. */
export type FilingException = {
  /** Stable exception id. */
  id: string;
  /** Human-readable label. */
  label: string;
};

/**
 * ILLUSTRATIVE, synthetic filing-limit catalog — clearly labeled, NOT the real limits. Real
 * limits come from each payer's provider contract, Medicare (generally 12 months), state Medicaid
 * rules, and state prompt-pay law.
 */
export const FILING_RULES: FilingRule[] = [
  {
    id: "rule.filing.medicare-12mo",
    payerType: "medicare",
    limitDays: 365,
    description: "Medicare — generally 12 months from the date of service (illustrative).",
    exceptionsAllowed: [
      "exception.retroactive-eligibility",
      "exception.proof-of-timely-filing",
      "exception.administrative-error"
    ]
  },
  {
    id: "rule.filing.medicaid-180day",
    payerType: "medicaid",
    limitDays: 180,
    description: "Medicaid — illustrative 180 days from the date of service (varies by state).",
    exceptionsAllowed: [
      "exception.retroactive-eligibility",
      "exception.cob-primary-delay",
      "exception.proof-of-timely-filing"
    ]
  },
  {
    id: "rule.filing.commercial-90day",
    payerType: "commercial",
    limitDays: 90,
    description: "Commercial — illustrative 90 days from the date of service (contract-driven).",
    exceptionsAllowed: [
      "exception.cob-primary-delay",
      "exception.proof-of-timely-filing",
      "exception.provider-of-record-error"
    ]
  },
  {
    id: "rule.filing.commercial-180day",
    payerType: "commercial",
    limitDays: 180,
    description: "Commercial — illustrative 180 days from the date of service (contract-driven).",
    exceptionsAllowed: [
      "exception.cob-primary-delay",
      "exception.proof-of-timely-filing",
      "exception.provider-of-record-error"
    ]
  }
];

/**
 * ILLUSTRATIVE, synthetic exception catalog — the documented reasons an untimely claim may still
 * be filed as an appeal. Clearly labeled; NOT a certified exception list.
 */
export const FILING_EXCEPTIONS: FilingException[] = [
  { id: "exception.cob-primary-delay", label: "Delay awaiting the primary carrier's EOB (COB)" },
  { id: "exception.retroactive-eligibility", label: "Retroactive eligibility determination" },
  { id: "exception.proof-of-timely-filing", label: "Documented proof of timely filing" },
  { id: "exception.provider-of-record-error", label: "Provider-of-record / payer routing error" },
  { id: "exception.administrative-error", label: "Payer administrative error" }
];

/** Look up a filing rule by id (undefined when off-catalog). */
export function getFilingRule(id: string): FilingRule | undefined {
  return FILING_RULES.find((r) => r.id === id);
}

/** Whether an exception id is recognized in the catalog. */
export function isKnownException(id: string): boolean {
  return FILING_EXCEPTIONS.some((e) => e.id === id);
}

/** The disposition for a claim after the timeliness decision. */
export type TimelyFilingDisposition = "accept" | "appeal-with-exception" | "write-off-review";

/** A claim-timeliness request. */
export type ClaimTimelinessRequest = {
  /** Synthetic claim reference. */
  claimRef: string;
  /** The payer type (informational; the rule carries the governing limit). */
  payerType: string;
  /** The cited filing-limit rule id. */
  filingRuleId: string;
  /** The date of service (ISO; treated as data). */
  serviceDate: string;
  /** The claim submission date (ISO; treated as data). */
  submissionDate: string;
  /** Optional claim type (informational). */
  claimType?: string;
  /** Optional claimed filing-limit exception id. */
  exceptionClaimed?: string;
};

/** The deterministic timely-filing determination the agent returns. */
export type TimelyFilingDetermination = {
  /** Synthetic claim reference. */
  claimRef: string;
  /** The cited filing-limit rule id. */
  filingRuleId: string;
  /** The payer type. */
  payerType: string;
  /** The filing limit in days (from the cited rule; 0 when the rule is off-catalog). */
  limitDays: number;
  /** The date of service. */
  serviceDate: string;
  /** The submission date. */
  submissionDate: string;
  /** The computed filing deadline (serviceDate + limitDays), date-only. */
  deadline: string;
  /** How many days late the submission is (0 when timely). */
  daysLate: number;
  /** Whether the claim was submitted on or before the deadline. */
  timely: boolean;
  /** The claimed exception id, if any. */
  exceptionClaimed?: string;
  /** Whether a claimed exception is recognized for the cited rule. */
  exceptionRecognized: boolean;
  /** The disposition. */
  disposition: TimelyFilingDisposition;
  /** Whether the determination requires human review (any untimely claim). */
  requiresHumanReview: boolean;
  /** Always false — the agent never autonomously writes off the balance. */
  writtenOff: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the limits / exceptions are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * The deterministic timely-filing function — the heart of the service. DETERMINISTIC: a pure
 * function of the claim's dates + the cited rule (no randomness, no clock). It computes the
 * deadline (date of service + the rule's limit days), compares the submission date to it,
 * computes how many days late an untimely claim is, honors a recognized exception when claimed,
 * and decides the disposition. Nothing is written off here — an untimely claim is a recommendation
 * requiring human review.
 */
export function evaluateTimelyFiling(
  request: ClaimTimelinessRequest
): TimelyFilingDetermination {
  const rule = getFilingRule(request.filingRuleId);
  const limitDays = rule?.limitDays ?? 0;
  const deadline = addDays(request.serviceDate, limitDays);
  const timely = toUtcDateMs(request.submissionDate) <= toUtcDateMs(deadline);
  const daysLate = timely ? 0 : Math.max(0, daysBetween(deadline, request.submissionDate));

  const exceptionClaimed = request.exceptionClaimed;
  const exceptionRecognized =
    !timely &&
    exceptionClaimed !== undefined &&
    isKnownException(exceptionClaimed) &&
    (rule?.exceptionsAllowed.includes(exceptionClaimed) ?? false);

  const disposition: TimelyFilingDisposition = timely
    ? "accept"
    : exceptionRecognized
      ? "appeal-with-exception"
      : "write-off-review";

  const requiresHumanReview = !timely;

  const reason = !rule
    ? `Claim ${request.claimRef}: filing rule '${request.filingRuleId}' is not in the catalog — cannot establish a deadline; human review required`
    : timely
      ? `Claim ${request.claimRef}: TIMELY — submitted ${request.submissionDate}, on or before the ${deadline} deadline (${rule.limitDays}-day limit, ${rule.id})`
      : exceptionRecognized
        ? `Claim ${request.claimRef}: UNTIMELY by ${daysLate} day(s) past the ${deadline} deadline, but a recognized exception (${exceptionClaimed}) applies → file an appeal with documentation; human review required`
        : `Claim ${request.claimRef}: UNTIMELY by ${daysLate} day(s) past the ${deadline} deadline with no recognized exception → route to a write-off decision; human review required (NOT auto-written-off)`;

  return {
    claimRef: request.claimRef,
    filingRuleId: request.filingRuleId,
    payerType: request.payerType,
    limitDays,
    serviceDate: request.serviceDate,
    submissionDate: request.submissionDate,
    deadline,
    daysLate,
    timely,
    ...(exceptionClaimed !== undefined ? { exceptionClaimed } : {}),
    exceptionRecognized,
    disposition,
    requiresHumanReview,
    writtenOff: false,
    reason,
    synthetic: true,
    note:
      `Timely-filing check for ${request.claimRef}: ${limitDays}-day limit, deadline ${deadline}, submitted ${request.submissionDate}, timely=${timely}${timely ? "" : `, ${daysLate} day(s) late, disposition ${disposition}`}. ` +
      "Synthetic/illustrative filing limits + exceptions — NOT a certified timely-filing engine; real limits are governed by each payer's provider contract, Medicare (generally 12 months / 42 CFR 424.44), state Medicaid rules, and state prompt-pay law."
  };
}

/**
 * Filing-limit-sourced check: does the determination cite a recorded filing-limit rule? True only
 * when the cited rule id resolves in the catalog; the guard that catches an ad-hoc / un-sourced
 * limit. Anything evaluateTimelyFiling() produces from a cataloged rule satisfies it. This is the
 * honest signal the route reports to policy.timelyfiling.filing-limit-sourced. A non-object input
 * is a violation.
 */
export function timelyFilingRuleSourced(
  determination: Pick<TimelyFilingDetermination, "filingRuleId"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return getFilingRule(determination.filingRuleId) !== undefined;
}

/**
 * Deadline-computed check: does the determination's stated deadline match the recomputed one? True
 * only when deadline === serviceDate + limitDays (recomputed from the determination's own fields);
 * the guard that catches a guessed / hidden deadline. Anything evaluateTimelyFiling() produces
 * satisfies it. This is the honest signal the route reports to policy.timelyfiling.deadline-computed.
 * A non-object / malformed input is a violation.
 */
export function timelyFilingDeadlineComputed(
  determination:
    | Pick<TimelyFilingDetermination, "serviceDate" | "limitDays" | "deadline">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (
    typeof determination.serviceDate !== "string" ||
    typeof determination.limitDays !== "number" ||
    typeof determination.deadline !== "string"
  ) {
    return false;
  }
  return addDays(determination.serviceDate, determination.limitDays) === determination.deadline;
}

/**
 * No-autonomous-write-off check: did the agent avoid autonomously writing off the claim? True
 * unless the determination marks the claim written-off, or reports an untimely claim without
 * requiring human review; the guard that catches an autonomous / unreviewed write-off. Anything
 * evaluateTimelyFiling() produces satisfies it (writtenOff is always false; an untimely claim
 * requires review). This is the honest signal the route reports to
 * policy.timelyfiling.no-autonomous-write-off. A non-object input is a violation.
 */
export function timelyFilingNoAutonomousWriteOff(
  determination:
    | { writtenOff?: boolean; timely?: boolean; requiresHumanReview?: boolean }
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (determination.writtenOff === true) return false;
  if (determination.timely === false && determination.requiresHumanReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric
 * trace + the response `meta`.
 */
export function timelyFilingSummary(determination: TimelyFilingDetermination): {
  claimRef: string;
  filingRuleId: string;
  limitDays: number;
  deadline: string;
  daysLate: number;
  timely: boolean;
  exceptionRecognized: boolean;
  disposition: TimelyFilingDisposition;
  requiresHumanReview: boolean;
  synthetic: boolean;
} {
  return {
    claimRef: determination.claimRef,
    filingRuleId: determination.filingRuleId,
    limitDays: determination.limitDays,
    deadline: determination.deadline,
    daysLate: determination.daysLate,
    timely: determination.timely,
    exceptionRecognized: determination.exceptionRecognized,
    disposition: determination.disposition,
    requiresHumanReview: determination.requiresHumanReview,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request: a commercial claim filed well within the 90-day window →
 * timely / accept. Synthetic.
 */
export const DEMO_TIMELY_FILING_REQUEST: ClaimTimelinessRequest = {
  claimRef: "claim-tf-001",
  payerType: "commercial",
  filingRuleId: "rule.filing.commercial-90day",
  serviceDate: "2026-01-10",
  submissionDate: "2026-02-15"
};

/**
 * A representative demo request: a commercial claim filed past the 90-day window WITH a recognized
 * COB-primary-delay exception → untimely / appeal-with-exception, human review. Synthetic.
 */
export const DEMO_TIMELY_FILING_EXCEPTION_REQUEST: ClaimTimelinessRequest = {
  claimRef: "claim-tf-002",
  payerType: "commercial",
  filingRuleId: "rule.filing.commercial-90day",
  serviceDate: "2026-01-10",
  submissionDate: "2026-06-01",
  exceptionClaimed: "exception.cob-primary-delay"
};

/**
 * A representative demo request: a commercial claim filed past the 90-day window with NO exception
 * → untimely / write-off-review, human review (never auto-written-off). Synthetic.
 */
export const DEMO_TIMELY_FILING_UNTIMELY_REQUEST: ClaimTimelinessRequest = {
  claimRef: "claim-tf-003",
  payerType: "commercial",
  filingRuleId: "rule.filing.commercial-90day",
  serviceDate: "2026-01-10",
  submissionDate: "2026-06-01"
};
