/**
 * Data Retention & Records Lifecycle Management — the deterministic, transparent
 * records-disposition layer of Pause's data substrate.
 *
 * Deterministic, dependency-free domain core the Data Retention & Records
 * Lifecycle Management Agent (app/api/agents/records-retention) wraps — the
 * MuleSoft control-plane / data-substrate records-management service on Pause's
 * Agent Fabric. It manages the lifecycle of records against RETENTION SCHEDULES
 * and LEGAL HOLDS: given a RECORD — its type/category, patient, created and
 * last-touched dates (evaluated against a provided `atTime`), jurisdiction, and
 * any active legal hold — it DETERMINISTICALLY produces a DISPOSITION
 * RECOMMENDATION (retain / eligible-for-purge / hold), citing the governing
 * retention rule and the computed retention expiry. It NEVER autonomously purges:
 * a purge is only ever a RECOMMENDATION requiring human approval, and a LEGAL HOLD
 * ALWAYS OVERRIDES A PURGE (a held record is `hold`, never `eligible-for-purge`).
 *
 *   Inbound:  a RetentionRequest { recordId, patientRef, recordType, createdAt,
 *             lastTouchedAt?, patientDob?, jurisdiction?, legalHold?, atTime }
 *   Outbound: a RetentionDisposition { recommendation, retentionRuleId,
 *             retentionRuleLabel, retentionExpiresAt?, underLegalHold,
 *             requiresHumanApproval, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other platform-plane agents. It is
 * distinct from the Consent & Preferences Management agent (which manages patient
 * consent scopes for outreach / data-sharing), the Master Patient Index (identity
 * / dedup), and the Break-the-Glass / Emergency Access Governance agent (which
 * governs emergency PHI *access*): this one governs records *retention /
 * disposition* under records-management + legal-hold obligations.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: a legal hold ALWAYS overrides a purge.
 * ─────────────────────────────────────────────────────────────────────
 *  A record under an active legal hold is NEVER marked eligible-for-purge — the
 *  disposition is `hold`, no matter how far past its retention expiry it is.
 *  retentionRespectsLegalHold() reports the honest signal the Agent Fabric
 *  enforces via policy.retention.legal-hold-overrides-purge.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: every disposition is schedule-sourced.
 * ─────────────────────────────────────────────────────────────────────
 *  Every retain / purge / hold decision must cite a recorded retention rule from
 *  the schedule catalog — there is no ad-hoc, un-sourced disposition.
 *  retentionRuleCited() reports the honest signal the Agent Fabric enforces via
 *  policy.retention.schedule-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous purge (human-approval-gated).
 * ─────────────────────────────────────────────────────────────────────
 *  A destructive purge is never executed autonomously: an eligible-for-purge
 *  disposition is a RECOMMENDATION carrying requiresHumanApproval:true, and a
 *  purge only happens after a human approves it. purgeHumanApproved() reports the
 *  honest signal the Agent Fabric enforces via policy.retention.no-autonomous-purge.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE RECOMMENDATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  An `eligible-for-purge` RECOMMENDATION (a record past its retention expiry with
 *  no active hold) is a SAFE, honest OUTPUT: the agent recommends a purge with
 *  requiresHumanApproval:true and the task COMPLETES — it is NOT a block, and it
 *  never means the record was purged. A GOVERNANCE BLOCK is when a caller PRESENTS
 *  an offending DISPOSITION (a purge asserted while under an active legal hold, a
 *  disposition with no cited retention schedule, or an autonomous / unapproved
 *  purge) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified records-management system.
 * ─────────────────────────────────────────────────────────────────────
 *  The retention schedules, retention periods, and rule ids/labels below are
 *  ILLUSTRATIVE synthetic/demo values chosen to model the SHAPE of a governed
 *  records-lifecycle control — they are NOT a certified records-management /
 *  retention product, and REAL retention is JURISDICTION-SPECIFIC and LEGALLY
 *  REVIEWED (federal + state medical-record statutes, HIPAA §164.316(b)(2)
 *  6-year documentation retention, CMS conditions of participation, statutes of
 *  limitations, and organizational records-management policy all differ). The
 *  record / patient references are synthetic / de-identified. There is NO
 *  randomness and NO clock anywhere here: the disposition is a pure function of
 *  the record's own dates + the request's own `atTime` (the caller passes time as
 *  data — no Date.now()), so the same request always yields the same
 *  recommendation + cited rule + expiry — which is what lets the demo, the seeded
 *  trace, and the tests agree.
 */

