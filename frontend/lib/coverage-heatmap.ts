/**
 * Coverage Heatmap / Difference-Array Range Accumulation — the deterministic, transparent care-coordination
 * layer that, given a set of staffing COVERAGE INTERVALS (each adding some number of staff over a contiguous
 * window of time slots) and a REQUIRED MINIMUM staffing level, computes the CONCURRENT coverage at every slot and
 * flags the UNDER-STAFFED slots (those below the required minimum) — without ever scheduling, adjusting, or
 * dispatching a single staff member on its own. A staffing manager confirms.
 *
 * Deterministic, dependency-free domain core the Coverage Heatmap agent (app/api/agents/coverage-heatmap) wraps —
 * a capacity-visibility agent on the care-coordination plane of Pause's Agent Fabric. CRUCIALLY, the heart of
 * this service is the DIFFERENCE ARRAY (the imos / range-update technique): to add `staff` to every slot in
 * [start, end), increment diff[start] by staff and decrement diff[end] by staff — an O(1) range update — then a
 * single PREFIX-SUM pass over the difference array materializes the concurrent coverage at every slot in O(T).
 * Applying m overlapping intervals costs O(m + T) total, not O(m·T). This is a genuinely NEW computation pattern
 * for the fabric: it is NOT the Fenwick / Benefit Accumulator agent's POINT-UPDATE + PREFIX-QUERY tree (the dual
 * problem — this is RANGE-UPDATE + full MATERIALIZE), NOT the Schedule Conflict agent's GREEDY INTERVAL SELECTION
 * (which picks a max non-overlapping subset — this COUNTS overlaps per slot), NOT the Peak-Window agent's KADANE
 * MAXIMUM-SUBARRAY (a max contiguous sum — this is per-slot occupancy), NOT the Caseload Balancing agent's
 * BIN-PACKING, and NOT the Batch Partition agent's LINEAR PARTITION — it is difference-array range accumulation.
 * The per-slot concurrent coverage is the invariant this service reports and defends.
 *
 *   Inbound:  a CoverageHeatmapRequest { scheduleRef, slotCount, requiredMin, intervals[] }  (intervals: { label, start, end, staff })
 *   Outbound: a CoverageHeatmapDetermination { coverage[], understaffedSlots[], minCoverage, maxCoverage,
 *             requiredMin, slotCount, intervalCount, disposition, requiresManagerReview:true, autoStaffed:false,
 *             reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the coverage is sourced and self-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  A heatmap is trustworthy only if the reported per-slot coverage is the TRUE count of staff covering each slot:
 *  coverage[t] must equal the sum of `staff` over every submitted interval whose [start, end) contains t (checked
 *  by DIRECT interval counting — independent of the difference-array method), the reported understaffedSlots must
 *  be exactly the slots below requiredMin, minCoverage / maxCoverage honest, slotCount / intervalCount honest,
 *  and the disposition following (fully-covered iff no slot is below requiredMin). A fabricated coverage value, a
 *  mis-listed under-staffed slot, or a dishonest min/max corrupts the heatmap. coverageSourced() verifies it; the
 *  Agent Fabric enforces it via policy.coverageheat.coverage-sourced. It does NOT use the difference-array
 *  materialization — that is the accumulation gate's job — so the two are independent computations of the same
 *  truth. (The sourced + self-consistency gate — mirrors the Benefit Accumulator Agent's ledger-sourced and the
 *  Interpreter Assignment Agent's assignment-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the accumulation is exact (the difference array re-materializes).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-applying the intervals to a fresh difference array and prefix-summing must reproduce the reported coverage
 *  array exactly, slot for slot. A heatmap whose materialized coverage doesn't match the difference-array
 *  computation would mis-state where the gaps are. accumulationExact() re-runs the difference-array range
 *  accumulation INDEPENDENT of the reported coverage (and of the sourced gate's direct counting), so a fabricated
 *  coverage that still reports the right under-staffed slots fails accumulation, and a genuine-but-mislabeled
 *  disposition fails sourced — the two gates are isolable and cross-check the same per-slot truth by two
 *  different methods. The Agent Fabric enforces it via policy.coverageheat.accumulation-exact. (The load-bearing
 *  correctness gate — mirrors the Benefit Accumulator Agent's accumulator-exact and the Interpreter Assignment
 *  Agent's cost-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous staffing.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent VISUALIZES on paper — it never schedules, adjusts, or dispatches staff on its own (each is a
 *  staffing action that must be authorized); every heatmap is a RECOMMENDATION requiring a staffing manager to
 *  confirm before any coverage changes. noAutonomousStaff() reports the honest signal the Agent Fabric enforces
 *  via policy.coverageheat.no-autonomous-staff. (Mirrors the Interpreter Assignment Agent's no-autonomous-dispatch
 *  and the Benefit Accumulator Agent's no-autonomous-adjust — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A heatmap — fully-covered or understaffed — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresManagerReview:true, autoStaffed:false). An understaffed disposition is NOT a governance block — it is
 *  the honest finding that some slot is below the required minimum (surfacing the gap is the whole point). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (a fabricated coverage array, a
 *  mis-materialized heatmap, or an autonomous staffing action) — which the Agent Fabric rejects before it can
 *  leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified workforce-management / staffing system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real staffing weighs skill mix, acuity-adjusted ratios, licensure, breaks & meal relief, union rules, and
 *  float pools — not a bare count of overlapping intervals. This accumulates the supplied illustrative intervals
 *  only. TIME IS DATA: the intervals + slot indices are plain numbers and the heatmap is a pure function of them
 *  (no real clock, no randomness), so the same request always yields the same determination, which is what lets
 *  the demo, the seeded trace, and the tests agree. The schedule is a clearly-labeled ILLUSTRATIVE synthetic. The
 *  intervals reference care-unit staffing, so a determination is treated as PHI-adjacent and the agent is on the
 *  HIPAA audit path.
 */

