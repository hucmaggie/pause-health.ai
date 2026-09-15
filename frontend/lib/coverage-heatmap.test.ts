import { describe, expect, it } from "vitest";

import {
  DEMO_COVERAGE_HEATMAP_COVERED_REQUEST,
  DEMO_COVERAGE_HEATMAP_REQUEST,
  DEMO_COVERAGE_HEATMAP_SPIKE_REQUEST,
  accumulateCoverage,
  accumulationExact,
  coverageByDirectCount,
  coverageHeatmapSummary,
  coverageSourced,
  evaluateCoverageHeatmap,
  noAutonomousStaff
} from "./coverage-heatmap";

describe("accumulateCoverage / coverageByDirectCount", () => {
  it("materializes the concurrent coverage per slot via the difference array", () => {
    expect(accumulateCoverage(DEMO_COVERAGE_HEATMAP_REQUEST.intervals, 12)).toEqual([
      2, 2, 3, 3, 3, 3, 1, 1, 3, 3, 2, 2
    ]);
  });

  it("the two independent methods agree (difference array vs direct count)", () => {
    for (const req of [
      DEMO_COVERAGE_HEATMAP_REQUEST,
      DEMO_COVERAGE_HEATMAP_COVERED_REQUEST,
      DEMO_COVERAGE_HEATMAP_SPIKE_REQUEST
    ]) {
      expect(accumulateCoverage(req.intervals, req.slotCount)).toEqual(
        coverageByDirectCount(req.intervals, req.slotCount)
      );
    }
  });

  it("ignores zero-width and zero-staff intervals", () => {
    expect(accumulateCoverage([{ label: "z", start: 4, end: 4, staff: 5 }], 8)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0
    ]);
  });

  it("returns [] for zero slots", () => {
    expect(accumulateCoverage([{ label: "a", start: 0, end: 3, staff: 1 }], 0)).toEqual([]);
  });
});

describe("evaluateCoverageHeatmap", () => {
  it("classifies an understaffed schedule", () => {
    const d = evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST);
    expect(d.disposition).toBe("understaffed");
    expect(d.understaffedSlots).toEqual([6, 7]);
    expect(d.minCoverage).toBe(1);
    expect(d.maxCoverage).toBe(3);
    expect(d.requiresManagerReview).toBe(true);
    expect(d.autoStaffed).toBe(false);
  });

  it("classifies a fully-covered schedule", () => {
    const d = evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_COVERED_REQUEST);
    expect(d.disposition).toBe("fully-covered");
    expect(d.understaffedSlots).toEqual([]);
    expect(d.minCoverage).toBe(3);
  });

  it("handles a spiky schedule with many overlaps", () => {
    const d = evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_SPIKE_REQUEST);
    expect(d.coverage).toEqual([1, 1, 1, 5, 5, 1, 1, 1]);
    expect(d.understaffedSlots).toEqual([0, 1, 2, 5, 6, 7]);
  });

  it("is deterministic", () => {
    expect(evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST)).toEqual(
      evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST)
    );
  });
});

describe("coverageSourced", () => {
  it("is true for each demo determination", () => {
    expect(coverageSourced(evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST))).toBe(true);
    expect(coverageSourced(evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_COVERED_REQUEST))).toBe(true);
    expect(coverageSourced(evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_SPIKE_REQUEST))).toBe(true);
  });

  it("is false for a fabricated coverage value", () => {
    const d = evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST);
    const coverage = d.coverage.map((c, i) => (i === 6 ? c + 5 : c));
    expect(coverageSourced({ ...d, coverage })).toBe(false);
  });

  it("is false for a mis-listed under-staffed slot set", () => {
    const d = evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST);
    expect(coverageSourced({ ...d, understaffedSlots: [6] })).toBe(false);
  });

  it("is false for a dishonest min/max", () => {
    const d = evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST);
    expect(coverageSourced({ ...d, minCoverage: 2 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(coverageSourced(null)).toBe(false);
  });
});

describe("accumulationExact", () => {
  it("is true for each demo determination", () => {
    expect(accumulationExact(evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST))).toBe(true);
    expect(accumulationExact(evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_SPIKE_REQUEST))).toBe(true);
  });

  it("is false for a coverage array that the difference array wouldn't produce (while under-staffed slots look right)", () => {
    const d = evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST);
    // Inflate a NON-understaffed slot's coverage (slot 2, from 3 to 4): the under-staffed slot set [6,7] is
    // unchanged and min/max shift, so this is a targeted materialization corruption.
    const coverage = d.coverage.map((c, i) => (i === 2 ? c + 1 : c));
    expect(accumulationExact({ ...d, coverage })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(accumulationExact(undefined)).toBe(false);
  });
});

describe("noAutonomousStaff", () => {
  it("is true for a produced heatmap", () => {
    expect(noAutonomousStaff(evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST))).toBe(true);
  });

  it("is false when auto-staffed", () => {
    const d = evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST);
    expect(noAutonomousStaff({ ...d, autoStaffed: true as unknown as false })).toBe(false);
  });

  it("is false when manager review is skipped", () => {
    const d = evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST);
    expect(noAutonomousStaff({ ...d, requiresManagerReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousStaff(null)).toBe(false);
  });
});

describe("coverageHeatmapSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST);
    expect(coverageHeatmapSummary(d)).toEqual({
      scheduleRef: "care-unit-coverage-2026-4408",
      disposition: "understaffed",
      slotCount: 12,
      intervalCount: 4,
      requiredMin: 2,
      minCoverage: 1,
      maxCoverage: 3,
      understaffedCount: 2,
      requiresManagerReview: true,
      synthetic: true
    });
  });
});
