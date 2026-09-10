/**
 * Provider Cost & Quality Percentile Benchmarking — the deterministic, transparent commercial-operations
 * layer that takes a target provider's metric value plus a PEER COHORT of providers' values and computes
 * WHERE the provider falls in the DISTRIBUTION: its percentile rank, the cohort median, and a performance
 * band (top-quartile / above-median / below-median / bottom-quartile), flagging an unfavorable band for
 * network review — never autonomously TIERING the provider, ADJUSTING their payment, or REMOVING them
 * from the network; a network manager confirms every benchmark.
 *
 * Deterministic, dependency-free domain core the Provider Benchmarking agent
 * (app/api/agents/provider-benchmarking) wraps — a commercial-operations service on the commercial plane
 * of Pause's Agent Fabric. UNLIKE the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication
 * Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the
 * Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the
 * Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the
 * Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar
 * waterfall, the DDI agent's PAIRWISE KNOWLEDGE-BASE LOOKUP, the OIG Exclusion agent's EXACT identity
 * MATCHING, or the Audit Log Integrity agent's HASH CHAIN — and UNLIKE the DATE-DEADLINE agents (Timely
 * Filing, Right of Access, Amendment) that add N days to a single date — the heart of this service is
 * PERCENTILE / RANK STATISTICS over a numeric distribution: sort the cohort, compute the target's
 * percentile rank (the standard midpoint method), the median, and a quartile band. Provider benchmarking
 * drives value-based-care tiering, incentive payments, and network decisions; a wrong percentile
 * mis-tiers a provider, so this service surfaces the rank deterministically and hands it to a human.
 *
 *   Inbound:  a ProviderBenchmarkingRequest { benchmarkRef, providerRef, metricName, metricDirection, targetValue, cohort[] }
 *   Outbound: a ProviderBenchmarkingDetermination { disposition, percentileRank, effectivePercentile,
 *             performanceBand, median, countBelow/Equal/Above, cohort[], cohortSize,
 *             requiresNetworkReview:true, autoTiered:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other provider / quality agents: distinct from the Provider
 * Contracting agent (which computes a single VBC benchmark-DRIFT vs a contract threshold), the HEDIS
 * Quality agent (which computes the measure RATES), the Quality-Measure Attribution agent (which assigns
 * the DENOMINATOR), and the Provider Credentialing agent (network integrity): this ranks a provider within
 * a peer DISTRIBUTION via percentile.
 *
 * DELIBERATELY NOT PHI-BEARING: it operates on PROVIDER-LEVEL aggregate metrics (cost-per-episode, a
 * quality composite) — not a patient's health information — so, like the OIG Exclusion agent, it lives on
 * the commercial plane and is NOT on the HIPAA-audit policy.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the cohort is sourced and intact.
 * ─────────────────────────────────────────────────────────────────────
 *  A benchmark is trustworthy only if the peer cohort it ranks against is intact: every cohort member is a
 *  well-formed { providerId, numeric value }, the reported cohort size equals the actual cohort, and the
 *  target value is numeric. A phantom or omitted peer silently mis-sizes the denominator and misrepresents
 *  the percentile. benchmarkCohortSourced() verifies it; the Agent Fabric enforces it via
 *  policy.benchmark.cohort-sourced. (The sourced gate — mirrors the Claim Lifecycle Agent's states-sourced
 *  and the Access Anomaly Agent's events-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the statistics are exact.
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing the rank statistics from the echoed cohort must reproduce the reported counts, percentile
 *  rank, direction-adjusted effective percentile, median, performance band, and disposition. A miscomputed
 *  percentile or a band that doesn't follow mis-tiers the provider — the whole point is the arithmetic.
 *  benchmarkStatsConsistent() recomputes it end-to-end from the echoed cohort; the Agent Fabric enforces
 *  it via policy.benchmark.stats-consistent. (The load-bearing correctness gate — mirrors the Claim
 *  Lifecycle Agent's transition-consistent and the Member Cost-Share Agent's math-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a provider is never autonomously tiered / penalized / de-networked.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent BENCHMARKS — it never TIERS the provider, ADJUSTS their payment, or REMOVES them from the
 *  network (each is a commercially consequential action that must be authorized); every benchmark is a
 *  RECOMMENDATION requiring a network manager to confirm. benchmarkNoAutonomousTiering() reports the
 *  honest signal the Agent Fabric enforces via policy.benchmark.no-autonomous-tiering. (Mirrors the
 *  Provider Contracting Agent's no-autonomous-term-change and the Timely Filing Agent's
 *  no-autonomous-write-off posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A finding — benchmark-favorable or benchmark-review — is a SAFE, honest OUTPUT: the task COMPLETES (it
 *  carries requiresNetworkReview:true, autoTiered:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (one that mis-sizes the cohort, miscomputes the statistics, or autonomously
 *  tiers) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified benchmarking system.
 * ─────────────────────────────────────────────────────────────────────
 *  The cohorts + metric values below are clearly-labeled ILLUSTRATIVE synthetics chosen to model the SHAPE
 *  of a percentile benchmark deterministically in the demo. Real provider benchmarking uses risk / case-mix
 *  adjustment, statistically valid peer grouping, minimum denominators, confidence intervals, and the
 *  network team's judgment. TIME IS DATA: the finding is a pure function of the request's own values + cohort
 *  (no clock, no randomness), so the same input always yields the same finding, which is what lets the demo,
 *  the seeded trace, and the tests agree.
 */

