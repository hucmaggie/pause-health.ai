/**
 * Clinical Quality-Measure Shift Detection (Statistical Process Control) — the deterministic, transparent
 * quality-analytics layer that watches a time-ordered series of a clinical QUALITY MEASURE (a weekly
 * mammography-screening rate, a monthly HbA1c-control rate, a daily lab-QC value) and detects whether the
 * measure has drifted into a SUSTAINED SHIFT away from its established TARGET — a signal the quality team
 * investigates — without ever launching a corrective action, a recall campaign, or a process change on its
 * own. A human confirms.
 *
 * Deterministic, dependency-free domain core the Quality Shift agent (app/api/agents/quality-shift) wraps —
 * a care-coordination / quality-analytics service on the patient & clinical plane of Pause's Agent Fabric.
 * UNLIKE the Timeline Merge agent's K-WAY MERGE OF SORTED STREAMS, the Reportable Condition agent's
 * RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP Matching agent's TWO-SIDED STABLE MATCHING
 * (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation
 * agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the
 * MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Claim Lifecycle agent's FSM TRANSITION VALIDATION,
 * the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL
 * SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Care Pathway agent's TOPOLOGICAL
 * ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity agent's
 * HASH CHAIN — and, CRUCIALLY, UNLIKE the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS (which
 * ranks one value against a static peer distribution; this watches ONE series evolve over time) and the
 * Access Anomaly agent's SLIDING-WINDOW COUNTING (which counts events in a fixed recent window to catch a
 * spike; this accumulates a running deviation to catch a SUSTAINED small shift a window would miss) — the
 * heart of this service is CHANGE-POINT DETECTION via a two-sided TABULAR CUSUM (cumulative-sum) control
 * chart: it accumulates, at each observation, a one-sided upper sum SH_i = max(0, SH_{i-1} + (x_i − target) −
 * k) and a one-sided lower sum SL_i = max(0, SL_{i-1} + (target − x_i) − k), where k is the slack (the
 * half-shift the chart tolerates), and SIGNALS the first observation whose SH or SL exceeds the decision
 * threshold h. A missed shift lets a quality measure decay unnoticed; a false alarm sends a team chasing
 * noise — so the chart signals DETERMINISTICALLY and hands the finding to a human.
 *
 *   Inbound:  a QualityShiftRequest { measureRef, target, slack, threshold, observations[] }
 *   Outbound: a QualityShiftDetermination { points[], signal, alarmIndex, alarmDirection, peakHigh, peakLow,
 *             requiresQualityReview:true, autoActioned:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every charted point is sourced and every observation is accounted for.
 * ─────────────────────────────────────────────────────────────────────
 *  A control chart is trustworthy only if it is drawn from the submitted observations: every charted point
 *  must trace to a SUBMITTED observation (same index + value; no FABRICATED point), every submitted
 *  observation must appear EXACTLY ONCE (none dropped, none double-charted), and the chart parameters
 *  (target, slack, threshold) must be present numbers. A fabricated or dropped point silently rewrites the
 *  trend. observationsSourced() verifies it; the Agent Fabric enforces it via
 *  policy.quality.observations-sourced. (The sourced + completeness gate — mirrors the Timeline Merge
 *  Agent's events-sourced and the Enrollment Reconciliation Agent's reconciliation-complete.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the CUSUM recomputes.
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing the two-sided tabular CUSUM from the submitted observations + parameters must reproduce every
 *  charted SH_i / SL_i, the first-alarm index, the alarm direction (up / down), the signal
 *  (in-control / shift-up-detected / shift-down-detected), and the peak sums. A mis-charted CUSUM fakes a
 *  shift that isn't there or hides one that is. cusumConsistent() recomputes it end-to-end; the Agent Fabric
 *  enforces it via policy.quality.cusum-consistent. (The load-bearing correctness gate — mirrors the
 *  Timeline Merge Agent's merge-consistent and the Provider Benchmarking Agent's stats-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous intervention.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent DETECTS — it never launches a corrective action, a recall / outreach campaign, or a process
 *  change on its own (each is a consequential action that must be authorized); every signal is a
 *  RECOMMENDATION requiring a quality reviewer to confirm. noAutonomousIntervention() reports the honest
 *  signal the Agent Fabric enforces via policy.quality.no-autonomous-intervention. (Mirrors the HEDIS
 *  Agent's no-autonomous-submission and the Care Gap Agent's human-review posture — the harmful action is
 *  enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A signal — in-control, shift-up-detected, or shift-down-detected — is a SAFE, honest OUTPUT: the task
 *  COMPLETES (it carries requiresQualityReview:true, autoActioned:false). A GOVERNANCE BLOCK is when a
 *  caller PRESENTS an offending DETERMINATION (a fabricated point, a mis-charted CUSUM, or an autonomous
 *  intervention) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified SPC / quality-surveillance platform.
 * ─────────────────────────────────────────────────────────────────────
 *  Real statistical process control tunes k and h to a target ARL (average run length), combines CUSUM with
 *  Shewhart / EWMA charts, and accounts for autocorrelation and measure specifications. This charts the
 *  supplied de-identified aggregate rate series only. TIME IS DATA: the chart is a pure function of the
 *  observations' own values + the parameters (no clock, no randomness), so the same series always yields the
 *  same signal, which is what lets the demo, the seeded trace, and the tests agree. The measures are
 *  clearly-labeled ILLUSTRATIVE synthetics.
 */

