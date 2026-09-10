/**
 * Creditable Coverage Continuity — the deterministic, transparent payer-operations layer that takes a
 * member's COVERAGE SEGMENTS (each a start/end date from an employer, individual, or public plan),
 * MERGES the overlapping / adjacent ones into continuous spans, totals the covered days, and measures
 * the GAPS between spans — flagging a SIGNIFICANT BREAK in creditable coverage (a gap longer than the
 * threshold, 63 days by the HIPAA / ACA rule) — never autonomously ISSUING a creditable-coverage
 * determination, denying special enrollment, or imposing a late-enrollment penalty; an eligibility
 * reviewer confirms every determination.
 *
 * Deterministic, dependency-free domain core the Coverage Continuity Agent
 * (app/api/agents/coverage-continuity) wraps — a claims / payer-operations service on the payer & plan
 * operations plane of Pause's Agent Fabric. UNLIKE the Care Pathway agent's TOPOLOGICAL ORDERING, the
 * Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL
 * dollar waterfall, the OIG Exclusion agent's identity MATCHING, or the MLR Rebate agent's RATIO +
 * apportionment — and UNLIKE the DATE-DEADLINE agents (Timely Filing, Right of Access, Amendment) that
 * add N days to a single date — the heart of this service is INTERVAL MERGING + GAP DETECTION over a
 * set of date ranges. "Creditable coverage" is prior health coverage that counts toward waiting-period
 * / pre-existing-condition rules; a break longer than 63 days (a "significant break") resets it and can
 * trigger a special-enrollment loss or a Medicare Part D late-enrollment penalty.
 *
 *   Inbound:  a CoverageContinuityRequest { requestRef, memberRef, asOfDate, maxGapDays?, segments[] }
 *   Outbound: a CoverageContinuityDetermination { disposition, mergedSpans[], gaps[],
 *             totalCoveredDays, maxGapDays, hasSignificantBreak, segments[], requiresEligibilityReview:
 *             true, autoDetermined:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other payer-operations agents: distinct from the
 * Benefits Verification agent (is coverage active NOW), the Coordination of Benefits agent (the ORDER
 * of concurrent coverages), the Enrollment Reconciliation agent (employer-vs-carrier roster drift),
 * the Member Cost-Share agent (splitting a claim), and the MLR Rebate agent (a plan-year rebate): this
 * measures the CONTINUITY of a member's coverage OVER TIME — the merged span of their history and any
 * significant break in it.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every span is sourced — no fabricated coverage.
 * ─────────────────────────────────────────────────────────────────────
 *  A continuity determination is trustworthy only if every merged span traces to submitted segments —
 *  each span's boundaries must come from real segment boundaries, and no submitted segment may be
 *  dropped (every segment must fall within a merged span). Fabricated coverage (a span not backed by a
 *  segment) would wrongly certify continuity; dropped coverage would wrongly find a break.
 *  coverageSegmentsSourced() verifies every span's start / end resolves to a segment boundary and every
 *  segment is covered; it reports the honest signal the Agent Fabric enforces via
 *  policy.coverage.segments-sourced. (Mirrors the Care Pathway Agent's steps-sourced and the Drug
 *  Interaction Agent's interaction-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the coverage math is consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  The merged spans must be non-overlapping and ordered; the total covered days must equal the sum of
 *  the spans' inclusive lengths; each reported gap must equal the exact day distance between
 *  consecutive spans; and the significant-break flag must equal whether any gap exceeds the threshold.
 *  A miscounted covered-day total, a mis-measured gap, or a break flag that doesn't match the threshold
 *  drives a wrong creditable-coverage determination. coverageMathConsistent() recomputes the totals,
 *  the gaps, and the break flag from the spans; it reports the honest signal the Agent Fabric enforces
 *  via policy.coverage.math-consistent. (The load-bearing correctness gate — mirrors the Member
 *  Cost-Share Agent's math-consistent and the MLR Rebate Agent's allocation-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a coverage determination is never autonomously issued.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent MEASURES — it never ISSUES a creditable-coverage determination, denies a special
 *  enrollment, or imposes a late-enrollment penalty (each is a coverage decision that must be
 *  authorized); every determination is a RECOMMENDATION requiring an eligibility reviewer to confirm.
 *  coverageNoAutonomousDetermination() reports the honest signal the Agent Fabric enforces via
 *  policy.coverage.no-autonomous-determination. (Mirrors the Enrollment Reconciliation Agent's
 *  no-autonomous-change and the MLR Rebate Agent's no-autonomous-disbursement posture — the harmful
 *  action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — continuous coverage OR a significant break — is a SAFE, honest OUTPUT: the task
 *  COMPLETES (it carries requiresEligibilityReview:true, autoDetermined:false). A GOVERNANCE BLOCK is
 *  when a caller PRESENTS an offending DETERMINATION (one with a fabricated span, inconsistent
 *  coverage math, or an autonomously-issued / unreviewed determination) — which the Agent Fabric
 *  rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified creditable-coverage system.
 * ─────────────────────────────────────────────────────────────────────
 *  The segments + threshold below are clearly-labeled ILLUSTRATIVE synthetics chosen to model the
 *  SHAPE of a coverage-continuity analysis deterministically in the demo. Real creditable-coverage
 *  determination uses the certificate of creditable coverage, plan-specific rules, the full HIPAA /
 *  ACA / Medicare Part D frameworks, and the plan administrator's judgment. TIME IS DATA: the analysis
 *  is a pure function of the request's own segments + asOfDate — there is NO reliance on the real
 *  clock — so the same segments always yield the same spans + gaps + determination, which is what lets
 *  the demo, the seeded trace, and the tests agree.
 */

