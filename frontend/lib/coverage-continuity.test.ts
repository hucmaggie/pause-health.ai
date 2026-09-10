import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_GAP_DAYS,
  DEMO_COVERAGE_CONTINUITY_BREAK_REQUEST,
  DEMO_COVERAGE_CONTINUITY_OVERLAP_REQUEST,
  DEMO_COVERAGE_CONTINUITY_REQUEST,
  coverageContinuitySummary,
  coverageMathConsistent,
  coverageNoAutonomousDetermination,
  coverageSegmentsSourced,
  evaluateCoverageContinuity,
  fromEpochDay,
  toEpochDay
} from "./coverage-continuity";

describe("date helpers", () => {
  it("round-trips an ISO date through epoch days", () => {
    const d = toEpochDay("2024-01-01");
    expect(d).not.toBeNull();
    expect(fromEpochDay(d!)).toBe("2024-01-01");
  });
  it("rejects an invalid date", () => {
    expect(toEpochDay("2024-13-01")).toBeNull();
    expect(toEpochDay("not-a-date")).toBeNull();
    expect(toEpochDay("2024-02-30")).toBeNull();
  });
});

describe("evaluateCoverageContinuity", () => {
  it("finds continuous coverage under the threshold (14-day gap)", () => {
    const d = evaluateCoverageContinuity(DEMO_COVERAGE_CONTINUITY_REQUEST);
    expect(d.disposition).toBe("continuous");
    expect(d.mergedSpans).toHaveLength(2);
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0].gapDays).toBe(14);
    expect(d.gaps[0].significant).toBe(false);
    expect(d.hasSignificantBreak).toBe(false);
    expect(d.totalCoveredDays).toBe(182 + 170);
    expect(d.maxGapDays).toBe(DEFAULT_MAX_GAP_DAYS);
    expect(d.requiresEligibilityReview).toBe(true);
    expect(d.autoDetermined).toBe(false);
  });

  it("finds a significant break over the threshold (153-day gap)", () => {
    const d = evaluateCoverageContinuity(DEMO_COVERAGE_CONTINUITY_BREAK_REQUEST);
    expect(d.disposition).toBe("significant-break");
    expect(d.gaps[0].gapDays).toBe(153);
    expect(d.gaps[0].significant).toBe(true);
    expect(d.hasSignificantBreak).toBe(true);
  });

  it("merges overlapping segments into a single span", () => {
    const d = evaluateCoverageContinuity(DEMO_COVERAGE_CONTINUITY_OVERLAP_REQUEST);
    expect(d.disposition).toBe("continuous");
    expect(d.mergedSpans).toHaveLength(1);
    expect(d.mergedSpans[0].startDate).toBe("2024-01-01");
    expect(d.mergedSpans[0].endDate).toBe("2024-12-31");
    expect(d.gaps).toHaveLength(0);
    expect(d.totalCoveredDays).toBe(366); // 2024 leap year
  });

  it("merges adjacent segments (0-day gap → one span)", () => {
    const d = evaluateCoverageContinuity({
      requestRef: "r",
      memberRef: "m",
      asOfDate: "2025-01-01",
      segments: [
        { segmentId: "a", source: "x", startDate: "2024-01-01", endDate: "2024-06-30" },
        { segmentId: "b", source: "y", startDate: "2024-07-01", endDate: "2024-12-31" }
      ]
    });
    expect(d.mergedSpans).toHaveLength(1);
    expect(d.gaps).toHaveLength(0);
  });

  it("skips invalid / reversed-date segments", () => {
    const d = evaluateCoverageContinuity({
      requestRef: "r",
      memberRef: "m",
      asOfDate: "2025-01-01",
      segments: [
        { segmentId: "good", source: "x", startDate: "2024-01-01", endDate: "2024-06-30" },
        { segmentId: "bad", source: "y", startDate: "2024-12-31", endDate: "2024-01-01" }
      ]
    });
    expect(d.invalidSegments).toEqual(["bad"]);
    expect(d.segments).toHaveLength(1);
  });

  it("honors a custom maxGapDays threshold", () => {
    const d = evaluateCoverageContinuity({ ...DEMO_COVERAGE_CONTINUITY_REQUEST, maxGapDays: 7 });
    // The 14-day gap now exceeds a 7-day threshold → significant break.
    expect(d.hasSignificantBreak).toBe(true);
    expect(d.disposition).toBe("significant-break");
  });

  it("is deterministic", () => {
    expect(evaluateCoverageContinuity(DEMO_COVERAGE_CONTINUITY_REQUEST)).toEqual(
      evaluateCoverageContinuity(DEMO_COVERAGE_CONTINUITY_REQUEST)
    );
  });
});