/** The disposition recommendation the agent produces for a record. */
export type RetentionRecommendation = "retain" | "eligible-for-purge" | "hold";

/**
 * How a schedule's retention expiry is anchored. `from-last-touched` runs the
 * retention period from the record's last-touched (or created) date;
 * `until-age-of-majority` runs it from the patient's date of birth (a minor's
 * record is kept until the age of majority plus additional years). Illustrative.
 */
export type RetentionBasis = "from-last-touched" | "until-age-of-majority";

/**
 * A single documented retention schedule in the catalog — a record type/category
 * mapped to a retention period and the governing retention rule it cites.
 * Illustrative/synthetic; NOT a certified retention schedule (see the header —
 * real retention is jurisdiction-specific and legally reviewed).
 */
export type RetentionSchedule = {
  /** Stable catalog id — the record type/category every request references. */
  id: string;
  /** Human-readable record-type label. */
  label: string;
  /** The governing retention rule's stable id (cited on every disposition). */
  ruleId: string;
  /** The governing retention rule's human-readable label. */
  ruleLabel: string;
  /** How the retention expiry is anchored. */
  basis: RetentionBasis;
  /**
   * The retention period in whole years. For `from-last-touched` it is the years
   * after the anchor date; for `until-age-of-majority` it is the ADDITIONAL years
   * kept after the patient reaches the age of majority.
   */
  retentionYears: number;
  /** The age of majority in years — only meaningful for `until-age-of-majority`. */
  ageOfMajority?: number;
  /**
   * The (illustrative) description of what this schedule governs. NOT a certified
   * retention determination — a demo-honest description.
   */
  description: string;
};

/**
 * The retention-schedule catalog: the record types/categories a disposition may
 * be sourced from, each citing a governing retention rule + period. Illustrative
 * /synthetic; NOT a certified retention schedule (see the header). Real retention
 * is jurisdiction-specific and legally reviewed.
 */
export const RETENTION_SCHEDULES: RetentionSchedule[] = [
  {
    id: "clinical-record",
    label: "Adult clinical record",
    ruleId: "rule.retention.clinical-record-7y",
    ruleLabel: "Adult clinical record — 7-year default retention",
    basis: "from-last-touched",
    retentionYears: 7,
    description:
      "An adult patient's clinical record: retained for 7 years from the last date of service / last-touched date. (Illustrative — real medical-record retention is jurisdiction-specific and legally reviewed.)"
  },
  {
    id: "minor-record",
    label: "Minor's clinical record",
    ruleId: "rule.retention.minor-record-majority-3y",
    ruleLabel: "Minor's clinical record — until age of majority + 3 years",
    basis: "until-age-of-majority",
    retentionYears: 3,
    ageOfMajority: 18,
    description:
      "A minor patient's clinical record: retained until the patient reaches the age of majority (18) plus 3 additional years. (Illustrative — the age of majority and the tail period are jurisdiction-specific and legally reviewed.)"
  },
  {
    id: "billing-claim",
    label: "Billing / claim record",
    ruleId: "rule.retention.billing-claim-7y",
    ruleLabel: "Billing / claim record — 7-year retention",
    basis: "from-last-touched",
    retentionYears: 7,
    description:
      "A billing / claim record: retained for 7 years from the last-touched date (a common financial-records window). (Illustrative — real billing retention is jurisdiction-specific and legally reviewed.)"
  },
  {
    id: "behavioral-health-record",
    label: "Behavioral-health record",
    ruleId: "rule.retention.behavioral-health-10y",
    ruleLabel: "Behavioral-health record — 10-year retention",
    basis: "from-last-touched",
    retentionYears: 10,
    description:
      "A behavioral-health record: retained for 10 years from the last-touched date (a longer window reflecting heightened sensitivity). (Illustrative — real behavioral-health retention is jurisdiction-specific and legally reviewed.)"
  },
  {
    id: "diagnostic-imaging",
    label: "Diagnostic imaging study",
    ruleId: "rule.retention.diagnostic-imaging-7y",
    ruleLabel: "Diagnostic imaging study — 7-year retention",
    basis: "from-last-touched",
    retentionYears: 7,
    description:
      "A diagnostic imaging study: retained for 7 years from the study date / last-touched date. (Illustrative — real imaging retention is jurisdiction-specific and legally reviewed.)"
  }
];

