/**
 * Accounting of Disclosures (HIPAA §164.528) — the deterministic, transparent privacy layer that
 * assembles a patient's ACCOUNTING OF DISCLOSURES: given the patient's disclosure log, it
 * deterministically classifies each disclosure (in-accounting / excluded-TPO / excluded-authorized
 * / out-of-window), assembles the accounting of every ACCOUNTABLE disclosure within the lookback
 * window, and hands it back for a privacy officer to release — never autonomously suppressing,
 * redacting, or deleting a logged disclosure.
 *
 * Deterministic, dependency-free domain core the Accounting of Disclosures Agent
 * (app/api/agents/accounting-of-disclosures) wraps — a control-plane / data-substrate privacy
 * service on the platform plane of Pause's Agent Fabric. Given an accounting request (a patient
 * reference, an as-of date, a lookback window in years, and the patient's disclosure log — each
 * disclosure a date, a recipient, and the cited purpose-of-disclosure), it DETERMINISTICALLY
 * classifies each disclosure against the §164.528 accountability rules (treatment / payment /
 * operations and patient-authorized disclosures are EXCLUDED from the accounting; non-TPO
 * disclosures — public-health mandates, law enforcement, judicial orders, research without
 * authorization — ARE accountable), filters to the lookback window (as-of date − lookback years),
 * and assembles the accounting.
 *
 *   Inbound:  an AccountingRequest { requestRef, patientRef, asOfDate, lookbackYears, disclosures }
 *   Outbound: an AccountingDetermination { windowStart, classified[], accountableCount,
 *             excludedCount, outOfWindowCount, requiresPrivacyOfficerReview:true,
 *             autonomousSuppression:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other platform / privacy agents: distinct from the
 * Consent & Preferences Management agent (WHETHER a patient may be contacted / data used), the
 * Minimum Necessary agent (HOW MUCH PHI a purpose may see), the De-Identification agent (whether a
 * dataset is still PHI), the Data Retention agent (records disposition), and the Audit Log
 * Integrity agent (whether the audit TRAIL is tamper-evident): this answers the patient's §164.528
 * RIGHT to know WHO their PHI was disclosed to, and for what non-TPO purpose, over the prior years.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every disclosure's purpose traces to a recorded catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Each disclosure's accountability is decided by its purpose-of-disclosure, which must resolve in
 *  the recorded purpose catalog — an ad-hoc / off-catalog purpose id cannot be correctly classified
 *  as accountable or excluded. accountingPurposeSourced() reports the honest signal the Agent
 *  Fabric enforces via policy.accounting.purpose-category-sourced. (Mirrors the Minimum Necessary
 *  Agent's purpose-of-use-sourced and the Data Retention Agent's schedule-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: every accountable disclosure appears in the accounting.
 * ─────────────────────────────────────────────────────────────────────
 *  A disclosure that is accountable (a non-TPO, non-authorized purpose) AND within the lookback
 *  window MUST appear in the accounting — dropping an accountable disclosure understates the
 *  accounting and defeats the patient's §164.528 right. accountingComplete() recomputes, from the
 *  determination's own classified list, which disclosures should be in the accounting and verifies
 *  none was omitted; it reports the honest signal the Agent Fabric enforces via
 *  policy.accounting.accountable-disclosures-complete. (The load-bearing completeness gate —
 *  mirrors the Good Faith Estimate Agent's expected-items-complete and the Audit Log Integrity
 *  Agent's sequence-complete.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a logged disclosure is never autonomously suppressed.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent CLASSIFIES and ASSEMBLES — it never deletes, redacts, or suppresses a logged
 *  disclosure (that would falsify the accounting and destroy evidence), and the assembled
 *  accounting is a RECOMMENDATION requiring a privacy officer to review before release.
 *  accountingNoAutonomousSuppression() reports the honest signal the Agent Fabric enforces via
 *  policy.accounting.no-autonomous-suppression. (Mirrors the Audit Log Integrity Agent's
 *  no-autonomous-redaction and the Minimum Necessary Agent's no-autonomous-over-disclosure posture
 *  — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — however many accountable disclosures it lists — is a SAFE, honest OUTPUT: the
 *  task COMPLETES (it carries requiresPrivacyOfficerReview:true). A GOVERNANCE BLOCK is when a
 *  caller PRESENTS an offending DETERMINATION (an off-catalog purpose, an accountable disclosure
 *  dropped from the accounting, or an autonomously-suppressed / unreviewed accounting) — which the
 *  Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified accounting-of-disclosures system.
 * ─────────────────────────────────────────────────────────────────────
 *  The purpose catalog and accountability rules below are clearly-labeled ILLUSTRATIVE synthetics
 *  chosen to model the SHAPE of a §164.528 accounting deterministically in the demo — they are NOT
 *  a complete implementation. Real accountings are governed by HIPAA §164.528 (including the full
 *  set of exclusions, the six-year window, and the electronic-health-record disclosure rules) and
 *  the covered entity's Notice of Privacy Practices. There is NO randomness and NO clock anywhere
 *  here: the accounting is a pure function of the request's own fields (dates taken as data — no
 *  Date.now()), so the same log always yields the same classification / accounting / counts —
 *  which is what lets the demo, the seeded trace, and the tests agree.
 */