/** One coverage interval: `staff` staff members present over slots [start, end). */
export type CoverageInterval = {
  label: string;
  /** Inclusive start slot index (0-based). */
  start: number;
  /** Exclusive end slot index. */
  end: number;
  /** Number of staff this interval contributes across its window. Non-negative. */
  staff: number;
};

/** A request: the number of slots, the required minimum, and the coverage intervals. */
export type CoverageHeatmapRequest = {
  scheduleRef: string;
  /** Total number of time slots (the heatmap has this many columns). */
  slotCount: number;
  /** Required minimum concurrent staff at every slot. */
  requiredMin: number;
  intervals: CoverageInterval[];
};

export type CoverageHeatmapDisposition = "fully-covered" | "understaffed";

/** The deterministic finding the agent returns. */
export type CoverageHeatmapDetermination = {
  scheduleRef: string;
  intervals: CoverageInterval[];
  slotCount: number;
  requiredMin: number;
  /** Concurrent staff coverage at each slot [0, slotCount). */
  coverage: number[];
  /** Slot indices whose coverage is below requiredMin, ascending. */
  understaffedSlots: number[];
  minCoverage: number;
  maxCoverage: number;
  intervalCount: number;
  disposition: CoverageHeatmapDisposition;
  /** Always true — a staffing manager confirms every heatmap. */
  requiresManagerReview: true;
  /** Always false — the agent never autonomously schedules staff. */
  autoStaffed: false;
  reason: string;
  synthetic: true;
  note: string;
};

/** Clamp an interval to [0, slotCount) and return its effective [start, end) or null if empty. */
function clampInterval(iv: CoverageInterval, slotCount: number): { start: number; end: number } | null {
  const start = Math.max(0, Math.floor(iv.start));
  const end = Math.min(slotCount, Math.floor(iv.end));
  if (end <= start) return null;
  return { start, end };
}

/**
 * DIFFERENCE ARRAY (imos) range accumulation — the heart of the service. For each interval, add `staff` at
 * diff[start] and subtract it at diff[end] (an O(1) range update); a single prefix-sum pass materializes the
 * concurrent coverage at every slot. Pure — a function of the intervals + slotCount.
 */
export function accumulateCoverage(intervals: CoverageInterval[], slotCount: number): number[] {
  const n = Math.max(0, Math.floor(slotCount));
  if (n === 0) return [];
  const diff = new Array<number>(n + 1).fill(0);
  for (const iv of Array.isArray(intervals) ? intervals : []) {
    const staff = Math.max(0, Math.floor(iv.staff));
    if (staff === 0) continue;
    const clamped = clampInterval(iv, n);
    if (!clamped) continue;
    diff[clamped.start] += staff;
    diff[clamped.end] -= staff;
  }
  const coverage = new Array<number>(n).fill(0);
  let running = 0;
  for (let t = 0; t < n; t++) {
    running += diff[t];
    coverage[t] = running;
  }
  return coverage;
}

