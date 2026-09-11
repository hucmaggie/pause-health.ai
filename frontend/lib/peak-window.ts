/**
 * Commercial Peak-Window / Maximum Contiguous Net-Gain Detection — the deterministic, transparent
 * commercial-analytics layer that, given a time-ordered series of a business metric's SIGNED per-period NET
 * CHANGE (net-new ARR = bookings − churn, net enrolled patients = adds − drops, net revenue delta), finds the
 * single MAXIMUM-SUM CONTIGUOUS WINDOW — the strongest sustained net-gain STRETCH — reporting its start / end
 * period, its summed net gain, and its length, or honestly reporting NO POSITIVE WINDOW when every contiguous
 * stretch nets a loss. It never commits the finding, adjusts a quota, or notifies finance. A revenue analyst
 * confirms.
 *
 * Deterministic, dependency-free domain core the Peak Window agent (app/api/agents/peak-window) wraps — a
 * commercial-analytics agent on the PHI-separated commercial plane of Pause's Agent Fabric. CRUCIALLY, this
 * is NOT the KPI Trend agent's ORDINARY LEAST-SQUARES LINEAR REGRESSION (which fits a best-fit line through
 * the points and PROJECTS it to a horizon — a fitted model + extrapolation), NOT the Quality Shift agent's
 * CUSUM CHANGE-POINT DETECTION (which accumulates a running deviation from a target to catch a SUSTAINED
 * shift), NOT the Access Anomaly agent's SLIDING-WINDOW COUNTING (which counts events in a FIXED-width window
 * as it slides), and NOT the Remote Patient Monitoring agent's WINDOW-VS-BASELINE trend classification (which
 * compares a recent window to a baseline window). It is also UNLIKE the Resource Scheduling agent's WEIGHTED
 * INTERVAL SCHEDULING, the Care Routing agent's DIJKSTRA'S SHORTEST PATH, the Outreach agent's 0/1 KNAPSACK,
 * the Source Consensus agent's MAJORITY VOTE, the Code Taxonomy agent's TRIE LONGEST-PREFIX MATCH, the
 * Timeline Merge agent's K-WAY MERGE, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the
 * Household Composition agent's UNION-FIND, or the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM.
 * The heart of this service is KADANE'S MAXIMUM-SUBARRAY algorithm: a single linear scan carrying a running
 * sum that RESETS whenever extending the previous stretch would do worse than starting fresh at the current
 * period (curSum = max(x_i, curSum + x_i)), tracking the best window seen — the maximum-sum contiguous
 * subarray in O(n), no fixed window width, no fitted model. A fixed-width or whole-series average hides the
 * true peak run; Kadane finds the exact contiguous window that maximizes net gain. So this detects
 * DETERMINISTICALLY and hands the window to a human.
 *
 *   Inbound:  a PeakWindowRequest { seriesRef, series[] }  (each period a label + a signed net value)
 *   Outbound: a PeakWindowDetermination { startIndex, endIndex, windowSum, windowLength, hasPositiveWindow,
 *             disposition, requiresAnalystReview:true, autoActioned:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the window is sourced and self-honest.
 * ─────────────────────────────────────────────────────────────────────
 *  A reported window is trustworthy only if it is a REAL contiguous sub-range of the submitted series
 *  (0 <= start <= end < n), its reported length matches (end − start + 1), and its reported windowSum equals
 *  the ACTUAL sum of the series over that range — with hasPositiveWindow / disposition following the sum's
 *  sign. A window that runs off the end of the series, or that overstates its own sum, is a fabricated
 *  finding. windowSourced() verifies it; the Agent Fabric enforces it via policy.peak-window.window-sourced.
 *  It does NOT recompute Kadane's optimum — that is the optimality gate's job — so the two are isolable. (The
 *  sourced + self-honesty gate — mirrors the Care Routing Agent's path-sourced and the Resource Scheduling
 *  Agent's selection-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the window is optimal (Kadane recomputes).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running Kadane's maximum-subarray over the submitted series must reproduce the reported windowSum (and
 *  the same positive-window / no-positive-window disposition). A sub-optimal window under-reports the true
 *  peak run — the business misses the real momentum stretch. windowOptimal() recomputes the optimum
 *  end-to-end, INDEPENDENT of the reported window bounds (it recomputes the max sum from the series, not from
 *  the reported window), so a fabricated out-of-range window that still reports the optimal sum fails sourced
 *  only, and a real-but-sub-optimal window fails optimal only — the two gates are isolable. The Agent Fabric
 *  enforces it via policy.peak-window.window-optimal. (The load-bearing correctness gate — mirrors the Care
 *  Routing Agent's route-optimal and the Resource Scheduling Agent's schedule-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous action.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent DETECTS on paper — it never commits the finding as an official metric, adjusts a quota / target,
 *  or notifies finance on its own (each is a consequential commercial action that must be authorized); every
 *  window is a RECOMMENDATION requiring a revenue analyst to confirm. noAutonomousAction() reports the honest
 *  signal the Agent Fabric enforces via policy.peak-window.no-autonomous-action. (Mirrors the KPI Trend
 *  Agent's no-autonomous-commit and the Provider Benchmarking Agent's no-autonomous-tiering — the harmful
 *  action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A window — positive-window or no-positive-window — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresAnalystReview:true, autoActioned:false). A GOVERNANCE BLOCK is when a caller PRESENTS an offending
 *  DETERMINATION (a fabricated / out-of-range window, a sub-optimal window, or an autonomous action) — which
 *  the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified analytics / FP&A system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real commercial analytics weighs seasonality, cohort dynamics, pipeline mix, macro conditions, and human
 *  judgment — not a bare maximum-subarray over a handful of periods. This detects the peak window in the
 *  supplied illustrative series only. TIME IS DATA: the series is plain labeled numbers, and the detection is
 *  a pure function of the series (no clock, no randomness), so the same request always yields the same
 *  determination, which is what lets the demo, the seeded trace, and the tests agree. The series are
 *  clearly-labeled ILLUSTRATIVE aggregate business figures — DELIBERATELY NOT PHI: this agent runs only on the
 *  commercial plane, with no access to patient data.
 */

