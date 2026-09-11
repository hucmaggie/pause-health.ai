/**
 * Commercial KPI Trend & Projection — the deterministic, transparent commercial-analytics layer that, given a
 * time-ordered series of a business METRIC (monthly provider-org adoption, active enrolled patients, ARR,
 * bookings), fits a LEAST-SQUARES linear-regression line through the observations, reports its SLOPE +
 * INTERCEPT + R² (goodness of fit), classifies the trend (rising / flat / declining) against a documented
 * flat tolerance, and PROJECTS the metric to a future horizon — without ever committing that projection as
 * an official forecast, adjusting a quota / target, or notifying finance on its own. A revenue analyst
 * confirms.
 *
 * Deterministic, dependency-free domain core the KPI Trend agent (app/api/agents/kpi-trend) wraps — a
 * commercial-operations / analytics service on the COMMERCIAL CRM plane of Pause's Agent Fabric (NO patient
 * PHI, NOT on the HIPAA-audit policy — it charts aggregate business metrics). UNLIKE the Outreach
 * Prioritization agent's 0/1 KNAPSACK DYNAMIC PROGRAMMING, the Quality Shift agent's CUSUM CHANGE-POINT
 * DETECTION, the Timeline Merge agent's K-WAY MERGE OF SORTED STREAMS, the Reportable Condition agent's
 * RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP Matching agent's TWO-SIDED STABLE MATCHING
 * (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation
 * agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the
 * Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER
 * APPORTIONMENT, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's
 * STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Care Pathway agent's
 * TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log
 * Integrity agent's HASH CHAIN — and, CRUCIALLY, UNLIKE the Pipeline Management agent's FORECAST ROLLUP
 * (which SUMS CRM opportunity records into committed / best-case figures — an aggregation of records, no
 * fitted model), the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS (which ranks ONE value
 * against a static distribution; it fits no line and projects nothing), the Quality Shift agent's CUSUM
 * (which accumulates a running deviation to catch a SUSTAINED shift; it fits no model and extrapolates
 * nothing), and the Remote Patient Monitoring agent's WINDOW-VS-BASELINE trend classification (which compares
 * a recent window to a baseline window; it fits no line) — the heart of this service is ORDINARY
 * LEAST-SQUARES LINEAR REGRESSION: the closed-form best-fit line minimizing the sum of squared residuals,
 * slope = (n·Σxy − Σx·Σy) / (n·Σx² − (Σx)²), intercept = (Σy − slope·Σx) / n, with R² = 1 − SSres/SStot, then
 * a projection ŷ = slope·horizon + intercept. A mis-fit line reports a trend the data doesn't support and a
 * projection nobody should plan against, so this fits DETERMINISTICALLY and hands the forecast to a human.
 *
 *   Inbound:  a KpiTrendRequest { seriesRef, horizon, flatTolerance, observations[] }
 *   Outbound: a KpiTrendDetermination { points[], slope, intercept, rSquared, trend, projection,
 *             requiresAnalystReview:true, autoCommitted:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every fitted point is sourced and every observation is accounted for.
 * ─────────────────────────────────────────────────────────────────────
 *  A fit is trustworthy only if it is drawn from the submitted observations: every fitted point must trace to
 *  a SUBMITTED observation (same index + value; no FABRICATED point), every submitted observation must appear
 *  EXACTLY ONCE (none dropped, none double-plotted), and the fit parameters (horizon, flatTolerance) must be
 *  present numbers. A fabricated or dropped point silently bends the line. seriesSourced() verifies it; the
 *  Agent Fabric enforces it via policy.kpi.series-sourced. (The sourced + completeness gate — mirrors the
 *  Quality Shift Agent's observations-sourced and the Timeline Merge Agent's events-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the fit + projection recompute.
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing the ordinary least-squares regression over the submitted observations must reproduce the
 *  reported slope, intercept, R², trend classification, projection, and every point's fitted value +
 *  residual. A mis-fit line or a fabricated projection misleads the plan. fitConsistent() recomputes it
 *  end-to-end; the Agent Fabric enforces it via policy.kpi.fit-consistent. (The load-bearing correctness gate
 *  — mirrors the Quality Shift Agent's cusum-consistent and the Provider Benchmarking Agent's
 *  stats-consistent. It recomputes from the observations INDEPENDENT of the point-correspondence, so the two
 *  gates are isolable.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous commit.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent PROJECTS — it never commits the projection as an official forecast, adjusts a quota / target, or
 *  notifies finance on its own (each is a consequential commercial action that must be authorized); every
 *  projection is a RECOMMENDATION requiring a revenue analyst to confirm. noAutonomousCommit() reports the
 *  honest signal the Agent Fabric enforces via policy.kpi.no-autonomous-commit. (Mirrors the Pipeline
 *  Management Agent's human-owner posture and the Account Management Agent's never-commit-a-contract posture
 *  — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A trend — rising / flat / declining — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresAnalystReview:true, autoCommitted:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (a fabricated point, a mis-fit line / fabricated projection, or an autonomous
 *  commit) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified forecasting / FP&A system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real commercial forecasting weighs seasonality, pipeline mix, cohort dynamics, macro conditions, and
 *  human judgment — not a single straight line through past points. This fits the supplied illustrative
 *  series only. TIME IS DATA: the fit is a pure function of the observations' own indices + values + the
 *  parameters (no clock, no randomness), so the same request always yields the same line, which is what lets
 *  the demo, the seeded trace, and the tests agree. The metrics are clearly-labeled ILLUSTRATIVE synthetics,
 *  and carry NO patient PHI.
 */