/**
 * The DIRECT (independent) per-slot coverage: for each slot, sum `staff` over every interval whose clamped
 * [start, end) contains it. O(m·T) — deliberately NOT the difference-array method, so the sourced gate can
 * cross-check the accumulation gate by a different computation of the same truth. Pure.
 */
export function coverageByDirectCount(intervals: CoverageInterval[], slotCount: number): number[] {
  const n = Math.max(0, Math.floor(slotCount));
  const coverage = new Array<number>(n).fill(0);
  for (const iv of Array.isArray(intervals) ? intervals : []) {
    const staff = Math.max(0, Math.floor(iv.staff));
    if (staff === 0) continue;
    const clamped = clampInterval(iv, n);
    if (!clamped) continue;
    for (let t = clamped.start; t < clamped.end; t++) coverage[t] += staff;
  }
  return coverage;
}

/**
 * The deterministic heatmap function — DETERMINISTIC: a pure function of the request's own intervals + slotCount
 * + requiredMin (no randomness, no clock). It materializes the coverage via the difference array, finds the
 * under-staffed slots, reads off min/max, and derives the disposition. Nothing is scheduled — the heatmap is
 * handed to a staffing manager.
 */
export function evaluateCoverageHeatmap(request: CoverageHeatmapRequest): CoverageHeatmapDetermination {
  const intervals = Array.isArray(request.intervals) ? request.intervals : [];
  const slotCount = Math.max(0, Math.floor(request.slotCount));
  const requiredMin = Math.max(0, Math.floor(request.requiredMin));
  const coverage = accumulateCoverage(intervals, slotCount);
  const understaffedSlots: number[] = [];
  for (let t = 0; t < coverage.length; t++) {
    if (coverage[t] < requiredMin) understaffedSlots.push(t);
  }
  const minCoverage = coverage.length > 0 ? Math.min(...coverage) : 0;
  const maxCoverage = coverage.length > 0 ? Math.max(...coverage) : 0;
  const disposition: CoverageHeatmapDisposition =
    understaffedSlots.length === 0 ? "fully-covered" : "understaffed";

  const reason =
    disposition === "fully-covered"
      ? `All ${slotCount} slot(s) of ${request.scheduleRef} meet the required minimum of ${requiredMin} staff (coverage ${minCoverage}–${maxCoverage}).`
      : `${understaffedSlots.length} of ${slotCount} slot(s) of ${request.scheduleRef} are below the required minimum of ${requiredMin} staff (slots ${understaffedSlots.join(", ")}; coverage dips to ${minCoverage}). Add coverage on those slots.`;

  return {
    scheduleRef: request.scheduleRef,
    intervals,
    slotCount,
    requiredMin,
    coverage,
    understaffedSlots,
    minCoverage,
    maxCoverage,
    intervalCount: intervals.length,
    disposition,
    requiresManagerReview: true,
    autoStaffed: false,
    reason,
    synthetic: true,
    note:
      `Coverage heatmap ${request.scheduleRef}: ${disposition.toUpperCase()} — ` +
      `${slotCount} slot(s), ${intervals.length} interval(s), required min ${requiredMin}, coverage ${minCoverage}–${maxCoverage}` +
      (understaffedSlots.length > 0 ? ` (${understaffedSlots.length} under-staffed) ` : " ") +
      "via DIFFERENCE-ARRAY RANGE ACCUMULATION. Real staffing weighs skill mix, acuity-adjusted ratios, licensure, breaks & meal relief, union rules, and float pools — not a bare count of overlapping intervals. Synthetic/illustrative intervals — NOT a certified workforce-management / staffing system. The agent never schedules, adjusts, or dispatches staff on its own — a staffing manager confirms every heatmap. Intervals reference care-unit staffing, so a determination is PHI-adjacent and on the HIPAA audit path."
  };
}