/** One period's signed net change. */
export type PeriodValue = {
  period: string;
  net: number;
};

/** A peak-window request: a labeled time-ordered series of signed net changes. */
export type PeakWindowRequest = {
  seriesRef: string;
  series: PeriodValue[];
};

export type PeakWindowDisposition = "positive-window" | "no-positive-window";

/** The deterministic finding the agent returns. */
export type PeakWindowDetermination = {
  seriesRef: string;
  /** The submitted series, echoed so the guards can recompute. */
  series: PeriodValue[];
  /** Start index (inclusive) of the maximum-sum contiguous window. -1 when the series is empty. */
  startIndex: number;
  /** End index (inclusive) of the maximum-sum contiguous window. -1 when the series is empty. */
  endIndex: number;
  /** The summed net gain over [startIndex, endIndex]. 0 when the series is empty. */
  windowSum: number;
  /** endIndex - startIndex + 1 (0 when the series is empty). */
  windowLength: number;
  /** True when windowSum > 0. */
  hasPositiveWindow: boolean;
  disposition: PeakWindowDisposition;
  /** Always true — a revenue analyst confirms every window. */
  requiresAnalystReview: true;
  /** Always false — the agent never autonomously acts. */
  autoActioned: false;
  reason: string;
  synthetic: true;
  note: string;
};

/**
 * KADANE'S MAXIMUM-SUBARRAY — the heart of the service. A single linear scan carrying a running sum that
 * RESETS whenever extending the previous stretch would do worse than starting fresh at the current period,
 * tracking the best window seen. Returns the [start, end] (inclusive) and the max sum. Deterministic
 * tie-breaks: the running best updates only on a STRICT improvement (so the EARLIEST maximum window wins), and
 * on a tie between extending and restarting the scan EXTENDS (so the earliest start is kept). For an all-
 * negative series it returns the single least-negative element's window (classic Kadane, non-empty). For an
 * empty series it returns { start: -1, end: -1, sum: 0 }.
 */
export function kadaneMaxSubarray(values: number[]): {
  start: number;
  end: number;
  sum: number;
} {
  const n = values.length;
  if (n === 0) return { start: -1, end: -1, sum: 0 };

  let bestSum = values[0];
  let bestStart = 0;
  let bestEnd = 0;
  let curSum = values[0];
  let curStart = 0;

  for (let i = 1; i < n; i++) {
    const x = values[i];
    // Extend the current stretch unless starting fresh at x strictly beats it.
    if (curSum + x < x) {
      curSum = x;
      curStart = i;
    } else {
      curSum = curSum + x;
    }
    if (curSum > bestSum) {
      bestSum = curSum;
      bestStart = curStart;
      bestEnd = i;
    }
  }
  return { start: bestStart, end: bestEnd, sum: bestSum };
}

