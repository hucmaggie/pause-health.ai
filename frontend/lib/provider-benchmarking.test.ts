import { describe, expect, it } from "vitest";

import {
  type ProviderBenchmarkingDetermination,
  DEMO_COST_COHORT,
  DEMO_PROVIDER_BENCHMARKING_QUALITY_REQUEST,
  DEMO_PROVIDER_BENCHMARKING_REQUEST,
  DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST,
  benchmarkCohortSourced,
  benchmarkNoAutonomousTiering,
  benchmarkStatsConsistent,
  evaluateProviderBenchmarking,
  providerBenchmarkingSummary
} from "./provider-benchmarking";

describe("evaluateProviderBenchmarking", () => {
  it("ranks a low-cost provider in the top quartile (lower-is-better)", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REQUEST);
    expect(d.countBelow).toBe(1);
    expect(d.countEqual).toBe(0);
    expect(d.countAbove).toBe(8);
    expect(d.percentileRank).toBe(11.11);
    expect(d.effectivePercentile).toBe(88.89);
    expect(d.median).toBe(1150);
    expect(d.performanceBand).toBe("top-quartile");
    expect(d.disposition).toBe("benchmark-favorable");
    expect(d.requiresNetworkReview).toBe(true);
    expect(d.autoTiered).toBe(false);
    expect(d.cohortSize).toBe(9);
  });

  it("flags a high-cost provider in the bottom quartile for review (lower-is-better)", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST);
    expect(d.countBelow).toBe(8);
    expect(d.percentileRank).toBe(88.89);
    expect(d.effectivePercentile).toBe(11.11);
    expect(d.performanceBand).toBe("bottom-quartile");
    expect(d.disposition).toBe("benchmark-review");
  });

  it("honors the direction inversion — a low score on a higher-is-better metric is bottom-quartile", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_QUALITY_REQUEST);
    expect(d.metricDirection).toBe("higher-is-better");
    expect(d.percentileRank).toBe(11.11);
    // Higher-is-better: effective percentile equals the raw percentile.
    expect(d.effectivePercentile).toBe(11.11);
    expect(d.performanceBand).toBe("bottom-quartile");
    expect(d.disposition).toBe("benchmark-review");
  });

  it("counts equal cohort values with the midpoint method", () => {
    const d = evaluateProviderBenchmarking({
      benchmarkRef: "b",
      providerRef: "p",
      metricName: "m",
      metricDirection: "higher-is-better",
      targetValue: 1000,
      cohort: [
        { providerId: "x", value: 1000 },
        { providerId: "y", value: 1000 },
        { providerId: "z", value: 500 },
        { providerId: "w", value: 1500 }
      ]
    });
    expect(d.countBelow).toBe(1);
    expect(d.countEqual).toBe(2);
    expect(d.countAbove).toBe(1);
    // (1 + 0.5*2) / 4 * 100 = 50
    expect(d.percentileRank).toBe(50);
  });

  it("handles an empty cohort as a review with a null median", () => {
    const d = evaluateProviderBenchmarking({
      benchmarkRef: "b",
      providerRef: "p",
      metricName: "m",
      metricDirection: "lower-is-better",
      targetValue: 100,
      cohort: []
    });
    expect(d.cohortSize).toBe(0);
    expect(d.percentileRank).toBe(0);
    expect(d.effectivePercentile).toBe(0);
    expect(d.median).toBeNull();
    expect(d.performanceBand).toBe("bottom-quartile");
    expect(d.disposition).toBe("benchmark-review");
  });

  it("is deterministic — identical inputs yield identical findings", () => {
    const a = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST);
    const b = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST);
    expect(a).toEqual(b);
  });

  it("echoes the cohort so the guards can recompute end-to-end", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REQUEST);
    expect(d.cohort).toEqual(
      DEMO_COST_COHORT.map((c) => ({ providerId: c.providerId, value: c.value }))
    );
  });

  it("computes an even-length cohort median as the midpoint of the two middles", () => {
    const d = evaluateProviderBenchmarking({
      benchmarkRef: "b",
      providerRef: "p",
      metricName: "m",
      metricDirection: "higher-is-better",
      targetValue: 5,
      cohort: [
        { providerId: "a", value: 10 },
        { providerId: "b", value: 20 },
        { providerId: "c", value: 30 },
        { providerId: "d", value: 40 }
      ]
    });
    expect(d.median).toBe(25);
  });
});