/** A single observation of the metric. `index` is the ordinal time step; `value` the metric's value. */
export type KpiObservation = {
  index: number;
  value: number;
  label?: string;
};

/** A KPI-trend request. `horizon` is the future index to project to; `flatTolerance` the slope magnitude at/below which the trend is flat. */
export type KpiTrendRequest = {
  seriesRef: string;
  horizon: number;
  flatTolerance: number;
  observations: KpiObservation[];
};

/** A fitted point: the observation plus its on-line fitted value and residual. */
export type KpiFitPoint = {
  index: number;
  value: number;
  fitted: number;
  residual: number;
};

export type KpiTrend = "rising" | "flat" | "declining";

/** The deterministic finding the agent returns. */
export type KpiTrendDetermination = {
  seriesRef: string;
  horizon: number;
  flatTolerance: number;
  /** The submitted observations, echoed so the guards can recompute. */
  observations: KpiObservation[];
  /** One fitted point per submitted observation, in observation order. */
  points: KpiFitPoint[];
  slope: number;
  intercept: number;
  rSquared: number;
  trend: KpiTrend;
  /** The projected metric value at `horizon`: slope·horizon + intercept. */
  projection: number;
  /** Always true — a revenue analyst confirms every projection. */
  requiresAnalystReview: true;
  /** Always false — the agent never autonomously commits the projection. */
  autoCommitted: false;
  reason: string;
  synthetic: true;
  note: string;
};

const EPS = 1e-9;

function approxEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

/**
 * ORDINARY LEAST-SQUARES LINEAR REGRESSION — the heart of the service. Computes the closed-form best-fit
 * line (slope, intercept) minimizing the sum of squared residuals, plus the coefficient of determination R².
 * Deterministic. Degenerate inputs are handled: with fewer than two points, or with a zero x-variance, the
 * slope is 0; when the y-variance (SStot) is 0 the line fits the constant perfectly and R² is defined as 1.
 */
export function computeRegression(observations: KpiObservation[]): {
  slope: number;
  intercept: number;
  rSquared: number;
} {
  const n = observations.length;
  if (n === 0) return { slope: 0, intercept: 0, rSquared: 1 };
  if (n === 1) return { slope: 0, intercept: observations[0].value, rSquared: 1 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const o of observations) {
    sumX += o.index;
    sumY += o.value;
    sumXY += o.index * o.value;
    sumXX += o.index * o.index;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = Math.abs(denom) < EPS ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const o of observations) {
    const fitted = slope * o.index + intercept;
    ssTot += (o.value - meanY) * (o.value - meanY);
    ssRes += (o.value - fitted) * (o.value - fitted);
  }
  const rSquared = ssTot < EPS ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, rSquared };
}

/** Classify the trend from the slope against the flat tolerance. */
export function classifyTrend(slope: number, flatTolerance: number): KpiTrend {
  const band = Math.max(0, flatTolerance);
  if (slope > band) return "rising";
  if (slope < -band) return "declining";
  return "flat";
}

/**
 * The deterministic fit + projection function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own observations + parameters (no randomness, no clock). It runs ordinary least-squares
 * regression, emits one fitted point per observation, classifies the trend, and projects to the horizon.
 * Nothing is committed — the forecast is handed to a revenue analyst.
 */