/** Sum a half-open-safe inclusive range [start, end] of a series' net values. */
function sumRange(series: PeriodValue[], start: number, end: number): number {
  let s = 0;
  for (let i = start; i <= end; i++) s += series[i].net;
  return s;
}

/**
 * The deterministic detection function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own series (no randomness, no clock). It runs Kadane's maximum-subarray and returns the peak
 * window. Nothing is committed — the window is handed to a revenue analyst.
 */
export function evaluatePeakWindow(request: PeakWindowRequest): PeakWindowDetermination {
  const series = Array.isArray(request.series) ? request.series : [];
  const { start, end, sum } = kadaneMaxSubarray(series.map((p) => p.net));
  const windowLength = start >= 0 ? end - start + 1 : 0;
  const hasPositiveWindow = sum > 0;
  const disposition: PeakWindowDisposition = hasPositiveWindow
    ? "positive-window"
    : "no-positive-window";

  const windowLabel =
    start >= 0 ? `${series[start].period}\u2192${series[end].period}` : "(none)";
  const reason = hasPositiveWindow
    ? `Peak net-gain window ${windowLabel} (${windowLength} period(s)) nets +${sum} for ${request.seriesRef}.`
    : `No positive net-gain window for ${request.seriesRef} \u2014 every contiguous stretch nets a loss (best ${sum}).`;

  return {
    seriesRef: request.seriesRef,
    series,
    startIndex: start,
    endIndex: end,
    windowSum: sum,
    windowLength,
    hasPositiveWindow,
    disposition,
    requiresAnalystReview: true,
    autoActioned: false,
    reason,
    synthetic: true,
    note:
      `Peak-window detection ${request.seriesRef}: ${disposition.toUpperCase()} \u2014 ` +
      `maximum-sum contiguous window ${windowLabel} nets ${sum} over ${windowLength} period(s) via KADANE'S MAXIMUM-SUBARRAY algorithm. ` +
      "Real commercial analytics weighs seasonality, cohort dynamics, pipeline mix, macro conditions, and human judgment \u2014 not a bare maximum-subarray over a handful of periods. Synthetic/illustrative aggregate business figures \u2014 NOT a certified analytics / FP&A system; DELIBERATELY NOT PHI (commercial plane only). The agent never commits the finding, adjusts a quota, or notifies finance on its own \u2014 a revenue analyst confirms every window."
  };
}

/**
 * Sourced + self-honesty check: is the reported window a REAL contiguous sub-range of the submitted series
 * whose reported length + sum are honest? Requires 0 <= startIndex <= endIndex < n (or start = end = -1 for an
 * empty series), windowLength = end − start + 1, windowSum equal to the actual sum over [start, end], and
 * hasPositiveWindow / disposition following the sum's sign. Catches a window that runs off the series or
 * overstates its own sum. Does NOT recompute Kadane's optimum (that is the optimality gate's job), so it is
 * independent of it. Anything evaluatePeakWindow() produces satisfies it. This is the honest signal the window
 * reports to policy.peak-window.window-sourced. A non-object / malformed input is a violation.
 */
export function windowSourced(
  decision:
    | {
        series?: unknown;
        startIndex?: unknown;
        endIndex?: unknown;
        windowSum?: unknown;
        windowLength?: unknown;
        hasPositiveWindow?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const series = Array.isArray(decision.series) ? (decision.series as PeriodValue[]) : null;
  if (!series) return false;
  const { startIndex, endIndex, windowSum, windowLength } = decision;
  if (
    typeof startIndex !== "number" ||
    typeof endIndex !== "number" ||
    typeof windowSum !== "number" ||
    typeof windowLength !== "number"
  ) {
    return false;
  }

  if (series.length === 0) {
    if (startIndex !== -1 || endIndex !== -1 || windowSum !== 0 || windowLength !== 0) return false;
    if (decision.hasPositiveWindow !== false) return false;
    if (decision.disposition !== undefined && decision.disposition !== "no-positive-window") {
      return false;
    }
    return true;
  }

  // Valid contiguous sub-range.
  if (!(startIndex >= 0 && startIndex <= endIndex && endIndex < series.length)) return false;
  if (windowLength !== endIndex - startIndex + 1) return false;
  if (windowSum !== sumRange(series, startIndex, endIndex)) return false;

  const expectedPositive = windowSum > 0;
  if (decision.hasPositiveWindow !== undefined && decision.hasPositiveWindow !== expectedPositive) {
    return false;
  }
  const expectedDisposition: PeakWindowDisposition = expectedPositive
    ? "positive-window"
    : "no-positive-window";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }
  return true;
}

