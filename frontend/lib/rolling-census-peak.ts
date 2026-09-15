/**
 * Rolling Census Peak / Sliding-Window Maximum (Monotonic Deque) — the deterministic, transparent
 * care-coordination layer that, given a series of per-slot CENSUS readings (occupancy counts over time) and a
 * trailing WINDOW width k, computes the PEAK census in every trailing window and flags the windows whose peak
 * exceeds a CAPACITY threshold — so a rising census can be seen before it breaches capacity — without ever
 * diverting admissions, triggering surge staffing, or acting on a peak on its own. A nursing supervisor confirms.
 *
 * Deterministic, dependency-free domain core the Rolling Census Peak agent (app/api/agents/rolling-census-peak)
 * wraps — a capacity-monitoring agent on the care-coordination plane of Pause's Agent Fabric. CRUCIALLY, the
 * heart of this service is the MONOTONIC DEQUE sliding-window maximum: maintain a double-ended queue of candidate
 * indices whose readings are in decreasing order; as the window advances, pop from the back every index whose
 * reading is ≤ the incoming reading (they can never again be a maximum), push the new index, and drop from the
 * front any index that has fallen out of the window — the front is always the window's maximum, giving O(1)
 * amortized per window and O(n) overall. This is a genuinely NEW computation pattern for the fabric: it is NOT
 * the Access Anomaly agent's SLIDING-WINDOW COUNTING (a fixed-window EVENT COUNT — this is the sliding-window
 * EXTREMUM via a monotonic deque), NOT the Coverage Heatmap agent's DIFFERENCE-ARRAY RANGE ACCUMULATION (per-slot
 * occupancy from range-adds — this is the rolling MAX over a window of an existing series), NOT the Peak-Window
 * agent's KADANE MAXIMUM-SUBARRAY (a max contiguous SUM — this is a max VALUE per fixed-width window), NOT the
 * Fenwick / Benefit Accumulator agent's PREFIX SUMS, and NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST
 * SCHEDULING — it is the sliding-window maximum. The per-window peak is the invariant this service reports and
 * defends.
 *
 *   Inbound:  a RollingCensusRequest { unitRef, windowSize, capacity, readings[] }
 *   Outbound: a RollingCensusDetermination { windowMaxes[], overCapacityWindows[], peakCensus, windowCount,
 *             windowSize, capacity, readingCount, disposition, requiresSupervisorReview:true,
 *             autoDiverted:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the windows are sourced and self-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  A census report is trustworthy only if the reported per-window maxima are the TRUE maxima of each trailing
 *  window: windowMaxes[i] must equal max(readings[i .. i + k - 1]) for every window (checked by DIRECT
 *  per-window scanning — independent of the monotonic-deque method), there must be exactly readingCount - k + 1
 *  windows (or zero when k > readingCount), the reported overCapacityWindows must be exactly the windows whose
 *  max exceeds capacity, peakCensus the overall maximum window peak, windowCount / readingCount honest, and the
 *  disposition following (over-capacity iff any window exceeds capacity). A fabricated window max, a mis-listed
 *  over-capacity window, or a dishonest peak corrupts the report. windowsSourced() verifies it; the Agent Fabric
 *  enforces it via policy.rollingcensus.windows-sourced. It does NOT use the monotonic-deque computation — that
 *  is the deque gate's job — so the two are independent computations of the same truth. (The sourced +
 *  self-consistency gate — mirrors the Coverage Heatmap Agent's coverage-sourced and the Benefit Accumulator
 *  Agent's ledger-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the deque is exact (the monotonic deque re-derives).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running the monotonic-deque sliding-window maximum over the submitted readings + window size must reproduce
 *  the reported windowMaxes array exactly, window for window. A report whose maxima don't match the deque
 *  computation would mis-state where the census peaks. dequeExact() re-runs the monotonic deque INDEPENDENT of
 *  the reported maxima (and of the sourced gate's direct scanning), so the two gates cross-check the same
 *  per-window truth by two different methods: a fabricated maxima array that still reports the right
 *  over-capacity windows fails deque, and a genuine-but-mislabeled disposition fails sourced. The Agent Fabric
 *  enforces it via policy.rollingcensus.deque-exact. (The load-bearing correctness gate — mirrors the Coverage
 *  Heatmap Agent's accumulation-exact and the Benefit Accumulator Agent's accumulator-exact.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous diversion.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent MONITORS on paper — it never diverts admissions, triggers surge staffing, or acts on a peak on its
 *  own (each is an operational action that must be authorized); every report is a RECOMMENDATION requiring a
 *  nursing supervisor to confirm. noAutonomousDivert() reports the honest signal the Agent Fabric enforces via
 *  policy.rollingcensus.no-autonomous-divert. (Mirrors the Coverage Heatmap Agent's no-autonomous-staff and the
 *  Interpreter Assignment Agent's no-autonomous-dispatch — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A report — within-capacity or over-capacity — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresSupervisorReview:true, autoDiverted:false). An over-capacity disposition is NOT a governance block —
 *  it is the honest finding that a window's peak breaches capacity (surfacing the breach is the whole point). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (a fabricated maxima array, a
 *  mis-derived deque, or an autonomous diversion) — which the Agent Fabric rejects before it can leave the
 *  fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified capacity-management / patient-flow system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real census management weighs acuity, staffed vs licensed beds, isolation & telemetry needs, anticipated
 *  discharges, and boarding — not a bare rolling max over illustrative counts. This scans the supplied
 *  illustrative readings only. TIME IS DATA: the readings + window size are plain numbers and the report is a
 *  pure function of them (no real clock, no randomness), so the same request always yields the same
 *  determination, which is what lets the demo, the seeded trace, and the tests agree. The readings are a
 *  clearly-labeled ILLUSTRATIVE synthetic. The census references a care unit's occupancy, so a determination is
 *  treated as PHI-adjacent and the agent is on the HIPAA audit path.
 */