/** Whether a higher metric value is better (quality) or a lower one is better (cost). */
export type MetricDirection = "higher-is-better" | "lower-is-better";

/** A peer provider in the benchmarking cohort. */
export type CohortMember = {
  /** The peer provider identifier. */
  providerId: string;
  /** The peer provider's metric value. */
  value: number;
};

/** A provider-benchmarking request. */
export type ProviderBenchmarkingRequest = {
  /** Synthetic benchmark reference. */
  benchmarkRef: string;
  /** The target provider being benchmarked. */
  providerRef: string;
  /** The metric being benchmarked (e.g., risk-adjusted-cost-per-episode). */
  metricName: string;
  /** Whether higher or lower is better for this metric. */
  metricDirection: MetricDirection;
  /** The target provider's metric value. */
  targetValue: number;
  /** The peer cohort to rank against. */
  cohort: CohortMember[];
};

/** The performance band of a benchmark. */
export type PerformanceBand =
  | "top-quartile"
  | "above-median"
  | "below-median"
  | "bottom-quartile";

/** The disposition of a benchmark finding. */
export type ProviderBenchmarkingDisposition = "benchmark-favorable" | "benchmark-review";

/** The deterministic finding the agent returns. */
export type ProviderBenchmarkingDetermination = {
  benchmarkRef: string;
  providerRef: string;
  metricName: string;
  metricDirection: MetricDirection;
  targetValue: number;
  /** The cohort echoed so the honesty guards can recompute end-to-end. */
  cohort: CohortMember[];
  /** The number of cohort members. */
  cohortSize: number;
  /** The number of cohort values strictly less than the target. */
  countBelow: number;
  /** The number of cohort values equal to the target. */
  countEqual: number;
  /** The number of cohort values strictly greater than the target. */
  countAbove: number;
  /** The percentile rank of the target by value (midpoint method), 0..100. */
  percentileRank: number;
  /** The direction-adjusted percentile (higher = better regardless of metric), 0..100. */
  effectivePercentile: number;
  /** The cohort median (null for an empty cohort). */
  median: number | null;
  /** The performance band, derived from the effective percentile. */
  performanceBand: PerformanceBand;
  /** The disposition. */
  disposition: ProviderBenchmarkingDisposition;
  /** Always true — a network manager confirms every benchmark. */
  requiresNetworkReview: true;
  /** Always false — the agent never autonomously tiers / penalizes / de-networks. */
  autoTiered: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the cohort is illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Round to 2 decimals deterministically (shared by the engine + the guards). */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** The cohort median (null for empty). Deterministic — sorts a copy ascending. */
function cohortMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? round2((sorted[mid - 1] + sorted[mid]) / 2) : round2(sorted[mid]);
}