describe("benchmarkCohortSourced", () => {
  it("is true for a produced determination", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST);
    expect(benchmarkCohortSourced(d)).toBe(true);
  });

  it("is false when the reported cohort size doesn't match the cohort", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST);
    expect(benchmarkCohortSourced({ ...d, cohortSize: 14 })).toBe(false);
  });

  it("is false when a cohort member is malformed", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST);
    const tampered = {
      ...d,
      cohort: [...d.cohort, { providerId: "ghost", value: Number.NaN }],
      cohortSize: d.cohortSize + 1
    };
    expect(benchmarkCohortSourced(tampered)).toBe(false);
  });

  it("is false when the target value is not numeric", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST);
    expect(
      benchmarkCohortSourced({ ...d, targetValue: "high" as unknown as number })
    ).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(benchmarkCohortSourced(null)).toBe(false);
  });
});

describe("benchmarkStatsConsistent", () => {
  it("is true for each demo finding", () => {
    expect(
      benchmarkStatsConsistent(evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REQUEST))
    ).toBe(true);
    expect(
      benchmarkStatsConsistent(
        evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST)
      )
    ).toBe(true);
    expect(
      benchmarkStatsConsistent(
        evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_QUALITY_REQUEST)
      )
    ).toBe(true);
  });

  it("is false when the percentile is inverted (miscomputed)", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST);
    expect(
      benchmarkStatsConsistent({
        ...d,
        percentileRank: 11.11,
        effectivePercentile: 88.89,
        performanceBand: "top-quartile",
        disposition: "benchmark-favorable"
      })
    ).toBe(false);
  });

  it("is false when only the disposition doesn't follow the band", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST);
    expect(benchmarkStatsConsistent({ ...d, disposition: "benchmark-favorable" })).toBe(false);
  });

  it("is false when the median is wrong", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST);
    expect(benchmarkStatsConsistent({ ...d, median: 9999 })).toBe(false);
  });

  it("ignores the cohortSize field — isolated from the sourced check", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST);
    const tampered = { ...d, cohortSize: 14 };
    expect(benchmarkStatsConsistent(tampered)).toBe(true);
    expect(benchmarkCohortSourced(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(benchmarkStatsConsistent(null)).toBe(false);
  });
});

describe("benchmarkNoAutonomousTiering", () => {
  it("is true for a produced determination", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REQUEST);
    expect(benchmarkNoAutonomousTiering(d)).toBe(true);
  });

  it("is false when the provider was tiered autonomously", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REQUEST);
    expect(
      benchmarkNoAutonomousTiering({
        ...(d as ProviderBenchmarkingDetermination),
        autoTiered: true as unknown as false
      })
    ).toBe(false);
  });

  it("is false when network review is skipped", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REQUEST);
    expect(
      benchmarkNoAutonomousTiering({
        ...(d as ProviderBenchmarkingDetermination),
        requiresNetworkReview: false as unknown as true
      })
    ).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(benchmarkNoAutonomousTiering(null)).toBe(false);
  });
});

describe("providerBenchmarkingSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateProviderBenchmarking(DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST);
    const s = providerBenchmarkingSummary(d);
    expect(s).toEqual({
      benchmarkRef: "bmk-002",
      providerRef: "prov-target-high",
      metricName: "risk-adjusted-cost-per-episode",
      disposition: "benchmark-review",
      percentileRank: 88.89,
      effectivePercentile: 11.11,
      performanceBand: "bottom-quartile",
      cohortSize: 9,
      requiresNetworkReview: true,
      synthetic: true
    });
  });
});
