/**
 * Fraud, Waste & Abuse (FWA) Detection — deterministic pattern-based
 * screening of claims and prior-auths for the Special Investigations Unit
 * (SIU).
 *
 * Deterministic, dependency-free domain core the FWA Detection Agent
 * (app/api/agents/fwa-detection) wraps — the Salesforce "Agentforce for
 * Health" / Health Cloud FWA analog on Pause's Agent Fabric. It screens
 * each submitted claim / prior-auth against a defined pattern catalog
 * (unbundling, upcoding, duplicate billing, quantity outliers, impossible-
 * day billing, phantom services), classifies each hit by severity, and
 * routes to the SIU for HUMAN review. It NEVER autonomously denies a
 * claim, opens an investigation, or freezes payment — those are formal
 * acts. Distinct from the Claims Adjudication Assistant (routine edits
 * like NCCI-PTP that AUTO-deny with a specific reason code): FWA is
 * about SUSPICIOUS PATTERNS that need investigation, not a mechanical
 * catalog-edit deny.
 *
 *   Inbound:  FwaScreeningRequest (a synthetic providerRef + claimRef —
 *             clearly labeled illustrative — claim lines, submission
 *             history, an ISO asOfDate accepted as data)
 *   Outbound: FwaScreeningReport { requestRef, decision: 'clear' |
 *             'flag-for-siu-review', flags: FwaFlag[] with pattern id +
 *             severity + reason, routedTo, requiresSiuReview,
 *             investigationOpened:false, paymentFrozen:false, synthetic:
 *             true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: patterns trace to the pattern catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every applied FWA pattern must trace to the defined FWA_PATTERN_CATALOG
 *  (unbundling, upcoding, duplicate-billing, quantity-outlier, impossible-
 *  day-billing, phantom-service). A fabricated "we just don't like this
 *  provider" pattern is a category-of-one flag masquerading as a rule and
 *  fails. patternsTraceToCatalog() reports the honest signal the Agent
 *  Fabric enforces via policy.fwa.pattern-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no autonomous denial / investigation /
 *  payment freeze.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent may only FLAG for SIU review. Every report is
 *  requiresSiuReview:true / investigationOpened:false / paymentFrozen:
 *  false; a caller-asserted plan that claims any of those true is a
 *  violation. Denying a suspected-fraud claim without investigation is a
 *  discrimination / due-process failure — a payer cannot deny a claim on
 *  the basis of an unproven suspicion, and Section 1557 / state insurance
 *  code requires notice + appeal rights on any denial. Mirrors the Claims
 *  Adjudication Agent's no-autonomous-denial, the PA Agent's no-
 *  autonomous-submission, and the CCM Agent's no-autonomous-billing
 *  posture. reportRequiresSiuReview() reports the honest signal the Agent
 *  Fabric enforces via policy.fwa.no-autonomous-denial.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no protected-class factors.
 * ─────────────────────────────────────────────────────────────────────
 *  The pattern-detection engine must NOT use protected-class attributes
 *  (race, ethnicity, gender identity, religion, national origin,
 *  disability status, sexual orientation, marital status) or provider
 *  demographic proxies as detection factors. Bias in FWA is a well-
 *  documented compliance failure (algorithmic-audit reports of payer
 *  systems disproportionately targeting minority-owned clinics). None of
 *  FWA_PATTERNS is a protected-class factor; noProtectedClassFactors()
 *  reports the honest signal the Agent Fabric enforces via policy.fwa.
 *  no-protected-class-factors. Mirrors the Population Health Agent's no-
 *  protected-class-factors posture.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified FWA / SIU engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The pattern catalog, severity thresholds, provider baselines, and
 *  detection windows below are ILLUSTRATIVE synthetic/demo values that
 *  model the SHAPE of a payer FWA workflow — they are NOT SAS Detection
 *  and Investigation, LexisNexis Provider Insight, an actual payer's SIU
 *  rule set, or a certified fraud-detection engine. The refs + amounts
 *  are synthetic / de-identified. There is NO randomness and NO clock
 *  anywhere here: screening is a pure function of the claim + provider
 *  baseline + pattern catalog + caller-provided asOfDate.
 */