describe("coverageSegmentsSourced", () => {
  it("passes produced determinations", () => {
    expect(coverageSegmentsSourced(evaluateCoverageContinuity(DEMO_COVERAGE_CONTINUITY_REQUEST))).toBe(true);
    expect(coverageSegmentsSourced(evaluateCoverageContinuity(DEMO_COVERAGE_CONTINUITY_OVERLAP_REQUEST))).toBe(true);
  });
  it("fails a span whose boundary is not from any segment", () => {
    expect(
      coverageSegmentsSourced({
        mergedSpans: [{ startDay: 100, endDay: 200 }],
        segments: [{ startDay: 300, endDay: 400 }]
      })
    ).toBe(false);
  });
  it("fails a dropped segment (not within any span)", () => {
    expect(
      coverageSegmentsSourced({
        mergedSpans: [{ startDay: 100, endDay: 200 }],
        segments: [
          { startDay: 100, endDay: 200 },
          { startDay: 500, endDay: 600 }
        ]
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(coverageSegmentsSourced(null)).toBe(false);
  });
});

describe("coverageMathConsistent", () => {
  it("passes produced determinations", () => {
    expect(coverageMathConsistent(evaluateCoverageContinuity(DEMO_COVERAGE_CONTINUITY_REQUEST))).toBe(true);
    expect(coverageMathConsistent(evaluateCoverageContinuity(DEMO_COVERAGE_CONTINUITY_BREAK_REQUEST))).toBe(true);
  });
  it("fails a miscounted total", () => {
    expect(
      coverageMathConsistent({
        mergedSpans: [{ startDay: 0, endDay: 181, coveredDays: 182 }],
        gaps: [],
        totalCoveredDays: 999,
        maxGapDays: 63,
        hasSignificantBreak: false
      })
    ).toBe(false);
  });
  it("fails a wrong inclusive covered-day length", () => {
    expect(
      coverageMathConsistent({
        mergedSpans: [{ startDay: 0, endDay: 181, coveredDays: 100 }],
        gaps: [],
        totalCoveredDays: 100,
        maxGapDays: 63,
        hasSignificantBreak: false
      })
    ).toBe(false);
  });
  it("fails a break flag that doesn't match the threshold", () => {
    expect(
      coverageMathConsistent({
        mergedSpans: [
          { startDay: 0, endDay: 90, coveredDays: 91 },
          { startDay: 244, endDay: 365, coveredDays: 122 }
        ],
        gaps: [{ afterSpanIndex: 0, gapDays: 153, significant: true }],
        totalCoveredDays: 213,
        maxGapDays: 63,
        hasSignificantBreak: false // wrong: a significant gap exists
      })
    ).toBe(false);
  });
  it("fails overlapping (unmerged) spans", () => {
    expect(
      coverageMathConsistent({
        mergedSpans: [
          { startDay: 0, endDay: 100, coveredDays: 101 },
          { startDay: 50, endDay: 200, coveredDays: 151 }
        ],
        gaps: [],
        totalCoveredDays: 252,
        maxGapDays: 63,
        hasSignificantBreak: false
      })
    ).toBe(false);
  });
});

describe("coverageNoAutonomousDetermination", () => {
  it("passes a produced determination", () => {
    expect(coverageNoAutonomousDetermination(evaluateCoverageContinuity(DEMO_COVERAGE_CONTINUITY_REQUEST))).toBe(true);
  });
  it("fails an autonomously-issued determination", () => {
    expect(
      coverageNoAutonomousDetermination({ autoDetermined: true, requiresEligibilityReview: true })
    ).toBe(false);
  });
  it("fails an un-reviewed determination", () => {
    expect(
      coverageNoAutonomousDetermination({ autoDetermined: false, requiresEligibilityReview: false })
    ).toBe(false);
  });
});

describe("coverageContinuitySummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = coverageContinuitySummary(evaluateCoverageContinuity(DEMO_COVERAGE_CONTINUITY_REQUEST));
    expect(s.disposition).toBe("continuous");
    expect(s.spanCount).toBe(2);
    expect(s.gapCount).toBe(1);
    expect(s.totalCoveredDays).toBe(352);
    expect(s.hasSignificantBreak).toBe(false);
    expect(s.requiresEligibilityReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