/** Derive the performance band from the direction-adjusted effective percentile. */
function deriveBand(effectivePercentile: number): PerformanceBand {
  if (effectivePercentile >= 75) return "top-quartile";
  if (effectivePercentile >= 50) return "above-median";
  if (effectivePercentile >= 25) return "below-median";
  return "bottom-quartile";
}

/** Derive the disposition from the performance band. */
function deriveDisposition(band: PerformanceBand): ProviderBenchmarkingDisposition {
  return band === "top-quartile" || band === "above-median"
    ? "benchmark-favorable"
    : "benchmark-review";
}

/** The core statistics, shared by the engine + the consistency guard so they compute identically. */
function computeStats(
  targetValue: number,
  cohort: CohortMember[],
  direction: MetricDirection
): {
  countBelow: number;
  countEqual: number;
  countAbove: number;
  percentileRank: number;
  effectivePercentile: number;
  median: number | null;
  performanceBand: PerformanceBand;
  disposition: ProviderBenchmarkingDisposition;
} {
  const values = cohort.map((c) => c.value);
  const n = values.length;
  const countBelow = values.filter((v) => v < targetValue).length;
  const countEqual = values.filter((v) => v === targetValue).length;
  const countAbove = values.filter((v) => v > targetValue).length;
  const median = cohortMedian(values);

  if (n === 0) {
    // Nothing to rank against — a benchmark can't be asserted; route to review.
    return {
      countBelow,
      countEqual,
      countAbove,
      percentileRank: 0,
      effectivePercentile: 0,
      median,
      performanceBand: "bottom-quartile",
      disposition: "benchmark-review"
    };
  }

  const percentileRank = round2(((countBelow + 0.5 * countEqual) / n) * 100);
  const effectivePercentile =
    direction === "lower-is-better" ? round2(100 - percentileRank) : percentileRank;
  const performanceBand = deriveBand(effectivePercentile);
  const disposition = deriveDisposition(performanceBand);

  return {
    countBelow,
    countEqual,
    countAbove,
    percentileRank,
    effectivePercentile,
    median,
    performanceBand,
    disposition
  };
}

/**
 * The deterministic benchmarking function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own value + cohort + direction (no randomness, no clock). It counts how many peers fall
 * below / at / above the target, computes the target's percentile rank (midpoint method), adjusts for the
 * metric direction (so higher effective percentile always means better), computes the cohort median,
 * derives the performance band (top-quartile / above-median / below-median / bottom-quartile), and derives
 * the disposition (benchmark-favorable for an above-median-or-better band, benchmark-review otherwise).
 * Nothing is tiered — the finding is handed to a network manager.
 */
export function evaluateProviderBenchmarking(
  request: ProviderBenchmarkingRequest
): ProviderBenchmarkingDetermination {
  const cohort = Array.isArray(request.cohort) ? request.cohort : [];
  const direction: MetricDirection =
    request.metricDirection === "lower-is-better" ? "lower-is-better" : "higher-is-better";
  const stats = computeStats(request.targetValue, cohort, direction);

  const betterWord = direction === "lower-is-better" ? "lower" : "higher";
  const reason =
    stats.disposition === "benchmark-favorable"
      ? `${request.providerRef} is in the ${stats.performanceBand} for ${request.metricName} (effective percentile ${stats.effectivePercentile}, where ${betterWord} is better) — a favorable benchmark.`
      : `${request.providerRef} is in the ${stats.performanceBand} for ${request.metricName} (effective percentile ${stats.effectivePercentile}, where ${betterWord} is better) — flagged for network review.`;

  return {
    benchmarkRef: request.benchmarkRef,
    providerRef: request.providerRef,
    metricName: request.metricName,
    metricDirection: direction,
    targetValue: request.targetValue,
    cohort: cohort.map((c) => ({ providerId: c.providerId, value: c.value })),
    cohortSize: cohort.length,
    countBelow: stats.countBelow,
    countEqual: stats.countEqual,
    countAbove: stats.countAbove,
    percentileRank: stats.percentileRank,
    effectivePercentile: stats.effectivePercentile,
    median: stats.median,
    performanceBand: stats.performanceBand,
    disposition: stats.disposition,
    requiresNetworkReview: true,
    autoTiered: false,
    reason,
    synthetic: true,
    note:
      `Provider benchmarking ${request.benchmarkRef}: ${stats.disposition.toUpperCase()} — ${request.providerRef} at the ${stats.performanceBand} for ${request.metricName} (percentile rank ${stats.percentileRank}, effective ${stats.effectivePercentile}, cohort n=${cohort.length}, median ${stats.median ?? "n/a"}).` +
      " NOT PHI-bearing — provider-level aggregate metrics, not patient health information. Synthetic/illustrative cohort — NOT a certified benchmarking system; real benchmarking uses risk / case-mix adjustment, statistically valid peer grouping, minimum denominators, and confidence intervals. The agent never tiers, penalizes, or de-networks a provider on its own — a network manager confirms every benchmark."
  };
}