/** A single FWA pattern in the illustrative catalog. */
export type FwaPattern = {
  /** Stable catalog id every flag references (never invented). */
  id: string;
  /** Human-readable label. */
  label: string;
  /**
   * Default severity when this pattern fires. `high` routes to SIU with
   * priority; `medium` routes to SIU standard queue; `low` is informational
   * (SIU review still required, but non-blocking).
   */
  defaultSeverity: "low" | "medium" | "high";
  /** Illustrative rationale for including this pattern. */
  rationale: string;
  /** Always true — the catalog is an illustrative synthetic. */
  synthetic: true;
};

/**
 * The illustrative FWA pattern catalog. Six patterns that model the SHAPE
 * of a payer SIU rule set. NOT a real payer's FWA rules.
 */
export const FWA_PATTERNS: FwaPattern[] = [
  {
    id: "pattern.unbundling",
    label: "Unbundling — CPTs billed separately that are typically bundled",
    defaultSeverity: "medium",
    rationale:
      "Provider is billing component CPTs separately when the comprehensive code covers all of them. Distinct from NCCI-PTP catch (which is a mechanical claims-adjudication edit) — this is REPEATED unbundling behavior across claims, a pattern signal.",
    synthetic: true
  },
  {
    id: "pattern.upcoding",
    label: "Upcoding — E/M level higher than expected given diagnosis + visit type",
    defaultSeverity: "medium",
    rationale:
      "Provider consistently bills E/M levels above their peer baseline for similar case mix — a coding-integrity pattern.",
    synthetic: true
  },
  {
    id: "pattern.duplicate-billing",
    label: "Duplicate billing — same DOS + same CPT + same provider across submissions",
    defaultSeverity: "high",
    rationale:
      "Same claim submitted multiple times across a short window. Distinct from Claims Adjudication's duplicate-submission edit (immediate) — this is a PATTERN of dupes over time.",
    synthetic: true
  },
  {
    id: "pattern.quantity-outlier",
    label: "Quantity outlier — units billed > 3× peer baseline",
    defaultSeverity: "medium",
    rationale:
      "Units-billed per encounter exceed the peer-provider baseline by more than 3×. Peer baselines are catalog-sourced (illustrative).",
    synthetic: true
  },
  {
    id: "pattern.impossible-day-billing",
    label: "Impossible-day billing — total billed time per day exceeds 24h",
    defaultSeverity: "high",
    rationale:
      "Total service time (from time-based CPT units) across all claims for the same provider on the same day sums to more than 24 hours — physically impossible.",
    synthetic: true
  },
  {
    id: "pattern.phantom-service",
    label: "Phantom service — CPT with no corresponding EHR encounter",
    defaultSeverity: "high",
    rationale:
      "Claim references a CPT with no matching encounter in the linked EHR feed for that member on that DOS.",
    synthetic: true
  }
];

const PATTERN_BY_ID = new Map<string, FwaPattern>(
  FWA_PATTERNS.map((p) => [p.id, p])
);

/** Is `id` a defined pattern catalog id? */
export function isFwaPattern(id: unknown): boolean {
  return typeof id === "string" && PATTERN_BY_ID.has(id);
}

/** Look up a pattern (undefined for an off-catalog id). */
export function getFwaPattern(id: string): FwaPattern | undefined {
  return PATTERN_BY_ID.get(id);
}

/**
 * Protected-class attributes the FWA engine must NEVER use as detection
 * factors. Mirrors the Population Health Agent's list. If any of these
 * appears in `factorsInUse`, the model is not fairness-clean.
 */
export const PROTECTED_CLASS_ATTRIBUTES: readonly string[] = [
  "attr.race",
  "attr.ethnicity",
  "attr.gender-identity",
  "attr.religion",
  "attr.national-origin",
  "attr.disability-status",
  "attr.sexual-orientation",
  "attr.marital-status",
  "attr.provider-race",
  "attr.provider-ethnicity",
  "attr.clinic-neighborhood-race-composition"
];
const PROTECTED_CLASS_SET = new Set<string>(PROTECTED_CLASS_ATTRIBUTES);

/** Is `id` a protected-class attribute the engine may not score on? */
export function isProtectedClassAttribute(id: unknown): boolean {
  return typeof id === "string" && PROTECTED_CLASS_SET.has(id);
}

/** A single claim line for FWA screening. */
export type ClaimLineForScreening = {
  lineId: string;
  cptCode: string;
  units: number;
  /** Illustrative time-based service minutes (for impossible-day billing). */
  serviceMinutes?: number;
};

/**
 * The provider baseline — used to compare "quantity-outlier" and "upcoding"
 * signals. Illustrative peer-baseline shape.
 */