/**
 * The default rule cited when a record's type is not in the schedule catalog:
 * retain by default — a record is NEVER purged without a cited retention
 * schedule. Keeps every produced disposition schedule-sourced (retentionRuleCited
 * stays true) rather than emitting an un-sourced disposition. Illustrative.
 */
export const DEFAULT_RETENTION_RULE: { id: string; label: string } = {
  id: "rule.retention.default-retain-unscheduled",
  label: "Unscheduled record — retain by default (never purge without a schedule)"
};

const SCHEDULE_BY_ID = new Map(RETENTION_SCHEDULES.map((s) => [s.id, s]));

const RETENTION_RULE_IDS = new Set<string>([
  ...RETENTION_SCHEDULES.map((s) => s.ruleId),
  DEFAULT_RETENTION_RULE.id
]);

/** Is `id` a defined record-type/category catalog id? */
export function isRecordType(id: unknown): boolean {
  return typeof id === "string" && SCHEDULE_BY_ID.has(id);
}

/** Look up a retention schedule by record type (undefined for an off-catalog id). */
export function getRetentionSchedule(id: string): RetentionSchedule | undefined {
  return SCHEDULE_BY_ID.get(id);
}

/** Is `id` a recognized retention-rule id (a catalog rule or the default rule)? */
export function isRetentionRule(id: unknown): boolean {
  return typeof id === "string" && RETENTION_RULE_IDS.has(id);
}

/** An active-or-not legal hold placed on a record. */
export type LegalHold = {
  /** Whether the hold is currently active (a purge is blocked while active). */
  active: boolean;
  /** Synthetic, de-identified hold id (e.g. "hold-litigation-001"). */
  holdId?: string;
  /** The (illustrative) reason the hold is in place (e.g. "active litigation"). */
  reason?: string;
};

/** A records-retention / disposition evaluation request. */
export type RetentionRequest = {
  /** Synthetic, de-identified record id (e.g. "retention-record-001"). */
  recordId: string;
  /** Synthetic, de-identified patient reference (e.g. "retention-patient-001"). */
  patientRef: string;
  /** The record type/category (a schedule catalog id, or an off-catalog string). */
  recordType: string;
  /** When the record was created (ISO-8601 date or datetime). */
  createdAt: string;
  /** When the record was last touched / last date of service (ISO-8601). */
  lastTouchedAt?: string;
  /** The patient's date of birth (ISO date) — used for a minor's until-majority rule. */
  patientDob?: string;
  /** The (illustrative) jurisdiction/category the schedule is scoped to. */
  jurisdiction?: string;
  /** Any legal hold placed on the record (an active hold always overrides a purge). */
  legalHold?: LegalHold;
  /**
   * The explicit evaluation time (ISO-8601) — taken as data, not a clock read.
   * A record is eligible for purge only when its retention expiry is at/before
   * this time.
   */
  atTime: string;
};

