import { describe, expect, it } from "vitest";

import {
  DEMO_PEAK_WINDOW_ALL_NEGATIVE_REQUEST,
  DEMO_PEAK_WINDOW_ALL_POSITIVE_REQUEST,
  DEMO_PEAK_WINDOW_REQUEST,
  evaluatePeakWindow,
  kadaneMaxSubarray,
  noAutonomousAction,
  peakWindowSummary,
  windowOptimal,
  windowSourced
} from "./peak-window";

describe("kadaneMaxSubarray", () => {
  it("finds the maximum-sum contiguous window", () => {
    expect(kadaneMaxSubarray([6, -9, -4, 12, 18, -5, 14, 19, -22, 8, 3, -6])).toEqual({
      start: 3,
      end: 7,
      sum: 58
    });
  });

  it("returns the least-negative element for an all-negative series", () => {
    expect(kadaneMaxSubarray([-8, -3, -11])).toEqual({ start: 1, end: 1, sum: -3 });
  });

  it("spans the whole series when all positive", () => {
    expect(kadaneMaxSubarray([4, 7, 5, 9])).toEqual({ start: 0, end: 3, sum: 25 });
  });

  it("keeps the earliest window on a tie", () => {
    // Two windows sum to 3: [0,0] and [2,2]; the earliest wins.
    expect(kadaneMaxSubarray([3, -5, 3])).toEqual({ start: 0, end: 0, sum: 3 });
  });

  it("returns an empty window for an empty series", () => {
    expect(kadaneMaxSubarray([])).toEqual({ start: -1, end: -1, sum: 0 });
  });
});

describe("evaluatePeakWindow", () => {
  it("detects a positive peak window", () => {
    const d = evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST);
    expect(d.disposition).toBe("positive-window");
    expect(d.startIndex).toBe(3);
    expect(d.endIndex).toBe(7);
    expect(d.windowSum).toBe(58);
    expect(d.windowLength).toBe(5);
    expect(d.hasPositiveWindow).toBe(true);
    expect(d.requiresAnalystReview).toBe(true);
    expect(d.autoActioned).toBe(false);
  });

  it("reports no positive window for an all-negative series", () => {
    const d = evaluatePeakWindow(DEMO_PEAK_WINDOW_ALL_NEGATIVE_REQUEST);
    expect(d.disposition).toBe("no-positive-window");
    expect(d.windowSum).toBe(-3);
  });

  it("spans the whole series when all positive", () => {
    const d = evaluatePeakWindow(DEMO_PEAK_WINDOW_ALL_POSITIVE_REQUEST);
    expect(d.startIndex).toBe(0);
    expect(d.endIndex).toBe(3);
    expect(d.windowSum).toBe(25);
  });

  it("is deterministic", () => {
    expect(evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST)).toEqual(
      evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST)
    );
  });
});

describe("windowSourced", () => {
  it("is true for each demo window", () => {
    expect(windowSourced(evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST))).toBe(true);
    expect(windowSourced(evaluatePeakWindow(DEMO_PEAK_WINDOW_ALL_NEGATIVE_REQUEST))).toBe(true);
    expect(windowSourced(evaluatePeakWindow(DEMO_PEAK_WINDOW_ALL_POSITIVE_REQUEST))).toBe(true);
  });

  it("is false for an out-of-range / fabricated window (isolated from window-optimal)", () => {
    const d = evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST);
    // Claim the optimal sum (58) on an invalid range that doesn't actually sum to it.
    const tampered = { ...d, startIndex: 0, endIndex: 1, windowLength: 2 };
    expect(windowSourced(tampered)).toBe(false); // [0,1] nets 6 + -9 = -3, not 58
    expect(windowOptimal(tampered)).toBe(true); // windowSum 58 is still the true optimum
  });

  it("is false when windowSum overstates the range's actual sum", () => {
    const d = evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST);
    expect(windowSourced({ ...d, windowSum: 999 })).toBe(false);
  });

  it("is false when windowLength doesn't match the bounds", () => {
    const d = evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST);
    expect(windowSourced({ ...d, windowLength: 99 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(windowSourced(null)).toBe(false);
  });
});

describe("windowOptimal", () => {
  it("is true for each demo window", () => {
    expect(windowOptimal(evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST))).toBe(true);
    expect(windowOptimal(evaluatePeakWindow(DEMO_PEAK_WINDOW_ALL_NEGATIVE_REQUEST))).toBe(true);
  });

  it("is false for a sub-optimal window (while window-sourced stays true)", () => {
    const d = evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST);
    // A real, honestly-summed but sub-optimal window: Oct→Nov (indices 9..10) nets 8 + 3 = 11 < 58.
    const tampered = {
      ...d,
      startIndex: 9,
      endIndex: 10,
      windowSum: 11,
      windowLength: 2,
      hasPositiveWindow: true,
      disposition: "positive-window" as const
    };
    expect(windowSourced(tampered)).toBe(true);
    expect(windowOptimal(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(windowOptimal(undefined)).toBe(false);
  });
});

describe("noAutonomousAction", () => {
  it("is true for a produced window", () => {
    expect(noAutonomousAction(evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST))).toBe(true);
  });

  it("is false when auto-actioned", () => {
    const d = evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST);
    expect(noAutonomousAction({ ...d, autoActioned: true as unknown as false })).toBe(false);
  });

  it("is false when analyst review is skipped", () => {
    const d = evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST);
    expect(noAutonomousAction({ ...d, requiresAnalystReview: false as unknown as true })).toBe(
      false
    );
  });

  it("is false for a non-object", () => {
    expect(noAutonomousAction(null)).toBe(false);
  });
});

describe("peakWindowSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST);
    expect(peakWindowSummary(d)).toEqual({
      seriesRef: "net-new-arr-2026",
      disposition: "positive-window",
      periodCount: 12,
      startIndex: 3,
      endIndex: 7,
      windowSum: 58,
      windowLength: 5,
      requiresAnalystReview: true,
      synthetic: true
    });
  });
});