/**
 * Sourced + self-consistency check: is the reported coverage the TRUE per-slot staff count? Recomputed by DIRECT
 * interval counting (independent of the difference-array method): coverage[t] must equal the sum of `staff` over
 * every submitted interval whose clamped window contains t; the understaffedSlots must be exactly the slots below
 * requiredMin; minCoverage / maxCoverage / slotCount / intervalCount honest; and the disposition following.
 * Catches a fabricated coverage value, a mis-listed under-staffed slot, or a dishonest min/max. Does NOT use the
 * difference-array materialization (that is the accumulation gate's job), so the two gates cross-check the same
 * truth by different methods. Anything evaluateCoverageHeatmap() produces satisfies it. This is the honest signal
 * the heatmap reports to policy.coverageheat.coverage-sourced. A non-object / malformed input is a violation.
 */
export function coverageSourced(
  decision:
    | {
        intervals?: unknown;
        slotCount?: unknown;
        requiredMin?: unknown;
        coverage?: unknown;
        understaffedSlots?: unknown;
        minCoverage?: unknown;
        maxCoverage?: unknown;
        intervalCount?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const intervals = Array.isArray(decision.intervals) ? (decision.intervals as CoverageInterval[]) : null;
  const coverage = Array.isArray(decision.coverage) ? (decision.coverage as number[]) : null;
  if (!intervals || !coverage) return false;
  if (typeof decision.slotCount !== "number" || typeof decision.requiredMin !== "number") return false;
  for (const iv of intervals) {
    if (
      !iv ||
      typeof iv.label !== "string" ||
      typeof iv.start !== "number" ||
      typeof iv.end !== "number" ||
      typeof iv.staff !== "number" ||
      !Number.isFinite(iv.staff)
    ) {
      return false;
    }
  }
  const slotCount = Math.max(0, Math.floor(decision.slotCount));
  const requiredMin = Math.max(0, Math.floor(decision.requiredMin));
  if (coverage.length !== slotCount) return false;
  for (const c of coverage) if (typeof c !== "number" || !Number.isFinite(c)) return false;

  // Direct recompute of the per-slot coverage.
  const expected = coverageByDirectCount(intervals, slotCount);
  for (let t = 0; t < slotCount; t++) {
    if (coverage[t] !== expected[t]) return false;
  }

  // Under-staffed slots must be exactly the below-min slots, ascending.
  const expectedUnder: number[] = [];
  for (let t = 0; t < slotCount; t++) if (expected[t] < requiredMin) expectedUnder.push(t);
  const reportedUnder = Array.isArray(decision.understaffedSlots)
    ? (decision.understaffedSlots as number[])
    : null;
  if (reportedUnder) {
    if (reportedUnder.length !== expectedUnder.length) return false;
    for (let i = 0; i < expectedUnder.length; i++) if (reportedUnder[i] !== expectedUnder[i]) return false;
  }

  const minC = expected.length > 0 ? Math.min(...expected) : 0;
  const maxC = expected.length > 0 ? Math.max(...expected) : 0;
  if (decision.minCoverage !== undefined && decision.minCoverage !== minC) return false;
  if (decision.maxCoverage !== undefined && decision.maxCoverage !== maxC) return false;
  if (decision.intervalCount !== undefined && decision.intervalCount !== intervals.length) return false;

  const expectedDisposition: CoverageHeatmapDisposition =
    expectedUnder.length === 0 ? "fully-covered" : "understaffed";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * Accumulation-exactness check: re-applying the intervals to a fresh DIFFERENCE ARRAY and prefix-summing must
 * reproduce the reported coverage array exactly, slot for slot. True only when the recompute agrees. Catches a
 * mis-materialized heatmap. The load-bearing correctness gate — it re-runs the difference-array range
 * accumulation INDEPENDENT of the reported coverage (and of the sourced gate's direct counting), so the two
 * gates cross-check the same per-slot truth by two different methods; a fabricated coverage that still reports
 * the right under-staffed slots fails accumulation while a genuine-but-mislabeled disposition fails sourced.
 * Anything evaluateCoverageHeatmap() produces satisfies it. A non-object input is a violation.
 */
export function accumulationExact(
  decision:
    | { intervals?: unknown; slotCount?: unknown; coverage?: unknown }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const intervals = Array.isArray(decision.intervals) ? (decision.intervals as CoverageInterval[]) : null;
  const coverage = Array.isArray(decision.coverage) ? (decision.coverage as number[]) : null;
  if (!intervals || !coverage) return false;
  if (typeof decision.slotCount !== "number") return false;
  for (const iv of intervals) {
    if (
      !iv ||
      typeof iv.start !== "number" ||
      typeof iv.end !== "number" ||
      typeof iv.staff !== "number" ||
      !Number.isFinite(iv.staff)
    ) {
      return false;
    }
  }
  const slotCount = Math.max(0, Math.floor(decision.slotCount));
  const materialized = accumulateCoverage(intervals, slotCount);
  if (coverage.length !== materialized.length) return false;
  for (let t = 0; t < materialized.length; t++) {
    if (coverage[t] !== materialized[t]) return false;
  }
  return true;
}

/**
 * No-autonomous-staffing check: did the agent avoid scheduling / dispatching on its own? True unless the
 * determination reports it auto-staffed (autoStaffed:true) or does not require manager review
 * (requiresManagerReview:false). Anything evaluateCoverageHeatmap() produces satisfies it. This is the honest
 * signal the heatmap reports to policy.coverageheat.no-autonomous-staff. A non-object input is a violation.
 */
export function noAutonomousStaff(
  decision: { autoStaffed?: boolean; requiresManagerReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoStaffed === true) return false;
  if (decision.requiresManagerReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a heatmap. */
export function coverageHeatmapSummary(decision: CoverageHeatmapDetermination): {
  scheduleRef: string;
  disposition: CoverageHeatmapDisposition;
  slotCount: number;
  intervalCount: number;
  requiredMin: number;
  minCoverage: number;
  maxCoverage: number;
  understaffedCount: number;
  requiresManagerReview: boolean;
  synthetic: boolean;
} {
  return {
    scheduleRef: decision.scheduleRef,
    disposition: decision.disposition,
    slotCount: decision.slotCount,
    intervalCount: decision.intervalCount,
    requiredMin: decision.requiredMin,
    minCoverage: decision.minCoverage,
    maxCoverage: decision.maxCoverage,
    understaffedCount: decision.understaffedSlots.length,
    requiresManagerReview: decision.requiresManagerReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a 12-slot care-unit day with four overlapping coverage intervals against a
 * required minimum of 2. A midday dip leaves a couple of slots below 2. "Understaffed." Synthetic; PHI-adjacent
 * (care-unit staffing).
 *
 * Intervals: A[0,6) 2, B[4,10) 1, C[8,12) 2, D[2,4) 1 → coverage per slot computed in the tests.
 */
export const DEMO_COVERAGE_HEATMAP_REQUEST: CoverageHeatmapRequest = {
  scheduleRef: "care-unit-coverage-2026-4408",
  slotCount: 12,
  requiredMin: 2,
  intervals: [
    { label: "shift-A", start: 0, end: 6, staff: 2 },
    { label: "shift-B", start: 4, end: 10, staff: 1 },
    { label: "shift-C", start: 8, end: 12, staff: 2 },
    { label: "shift-D", start: 2, end: 4, staff: 1 }
  ]
};

/**
 * A representative demo request where the intervals blanket every slot at or above the required minimum.
 * "Fully-covered." Synthetic.
 */
export const DEMO_COVERAGE_HEATMAP_COVERED_REQUEST: CoverageHeatmapRequest = {
  scheduleRef: "care-unit-coverage-2026-4409",
  slotCount: 6,
  requiredMin: 2,
  intervals: [
    { label: "shift-early", start: 0, end: 6, staff: 2 },
    { label: "shift-boost", start: 0, end: 6, staff: 1 }
  ]
};

/**
 * A representative demo request with many overlapping short intervals — the difference-array technique shines
 * (O(m + T) vs O(m·T)). A single slot spikes while the edges dip below the minimum. "Understaffed." Synthetic.
 */
export const DEMO_COVERAGE_HEATMAP_SPIKE_REQUEST: CoverageHeatmapRequest = {
  scheduleRef: "care-unit-coverage-2026-4410",
  slotCount: 8,
  requiredMin: 3,
  intervals: [
    { label: "s1", start: 0, end: 8, staff: 1 },
    { label: "s2", start: 3, end: 5, staff: 3 },
    { label: "s3", start: 3, end: 5, staff: 1 },
    { label: "s4", start: 4, end: 4, staff: 5 }
  ]
};