/** One time-ordered observation of the quality measure. `index` is the position in the series. */
export type QualityObservation = {
  index: number;
  value: number;
  label?: string;
};

/** A quality-shift request. `slack` is k (the tolerated half-shift); `threshold` is h (the decision limit). */
export type QualityShiftRequest = {
  measureRef: string;
  target: number;
  slack: number;
  threshold: number;
  observations: QualityObservation[];
};

/** One charted CUSUM point. */
export type CusumPoint = {
  index: number;
  value: number;
  cusumHigh: number;
  cusumLow: number;
  alarm: boolean;
};

export type QualityShiftSignal = "in-control" | "shift-up-detected" | "shift-down-detected";
export type AlarmDirection = "up" | "down" | null;

/** The deterministic finding the agent returns. */
export type QualityShiftDetermination = {
  measureRef: string;
  target: number;
  slack: number;
  threshold: number;
  /** The submitted observations, echoed so the guards can recompute. */
  observations: QualityObservation[];
  /** The charted CUSUM points, one per observation, in order. */
  points: CusumPoint[];
  signal: QualityShiftSignal;
  /** The first index whose SH or SL exceeds the threshold, or -1 when in-control. */
  alarmIndex: number;
  alarmDirection: AlarmDirection;
  peakHigh: number;
  peakLow: number;
  /** Always true — a quality reviewer confirms every signal. */
  requiresQualityReview: true;
  /** Always false — the agent never autonomously intervenes. */
  autoActioned: false;
  reason: string;
  synthetic: true;
  note: string;
};

/** Float-safe equality for the CUSUM arithmetic. */
function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

/**
 * The two-sided tabular CUSUM — the heart of the service. Accumulates the one-sided upper and lower sums and
 * flags the first observation whose sum exceeds the threshold. Pure + deterministic; returns the charted
 * points in order.
 */
export function computeCusum(
  observations: QualityObservation[],
  target: number,
  slack: number,
  threshold: number
): CusumPoint[] {
  const points: CusumPoint[] = [];
  let sh = 0;
  let sl = 0;
  for (const obs of observations) {
    sh = Math.max(0, sh + (obs.value - target) - slack);
    sl = Math.max(0, sl + (target - obs.value) - slack);
    points.push({
      index: obs.index,
      value: obs.value,
      cusumHigh: sh,
      cusumLow: sl,
      alarm: sh > threshold || sl > threshold
    });
  }
  return points;
}