/**
 * Cohort-sourced check: is the peer cohort intact? True only when every cohort member is a well-formed
 * { providerId:string, value:number }, the reported cohortSize equals the actual cohort length, and the
 * target value is numeric. Catches a phantom / omitted peer that silently mis-sizes the denominator.
 * Anything evaluateProviderBenchmarking() produces satisfies it. This is the honest signal the route
 * reports to policy.benchmark.cohort-sourced. A non-object / malformed input is a violation.
 */
export function benchmarkCohortSourced(
  decision:
    | {
        cohort?: unknown;
        cohortSize?: unknown;
        targetValue?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (typeof decision.targetValue !== "number" || Number.isNaN(decision.targetValue)) return false;
  const cohort = Array.isArray(decision.cohort) ? decision.cohort : null;
  if (!cohort) return false;
  for (const m of cohort) {
    if (
      !m ||
      typeof m !== "object" ||
      typeof (m as CohortMember).providerId !== "string" ||
      typeof (m as CohortMember).value !== "number" ||
      Number.isNaN((m as CohortMember).value)
    ) {
      return false;
    }
  }
  if (decision.cohortSize !== cohort.length) return false;
  return true;
}

/**
 * Stats-consistent check: recomputing the rank statistics from the echoed cohort must reproduce the
 * reported counts, percentile rank, effective percentile, median, performance band, and disposition. True
 * only when they all match. Catches a miscomputed percentile, a wrong median, or a band / disposition that
 * doesn't follow. The load-bearing correctness gate — it recomputes from the cohort array and does NOT
 * check the cohortSize field (that is the sourced check's job), so it is independent of it. Anything
 * evaluateProviderBenchmarking() produces satisfies it. A non-object input is a violation.
 */
export function benchmarkStatsConsistent(
  decision:
    | {
        targetValue?: unknown;
        metricDirection?: unknown;
        cohort?: unknown;
        countBelow?: unknown;
        countEqual?: unknown;
        countAbove?: unknown;
        percentileRank?: unknown;
        effectivePercentile?: unknown;
        median?: unknown;
        performanceBand?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (typeof decision.targetValue !== "number" || Number.isNaN(decision.targetValue)) return false;
  const cohort = Array.isArray(decision.cohort) ? decision.cohort : null;
  if (!cohort) return false;
  for (const m of cohort) {
    if (!m || typeof (m as CohortMember).value !== "number") return false;
  }
  const direction: MetricDirection =
    decision.metricDirection === "lower-is-better" ? "lower-is-better" : "higher-is-better";

  const stats = computeStats(
    decision.targetValue,
    cohort as CohortMember[],
    direction
  );

  if (decision.countBelow !== stats.countBelow) return false;
  if (decision.countEqual !== stats.countEqual) return false;
  if (decision.countAbove !== stats.countAbove) return false;
  if (decision.percentileRank !== stats.percentileRank) return false;
  if (decision.effectivePercentile !== stats.effectivePercentile) return false;
  if ((decision.median ?? null) !== stats.median) return false;
  if (decision.performanceBand !== stats.performanceBand) return false;
  if (decision.disposition !== stats.disposition) return false;
  return true;
}

/**
 * No-autonomous-tiering check: did the agent avoid autonomously tiering / penalizing / de-networking?
 * True unless the determination reports it auto-tiered (autoTiered:true) or does not require network
 * review (requiresNetworkReview:false). Anything evaluateProviderBenchmarking() produces satisfies it.
 * This is the honest signal the route reports to policy.benchmark.no-autonomous-tiering. A non-object
 * input is a violation.
 */
export function benchmarkNoAutonomousTiering(
  decision:
    | { autoTiered?: boolean; requiresNetworkReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoTiered === true) return false;
  if (decision.requiresNetworkReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a finding — the shape stamped onto the Agent Fabric trace + the
 * response `meta`.
 */
export function providerBenchmarkingSummary(decision: ProviderBenchmarkingDetermination): {
  benchmarkRef: string;
  providerRef: string;
  metricName: string;
  disposition: ProviderBenchmarkingDisposition;
  percentileRank: number;
  effectivePercentile: number;
  performanceBand: PerformanceBand;
  cohortSize: number;
  requiresNetworkReview: boolean;
  synthetic: boolean;
} {
  return {
    benchmarkRef: decision.benchmarkRef,
    providerRef: decision.providerRef,
    metricName: decision.metricName,
    disposition: decision.disposition,
    percentileRank: decision.percentileRank,
    effectivePercentile: decision.effectivePercentile,
    performanceBand: decision.performanceBand,
    cohortSize: decision.cohortSize,
    requiresNetworkReview: decision.requiresNetworkReview,
    synthetic: decision.synthetic
  };
}

/** An ILLUSTRATIVE synthetic peer cohort for a cost metric (lower is better). Clearly labeled synthetic. */
export const DEMO_COST_COHORT: CohortMember[] = [
  { providerId: "prov-a", value: 820 },
  { providerId: "prov-b", value: 910 },
  { providerId: "prov-c", value: 1000 },
  { providerId: "prov-d", value: 1080 },
  { providerId: "prov-e", value: 1150 },
  { providerId: "prov-f", value: 1210 },
  { providerId: "prov-g", value: 1300 },
  { providerId: "prov-h", value: 1400 },
  { providerId: "prov-i", value: 1520 }
];

/** An ILLUSTRATIVE synthetic peer cohort for a quality metric (higher is better). Clearly labeled synthetic. */
export const DEMO_QUALITY_COHORT: CohortMember[] = [
  { providerId: "prov-a", value: 60 },
  { providerId: "prov-b", value: 65 },
  { providerId: "prov-c", value: 70 },
  { providerId: "prov-d", value: 72 },
  { providerId: "prov-e", value: 78 },
  { providerId: "prov-f", value: 80 },
  { providerId: "prov-g", value: 85 },
  { providerId: "prov-h", value: 88 },
  { providerId: "prov-i", value: 92 }
];

/** A representative demo request: a low-cost (favorable) provider — top quartile. Synthetic. */
export const DEMO_PROVIDER_BENCHMARKING_REQUEST: ProviderBenchmarkingRequest = {
  benchmarkRef: "bmk-001",
  providerRef: "prov-target-low",
  metricName: "risk-adjusted-cost-per-episode",
  metricDirection: "lower-is-better",
  targetValue: 900,
  cohort: DEMO_COST_COHORT
};

/** A representative demo request: a high-cost (unfavorable) provider — bottom quartile, flagged. Synthetic. */
export const DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST: ProviderBenchmarkingRequest = {
  benchmarkRef: "bmk-002",
  providerRef: "prov-target-high",
  metricName: "risk-adjusted-cost-per-episode",
  metricDirection: "lower-is-better",
  targetValue: 1450,
  cohort: DEMO_COST_COHORT
};

/**
 * A representative demo request: a low-quality (unfavorable) provider on a higher-is-better metric —
 * bottom quartile, flagged. Demonstrates the direction inversion. Synthetic.
 */
export const DEMO_PROVIDER_BENCHMARKING_QUALITY_REQUEST: ProviderBenchmarkingRequest = {
  benchmarkRef: "bmk-003",
  providerRef: "prov-target-lowqual",
  metricName: "quality-composite-score",
  metricDirection: "higher-is-better",
  targetValue: 63,
  cohort: DEMO_QUALITY_COHORT
};