/** The deterministic records-disposition recommendation the agent returns. */
export type RetentionDisposition = {
  /** Synthetic, de-identified record id this disposition is about. */
  recordId: string;
  /** Synthetic, de-identified patient reference this disposition is about. */
  patientRef: string;
  /** The record type/category the disposition is about. */
  recordType: string;
  /** The disposition recommendation. */
  recommendation: RetentionRecommendation;
  /** The governing retention rule's cited id (always a recognized rule). */
  retentionRuleId: string;
  /** The governing retention rule's human-readable label. */
  retentionRuleLabel: string;
  /**
   * The computed retention expiry (ISO-8601), derived from the record's dates +
   * the schedule's period. Undefined only for an unscheduled record with no
   * derivable period.
   */
  retentionExpiresAt?: string;
  /** True when an active legal hold is in place (a held record is never purged). */
  underLegalHold: boolean;
  /**
   * True whenever the recommendation is eligible-for-purge — a purge is only ever
   * a recommendation requiring human approval; the agent never autonomously purges.
   */
  requiresHumanApproval: boolean;
  /** Human-readable reason (cites the deciding factor). */
  reason: string;
  /** Always true — the schedules, periods, and rule ids are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Stable reason phrases the disposition cites (kept as constants for testability). */
export const RETENTION_REASON = {
  retain:
    "within its retention period — the record is retained under the governing retention schedule",
  eligibleForPurge:
    "past its retention expiry with no active legal hold — eligible for purge (a RECOMMENDATION requiring human approval; the agent never autonomously purges)",
  hold:
    "under an active legal hold — retained on hold; a legal hold always overrides a purge, so the record is never marked eligible-for-purge",
  unscheduled:
    "no retention schedule for this record type — retained by default; a record is never purged without a cited retention schedule"
} as const;

/**
 * Add `years` whole years to an ISO timestamp, deterministically (no clock).
 * Returns the input unchanged if it is not a parseable timestamp.
 */
export function addYearsIso(atTime: string, years: number): string {
  const d = new Date(atTime);
  if (Number.isNaN(d.getTime())) return atTime;
  const next = new Date(d.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next.toISOString();
}

/** Is `expiresAt` at/before `atTime`? (ISO timestamps sort lexically when normalized.) */
export function isPastRetention(expiresAt: string | undefined, atTime: string): boolean {
  if (!expiresAt) return false;
  const e = new Date(expiresAt).getTime();
  const t = new Date(atTime).getTime();
  if (Number.isNaN(e) || Number.isNaN(t)) return false;
  return e <= t;
}

/**
 * Compute a schedule's retention expiry from a record's dates, deterministically
 * (no clock). For `from-last-touched` the anchor is the last-touched date (or the
 * created date when absent) plus the retention period; for `until-age-of-majority`
 * the anchor is the patient's date of birth (or the created date when absent) plus
 * the age of majority + the additional retention period.
 */
export function computeRetentionExpiry(
  schedule: RetentionSchedule,
  request: Pick<RetentionRequest, "createdAt" | "lastTouchedAt" | "patientDob">
): string {
  if (schedule.basis === "until-age-of-majority") {
    const anchor = request.patientDob ?? request.createdAt;
    return addYearsIso(anchor, (schedule.ageOfMajority ?? 18) + schedule.retentionYears);
  }
  const anchor = request.lastTouchedAt ?? request.createdAt;
  return addYearsIso(anchor, schedule.retentionYears);
}

/**
 * The deterministic records-disposition function — the heart of the service.
 * DETERMINISTIC: a pure function of the record's dates + the request's own
 * `atTime` (no randomness, no clock). It resolves the governing retention
 * schedule, computes the retention expiry, and produces a recommendation:
 *   - an active LEGAL HOLD short-circuits to `hold` (a legal hold ALWAYS overrides
 *     a purge — a held record is never marked eligible-for-purge);
 *   - otherwise a record PAST its retention expiry is `eligible-for-purge` (a
 *     RECOMMENDATION only, requiresHumanApproval:true — never an autonomous purge);
 *   - otherwise `retain`.
 * Every disposition cites a recorded retention rule (the schedule's rule, or the
 * default retain-unscheduled rule for an off-catalog record type). A purge is
 * never executed here — this produces a recommendation, not a deletion.
 */
export function evaluateRetention(request: RetentionRequest): RetentionDisposition {
  const schedule = getRetentionSchedule(request.recordType);
  const underLegalHold = request.legalHold?.active === true;

  const base = {
    recordId: request.recordId,
    patientRef: request.patientRef,
    recordType: request.recordType,
    underLegalHold,
    synthetic: true as const
  };

  const holdSuffix = underLegalHold
    ? ` An active legal hold${
        request.legalHold?.holdId ? ` (${request.legalHold.holdId})` : ""
      } is in place.`
    : "";
  const synthNote =
    "Synthetic/illustrative retention schedules, periods, and rule ids — NOT a certified records-management system; real retention is jurisdiction-specific and legally reviewed.";

  // Off-catalog record type: retain by default, citing the default rule so the
  // disposition is still schedule-sourced. A record is never purged without a
  // cited schedule — even under a hold, the safe disposition remains hold.
  if (!schedule) {
    const recommendation: RetentionRecommendation = underLegalHold ? "hold" : "retain";
    const reason = underLegalHold ? RETENTION_REASON.hold : RETENTION_REASON.unscheduled;
    return {
      ...base,
      recommendation,
      retentionRuleId: DEFAULT_RETENTION_RULE.id,
      retentionRuleLabel: DEFAULT_RETENTION_RULE.label,
      retentionExpiresAt: undefined,
      requiresHumanApproval: false,
      reason,
      note:
        `Record ${request.recordId} (type "${request.recordType}") has no matching retention schedule → ${recommendation.toUpperCase()}: ${reason}.${holdSuffix} ` +
        synthNote
    };
  }

  const retentionExpiresAt = computeRetentionExpiry(schedule, request);

  // A legal hold ALWAYS overrides a purge — a held record is `hold`, never
  // eligible-for-purge, no matter how far past its expiry it is.
  if (underLegalHold) {
    return {
      ...base,
      recommendation: "hold",
      retentionRuleId: schedule.ruleId,
      retentionRuleLabel: schedule.ruleLabel,
      retentionExpiresAt,
      requiresHumanApproval: false,
      reason: RETENTION_REASON.hold,
      note:
        `Record ${request.recordId} (${schedule.label}) is on HOLD under ${schedule.ruleLabel} (retention expiry ${retentionExpiresAt}).${holdSuffix} A legal hold always overrides a purge, so the record is retained on hold and is never marked eligible-for-purge. ` +
        synthNote
    };
  }

  // Past its retention expiry with no hold → eligible-for-purge (a RECOMMENDATION
  // requiring human approval; the agent never autonomously purges).
  if (isPastRetention(retentionExpiresAt, request.atTime)) {
    return {
      ...base,
      recommendation: "eligible-for-purge",
      retentionRuleId: schedule.ruleId,
      retentionRuleLabel: schedule.ruleLabel,
      retentionExpiresAt,
      requiresHumanApproval: true,
      reason: RETENTION_REASON.eligibleForPurge,
      note:
        `Record ${request.recordId} (${schedule.label}) is PAST its retention expiry ${retentionExpiresAt} under ${schedule.ruleLabel}, with no active legal hold → ELIGIBLE FOR PURGE. This is a RECOMMENDATION requiring human approval — the agent never autonomously purges a record. ` +
        synthNote
    };
  }

  // Within its retention period → retain.
  return {
    ...base,
    recommendation: "retain",
    retentionRuleId: schedule.ruleId,
    retentionRuleLabel: schedule.ruleLabel,
    retentionExpiresAt,
    requiresHumanApproval: false,
    reason: RETENTION_REASON.retain,
    note:
      `Record ${request.recordId} (${schedule.label}) is within its retention period under ${schedule.ruleLabel} (retention expiry ${retentionExpiresAt}) → RETAIN. ` +
      synthNote
  };
}

/**
 * Legal-hold-overrides-purge check: does the disposition avoid marking a held
 * record eligible-for-purge? True unless a disposition asserts eligible-for-purge
 * on a record that is under an active legal hold — the guard that catches a
 * caller-asserted purge of a record on legal hold. Anything evaluateRetention()
 * produces satisfies it (a hold short-circuits to `hold`). This is the honest
 * signal the route reports to policy.retention.legal-hold-overrides-purge. A
 * non-object input is a violation.
 */
export function retentionRespectsLegalHold(
  disposition:
    | Pick<RetentionDisposition, "recommendation" | "underLegalHold">
    | null
    | undefined
): boolean {
  if (!disposition || typeof disposition !== "object") return false;
  return !(
    disposition.underLegalHold === true &&
    disposition.recommendation === "eligible-for-purge"
  );
}

/**
 * Schedule-sourced check: does the disposition cite a recorded retention rule?
 * True when the disposition's retentionRuleId is a recognized retention rule (a
 * catalog rule or the default retain-unscheduled rule); the guard that catches a
 * caller-asserted ad-hoc disposition with no cited schedule (a missing or
 * off-catalog rule id). Anything evaluateRetention() produces satisfies it (it
 * always cites a rule). This is the honest signal the route reports to
 * policy.retention.schedule-sourced. A non-object input is a violation.
 */
export function retentionRuleCited(
  disposition: Pick<RetentionDisposition, "retentionRuleId"> | null | undefined
): boolean {
  if (!disposition || typeof disposition !== "object") return false;
  return isRetentionRule(disposition.retentionRuleId);
}

/**
 * No-autonomous-purge check: is a purge human-approval-gated? True for any
 * disposition that is not a purge, and for an eligible-for-purge disposition that
 * carries requiresHumanApproval:true; the guard that catches a caller-asserted
 * AUTONOMOUS / UNAPPROVED purge (an eligible-for-purge disposition marked as not
 * requiring human approval). Anything evaluateRetention() produces satisfies it
 * (an eligible-for-purge is always requiresHumanApproval:true, and the agent never
 * executes a destructive purge itself). This is the honest signal the route
 * reports to policy.retention.no-autonomous-purge. A non-object input is a
 * violation.
 */
export function purgeHumanApproved(
  disposition:
    | Pick<RetentionDisposition, "recommendation" | "requiresHumanApproval">
    | null
    | undefined
): boolean {
  if (!disposition || typeof disposition !== "object") return false;
  if (disposition.recommendation !== "eligible-for-purge") return true;
  return disposition.requiresHumanApproval === true;
}

/**
 * A compact, trace-safe summary of a disposition — the shape stamped onto the
 * Agent Fabric trace + the response `meta`. Carries no free-text PHI (refs, the
 * record type, the recommendation, the cited rule, the expiry, and the flags only).
 */
export function retentionSummary(disposition: RetentionDisposition): {
  recordId: string;
  patientRef: string;
  recordType: string;
  recommendation: RetentionRecommendation;
  retentionRuleId: string;
  retentionExpiresAt?: string;
  underLegalHold: boolean;
  requiresHumanApproval: boolean;
  synthetic: boolean;
} {
  return {
    recordId: disposition.recordId,
    patientRef: disposition.patientRef,
    recordType: disposition.recordType,
    recommendation: disposition.recommendation,
    retentionRuleId: disposition.retentionRuleId,
    retentionExpiresAt: disposition.retentionExpiresAt,
    underLegalHold: disposition.underLegalHold,
    requiresHumanApproval: disposition.requiresHumanApproval,
    synthetic: disposition.synthetic
  };
}

/**
 * A representative, deterministic demo retention request (illustrative). A
 * recently-touched adult clinical record, well within its 7-year retention period
 * and with no legal hold — resolves to `retain`. Synthetic / de-identified.
 */
export const DEMO_RETENTION_REQUEST: RetentionRequest = {
  recordId: "retention-record-001",
  patientRef: "retention-patient-001",
  recordType: "clinical-record",
  createdAt: "2024-01-10",
  lastTouchedAt: "2025-06-15",
  jurisdiction: "us-demo",
  atTime: "2026-03-01T00:00:00Z"
};

/**
 * A representative, deterministic demo PURGE-ELIGIBLE request (illustrative). An
 * old billing / claim record last touched a decade ago, well past its 7-year
 * retention expiry, with NO legal hold → `eligible-for-purge`: a RECOMMENDATION
 * requiring human approval (never an autonomous purge). A safe, honest output —
 * NOT a governance block. Synthetic / de-identified.
 */
export const DEMO_PURGE_ELIGIBLE_REQUEST: RetentionRequest = {
  recordId: "retention-record-002",
  patientRef: "retention-patient-002",
  recordType: "billing-claim",
  createdAt: "2015-02-01",
  lastTouchedAt: "2016-03-01",
  jurisdiction: "us-demo",
  atTime: "2026-03-01T00:00:00Z"
};

/**
 * A representative, deterministic demo LEGAL-HOLD request (illustrative). A
 * clinical record that is well past its 7-year retention expiry — but under an
 * ACTIVE legal hold → `hold`: the legal hold overrides the purge, so the record is
 * retained and never marked eligible-for-purge. Synthetic / de-identified.
 */
export const DEMO_LEGAL_HOLD_REQUEST: RetentionRequest = {
  recordId: "retention-record-003",
  patientRef: "retention-patient-003",
  recordType: "clinical-record",
  createdAt: "2010-01-01",
  lastTouchedAt: "2011-01-01",
  jurisdiction: "us-demo",
  legalHold: {
    active: true,
    holdId: "hold-litigation-001",
    reason: "active litigation — records preserved under legal hold"
  },
  atTime: "2026-03-01T00:00:00Z"
};