export type ProviderBaseline = {
  /** Median monthly units per member across peers (illustrative). */
  medianUnitsPerMember: number;
  /** Median E/M level (2-5 scale, illustrative). */
  medianEmLevel: number;
  /** Illustrative unbundling-history flag (rolling 90-day). */
  hasRepeatedUnbundlingHistory: boolean;
  /** Illustrative duplicate-billing-history flag (rolling 90-day). */
  hasRepeatedDuplicateHistory: boolean;
};

/**
 * The prior-submission context — for duplicate-billing detection across
 * time. Illustrative.
 */
export type PriorSubmission = {
  claimRef: string;
  dateOfService: string;
  cptCode: string;
};

/** The daily service-time aggregate for the provider (impossible-day check). */
export type ProviderDailyServiceTotals = {
  /** ISO date. */
  date: string;
  /** Total service minutes across all claims for this provider on this date. */
  totalServiceMinutes: number;
};

/**
 * The structured input the screener reads. `providerRef`, `claimRef`,
 * `memberRef` are synthetic, de-identified. All fields accepted as data
 * (no clock, no randomness).
 */
export type FwaScreeningRequest = {
  requestRef: string;
  providerRef: string;
  claimRef: string;
  memberRef: string;
  /** ISO asOfDate. */
  asOfDate: string;
  /** ISO date of service. */
  dateOfService: string;
  /** The claim lines. */
  lines: readonly ClaimLineForScreening[];
  /** E/M level billed (if applicable). */
  emLevel?: number;
  /** Total units billed on this claim. */
  totalUnits: number;
  /** Members served this month (for units-per-member normalization). */
  membersServedThisMonth?: number;
  /** Peer-baseline data for the provider. */
  providerBaseline: ProviderBaseline;
  /** Prior submissions from this provider (rolling 90-day). */
  priorSubmissions?: readonly PriorSubmission[];
  /** Daily service-time totals (impossible-day). */
  providerDailyServiceTotals?: readonly ProviderDailyServiceTotals[];
  /** Whether the claim references an EHR encounter (phantom-service). */
  hasMatchingEhrEncounter?: boolean;
  /**
   * The list of pattern-detection factors the caller claims to be using
   * (for the no-protected-class-factors signal). When absent, defaults to
   * the built-in factor list — which is the ID of every pattern in the
   * catalog + the peer-baseline metric names. Never protected-class.
   */
  factorsInUse?: readonly string[];
};

/** A single FWA flag. */
export type FwaFlag = {
  patternId: string;
  patternLabel: string;
  severity: "low" | "medium" | "high";
  reason: string;
};

/** The overall screening decision. */
export type FwaDecision = "clear" | "flag-for-siu-review";

/** The routing target when the screening flags. */
export type FwaRoute = "clear-no-action" | "siu-standard-queue" | "siu-priority-queue";

/** The full screening report. */
export type FwaScreeningReport = {
  requestRef: string;
  providerRef: string;
  claimRef: string;
  memberRef: string;
  asOfDate: string;
  decision: FwaDecision;
  flags: readonly FwaFlag[];
  primaryPatternId: string | null;
  primarySeverity: "low" | "medium" | "high" | null;
  routedTo: FwaRoute;
  requiresSiuReview: boolean;
  /** Always false — the agent NEVER autonomously opens an investigation. */
  investigationOpened: false;
  /** Always false — the agent NEVER autonomously freezes payment. */
  paymentFrozen: false;
  /** Always true — the catalog + refs are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note. */
  note: string;
};

/** Severity precedence (higher = priority queue). */
const SEVERITY_RANK: Record<"low" | "medium" | "high", number> = {
  low: 0,
  medium: 1,
  high: 2
};

/**
 * The DEFAULT set of pattern-detection factors the engine uses — every
 * pattern id in FWA_PATTERNS + the peer-baseline metrics + submission-
 * time metrics. None is a protected-class attribute.
 */
export const DEFAULT_FWA_FACTORS: readonly string[] = [
  ...FWA_PATTERNS.map((p) => p.id),
  "attr.median-units-per-member",
  "attr.median-em-level",
  "attr.repeated-unbundling-history",
  "attr.repeated-duplicate-history",
  "attr.total-daily-service-minutes",
  "attr.matching-ehr-encounter"
];

/**
 * Deterministically evaluate FWA patterns for a screening request. Sorted
 * by pattern-id ascending for a stable display.
 */
