import { describe, expect, it } from "vitest";

import {
  DEMO_KPI_TREND_DECLINING_REQUEST,
  DEMO_KPI_TREND_FLAT_REQUEST,
  DEMO_KPI_TREND_REQUEST,
  classifyTrend,
  computeRegression,
  evaluateKpiTrend,
  fitConsistent,
  kpiTrendSummary,
  noAutonomousCommit,
  seriesSourced
} from "./kpi-trend";

describe("computeRegression", () => {
  it("fits a perfectly linear rising series (slope 11, R² 1)", () => {
    const { slope, intercept, rSquared } = computeRegression(DEMO_KPI_TREND_REQUEST.observations);
    expect(slope).toBeCloseTo(11, 9);
    expect(intercept).toBeCloseTo(20, 9);
    expect(rSquared).toBeCloseTo(1, 9);
  });

  it("defines R² as 1 for a constant series (zero variance)", () => {
    const { slope, rSquared } = computeRegression(DEMO_KPI_TREND_FLAT_REQUEST.observations);
    expect(slope).toBeCloseTo(0, 9);
    expect(rSquared).toBe(1);
  });

  it("handles a single observation degenerately", () => {
    expect(computeRegression([{ index: 3, value: 7 }])).toEqual({ slope: 0, intercept: 7, rSquared: 1 });
  });
});

describe("classifyTrend", () => {
  it("classifies against the flat tolerance", () => {
    expect(classifyTrend(11, 0.5)).toBe("rising");
    expect(classifyTrend(-8, 0.5)).toBe("declining");
    expect(classifyTrend(0.2, 0.5)).toBe("flat");
    expect(classifyTrend(-0.2, 0.5)).toBe("flat");
  });
});

describe("evaluateKpiTrend", () => {
  it("classifies a rising series and projects it forward", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);
    expect(d.trend).toBe("rising");
    expect(d.slope).toBeCloseTo(11, 9);
    expect(d.projection).toBeCloseTo(86, 9);
    expect(d.points).toHaveLength(6);
    expect(d.requiresAnalystReview).toBe(true);
    expect(d.autoCommitted).toBe(false);
  });

  it("classifies a flat series", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_FLAT_REQUEST);
    expect(d.trend).toBe("flat");
    expect(d.projection).toBeCloseTo(50, 9);
  });

  it("classifies a declining series and projects it forward", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_DECLINING_REQUEST);
    expect(d.trend).toBe("declining");
    expect(d.slope).toBeCloseTo(-8, 9);
    expect(d.projection).toBeCloseTo(32, 9);
  });

  it("is deterministic", () => {
    expect(evaluateKpiTrend(DEMO_KPI_TREND_REQUEST)).toEqual(evaluateKpiTrend(DEMO_KPI_TREND_REQUEST));
  });
});

describe("seriesSourced", () => {
  it("is true for each demo fit", () => {
    expect(seriesSourced(evaluateKpiTrend(DEMO_KPI_TREND_REQUEST))).toBe(true);
    expect(seriesSourced(evaluateKpiTrend(DEMO_KPI_TREND_FLAT_REQUEST))).toBe(true);
    expect(seriesSourced(evaluateKpiTrend(DEMO_KPI_TREND_DECLINING_REQUEST))).toBe(true);
  });

  it("is false when a phantom point is added (isolated from fit-consistent)", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);
    const tampered = {
      ...d,
      points: [...d.points, { index: 99, value: 999, fitted: 0, residual: 0 }]
    };
    expect(seriesSourced(tampered)).toBe(false);
    // The fit recomputes from observations (which the phantom never touched) and still holds.
    expect(fitConsistent(tampered)).toBe(true);
  });

  it("is false when an observation is dropped from the points", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);
    expect(seriesSourced({ ...d, points: d.points.slice(1) })).toBe(false);
  });

  it("is false when a point's value doesn't match the observation", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);
    const tampered = {
      ...d,
      points: d.points.map((p) => (p.index === 0 ? { ...p, value: 999 } : p))
    };
    expect(seriesSourced(tampered)).toBe(false);
  });

  it("is false when a fit parameter is missing", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);
    expect(seriesSourced({ ...d, horizon: undefined })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(seriesSourced(null)).toBe(false);
  });
});

describe("fitConsistent", () => {
  it("is true for each demo fit", () => {
    expect(fitConsistent(evaluateKpiTrend(DEMO_KPI_TREND_REQUEST))).toBe(true);
    expect(fitConsistent(evaluateKpiTrend(DEMO_KPI_TREND_FLAT_REQUEST))).toBe(true);
    expect(fitConsistent(evaluateKpiTrend(DEMO_KPI_TREND_DECLINING_REQUEST))).toBe(true);
  });

  it("is false for a mis-fit slope (while series-sourced stays true)", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);
    const tampered = { ...d, slope: 5, projection: 50 };
    expect(seriesSourced(tampered)).toBe(true);
    expect(fitConsistent(tampered)).toBe(false);
  });

  it("is false for a fabricated projection", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);
    expect(fitConsistent({ ...d, projection: 999 })).toBe(false);
  });

  it("is false for a wrong trend classification", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);
    expect(fitConsistent({ ...d, trend: "declining" })).toBe(false);
  });

  it("is false for a mis-computed point residual", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);
    const tampered = {
      ...d,
      points: d.points.map((p) => (p.index === 2 ? { ...p, residual: 42 } : p))
    };
    expect(fitConsistent(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(fitConsistent(undefined)).toBe(false);
  });
});

describe("noAutonomousCommit", () => {
  it("is true for a produced fit", () => {
    expect(noAutonomousCommit(evaluateKpiTrend(DEMO_KPI_TREND_REQUEST))).toBe(true);
  });

  it("is false when auto-committed", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);
    expect(noAutonomousCommit({ ...d, autoCommitted: true as unknown as false })).toBe(false);
  });

  it("is false when analyst review is skipped", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);
    expect(noAutonomousCommit({ ...d, requiresAnalystReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousCommit(null)).toBe(false);
  });
});

describe("kpiTrendSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);
    const s = kpiTrendSummary(d);
    expect(s.seriesRef).toBe("kpi-provider-org-adoption");
    expect(s.trend).toBe("rising");
    expect(s.observationCount).toBe(6);
    expect(s.projection).toBeCloseTo(86, 9);
    expect(s.requiresAnalystReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