/**
 * Derive the first-alarm index, the alarm direction (up wins a tie by documented precedence), and the
 * signal from a charted series.
 */
function deriveSignal(
  points: CusumPoint[],
  threshold: number
): { alarmIndex: number; alarmDirection: AlarmDirection; signal: QualityShiftSignal } {
  for (const p of points) {
    const up = p.cusumHigh > threshold;
    const down = p.cusumLow > threshold;
    if (up || down) {
      const direction: AlarmDirection = up ? "up" : "down";
      return {
        alarmIndex: p.index,
        alarmDirection: direction,
        signal: direction === "up" ? "shift-up-detected" : "shift-down-detected"
      };
    }
  }
  return { alarmIndex: -1, alarmDirection: null, signal: "in-control" };
}

/**
 * The deterministic detection function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own observations + parameters (no randomness, no clock). It runs the two-sided tabular CUSUM,
 * finds the first alarm, and classifies the signal. Nothing is actioned — the finding is handed to a quality
 * reviewer.
 */
export function evaluateQualityShift(request: QualityShiftRequest): QualityShiftDetermination {
  const observations = Array.isArray(request.observations) ? request.observations : [];
  const points = computeCusum(observations, request.target, request.slack, request.threshold);
  const { alarmIndex, alarmDirection, signal } = deriveSignal(points, request.threshold);
  const peakHigh = points.reduce((m, p) => Math.max(m, p.cusumHigh), 0);
  const peakLow = points.reduce((m, p) => Math.max(m, p.cusumLow), 0);

  const reason =
    signal === "in-control"
      ? `${observations.length} observation(s) charted; the measure is in control (no cumulative deviation exceeded the threshold ${request.threshold}).`
      : `Sustained ${alarmDirection === "up" ? "upward" : "downward"} shift detected at observation ${alarmIndex} — the ${alarmDirection === "up" ? "upper" : "lower"} CUSUM exceeded the threshold ${request.threshold}; flagged for quality review.`;

  return {
    measureRef: request.measureRef,
    target: request.target,
    slack: request.slack,
    threshold: request.threshold,
    observations,
    points,
    signal,
    alarmIndex,
    alarmDirection,
    peakHigh,
    peakLow,
    requiresQualityReview: true,
    autoActioned: false,
    reason,
    synthetic: true,
    note:
      `Quality-measure shift detection ${request.measureRef}: ${signal.toUpperCase()} over ${observations.length} observation(s) via a two-sided TABULAR CUSUM (target ${request.target}, slack k=${request.slack}, threshold h=${request.threshold}) — accumulating SH_i = max(0, SH_{i-1} + (x_i − target) − k) and SL_i = max(0, SL_{i-1} + (target − x_i) − k) and signaling the first sum to exceed h.` +
      " Real statistical process control tunes k and h to a target ARL, combines CUSUM with Shewhart / EWMA charts, and accounts for autocorrelation and measure specifications. Charts de-identified aggregate rate series — synthetic/illustrative, NOT a certified SPC / quality-surveillance platform. The agent never launches a corrective action, a recall campaign, or a process change on its own — a quality reviewer confirms every signal."
  };
}

/**
 * Sourced + completeness check: is the chart drawn from the submitted observations? True only when every
 * charted point traces to a SUBMITTED observation (same index + value; no fabricated point), every submitted
 * observation appears EXACTLY ONCE (none dropped, none double-charted), and the chart parameters (target,
 * slack, threshold) are present numbers. Catches a fabricated or dropped point. Does NOT recompute the CUSUM
 * arithmetic (that is the consistency check's job), so it is independent of it. Anything
 * evaluateQualityShift() produces satisfies it. This is the honest signal the route reports to
 * policy.quality.observations-sourced. A non-object / malformed input is a violation.
 */