/** The HIPAA / ACA "significant break" threshold in creditable coverage: a gap longer than 63 days. */
export const DEFAULT_MAX_GAP_DAYS = 63;

/** A single coverage segment on a member's history. */
export type CoverageSegment = {
  /** The segment identifier. */
  segmentId: string;
  /** The coverage source, e.g. "employer-a" / "individual-market" / "medicaid". */
  source: string;
  /** Inclusive start date, ISO YYYY-MM-DD. */
  startDate: string;
  /** Inclusive end date, ISO YYYY-MM-DD. */
  endDate: string;
};

/** A creditable coverage continuity request. */
export type CoverageContinuityRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic member reference. */
  memberRef: string;
  /** The as-of date the analysis is anchored to, ISO YYYY-MM-DD (time-as-data; no real clock). */
  asOfDate: string;
  /** The significant-break threshold in days (defaults to DEFAULT_MAX_GAP_DAYS = 63). */
  maxGapDays?: number;
  /** The member's coverage segments. */
  segments: CoverageSegment[];
};

/** A merged, continuous coverage span (overlapping / adjacent segments collapsed). */
export type MergedSpan = {
  /** Inclusive start, epoch-day integer (days since 1970-01-01 UTC). */
  startDay: number;
  /** Inclusive end, epoch-day integer. */
  endDay: number;
  /** Inclusive start date, ISO. */
  startDate: string;
  /** Inclusive end date, ISO. */
  endDate: string;
  /** Inclusive covered days = endDay - startDay + 1. */
  coveredDays: number;
};

/** A gap between two consecutive merged spans. */
export type CoverageGap = {
  /** The index of the span the gap follows. */
  afterSpanIndex: number;
  /** The first uncovered date, ISO. */
  fromDate: string;
  /** The last uncovered date, ISO. */
  toDate: string;
  /** The gap length in days. */
  gapDays: number;
  /** Whether the gap exceeds maxGapDays (a significant break). */
  significant: boolean;
};

/** The disposition of a continuity determination. */
export type CoverageContinuityDisposition = "continuous" | "significant-break";

/** A validated, echoed segment carrying its epoch-day boundaries (for self-contained guards). */
export type EchoedSegment = CoverageSegment & { startDay: number; endDay: number };