/** A request: the window width, the capacity threshold, and the per-slot census readings. */
export type RollingCensusRequest = {
  unitRef: string;
  /** Trailing window width k (number of slots per window). */
  windowSize: number;
  /** Capacity threshold — a window whose peak exceeds this is over-capacity. */
  capacity: number;
  /** Per-slot census (occupancy) readings, in time order. Non-negative. */
  readings: number[];
};

export type RollingCensusDisposition = "within-capacity" | "over-capacity";

/** The deterministic finding the agent returns. */
export type RollingCensusDetermination = {
  unitRef: string;
  readings: number[];
  windowSize: number;
  capacity: number;
  /** Peak census in each trailing window; windowMaxes[i] = max(readings[i .. i+k-1]). */
  windowMaxes: number[];
  /** Window start-indices whose peak exceeds capacity, ascending. */
  overCapacityWindows: number[];
  /** The overall maximum window peak (0 when there are no windows). */
  peakCensus: number;
  windowCount: number;
  readingCount: number;
  disposition: RollingCensusDisposition;
  /** Always true — a nursing supervisor confirms every report. */
  requiresSupervisorReview: true;
  /** Always false — the agent never autonomously diverts admissions. */
  autoDiverted: false;
  reason: string;
  synthetic: true;
  note: string;
};

/**
 * MONOTONIC DEQUE sliding-window maximum — the heart of the service. Maintain a deque of candidate indices whose
 * readings are strictly decreasing front-to-back: pop from the back every index whose reading is ≤ the incoming
 * reading, push the new index, drop the front once it falls out of the window; once the first window is full the
 * front is that window's maximum. O(n) overall. Pure — a function of the readings + window size. Returns [] when
 * k <= 0 or k > n.
 */