export function evaluateFwaPatterns(
  req: FwaScreeningRequest
): readonly FwaFlag[] {
  const flags: FwaFlag[] = [];
  const b = req.providerBaseline;

  // Unbundling: provider has a repeated-unbundling history.
  if (b.hasRepeatedUnbundlingHistory) {
    flags.push({
      patternId: "pattern.unbundling",
      patternLabel: getFwaPattern("pattern.unbundling")!.label,
      severity: getFwaPattern("pattern.unbundling")!.defaultSeverity,
      reason:
        "provider has repeated unbundling history in the rolling 90-day window"
    });
  }

  // Upcoding: E/M level > median+1.
  if (typeof req.emLevel === "number" && req.emLevel > b.medianEmLevel + 1) {
    flags.push({
      patternId: "pattern.upcoding",
      patternLabel: getFwaPattern("pattern.upcoding")!.label,
      severity: getFwaPattern("pattern.upcoding")!.defaultSeverity,
      reason: `billed E/M level ${req.emLevel} > peer median ${b.medianEmLevel} + 1`
    });
  }

  // Duplicate-billing: same DOS + same CPT + provider found in priorSubmissions.
  const prior = req.priorSubmissions ?? [];
  const cptSet = new Set(req.lines.map((l) => l.cptCode));
  const hasPriorDuplicate = prior.some(
    (p) => p.dateOfService === req.dateOfService && cptSet.has(p.cptCode)
  );
  if (hasPriorDuplicate || b.hasRepeatedDuplicateHistory) {
    flags.push({
      patternId: "pattern.duplicate-billing",
      patternLabel: getFwaPattern("pattern.duplicate-billing")!.label,
      severity: getFwaPattern("pattern.duplicate-billing")!.defaultSeverity,
      reason: hasPriorDuplicate
        ? `duplicate CPT + DOS found in the rolling prior-submissions window`
        : `provider has repeated duplicate-billing history in the rolling 90-day window`
    });
  }

  // Quantity outlier: units-per-member > 3× peer median.
  if (
    typeof req.membersServedThisMonth === "number" &&
    req.membersServedThisMonth > 0
  ) {
    const unitsPerMember = req.totalUnits / req.membersServedThisMonth;
    if (unitsPerMember > 3 * b.medianUnitsPerMember) {
      flags.push({
        patternId: "pattern.quantity-outlier",
        patternLabel: getFwaPattern("pattern.quantity-outlier")!.label,
        severity: getFwaPattern("pattern.quantity-outlier")!.defaultSeverity,
        reason: `units-per-member ${unitsPerMember.toFixed(2)} > 3× peer median ${b.medianUnitsPerMember}`
      });
    }
  }

  // Impossible-day: total service minutes across all claims for this
  // provider on this DOS > 24h (1440min).
  const dailyTotals = req.providerDailyServiceTotals ?? [];
  const forThisDate = dailyTotals.find((d) => d.date === req.dateOfService);
  if (forThisDate && forThisDate.totalServiceMinutes > 1440) {
    flags.push({
      patternId: "pattern.impossible-day-billing",
      patternLabel: getFwaPattern("pattern.impossible-day-billing")!.label,
      severity: getFwaPattern("pattern.impossible-day-billing")!.defaultSeverity,
      reason: `total service-minutes for ${req.dateOfService} = ${forThisDate.totalServiceMinutes} (> 24h)`
    });
  }

  // Phantom-service: no matching EHR encounter.
  if (req.hasMatchingEhrEncounter === false) {
    flags.push({
      patternId: "pattern.phantom-service",
      patternLabel: getFwaPattern("pattern.phantom-service")!.label,
      severity: getFwaPattern("pattern.phantom-service")!.defaultSeverity,
      reason:
        "claim references CPTs with no matching EHR encounter on this DOS for this member"
    });
  }

  return [...flags].sort((a, b) => a.patternId.localeCompare(b.patternId));
}