export function evaluateKpiTrend(request: KpiTrendRequest): KpiTrendDetermination {
  const observations = Array.isArray(request.observations) ? request.observations : [];
  const { slope, intercept, rSquared } = computeRegression(observations);
  const trend = classifyTrend(slope, request.flatTolerance);
  const projection = slope * request.horizon + intercept;

  const points: KpiFitPoint[] = observations.map((o) => {
    const fitted = slope * o.index + intercept;
    return { index: o.index, value: o.value, fitted, residual: o.value - fitted };
  });

  const round = (x: number) => Math.round(x * 100) / 100;
  const reason =
    `Least-squares fit over ${observations.length} observation(s): slope ${round(slope)}, R² ${round(
      rSquared
    )} \u2014 trend ${trend.toUpperCase()}; projected ${round(projection)} at index ${request.horizon}.`;

  return {
    seriesRef: request.seriesRef,
    horizon: request.horizon,
    flatTolerance: request.flatTolerance,
    observations,
    points,
    slope,
    intercept,
    rSquared,
    trend,
    projection,
    requiresAnalystReview: true,
    autoCommitted: false,
    reason,
    synthetic: true,
    note:
      `KPI trend ${request.seriesRef}: ${trend.toUpperCase()} \u2014 ordinary LEAST-SQUARES linear regression over ${observations.length} observation(s) gives slope ${round(slope)}, intercept ${round(intercept)}, R² ${round(rSquared)}, projecting ${round(projection)} at index ${request.horizon}.` +
      " Real commercial forecasting weighs seasonality, pipeline mix, cohort dynamics, macro conditions, and human judgment \u2014 not a single straight line through past points. Synthetic/illustrative business metrics carrying NO patient PHI \u2014 NOT a certified forecasting / FP&A system. The agent never commits the projection as an official forecast, adjusts a quota / target, or notifies finance on its own \u2014 a revenue analyst confirms every projection."
  };
}

/** Index the submitted observations by ordinal index. */
function observationIndex(observations: KpiObservation[]): Map<number, KpiObservation> {
  const idx = new Map<number, KpiObservation>();
  for (const o of observations) idx.set(o.index, o);
  return idx;
}

/**
 * Sourced + completeness check: is the fit drawn from the submitted observations? True only when every fitted
 * point traces to a SUBMITTED observation (same index + value; no fabricated point), every submitted
 * observation appears EXACTLY ONCE across the points (none dropped, none double-plotted), and the fit
 * parameters (horizon, flatTolerance) are present numbers. Catches a fabricated or dropped point. Does NOT
 * recompute the regression (that is the fit-consistent gate's job), so it is independent of it. Anything
 * evaluateKpiTrend() produces satisfies it. This is the honest signal the route reports to
 * policy.kpi.series-sourced. A non-object / malformed input is a violation.
 */