export function slidingWindowMax(readings: number[], windowSize: number): number[] {
  const n = Array.isArray(readings) ? readings.length : 0;
  const k = Math.floor(windowSize);
  if (k <= 0 || k > n) return [];
  const deque: number[] = []; // indices, readings[deque[*]] decreasing
  const maxes: number[] = [];
  for (let i = 0; i < n; i++) {
    // Drop back indices with a reading <= the incoming reading.
    while (deque.length > 0 && readings[deque[deque.length - 1]] <= readings[i]) {
      deque.pop();
    }
    deque.push(i);
    // Drop the front once it's outside the window [i-k+1, i].
    if (deque[0] <= i - k) deque.shift();
    // Once the first full window closes, record the front (the window max).
    if (i >= k - 1) maxes.push(readings[deque[0]]);
  }
  return maxes;
}

/**
 * The DIRECT (independent) per-window maxima: for each window start i in [0, n-k], scan readings[i .. i+k-1] and
 * take the max. O(n·k) — deliberately NOT the deque method, so the sourced gate can cross-check the deque gate by
 * a different computation of the same truth. Pure.
 */
export function windowMaxesByDirectScan(readings: number[], windowSize: number): number[] {
  const n = Array.isArray(readings) ? readings.length : 0;
  const k = Math.floor(windowSize);
  if (k <= 0 || k > n) return [];
  const maxes: number[] = [];
  for (let i = 0; i + k <= n; i++) {
    let m = readings[i];
    for (let j = i + 1; j < i + k; j++) if (readings[j] > m) m = readings[j];
    maxes.push(m);
  }
  return maxes;
}

/**
 * The deterministic census-report function — DETERMINISTIC: a pure function of the request's own readings +
 * window size + capacity (no randomness, no clock). It computes the per-window peaks via the monotonic deque,
 * flags over-capacity windows, reads off the overall peak, and derives the disposition. Nothing is diverted — the
 * report is handed to a nursing supervisor.
 */
export function evaluateRollingCensus(request: RollingCensusRequest): RollingCensusDetermination {
  const readings = (Array.isArray(request.readings) ? request.readings : []).map((r) => Math.max(0, r));
  const windowSize = Math.max(0, Math.floor(request.windowSize));
  const capacity = Math.max(0, request.capacity);
  const windowMaxes = slidingWindowMax(readings, windowSize);
  const overCapacityWindows: number[] = [];
  for (let i = 0; i < windowMaxes.length; i++) {
    if (windowMaxes[i] > capacity) overCapacityWindows.push(i);
  }
  const peakCensus = windowMaxes.length > 0 ? Math.max(...windowMaxes) : 0;
  const disposition: RollingCensusDisposition =
    overCapacityWindows.length === 0 ? "within-capacity" : "over-capacity";

  const reason =
    disposition === "within-capacity"
      ? `All ${windowMaxes.length} trailing window(s) of ${request.unitRef} stay within the capacity of ${capacity} (peak census ${peakCensus}).`
      : `${overCapacityWindows.length} of ${windowMaxes.length} trailing window(s) of ${request.unitRef} peak above the capacity of ${capacity} (windows starting at ${overCapacityWindows.join(", ")}; peak census ${peakCensus}). Review capacity / diversion.`;

  return {
    unitRef: request.unitRef,
    readings,
    windowSize,
    capacity,
    windowMaxes,
    overCapacityWindows,
    peakCensus,
    windowCount: windowMaxes.length,
    readingCount: readings.length,
    disposition,
    requiresSupervisorReview: true,
    autoDiverted: false,
    reason,
    synthetic: true,
    note:
      `Rolling census peak ${request.unitRef}: ${disposition.toUpperCase()} — ` +
      `${readings.length} reading(s), window ${windowSize}, ${windowMaxes.length} window(s), capacity ${capacity}, peak ${peakCensus}` +
      (overCapacityWindows.length > 0 ? ` (${overCapacityWindows.length} over-capacity) ` : " ") +
      "via SLIDING-WINDOW MAXIMUM (monotonic deque). Real census management weighs acuity, staffed vs licensed beds, isolation & telemetry needs, anticipated discharges, and boarding — not a bare rolling max over illustrative counts. Synthetic/illustrative readings — NOT a certified capacity-management / patient-flow system. The agent never diverts admissions, triggers surge staffing, or acts on a peak on its own — a nursing supervisor confirms every report. The census references a care unit's occupancy, so a determination is PHI-adjacent and on the HIPAA audit path."
  };
}