/** Pick the primary pattern (highest severity; lexical tie-break). */
export function summarizeFwaScreening(
  flags: readonly FwaFlag[]
): { decision: FwaDecision; primaryPatternId: string | null; primarySeverity: "low" | "medium" | "high" | null; routedTo: FwaRoute } {
  if (flags.length === 0) {
    return {
      decision: "clear",
      primaryPatternId: null,
      primarySeverity: null,
      routedTo: "clear-no-action"
    };
  }
  const sorted = [...flags].sort((a, b) => {
    if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) {
      return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    }
    return a.patternId.localeCompare(b.patternId);
  });
  const top = sorted[0];
  const routedTo: FwaRoute =
    top.severity === "high"
      ? "siu-priority-queue"
      : "siu-standard-queue";
  return {
    decision: "flag-for-siu-review",
    primaryPatternId: top.patternId,
    primarySeverity: top.severity,
    routedTo
  };
}

/** Deterministically produce the full screening report. */
export function screenClaim(req: FwaScreeningRequest): FwaScreeningReport {
  const flags = evaluateFwaPatterns(req);
  const { decision, primaryPatternId, primarySeverity, routedTo } =
    summarizeFwaScreening(flags);
  const note =
    decision === "clear"
      ? `Clear: no patterns fired on claim ${req.claimRef} from ${req.providerRef}.`
      : `${flags.length} pattern${flags.length === 1 ? "" : "s"} fired on claim ${req.claimRef} from ${req.providerRef}. Primary: ${primaryPatternId} (${primarySeverity}). Routed to ${routedTo} — FLAGGED for SIU review. The agent NEVER autonomously denies a claim, opens an investigation, or freezes payment. Synthetic — illustrative pattern catalog + refs, not certified FWA detection.`;
  return {
    requestRef: req.requestRef,
    providerRef: req.providerRef,
    claimRef: req.claimRef,
    memberRef: req.memberRef,
    asOfDate: req.asOfDate,
    decision,
    flags,
    primaryPatternId,
    primarySeverity,
    routedTo,
    requiresSiuReview: decision === "flag-for-siu-review",
    investigationOpened: false,
    paymentFrozen: false,
    synthetic: true,
    note
  };
}

/**
 * Pattern-catalog check: does every applied flag cite a pattern on
 * FWA_PATTERNS? True when every patternId is on the catalog. A non-array
 * input is a violation.
 */
export function patternsTraceToCatalog(
  flags: ReadonlyArray<{ patternId?: string }> | null | undefined
): boolean {
  if (!Array.isArray(flags)) return false;
  return flags.every((f) => isFwaPattern(f.patternId));
}

/**
 * SIU-review check: when the decision is flag-for-siu-review, the report
 * must be requiresSiuReview:true / investigationOpened:false /
 * paymentFrozen:false. When the decision is clear, the values must be
 * requiresSiuReview:false with the same investigationOpened + paymentFrozen
 * false. The guard against a caller-asserted investigationOpened:true or
 * paymentFrozen:true. A non-object input is a violation.
 */
export function reportRequiresSiuReview(
  report:
    | {
        decision?: string;
        requiresSiuReview?: boolean;
        investigationOpened?: boolean;
        paymentFrozen?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!report || typeof report !== "object") return false;
  if (report.investigationOpened === true) return false;
  if (report.paymentFrozen === true) return false;
  if (report.decision === "flag-for-siu-review") {
    return report.requiresSiuReview === true;
  }
  if (report.decision === "clear") {
    return report.requiresSiuReview !== true;
  }
  return false;
}

/**
 * No-protected-class check: does the factor list avoid protected-class
 * attributes and provider-demographic proxies? True when every factor is
 * absent from PROTECTED_CLASS_ATTRIBUTES. The guard against a caller-
 * asserted provider-demographic proxy factor.
 */
export function noProtectedClassFactors(
  factorsInUse: readonly string[] | null | undefined
): boolean {
  if (!Array.isArray(factorsInUse)) return false;
  return factorsInUse.every((f) => !isProtectedClassAttribute(f));
}

/** Clear demo — a routine claim from a clean provider. */
export const DEMO_CLEAR_REQUEST: FwaScreeningRequest = {
  requestRef: "fwa-req-2026-07-001",
  providerRef: "provider-002",
  claimRef: "claim-2026-07-100",
  memberRef: "member-001",
  asOfDate: "2026-07-05",
  dateOfService: "2026-07-04",
  lines: [
    { lineId: "l1", cptCode: "99213", units: 1, serviceMinutes: 25 }
  ],
  emLevel: 3,
  totalUnits: 1,
  membersServedThisMonth: 40,
  providerBaseline: {
    medianUnitsPerMember: 1,
    medianEmLevel: 3,
    hasRepeatedUnbundlingHistory: false,
    hasRepeatedDuplicateHistory: false
  },
  priorSubmissions: [],
  providerDailyServiceTotals: [{ date: "2026-07-04", totalServiceMinutes: 400 }],
  hasMatchingEhrEncounter: true
};

