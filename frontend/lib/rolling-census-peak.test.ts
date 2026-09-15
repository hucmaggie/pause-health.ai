import { describe, expect, it } from "vitest";

import {
  DEMO_ROLLING_CENSUS_REQUEST,
  DEMO_ROLLING_CENSUS_SPIKE_REQUEST,
  DEMO_ROLLING_CENSUS_WITHIN_REQUEST,
  dequeExact,
  evaluateRollingCensus,
  noAutonomousDivert,
  rollingCensusSummary,
  slidingWindowMax,
  windowMaxesByDirectScan,
  windowsSourced
} from "./rolling-census-peak";

describe("slidingWindowMax / windowMaxesByDirectScan", () => {
  it("computes the sliding-window maximum via the monotonic deque", () => {
    expect(slidingWindowMax(DEMO_ROLLING_CENSUS_REQUEST.readings, 3)).toEqual([
      15, 20, 20, 20, 19, 16, 17, 18
    ]);
  });

  it("the two independent methods agree (monotonic deque vs direct scan)", () => {
    for (const req of [
      DEMO_ROLLING_CENSUS_REQUEST,
      DEMO_ROLLING_CENSUS_WITHIN_REQUEST,
      DEMO_ROLLING_CENSUS_SPIKE_REQUEST
    ]) {
      expect(slidingWindowMax(req.readings, req.windowSize)).toEqual(
        windowMaxesByDirectScan(req.readings, req.windowSize)
      );
    }
  });

  it("exercises back-eviction on a decreasing run then a spike", () => {
    expect(slidingWindowMax(DEMO_ROLLING_CENSUS_SPIKE_REQUEST.readings, 3)).toEqual([9, 8, 7, 12, 12, 12]);
  });

  it("returns [] when the window is larger than the series or non-positive", () => {
    expect(slidingWindowMax([1, 2], 5)).toEqual([]);
    expect(slidingWindowMax([1, 2], 0)).toEqual([]);
  });
});

describe("evaluateRollingCensus", () => {
  it("classifies an over-capacity unit", () => {
    const d = evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST);
    expect(d.disposition).toBe("over-capacity");
    expect(d.windowMaxes).toEqual([15, 20, 20, 20, 19, 16, 17, 18]);
    expect(d.overCapacityWindows).toEqual([1, 2, 3, 4]);
    expect(d.peakCensus).toBe(20);
    expect(d.requiresSupervisorReview).toBe(true);
    expect(d.autoDiverted).toBe(false);
  });

  it("classifies a within-capacity unit", () => {
    const d = evaluateRollingCensus(DEMO_ROLLING_CENSUS_WITHIN_REQUEST);
    expect(d.disposition).toBe("within-capacity");
    expect(d.overCapacityWindows).toEqual([]);
  });

  it("handles a spike after a decreasing run", () => {
    const d = evaluateRollingCensus(DEMO_ROLLING_CENSUS_SPIKE_REQUEST);
    expect(d.overCapacityWindows).toEqual([3, 4, 5]);
    expect(d.peakCensus).toBe(12);
  });

  it("is deterministic", () => {
    expect(evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST)).toEqual(
      evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST)
    );
  });
});

describe("windowsSourced", () => {
  it("is true for each demo determination", () => {
    expect(windowsSourced(evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST))).toBe(true);
    expect(windowsSourced(evaluateRollingCensus(DEMO_ROLLING_CENSUS_WITHIN_REQUEST))).toBe(true);
    expect(windowsSourced(evaluateRollingCensus(DEMO_ROLLING_CENSUS_SPIKE_REQUEST))).toBe(true);
  });

  it("is false for a fabricated window max", () => {
    const d = evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST);
    const windowMaxes = d.windowMaxes.map((m, i) => (i === 0 ? m + 5 : m));
    expect(windowsSourced({ ...d, windowMaxes })).toBe(false);
  });

  it("is false for a mis-listed over-capacity window set", () => {
    const d = evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST);
    expect(windowsSourced({ ...d, overCapacityWindows: [1, 2, 3] })).toBe(false);
  });

  it("is false for a dishonest peak census", () => {
    const d = evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST);
    expect(windowsSourced({ ...d, peakCensus: 22 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(windowsSourced(null)).toBe(false);
  });
});

describe("dequeExact", () => {
  it("is true for each demo determination", () => {
    expect(dequeExact(evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST))).toBe(true);
    expect(dequeExact(evaluateRollingCensus(DEMO_ROLLING_CENSUS_SPIKE_REQUEST))).toBe(true);
  });

  it("is false for a maxima array the deque wouldn't produce", () => {
    const d = evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST);
    const windowMaxes = d.windowMaxes.map((m, i) => (i === 5 ? m + 1 : m));
    expect(dequeExact({ ...d, windowMaxes })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(dequeExact(undefined)).toBe(false);
  });
});

describe("noAutonomousDivert", () => {
  it("is true for a produced report", () => {
    expect(noAutonomousDivert(evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST))).toBe(true);
  });

  it("is false when auto-diverted", () => {
    const d = evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST);
    expect(noAutonomousDivert({ ...d, autoDiverted: true as unknown as false })).toBe(false);
  });

  it("is false when supervisor review is skipped", () => {
    const d = evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST);
    expect(noAutonomousDivert({ ...d, requiresSupervisorReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousDivert(null)).toBe(false);
  });
});

describe("rollingCensusSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST);
    expect(rollingCensusSummary(d)).toEqual({
      unitRef: "care-unit-census-2026-5501",
      disposition: "over-capacity",
      readingCount: 10,
      windowSize: 3,
      windowCount: 8,
      capacity: 18,
      peakCensus: 20,
      overCapacityCount: 4,
      requiresSupervisorReview: true,
      synthetic: true
    });
  });
});