export function seriesSourced(
  decision:
    | {
        observations?: unknown;
        points?: unknown;
        horizon?: unknown;
        flatTolerance?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const observations = Array.isArray(decision.observations)
    ? (decision.observations as KpiObservation[])
    : null;
  const points = Array.isArray(decision.points) ? (decision.points as KpiFitPoint[]) : null;
  if (!observations || !points) return false;
  if (typeof decision.horizon !== "number" || typeof decision.flatTolerance !== "number") return false;

  const idx = observationIndex(observations);
  const seen = new Set<number>();
  for (const p of points) {
    const o = idx.get(p.index);
    if (!o) return false; // fabricated point
    if (o.value !== p.value) return false;
    if (seen.has(p.index)) return false; // double-plotted
    seen.add(p.index);
  }
  if (seen.size !== idx.size) return false; // some observation dropped
  return true;
}

/**
 * Fit-consistency check: recomputing the ordinary least-squares regression over the submitted observations
 * must reproduce the reported slope, intercept, R², trend classification, projection, and every point's
 * fitted value + residual. True only when all of those recompute (within a small tolerance). Catches a
 * mis-fit line or a fabricated projection. The load-bearing correctness gate — it recomputes the fit from the
 * observations INDEPENDENT of the point-correspondence (a fabricated point is filtered out here, so it fails
 * sourced while the real observations still recompute — the two gates are isolable). Anything
 * evaluateKpiTrend() produces satisfies it. A non-object input is a violation.
 */
export function fitConsistent(
  decision:
    | {
        observations?: unknown;
        points?: unknown;
        horizon?: unknown;
        flatTolerance?: unknown;
        slope?: unknown;
        intercept?: unknown;
        rSquared?: unknown;
        trend?: unknown;
        projection?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const observations = Array.isArray(decision.observations)
    ? (decision.observations as KpiObservation[])
    : null;
  if (!observations) return false;
  if (typeof decision.horizon !== "number" || typeof decision.flatTolerance !== "number") return false;

  const { slope, intercept, rSquared } = computeRegression(observations);
  const trend = classifyTrend(slope, decision.flatTolerance);
  const projection = slope * decision.horizon + intercept;

  if (typeof decision.slope !== "number" || !approxEqual(decision.slope, slope)) return false;
  if (typeof decision.intercept !== "number" || !approxEqual(decision.intercept, intercept)) return false;
  if (typeof decision.rSquared !== "number" || !approxEqual(decision.rSquared, rSquared)) return false;
  if (decision.trend !== trend) return false;
  if (typeof decision.projection !== "number" || !approxEqual(decision.projection, projection)) return false;

  // Each reported point that corresponds to a real observation must have the right fitted value + residual.
  const idx = observationIndex(observations);
  const points = Array.isArray(decision.points) ? (decision.points as KpiFitPoint[]) : [];
  for (const p of points) {
    const o = idx.get(p.index);
    if (!o || o.value !== p.value) continue; // fabricated point — isolated to the sourced gate
    const fitted = slope * p.index + intercept;
    if (!approxEqual(p.fitted, fitted)) return false;
    if (!approxEqual(p.residual, p.value - fitted)) return false;
  }
  return true;
}

/**
 * No-autonomous-commit check: did the agent avoid autonomously committing the projection? True unless the
 * determination reports it auto-committed (autoCommitted:true) or does not require analyst review
 * (requiresAnalystReview:false). Anything evaluateKpiTrend() produces satisfies it. This is the honest signal
 * the route reports to policy.kpi.no-autonomous-commit. A non-object input is a violation.
 */
export function noAutonomousCommit(
  decision:
    | { autoCommitted?: boolean; requiresAnalystReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoCommitted === true) return false;
  if (decision.requiresAnalystReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a fit. */
export function kpiTrendSummary(decision: KpiTrendDetermination): {
  seriesRef: string;
  trend: KpiTrend;
  observationCount: number;
  slope: number;
  rSquared: number;
  projection: number;
  horizon: number;
  requiresAnalystReview: boolean;
  synthetic: boolean;
} {
  return {
    seriesRef: decision.seriesRef,
    trend: decision.trend,
    observationCount: decision.observations.length,
    slope: decision.slope,
    rSquared: decision.rSquared,
    projection: decision.projection,
    horizon: decision.horizon,
    requiresAnalystReview: decision.requiresAnalystReview,
    synthetic: decision.synthetic
  };
}

/** A representative demo request whose series rises linearly (rising). Synthetic, non-PHI. */
export const DEMO_KPI_TREND_REQUEST: KpiTrendRequest = {
  seriesRef: "kpi-provider-org-adoption",
  horizon: 6,
  flatTolerance: 0.5,
  observations: [
    { index: 0, value: 20, label: "Jan" },
    { index: 1, value: 31, label: "Feb" },
    { index: 2, value: 42, label: "Mar" },
    { index: 3, value: 53, label: "Apr" },
    { index: 4, value: 64, label: "May" },
    { index: 5, value: 75, label: "Jun" }
  ]
};

/** A representative demo request whose series is flat (constant). Synthetic, non-PHI. */
export const DEMO_KPI_TREND_FLAT_REQUEST: KpiTrendRequest = {
  seriesRef: "kpi-monthly-active-enrolled",
  horizon: 6,
  flatTolerance: 0.5,
  observations: [
    { index: 0, value: 50, label: "Jan" },
    { index: 1, value: 50, label: "Feb" },
    { index: 2, value: 50, label: "Mar" },
    { index: 3, value: 50, label: "Apr" },
    { index: 4, value: 50, label: "May" },
    { index: 5, value: 50, label: "Jun" }
  ]
};

/** A representative demo request whose series declines linearly (declining). Synthetic, non-PHI. */
export const DEMO_KPI_TREND_DECLINING_REQUEST: KpiTrendRequest = {
  seriesRef: "kpi-monthly-churn-cohort",
  horizon: 6,
  flatTolerance: 0.5,
  observations: [
    { index: 0, value: 80, label: "Jan" },
    { index: 1, value: 72, label: "Feb" },
    { index: 2, value: 64, label: "Mar" },
    { index: 3, value: 56, label: "Apr" },
    { index: 4, value: 48, label: "May" },
    { index: 5, value: 40, label: "Jun" }
  ]
};