/** Upcoding demo — E/M 5 vs peer median 3. */
export const DEMO_UPCODING_REQUEST: FwaScreeningRequest = {
  requestRef: "fwa-req-2026-07-002",
  providerRef: "provider-003",
  claimRef: "claim-2026-07-101",
  memberRef: "member-002",
  asOfDate: "2026-07-05",
  dateOfService: "2026-07-04",
  lines: [{ lineId: "l1", cptCode: "99215", units: 1, serviceMinutes: 40 }],
  emLevel: 5,
  totalUnits: 1,
  membersServedThisMonth: 30,
  providerBaseline: {
    medianUnitsPerMember: 1,
    medianEmLevel: 3,
    hasRepeatedUnbundlingHistory: false,
    hasRepeatedDuplicateHistory: false
  },
  priorSubmissions: [],
  providerDailyServiceTotals: [{ date: "2026-07-04", totalServiceMinutes: 300 }],
  hasMatchingEhrEncounter: true
};

/** Impossible-day demo — >24h of service time across all claims. */
export const DEMO_IMPOSSIBLE_DAY_REQUEST: FwaScreeningRequest = {
  requestRef: "fwa-req-2026-07-003",
  providerRef: "provider-004",
  claimRef: "claim-2026-07-102",
  memberRef: "member-003",
  asOfDate: "2026-07-05",
  dateOfService: "2026-07-04",
  lines: [{ lineId: "l1", cptCode: "99213", units: 1, serviceMinutes: 25 }],
  emLevel: 3,
  totalUnits: 1,
  membersServedThisMonth: 25,
  providerBaseline: {
    medianUnitsPerMember: 1,
    medianEmLevel: 3,
    hasRepeatedUnbundlingHistory: false,
    hasRepeatedDuplicateHistory: false
  },
  priorSubmissions: [],
  providerDailyServiceTotals: [
    // 26 hours of billed service time on 2026-07-04 across all claims.
    { date: "2026-07-04", totalServiceMinutes: 1560 }
  ],
  hasMatchingEhrEncounter: true
};

/** Phantom-service demo — claim with no matching EHR encounter. */
export const DEMO_PHANTOM_SERVICE_REQUEST: FwaScreeningRequest = {
  requestRef: "fwa-req-2026-07-004",
  providerRef: "provider-005",
  claimRef: "claim-2026-07-103",
  memberRef: "member-004",
  asOfDate: "2026-07-05",
  dateOfService: "2026-07-04",
  lines: [{ lineId: "l1", cptCode: "99214", units: 1, serviceMinutes: 30 }],
  emLevel: 4,
  totalUnits: 1,
  membersServedThisMonth: 20,
  providerBaseline: {
    medianUnitsPerMember: 1,
    medianEmLevel: 3,
    hasRepeatedUnbundlingHistory: false,
    hasRepeatedDuplicateHistory: false
  },
  priorSubmissions: [],
  providerDailyServiceTotals: [{ date: "2026-07-04", totalServiceMinutes: 300 }],
  hasMatchingEhrEncounter: false
};

/** Multi-flag demo — history + duplicate + quantity outlier. */
export const DEMO_MULTI_FLAG_REQUEST: FwaScreeningRequest = {
  requestRef: "fwa-req-2026-07-005",
  providerRef: "provider-006",
  claimRef: "claim-2026-07-104",
  memberRef: "member-005",
  asOfDate: "2026-07-05",
  dateOfService: "2026-07-04",
  lines: [
    { lineId: "l1", cptCode: "99213", units: 15, serviceMinutes: 25 },
    { lineId: "l2", cptCode: "10001", units: 5 }
  ],
  emLevel: 3,
  totalUnits: 20,
  membersServedThisMonth: 5,
  providerBaseline: {
    medianUnitsPerMember: 1,
    medianEmLevel: 3,
    hasRepeatedUnbundlingHistory: true,
    hasRepeatedDuplicateHistory: false
  },
  priorSubmissions: [
    { claimRef: "prior-1", dateOfService: "2026-07-04", cptCode: "99213" }
  ],
  providerDailyServiceTotals: [{ date: "2026-07-04", totalServiceMinutes: 480 }],
  hasMatchingEhrEncounter: true
};