export function observationsSourced(
  decision:
    | {
        observations?: unknown;
        points?: unknown;
        target?: unknown;
        slack?: unknown;
        threshold?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const observations = Array.isArray(decision.observations)
    ? (decision.observations as QualityObservation[])
    : null;
  const points = Array.isArray(decision.points) ? (decision.points as CusumPoint[]) : null;
  if (!observations || !points) return false;
  if (
    typeof decision.target !== "number" ||
    typeof decision.slack !== "number" ||
    typeof decision.threshold !== "number"
  ) {
    return false;
  }

  // Index the submitted observations by index.
  const obsByIndex = new Map<number, QualityObservation>();
  for (const o of observations) {
    if (typeof o.index !== "number" || typeof o.value !== "number") return false;
    if (obsByIndex.has(o.index)) return false; // duplicate submitted index
    obsByIndex.set(o.index, o);
  }

  // Every charted point traces to a submitted observation (same index + value); each observation charted
  // exactly once.
  const seen = new Set<number>();
  for (const p of points) {
    const obs = obsByIndex.get(p.index);
    if (!obs) return false; // fabricated point
    if (!approxEqual(obs.value, p.value)) return false;
    if (seen.has(p.index)) return false; // double-charted
    seen.add(p.index);
  }
  if (seen.size !== obsByIndex.size) return false; // some observation dropped
  return true;
}

/**
 * Consistency check: recomputing the two-sided tabular CUSUM from the submitted observations + parameters
 * must reproduce every charted SH_i / SL_i, the first-alarm index, the alarm direction, the signal, and the
 * peak sums. True only when, filtering the reported points to those whose (index + value) matches a
 * submitted observation, that filtered sequence equals the recomputed chart, AND the reported
 * signal / alarmIndex / alarmDirection / peaks match the recompute. Catches a mis-charted CUSUM. The
 * load-bearing correctness gate — it recomputes the chart from the observations INDEPENDENT of the
 * point-correspondence (a fabricated point is filtered out here, so it fails sourced while the real points
 * still recompute — the two gates are isolable). Anything evaluateQualityShift() produces satisfies it. A
 * non-object input is a violation.
 */
export function cusumConsistent(
  decision:
    | {
        observations?: unknown;
        points?: unknown;
        target?: unknown;
        slack?: unknown;
        threshold?: unknown;
        signal?: unknown;
        alarmIndex?: unknown;
        alarmDirection?: unknown;
        peakHigh?: unknown;
        peakLow?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const observations = Array.isArray(decision.observations)
    ? (decision.observations as QualityObservation[])
    : null;
  const points = Array.isArray(decision.points) ? (decision.points as CusumPoint[]) : null;
  if (!observations || !points) return false;
  if (
    typeof decision.target !== "number" ||
    typeof decision.slack !== "number" ||
    typeof decision.threshold !== "number"
  ) {
    return false;
  }

  const expected = computeCusum(observations, decision.target, decision.slack, decision.threshold);
  const obsByIndex = new Map<number, QualityObservation>();
  for (const o of observations) obsByIndex.set(o.index, o);

  // Filter reported points to real (submitted) ones, preserving order.
  const realPoints = points.filter((p) => {
    const obs = obsByIndex.get(p.index);
    return obs !== undefined && approxEqual(obs.value, p.value);
  });
  if (realPoints.length !== expected.length) return false;

  for (let i = 0; i < expected.length; i++) {
    const got = realPoints[i];
    const want = expected[i];
    if (got.index !== want.index) return false; // wrong order
    if (!approxEqual(got.cusumHigh, want.cusumHigh)) return false;
    if (!approxEqual(got.cusumLow, want.cusumLow)) return false;
    if (got.alarm !== want.alarm) return false;
  }

  // The derived signal fields must recompute.
  const derived = deriveSignal(expected, decision.threshold);
  if (decision.signal !== undefined && decision.signal !== derived.signal) return false;
  if (decision.alarmIndex !== undefined && decision.alarmIndex !== derived.alarmIndex) return false;
  if (
    decision.alarmDirection !== undefined &&
    (decision.alarmDirection ?? null) !== derived.alarmDirection
  ) {
    return false;
  }
  const expectedPeakHigh = expected.reduce((m, p) => Math.max(m, p.cusumHigh), 0);
  const expectedPeakLow = expected.reduce((m, p) => Math.max(m, p.cusumLow), 0);
  if (decision.peakHigh !== undefined && !approxEqual(decision.peakHigh as number, expectedPeakHigh)) {
    return false;
  }
  if (decision.peakLow !== undefined && !approxEqual(decision.peakLow as number, expectedPeakLow)) {
    return false;
  }
  return true;
}

/**
 * No-autonomous-intervention check: did the agent avoid autonomously acting on the signal? True unless the
 * determination reports it auto-actioned (autoActioned:true) or does not require quality review
 * (requiresQualityReview:false). Anything evaluateQualityShift() produces satisfies it. This is the honest
 * signal the route reports to policy.quality.no-autonomous-intervention. A non-object input is a violation.
 */
export function noAutonomousIntervention(
  decision:
    | { autoActioned?: boolean; requiresQualityReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoActioned === true) return false;
  if (decision.requiresQualityReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a detection. */
export function qualityShiftSummary(decision: QualityShiftDetermination): {
  measureRef: string;
  signal: QualityShiftSignal;
  alarmIndex: number;
  alarmDirection: AlarmDirection;
  observationCount: number;
  peakHigh: number;
  peakLow: number;
  requiresQualityReview: boolean;
  synthetic: boolean;
} {
  return {
    measureRef: decision.measureRef,
    signal: decision.signal,
    alarmIndex: decision.alarmIndex,
    alarmDirection: decision.alarmDirection,
    observationCount: decision.observations.length,
    peakHigh: decision.peakHigh,
    peakLow: decision.peakLow,
    requiresQualityReview: decision.requiresQualityReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request whose measure drifts upward into a sustained shift (shift-up-detected).
 * Synthetic aggregate rates.
 */
export const DEMO_QUALITY_SHIFT_REQUEST: QualityShiftRequest = {
  measureRef: "measure-mammography-screening-rate",
  target: 50,
  slack: 2,
  threshold: 8,
  observations: [
    { index: 0, value: 50, label: "wk-1" },
    { index: 1, value: 49, label: "wk-2" },
    { index: 2, value: 51, label: "wk-3" },
    { index: 3, value: 50, label: "wk-4" },
    { index: 4, value: 56, label: "wk-5" },
    { index: 5, value: 57, label: "wk-6" },
    { index: 6, value: 58, label: "wk-7" }
  ]
};

/** A representative demo request whose measure stays within the slack band (in-control). Synthetic. */
export const DEMO_QUALITY_SHIFT_IN_CONTROL_REQUEST: QualityShiftRequest = {
  measureRef: "measure-hba1c-control-rate",
  target: 50,
  slack: 2,
  threshold: 8,
  observations: [
    { index: 0, value: 50, label: "wk-1" },
    { index: 1, value: 51, label: "wk-2" },
    { index: 2, value: 49, label: "wk-3" },
    { index: 3, value: 50, label: "wk-4" },
    { index: 4, value: 51, label: "wk-5" },
    { index: 5, value: 49, label: "wk-6" },
    { index: 6, value: 50, label: "wk-7" }
  ]
};

/** A representative demo request whose measure drifts downward into a sustained shift (shift-down-detected). */
export const DEMO_QUALITY_SHIFT_DOWN_REQUEST: QualityShiftRequest = {
  measureRef: "measure-bp-control-rate",
  target: 50,
  slack: 2,
  threshold: 8,
  observations: [
    { index: 0, value: 50, label: "wk-1" },
    { index: 1, value: 50, label: "wk-2" },
    { index: 2, value: 49, label: "wk-3" },
    { index: 3, value: 44, label: "wk-4" },
    { index: 4, value: 43, label: "wk-5" },
    { index: 5, value: 42, label: "wk-6" }
  ]
};