/** Normalize an ISO date (date-only or full) to a UTC midnight epoch-ms. */
function toUtcDateMs(iso: string): number {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Subtract `years` from an ISO date, returning a date-only "YYYY-MM-DD" string. Deterministic (UTC). */
export function subtractYears(iso: string, years: number): string {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/** The high-level purpose category of a disclosure. */
export type DisclosureCategory =
  | "treatment"
  | "payment"
  | "operations"
  | "patient-authorized"
  | "public-health"
  | "law-enforcement"
  | "judicial"
  | "research";

/** A recorded purpose-of-disclosure (a catalog entry that decides accountability). */
export type DisclosurePurpose = {
  /** Stable purpose id. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** The high-level category. */
  category: DisclosureCategory;
  /** Whether a disclosure for this purpose must appear in a §164.528 accounting. */
  accountable: boolean;
};

/**
 * ILLUSTRATIVE, synthetic purpose catalog — clearly labeled, NOT a complete §164.528
 * implementation. Treatment / payment / operations (TPO) and patient-authorized disclosures are
 * EXCLUDED from the accounting; non-TPO disclosures ARE accountable.
 */
export const DISCLOSURE_PURPOSES: DisclosurePurpose[] = [
  {
    id: "purpose.treatment",
    label: "Treatment — shared with a treating provider",
    category: "treatment",
    accountable: false
  },
  {
    id: "purpose.payment",
    label: "Payment — shared with a payer to adjudicate a claim",
    category: "payment",
    accountable: false
  },
  {
    id: "purpose.operations",
    label: "Health-care operations — quality / care coordination",
    category: "operations",
    accountable: false
  },
  {
    id: "purpose.patient-authorized",
    label: "Patient-authorized disclosure (written authorization on file)",
    category: "patient-authorized",
    accountable: false
  },
  {
    id: "purpose.public-health-mandated",
    label: "Public-health reporting mandated by law (no authorization)",
    category: "public-health",
    accountable: true
  },
  {
    id: "purpose.law-enforcement",
    label: "Law-enforcement request (no authorization)",
    category: "law-enforcement",
    accountable: true
  },
  {
    id: "purpose.judicial-order",
    label: "Judicial / administrative order (subpoena)",
    category: "judicial",
    accountable: true
  },
  {
    id: "purpose.research-no-authorization",
    label: "Research disclosure without individual authorization (IRB waiver)",
    category: "research",
    accountable: true
  }
];

/** Look up a purpose by id (undefined when off-catalog). */
export function getDisclosurePurpose(id: string): DisclosurePurpose | undefined {
  return DISCLOSURE_PURPOSES.find((p) => p.id === id);
}

/**
 * Whether a disclosure for the cited purpose is accountable. An off-catalog purpose is treated as
 * accountable (conservative: it is INCLUDED so the accounting is never understated) — the
 * purpose-sourced guard separately blocks an off-catalog purpose.
 */
export function isAccountablePurpose(purposeId: string): boolean {
  const p = getDisclosurePurpose(purposeId);
  return p ? p.accountable : true;
}

/** A single logged disclosure of a patient's PHI. */
export type DisclosureRecord = {
  /** Stable disclosure id. */
  disclosureId: string;
  /** The date of the disclosure (ISO; treated as data). */
  date: string;
  /** The recipient of the disclosure. */
  recipient: string;
  /** The cited purpose-of-disclosure id. */
  purposeId: string;
};

/** How a disclosure was classified for the accounting. */
export type DisclosureDisposition =
  | "in-accounting"
  | "excluded-tpo"
  | "excluded-authorized"
  | "out-of-window";

/** A disclosure after classification. */
export type ClassifiedDisclosure = {
  disclosureId: string;
  date: string;
  recipient: string;
  purposeId: string;
  /** The purpose label ('unknown purpose' when off-catalog). */
  purposeLabel: string;
  /** The purpose category ('unknown' when off-catalog). */
  category: DisclosureCategory | "unknown";
  /** Whether the disclosure falls within the lookback window. */
  inWindow: boolean;
  /** Whether the disclosure belongs in the accounting (disposition === 'in-accounting'). */
  accountable: boolean;
  /** The classification disposition. */
  disposition: DisclosureDisposition;
};

/** An accounting-of-disclosures request. */
export type AccountingRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic patient reference. */
  patientRef: string;
  /** The as-of date the accounting is computed against (ISO; treated as data). */
  asOfDate: string;
  /** The lookback window in years (HIPAA §164.528 is six years). */
  lookbackYears: number;
  /** The patient's disclosure log. */
  disclosures: DisclosureRecord[];
};

/** The deterministic accounting determination the agent returns. */
export type AccountingDetermination = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic patient reference. */
  patientRef: string;
  /** The as-of date. */
  asOfDate: string;
  /** The lookback window in years. */
  lookbackYears: number;
  /** The computed window start (as-of date − lookback years), date-only. */
  windowStart: string;
  /** The total number of disclosures in the log. */
  totalDisclosures: number;
  /** Every disclosure, classified. */
  classified: ClassifiedDisclosure[];
  /** How many disclosures are in the accounting. */
  accountableCount: number;
  /** How many disclosures are excluded (TPO or patient-authorized) within the window. */
  excludedCount: number;
  /** How many disclosures fall outside the lookback window. */
  outOfWindowCount: number;
  /** Always true — the assembled accounting is released only after privacy-officer review. */
  requiresPrivacyOfficerReview: true;
  /** Always false — the agent never autonomously suppresses a logged disclosure. */
  autonomousSuppression: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the purpose catalog is illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * The deterministic accounting function — the heart of the service. DETERMINISTIC: a pure function
 * of the request's own fields (no randomness, no clock). It computes the lookback window, classifies
 * each disclosure (in-accounting / excluded-TPO / excluded-authorized / out-of-window), and assembles
 * the accounting. Nothing is deleted here — the accounting is a recommendation requiring privacy-
 * officer review.
 */
export function evaluateAccounting(request: AccountingRequest): AccountingDetermination {
  const windowStart = subtractYears(request.asOfDate, request.lookbackYears);
  const windowStartMs = toUtcDateMs(windowStart);
  const asOfMs = toUtcDateMs(request.asOfDate);

  const classified: ClassifiedDisclosure[] = request.disclosures.map((d) => {
    const purpose = getDisclosurePurpose(d.purposeId);
    const dateMs = toUtcDateMs(d.date);
    const inWindow = dateMs >= windowStartMs && dateMs <= asOfMs;

    let disposition: DisclosureDisposition;
    if (!inWindow) {
      disposition = "out-of-window";
    } else if (purpose?.category === "patient-authorized") {
      disposition = "excluded-authorized";
    } else if (purpose && !purpose.accountable) {
      disposition = "excluded-tpo";
    } else {
      // Accountable purpose (or unknown → conservatively included).
      disposition = "in-accounting";
    }

    return {
      disclosureId: d.disclosureId,
      date: d.date,
      recipient: d.recipient,
      purposeId: d.purposeId,
      purposeLabel: purpose?.label ?? "unknown purpose",
      category: purpose?.category ?? "unknown",
      inWindow,
      accountable: disposition === "in-accounting",
      disposition
    };
  });

  const accountableCount = classified.filter((c) => c.disposition === "in-accounting").length;
  const excludedCount = classified.filter(
    (c) => c.disposition === "excluded-tpo" || c.disposition === "excluded-authorized"
  ).length;
  const outOfWindowCount = classified.filter((c) => c.disposition === "out-of-window").length;

  const reason =
    `Accounting for ${request.patientRef} as of ${request.asOfDate} (${request.lookbackYears}-year window from ${windowStart}): ` +
    `${accountableCount} accountable disclosure(s) of ${request.disclosures.length} logged — ${excludedCount} excluded (TPO / authorized), ${outOfWindowCount} outside the window; privacy-officer review required before release`;

  return {
    requestRef: request.requestRef,
    patientRef: request.patientRef,
    asOfDate: request.asOfDate,
    lookbackYears: request.lookbackYears,
    windowStart,
    totalDisclosures: request.disclosures.length,
    classified,
    accountableCount,
    excludedCount,
    outOfWindowCount,
    requiresPrivacyOfficerReview: true,
    autonomousSuppression: false,
    reason,
    synthetic: true,
    note:
      `§164.528 accounting for ${request.patientRef}: ${accountableCount} accountable / ${excludedCount} excluded (TPO or authorized) / ${outOfWindowCount} out-of-window, ${request.lookbackYears}-year window from ${windowStart}. ` +
      "Synthetic/illustrative purpose catalog — NOT a certified accounting-of-disclosures system; real accountings are governed by HIPAA §164.528 (the full exclusion set, the six-year window, and the electronic-health-record disclosure rules) and the covered entity's Notice of Privacy Practices."
  };
}

/**
 * Purpose-category-sourced check: does every classified disclosure cite a recorded purpose? True
 * only when each disclosure's purpose id resolves in the catalog; the guard that catches an ad-hoc
 * / off-catalog purpose (which cannot be correctly classified as accountable or excluded). Anything
 * evaluateAccounting() produces from cataloged purposes satisfies it. This is the honest signal the
 * route reports to policy.accounting.purpose-category-sourced. A non-object input is a violation.
 */
export function accountingPurposeSourced(
  determination:
    | { classified?: Array<{ purposeId?: string }> }
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (!Array.isArray(determination.classified)) return false;
  return determination.classified.every(
    (c) => typeof c?.purposeId === "string" && getDisclosurePurpose(c.purposeId) !== undefined
  );
}

/**
 * Accountable-disclosures-complete check: does every accountable, in-window disclosure appear in
 * the accounting? True unless a disclosure whose purpose is accountable AND that is within the
 * window carries a disposition other than 'in-accounting' (i.e., was dropped / mis-excluded); the
 * guard that catches an understated accounting. Anything evaluateAccounting() produces satisfies
 * it. This is the honest signal the route reports to policy.accounting.accountable-disclosures-
 * complete. A non-object input is a violation.
 */
export function accountingComplete(
  determination:
    | {
        classified?: Array<{
          purposeId?: string;
          inWindow?: boolean;
          disposition?: DisclosureDisposition;
        }>;
      }
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (!Array.isArray(determination.classified)) return false;
  for (const c of determination.classified) {
    if (
      c?.inWindow === true &&
      typeof c.purposeId === "string" &&
      isAccountablePurpose(c.purposeId) &&
      c.disposition !== "in-accounting"
    ) {
      return false;
    }
  }
  return true;
}

/**
 * No-autonomous-suppression check: did the agent avoid autonomously suppressing a logged
 * disclosure? True unless the determination claims it suppressed / redacted a disclosure, or that
 * the accounting does not require privacy-officer review; the guard that catches an autonomous /
 * unreviewed suppression. Anything evaluateAccounting() produces satisfies it. This is the honest
 * signal the route reports to policy.accounting.no-autonomous-suppression. A non-object input is a
 * violation.
 */
export function accountingNoAutonomousSuppression(
  determination:
    | { autonomousSuppression?: boolean; requiresPrivacyOfficerReview?: boolean }
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (determination.autonomousSuppression === true) return false;
  if (determination.requiresPrivacyOfficerReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric
 * trace + the response `meta`.
 */
export function accountingSummary(determination: AccountingDetermination): {
  requestRef: string;
  patientRef: string;
  windowStart: string;
  totalDisclosures: number;
  accountableCount: number;
  excludedCount: number;
  outOfWindowCount: number;
  requiresPrivacyOfficerReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: determination.requestRef,
    patientRef: determination.patientRef,
    windowStart: determination.windowStart,
    totalDisclosures: determination.totalDisclosures,
    accountableCount: determination.accountableCount,
    excludedCount: determination.excludedCount,
    outOfWindowCount: determination.outOfWindowCount,
    requiresPrivacyOfficerReview: determination.requiresPrivacyOfficerReview,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request: a patient with a mixed disclosure log — treatment + payment (both
 * excluded TPO), a mandated public-health report + a law-enforcement request (both accountable),
 * and an old disclosure outside the six-year window. Synthetic.
 */
export const DEMO_ACCOUNTING_REQUEST: AccountingRequest = {
  requestRef: "acct-req-001",
  patientRef: "patient-acct-001",
  asOfDate: "2026-09-01",
  lookbackYears: 6,
  disclosures: [
    {
      disclosureId: "disc-001",
      date: "2026-02-14",
      recipient: "Dr. Rivera (treating cardiologist)",
      purposeId: "purpose.treatment"
    },
    {
      disclosureId: "disc-002",
      date: "2026-03-02",
      recipient: "BlueShield claims adjudication",
      purposeId: "purpose.payment"
    },
    {
      disclosureId: "disc-003",
      date: "2026-04-20",
      recipient: "State Department of Public Health",
      purposeId: "purpose.public-health-mandated"
    },
    {
      disclosureId: "disc-004",
      date: "2026-06-11",
      recipient: "County Sheriff's Office",
      purposeId: "purpose.law-enforcement"
    },
    {
      disclosureId: "disc-005",
      date: "2019-01-05",
      recipient: "State Department of Public Health",
      purposeId: "purpose.public-health-mandated"
    }
  ]
};

/**
 * A representative demo request: a patient whose accountable disclosures include a judicial order
 * and an unauthorized research disclosure (both accountable), plus a patient-authorized disclosure
 * (excluded). Synthetic.
 */
export const DEMO_ACCOUNTING_MIXED_REQUEST: AccountingRequest = {
  requestRef: "acct-req-002",
  patientRef: "patient-acct-002",
  asOfDate: "2026-09-01",
  lookbackYears: 6,
  disclosures: [
    {
      disclosureId: "disc-101",
      date: "2025-11-30",
      recipient: "Superior Court (subpoena)",
      purposeId: "purpose.judicial-order"
    },
    {
      disclosureId: "disc-102",
      date: "2026-01-18",
      recipient: "University research registry (IRB waiver)",
      purposeId: "purpose.research-no-authorization"
    },
    {
      disclosureId: "disc-103",
      date: "2026-05-09",
      recipient: "Life-insurance underwriter (authorization on file)",
      purposeId: "purpose.patient-authorized"
    }
  ]
};

/**
 * A representative demo request: a patient with ONLY TPO disclosures → an empty accounting (nothing
 * accountable), still requiring privacy-officer review. Synthetic.
 */
export const DEMO_ACCOUNTING_TPO_ONLY_REQUEST: AccountingRequest = {
  requestRef: "acct-req-003",
  patientRef: "patient-acct-003",
  asOfDate: "2026-09-01",
  lookbackYears: 6,
  disclosures: [
    {
      disclosureId: "disc-201",
      date: "2026-02-01",
      recipient: "Dr. Chen (primary care)",
      purposeId: "purpose.treatment"
    },
    {
      disclosureId: "disc-202",
      date: "2026-03-15",
      recipient: "Aetna claims",
      purposeId: "purpose.payment"
    }
  ]
};