/**
 * Optimality check: re-running Kadane's maximum-subarray over the submitted series must reproduce the reported
 * windowSum and the same positive-window / no-positive-window disposition. True only when the recompute
 * agrees. Catches a sub-optimal window that under-reports the true peak run. The load-bearing correctness gate
 * — it recomputes the optimum from the series INDEPENDENT of the reported window bounds (it recomputes the max
 * sum, not the reported window), so a fabricated out-of-range window that still reports the optimal sum fails
 * sourced while recomputing here, and a real-but-sub-optimal window fails here while passing sourced — the two
 * gates are isolable. Anything evaluatePeakWindow() produces satisfies it. A non-object input is a violation.
 */
export function windowOptimal(
  decision:
    | { series?: unknown; windowSum?: unknown; disposition?: unknown }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const series = Array.isArray(decision.series) ? (decision.series as PeriodValue[]) : null;
  if (!series) return false;
  const { sum } = kadaneMaxSubarray(series.map((p) => p.net));
  if (decision.windowSum !== sum) return false;
  const expectedDisposition: PeakWindowDisposition = sum > 0 ? "positive-window" : "no-positive-window";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }
  return true;
}

/**
 * No-autonomous-action check: did the agent avoid acting on its own? True unless the determination reports it
 * auto-actioned (autoActioned:true) or does not require analyst review (requiresAnalystReview:false). Anything
 * evaluatePeakWindow() produces satisfies it. This is the honest signal the window reports to
 * policy.peak-window.no-autonomous-action. A non-object input is a violation.
 */
export function noAutonomousAction(
  decision: { autoActioned?: boolean; requiresAnalystReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoActioned === true) return false;
  if (decision.requiresAnalystReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a peak-window finding. */
export function peakWindowSummary(decision: PeakWindowDetermination): {
  seriesRef: string;
  disposition: PeakWindowDisposition;
  periodCount: number;
  startIndex: number;
  endIndex: number;
  windowSum: number;
  windowLength: number;
  requiresAnalystReview: boolean;
  synthetic: boolean;
} {
  return {
    seriesRef: decision.seriesRef,
    disposition: decision.disposition,
    periodCount: decision.series.length,
    startIndex: decision.startIndex,
    endIndex: decision.endIndex,
    windowSum: decision.windowSum,
    windowLength: decision.windowLength,
    requiresAnalystReview: decision.requiresAnalystReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: twelve months of net-new ARR ($000s, signed). The maximum contiguous window
 * is Apr→Aug (indices 3..7) netting +58 — the peak growth stretch — even though the series dips before and
 * after. Synthetic aggregate business figures; NOT PHI.
 */
export const DEMO_PEAK_WINDOW_REQUEST: PeakWindowRequest = {
  seriesRef: "net-new-arr-2026",
  series: [
    { period: "Jan", net: 6 },
    { period: "Feb", net: -9 },
    { period: "Mar", net: -4 },
    { period: "Apr", net: 12 },
    { period: "May", net: 18 },
    { period: "Jun", net: -5 },
    { period: "Jul", net: 14 },
    { period: "Aug", net: 19 },
    { period: "Sep", net: -22 },
    { period: "Oct", net: 8 },
    { period: "Nov", net: 3 },
    { period: "Dec", net: -6 }
  ]
};

/**
 * A representative demo request whose every contiguous stretch nets a loss (no-positive-window): the peak
 * window is the single least-negative month. Synthetic.
 */
export const DEMO_PEAK_WINDOW_ALL_NEGATIVE_REQUEST: PeakWindowRequest = {
  seriesRef: "net-churn-q3",
  series: [
    { period: "Jul", net: -8 },
    { period: "Aug", net: -3 },
    { period: "Sep", net: -11 }
  ]
};

/**
 * A representative demo request whose whole series is the peak window (all-positive): the window spans every
 * period. Synthetic.
 */
export const DEMO_PEAK_WINDOW_ALL_POSITIVE_REQUEST: PeakWindowRequest = {
  seriesRef: "active-patients-h1",
  series: [
    { period: "Jan", net: 4 },
    { period: "Feb", net: 7 },
    { period: "Mar", net: 5 },
    { period: "Apr", net: 9 }
  ]
};