/** The deterministic continuity determination the agent returns. */
export type CoverageContinuityDetermination = {
  requestRef: string;
  memberRef: string;
  asOfDate: string;
  disposition: CoverageContinuityDisposition;
  /** The merged, continuous coverage spans (sorted, non-overlapping). */
  mergedSpans: MergedSpan[];
  /** The gaps between consecutive spans. */
  gaps: CoverageGap[];
  /** The sum of the spans' inclusive covered days. */
  totalCoveredDays: number;
  /** The significant-break threshold applied. */
  maxGapDays: number;
  /** Whether any gap is a significant break. */
  hasSignificantBreak: boolean;
  /** The validated segments, echoed with epoch-day boundaries so the honesty guards are self-contained. */
  segments: EchoedSegment[];
  /** Any segments that could not be parsed (invalid / reversed dates). */
  invalidSegments: string[];
  /** Always true — an eligibility reviewer confirms every determination. */
  requiresEligibilityReview: true;
  /** Always false — the agent never autonomously issues a coverage determination. */
  autoDetermined: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the segments are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

const MS_PER_DAY = 86_400_000;

/** Parse an ISO YYYY-MM-DD date to an epoch-day integer (UTC), or null if invalid. */
export function toEpochDay(iso: string): number | null {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.floor(t / MS_PER_DAY);
}

/** Format an epoch-day integer back to an ISO YYYY-MM-DD date (UTC). */
export function fromEpochDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The deterministic continuity function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own segments + asOfDate (time is data; no real clock). It validates + parses the
 * segments to epoch-day intervals, SORTS them by start, MERGES overlapping / adjacent ones (a gap of 0
 * days — i.e. the next starts the day after the previous ends — still merges into one continuous span),
 * totals the inclusive covered days, measures the GAPS between consecutive spans, and flags a
 * SIGNIFICANT BREAK when a gap exceeds maxGapDays. Nothing is issued here — every determination is
 * handed to an eligibility reviewer.
 */
export function evaluateCoverageContinuity(
  request: CoverageContinuityRequest
): CoverageContinuityDetermination {
  const maxGapDays =
    typeof request.maxGapDays === "number" && Number.isFinite(request.maxGapDays) && request.maxGapDays >= 0
      ? Math.floor(request.maxGapDays)
      : DEFAULT_MAX_GAP_DAYS;

  const rawSegments = Array.isArray(request.segments) ? request.segments : [];
  const echoed: EchoedSegment[] = [];
  const invalidSegments: string[] = [];
  for (const s of rawSegments) {
    const startDay = s ? toEpochDay(s.startDate) : null;
    const endDay = s ? toEpochDay(s.endDate) : null;
    if (startDay === null || endDay === null || startDay > endDay) {
      if (s && typeof s.segmentId === "string") invalidSegments.push(s.segmentId);
      continue;
    }
    echoed.push({
      segmentId: s.segmentId,
      source: s.source,
      startDate: s.startDate,
      endDate: s.endDate,
      startDay,
      endDay
    });
  }

  // Sort by start day (then end day), then merge overlapping / adjacent intervals.
  const sorted = echoed.slice().sort((a, b) => (a.startDay !== b.startDay ? a.startDay - b.startDay : a.endDay - b.endDay));
  const mergedSpans: MergedSpan[] = [];
  for (const seg of sorted) {
    const last = mergedSpans[mergedSpans.length - 1];
    if (last && seg.startDay <= last.endDay + 1) {
      // Overlap or adjacency (gap of 0 days) → extend.
      if (seg.endDay > last.endDay) {
        last.endDay = seg.endDay;
        last.endDate = fromEpochDay(seg.endDay);
        last.coveredDays = last.endDay - last.startDay + 1;
      }
    } else {
      mergedSpans.push({
        startDay: seg.startDay,
        endDay: seg.endDay,
        startDate: fromEpochDay(seg.startDay),
        endDate: fromEpochDay(seg.endDay),
        coveredDays: seg.endDay - seg.startDay + 1
      });
    }
  }

  const totalCoveredDays = mergedSpans.reduce((n, s) => n + s.coveredDays, 0);

  const gaps: CoverageGap[] = [];
  for (let i = 0; i < mergedSpans.length - 1; i += 1) {
    const prev = mergedSpans[i];
    const next = mergedSpans[i + 1];
    const gapDays = next.startDay - prev.endDay - 1;
    if (gapDays > 0) {
      gaps.push({
        afterSpanIndex: i,
        fromDate: fromEpochDay(prev.endDay + 1),
        toDate: fromEpochDay(next.startDay - 1),
        gapDays,
        significant: gapDays > maxGapDays
      });
    }
  }

  const hasSignificantBreak = gaps.some((g) => g.significant);
  const disposition: CoverageContinuityDisposition = hasSignificantBreak
    ? "significant-break"
    : "continuous";

  const reason = hasSignificantBreak
    ? `Coverage for ${request.memberRef} has a significant break: a gap exceeds ${maxGapDays} days across ${mergedSpans.length} span(s).`
    : `Coverage for ${request.memberRef} is continuous within the ${maxGapDays}-day threshold: ${totalCoveredDays} covered day(s) across ${mergedSpans.length} span(s).`;

  return {
    requestRef: request.requestRef,
    memberRef: request.memberRef,
    asOfDate: request.asOfDate,
    disposition,
    mergedSpans,
    gaps,
    totalCoveredDays,
    maxGapDays,
    hasSignificantBreak,
    segments: echoed,
    invalidSegments,
    requiresEligibilityReview: true,
    autoDetermined: false,
    reason,
    synthetic: true,
    note:
      `Coverage continuity ${request.requestRef}: ${disposition.toUpperCase()} — ${totalCoveredDays} covered day(s) across ${mergedSpans.length} merged span(s), ${gaps.length} gap(s)${hasSignificantBreak ? " including a significant break" : ""} (threshold ${maxGapDays} days).` +
      (invalidSegments.length > 0 ? ` ${invalidSegments.length} segment(s) skipped as invalid.` : "") +
      " PHI-bearing — the segments reference the member's coverage history. Synthetic/illustrative segments — NOT a certified creditable-coverage system; real determination uses the certificate of creditable coverage, plan-specific rules, and the full HIPAA / ACA / Medicare Part D frameworks. The agent never issues a coverage determination on its own — an eligibility reviewer confirms every one."
  };
}

/**
 * Segments-sourced check: does every merged span trace to submitted segments, and is every segment
 * covered? True only when each span's start / end day matches a submitted segment boundary and every
 * segment falls within some span. Catches fabricated coverage (a span boundary not backed by a
 * segment) or a dropped segment. Anything evaluateCoverageContinuity() produces satisfies it. This is
 * the honest signal the route reports to policy.coverage.segments-sourced. A non-object / malformed
 * input is a violation.
 */
export function coverageSegmentsSourced(
  decision:
    | {
        mergedSpans?: Array<{ startDay?: number; endDay?: number }>;
        segments?: Array<{ startDay?: number; endDay?: number }>;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const spans = Array.isArray(decision.mergedSpans) ? decision.mergedSpans : null;
  const segs = Array.isArray(decision.segments) ? decision.segments : null;
  if (!spans || !segs) return false;

  const segStarts = new Set<number>();
  const segEnds = new Set<number>();
  for (const s of segs) {
    if (!s || typeof s.startDay !== "number" || typeof s.endDay !== "number") return false;
    segStarts.add(s.startDay);
    segEnds.add(s.endDay);
  }

  // Each span boundary must come from a real segment boundary.
  for (const sp of spans) {
    if (!sp || typeof sp.startDay !== "number" || typeof sp.endDay !== "number") return false;
    if (!segStarts.has(sp.startDay)) return false;
    if (!segEnds.has(sp.endDay)) return false;
  }

  // Every segment must fall within some span (no dropped coverage).
  for (const s of segs) {
    const within = spans.some(
      (sp) => (s.startDay as number) >= (sp.startDay as number) && (s.endDay as number) <= (sp.endDay as number)
    );
    if (!within) return false;
  }
  return true;
}

/**
 * Math-consistent check: are the covered-day total, the gaps, and the break flag all exact? True only
 * when the merged spans are ordered + non-overlapping (each start ≤ end, and strictly gapped from the
 * previous), the total covered days equals the sum of the spans' inclusive lengths, each reported gap
 * equals the exact distance between consecutive spans, and the significant-break flag equals whether
 * any gap exceeds maxGapDays. Catches a miscounted total, a mis-measured gap, or a break flag that
 * doesn't match the threshold. The load-bearing correctness gate. Anything
 * evaluateCoverageContinuity() produces satisfies it. This is the honest signal the route reports to
 * policy.coverage.math-consistent. A non-object input is a violation.
 */
export function coverageMathConsistent(
  decision:
    | {
        mergedSpans?: Array<{ startDay?: number; endDay?: number; coveredDays?: number }>;
        gaps?: Array<{ afterSpanIndex?: number; gapDays?: number; significant?: boolean }>;
        totalCoveredDays?: number;
        maxGapDays?: number;
        hasSignificantBreak?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const spans = Array.isArray(decision.mergedSpans) ? decision.mergedSpans : null;
  const gaps = Array.isArray(decision.gaps) ? decision.gaps : null;
  if (!spans || !gaps) return false;
  if (typeof decision.totalCoveredDays !== "number") return false;
  if (typeof decision.maxGapDays !== "number") return false;
  if (typeof decision.hasSignificantBreak !== "boolean") return false;

  // Spans ordered, non-overlapping, each start ≤ end, correct inclusive length.
  let total = 0;
  for (let i = 0; i < spans.length; i += 1) {
    const sp = spans[i];
    if (!sp || typeof sp.startDay !== "number" || typeof sp.endDay !== "number") return false;
    if (sp.startDay > sp.endDay) return false;
    if (sp.coveredDays !== sp.endDay - sp.startDay + 1) return false;
    total += sp.coveredDays;
    if (i > 0) {
      const prev = spans[i - 1];
      // Must be strictly after the previous span with a real (>0) gap (else they'd be merged).
      if ((sp.startDay as number) <= (prev.endDay as number) + 1) return false;
    }
  }
  if (total !== decision.totalCoveredDays) return false;

  // Recompute gaps from spans and compare.
  const expected: Array<{ afterSpanIndex: number; gapDays: number; significant: boolean }> = [];
  for (let i = 0; i < spans.length - 1; i += 1) {
    const gapDays = (spans[i + 1].startDay as number) - (spans[i].endDay as number) - 1;
    if (gapDays > 0) {
      expected.push({ afterSpanIndex: i, gapDays, significant: gapDays > decision.maxGapDays });
    }
  }
  if (gaps.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    const g = gaps[i];
    if (!g || g.afterSpanIndex !== expected[i].afterSpanIndex) return false;
    if (g.gapDays !== expected[i].gapDays) return false;
    if (g.significant !== expected[i].significant) return false;
  }

  if (decision.hasSignificantBreak !== expected.some((g) => g.significant)) return false;
  return true;
}

/**
 * No-autonomous-determination check: did the agent avoid autonomously issuing a coverage
 * determination? True unless the determination reports it autonomously issued (autoDetermined:true) or
 * does not require eligibility review (requiresEligibilityReview:false). Anything
 * evaluateCoverageContinuity() produces satisfies it. This is the honest signal the route reports to
 * policy.coverage.no-autonomous-determination. A non-object input is a violation.
 */
export function coverageNoAutonomousDetermination(
  decision:
    | { autoDetermined?: boolean; requiresEligibilityReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoDetermined === true) return false;
  if (decision.requiresEligibilityReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric trace +
 * the response `meta`.
 */
export function coverageContinuitySummary(decision: CoverageContinuityDetermination): {
  requestRef: string;
  memberRef: string;
  disposition: CoverageContinuityDisposition;
  spanCount: number;
  gapCount: number;
  totalCoveredDays: number;
  hasSignificantBreak: boolean;
  requiresEligibilityReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: decision.requestRef,
    memberRef: decision.memberRef,
    disposition: decision.disposition,
    spanCount: decision.mergedSpans.length,
    gapCount: decision.gaps.length,
    totalCoveredDays: decision.totalCoveredDays,
    hasSignificantBreak: decision.hasSignificantBreak,
    requiresEligibilityReview: decision.requiresEligibilityReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a member whose employer-A and employer-B coverage have a short (14-day)
 * gap — under the 63-day threshold, so coverage is CONTINUOUS. Synthetic.
 */
export const DEMO_COVERAGE_CONTINUITY_REQUEST: CoverageContinuityRequest = {
  requestRef: "cov-001",
  memberRef: "member-4821",
  asOfDate: "2025-01-15",
  segments: [
    { segmentId: "seg-a", source: "employer-a", startDate: "2024-01-01", endDate: "2024-06-30" },
    { segmentId: "seg-b", source: "employer-b", startDate: "2024-07-15", endDate: "2024-12-31" }
  ]
};

/**
 * A representative demo request: a member with a long (153-day) gap between coverage — over the 63-day
 * threshold, so it is a SIGNIFICANT BREAK. Synthetic.
 */
export const DEMO_COVERAGE_CONTINUITY_BREAK_REQUEST: CoverageContinuityRequest = {
  requestRef: "cov-002",
  memberRef: "member-7799",
  asOfDate: "2025-01-15",
  segments: [
    { segmentId: "seg-a", source: "employer-a", startDate: "2024-01-01", endDate: "2024-03-31" },
    { segmentId: "seg-b", source: "individual-market", startDate: "2024-09-01", endDate: "2024-12-31" }
  ]
};

/**
 * A representative demo request: two overlapping segments that MERGE into a single continuous span with
 * no gaps. Synthetic.
 */
export const DEMO_COVERAGE_CONTINUITY_OVERLAP_REQUEST: CoverageContinuityRequest = {
  requestRef: "cov-003",
  memberRef: "member-9001",
  asOfDate: "2025-01-15",
  segments: [
    { segmentId: "seg-a", source: "employer-a", startDate: "2024-01-01", endDate: "2024-08-31" },
    { segmentId: "seg-b", source: "cobra", startDate: "2024-06-01", endDate: "2024-12-31" }
  ]
};