/**
 * Sourced + self-consistency check: are the reported per-window maxima the TRUE maxima of each trailing window?
 * Recomputed by DIRECT per-window scanning (independent of the monotonic-deque method): windowMaxes[i] must equal
 * max(readings[i .. i+k-1]); there must be exactly readingCount - k + 1 windows (or zero when k > readingCount);
 * the overCapacityWindows must be exactly the windows whose max exceeds capacity; peakCensus, windowCount, and
 * readingCount honest; and the disposition following. Catches a fabricated window max, a mis-listed over-capacity
 * window, or a dishonest peak. Does NOT use the monotonic-deque computation (that is the deque gate's job), so
 * the two gates cross-check the same truth by different methods. Anything evaluateRollingCensus() produces
 * satisfies it. This is the honest signal the report gives policy.rollingcensus.windows-sourced. A non-object /
 * malformed input is a violation.
 */
export function windowsSourced(
  decision:
    | {
        readings?: unknown;
        windowSize?: unknown;
        capacity?: unknown;
        windowMaxes?: unknown;
        overCapacityWindows?: unknown;
        peakCensus?: unknown;
        windowCount?: unknown;
        readingCount?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const readings = Array.isArray(decision.readings) ? (decision.readings as number[]) : null;
  const windowMaxes = Array.isArray(decision.windowMaxes) ? (decision.windowMaxes as number[]) : null;
  if (!readings || !windowMaxes) return false;
  if (typeof decision.windowSize !== "number" || typeof decision.capacity !== "number") return false;
  for (const r of readings) if (typeof r !== "number" || !Number.isFinite(r) || r < 0) return false;
  for (const m of windowMaxes) if (typeof m !== "number" || !Number.isFinite(m)) return false;

  const k = Math.max(0, Math.floor(decision.windowSize));
  const capacity = Math.max(0, decision.capacity);

  // Direct recompute of per-window maxima.
  const expected = windowMaxesByDirectScan(readings, k);
  if (windowMaxes.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) if (windowMaxes[i] !== expected[i]) return false;

  // Over-capacity windows must be exactly the windows whose max exceeds capacity, ascending.
  const expectedOver: number[] = [];
  for (let i = 0; i < expected.length; i++) if (expected[i] > capacity) expectedOver.push(i);
  const reportedOver = Array.isArray(decision.overCapacityWindows)
    ? (decision.overCapacityWindows as number[])
    : null;
  if (reportedOver) {
    if (reportedOver.length !== expectedOver.length) return false;
    for (let i = 0; i < expectedOver.length; i++) if (reportedOver[i] !== expectedOver[i]) return false;
  }

  const peak = expected.length > 0 ? Math.max(...expected) : 0;
  if (decision.peakCensus !== undefined && decision.peakCensus !== peak) return false;
  if (decision.windowCount !== undefined && decision.windowCount !== expected.length) return false;
  if (decision.readingCount !== undefined && decision.readingCount !== readings.length) return false;

  const expectedDisposition: RollingCensusDisposition =
    expectedOver.length === 0 ? "within-capacity" : "over-capacity";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * Deque-exactness check: re-running the MONOTONIC DEQUE sliding-window maximum over the submitted readings +
 * window size must reproduce the reported windowMaxes array exactly, window for window. True only when the
 * recompute agrees. Catches a mis-derived maxima array. The load-bearing correctness gate — it re-runs the
 * monotonic deque INDEPENDENT of the reported maxima (and of the sourced gate's direct scanning), so the two
 * gates cross-check the same per-window truth by two different methods; a fabricated maxima array that still
 * reports the right over-capacity windows fails deque while a genuine-but-mislabeled disposition fails sourced.
 * Anything evaluateRollingCensus() produces satisfies it. A non-object input is a violation.
 */
export function dequeExact(
  decision:
    | { readings?: unknown; windowSize?: unknown; windowMaxes?: unknown }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const readings = Array.isArray(decision.readings) ? (decision.readings as number[]) : null;
  const windowMaxes = Array.isArray(decision.windowMaxes) ? (decision.windowMaxes as number[]) : null;
  if (!readings || !windowMaxes) return false;
  if (typeof decision.windowSize !== "number") return false;
  for (const r of readings) if (typeof r !== "number" || !Number.isFinite(r) || r < 0) return false;

  const materialized = slidingWindowMax(readings, Math.max(0, Math.floor(decision.windowSize)));
  if (windowMaxes.length !== materialized.length) return false;
  for (let i = 0; i < materialized.length; i++) if (windowMaxes[i] !== materialized[i]) return false;
  return true;
}

/**
 * No-autonomous-diversion check: did the agent avoid diverting / surging on its own? True unless the
 * determination reports it auto-diverted (autoDiverted:true) or does not require supervisor review
 * (requiresSupervisorReview:false). Anything evaluateRollingCensus() produces satisfies it. This is the honest
 * signal the report gives policy.rollingcensus.no-autonomous-divert. A non-object input is a violation.
 */
export function noAutonomousDivert(
  decision: { autoDiverted?: boolean; requiresSupervisorReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoDiverted === true) return false;
  if (decision.requiresSupervisorReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a report. */
export function rollingCensusSummary(decision: RollingCensusDetermination): {
  unitRef: string;
  disposition: RollingCensusDisposition;
  readingCount: number;
  windowSize: number;
  windowCount: number;
  capacity: number;
  peakCensus: number;
  overCapacityCount: number;
  requiresSupervisorReview: boolean;
  synthetic: boolean;
} {
  return {
    unitRef: decision.unitRef,
    disposition: decision.disposition,
    readingCount: decision.readingCount,
    windowSize: decision.windowSize,
    windowCount: decision.windowCount,
    capacity: decision.capacity,
    peakCensus: decision.peakCensus,
    overCapacityCount: decision.overCapacityWindows.length,
    requiresSupervisorReview: decision.requiresSupervisorReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: 10 hourly census readings on a care unit, a 3-hour trailing window, capacity
 * 18. A mid-shift surge pushes a couple of windows over capacity. "Over-capacity." Synthetic; PHI-adjacent (care
 * unit occupancy).
 *
 * Readings: [12,15,14,20,19,16,13,11,17,18] → 3-window maxes computed in the tests.
 */
export const DEMO_ROLLING_CENSUS_REQUEST: RollingCensusRequest = {
  unitRef: "care-unit-census-2026-5501",
  windowSize: 3,
  capacity: 18,
  readings: [12, 15, 14, 20, 19, 16, 13, 11, 17, 18]
};

/**
 * A representative demo request whose census never breaches capacity in any window. "Within-capacity." Synthetic.
 */
export const DEMO_ROLLING_CENSUS_WITHIN_REQUEST: RollingCensusRequest = {
  unitRef: "care-unit-census-2026-5502",
  windowSize: 4,
  capacity: 25,
  readings: [10, 12, 11, 14, 13, 12, 15, 14]
};

/**
 * A representative demo request that exercises the monotonic deque's back-eviction with a strictly-decreasing run
 * followed by a spike. "Over-capacity." Synthetic.
 */
export const DEMO_ROLLING_CENSUS_SPIKE_REQUEST: RollingCensusRequest = {
  unitRef: "care-unit-census-2026-5503",
  windowSize: 3,
  capacity: 9,
  readings: [9, 8, 7, 6, 5, 12, 4, 3]
};
