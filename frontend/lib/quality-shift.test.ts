import { describe, expect, it } from "vitest";

import {
  type CusumPoint,
  DEMO_QUALITY_SHIFT_DOWN_REQUEST,
  DEMO_QUALITY_SHIFT_IN_CONTROL_REQUEST,
  DEMO_QUALITY_SHIFT_REQUEST,
  computeCusum,
  cusumConsistent,
  evaluateQualityShift,
  noAutonomousIntervention,
  observationsSourced,
  qualityShiftSummary
} from "./quality-shift";

describe("computeCusum", () => {
  it("accumulates the two-sided tabular CUSUM", () => {
    const pts = computeCusum(DEMO_QUALITY_SHIFT_REQUEST.observations, 50, 2, 8);
    expect(pts.map((p) => p.cusumHigh)).toEqual([0, 0, 0, 0, 4, 9, 15]);
    expect(pts.every((p, i) => (i < 5 ? !p.alarm : p.alarm))).toBe(true);
  });
});

describe("evaluateQualityShift", () => {
  it("detects a sustained upward shift", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);
    expect(d.signal).toBe("shift-up-detected");
    expect(d.alarmIndex).toBe(5);
    expect(d.alarmDirection).toBe("up");
    expect(d.peakHigh).toBe(15);
    expect(d.peakLow).toBe(0);
    expect(d.requiresQualityReview).toBe(true);
    expect(d.autoActioned).toBe(false);
  });

  it("reports in-control when the measure stays in the slack band", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_IN_CONTROL_REQUEST);
    expect(d.signal).toBe("in-control");
    expect(d.alarmIndex).toBe(-1);
    expect(d.alarmDirection).toBe(null);
    expect(d.peakHigh).toBe(0);
  });

  it("detects a sustained downward shift", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_DOWN_REQUEST);
    expect(d.signal).toBe("shift-down-detected");
    expect(d.alarmIndex).toBe(4);
    expect(d.alarmDirection).toBe("down");
    expect(d.peakLow).toBe(15);
  });

  it("charts one point per observation", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);
    expect(d.points).toHaveLength(d.observations.length);
  });

  it("is deterministic", () => {
    expect(evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST)).toEqual(
      evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST)
    );
  });
});

describe("observationsSourced", () => {
  it("is true for each demo detection", () => {
    expect(observationsSourced(evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST))).toBe(true);
    expect(observationsSourced(evaluateQualityShift(DEMO_QUALITY_SHIFT_IN_CONTROL_REQUEST))).toBe(true);
    expect(observationsSourced(evaluateQualityShift(DEMO_QUALITY_SHIFT_DOWN_REQUEST))).toBe(true);
  });

  it("is false when a phantom point is appended (isolated from cusum-consistent)", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);
    const phantom: CusumPoint = {
      index: 7,
      value: 99,
      cusumHigh: 0,
      cusumLow: 0,
      alarm: false
    };
    const tampered = { ...d, points: [...d.points, phantom] };
    expect(observationsSourced(tampered)).toBe(false);
    // The consistency check filters the phantom out and still recomputes the real chart.
    expect(cusumConsistent(tampered)).toBe(true);
  });

  it("is false when an observation is dropped from the chart", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);
    const tampered = { ...d, points: d.points.filter((p) => p.index !== 6) };
    expect(observationsSourced(tampered)).toBe(false);
  });

  it("is false when a charted value doesn't match the observation", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);
    const tampered = {
      ...d,
      points: d.points.map((p) => (p.index === 4 ? { ...p, value: 999 } : p))
    };
    expect(observationsSourced(tampered)).toBe(false);
  });

  it("is false when a parameter is missing", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);
    expect(observationsSourced({ ...d, threshold: undefined as unknown as number })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(observationsSourced(null)).toBe(false);
  });
});

describe("cusumConsistent", () => {
  it("is true for each demo detection", () => {
    expect(cusumConsistent(evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST))).toBe(true);
    expect(cusumConsistent(evaluateQualityShift(DEMO_QUALITY_SHIFT_IN_CONTROL_REQUEST))).toBe(true);
    expect(cusumConsistent(evaluateQualityShift(DEMO_QUALITY_SHIFT_DOWN_REQUEST))).toBe(true);
  });

  it("is false when a CUSUM value is mis-charted (while observations-sourced stays true)", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);
    const tampered = {
      ...d,
      points: d.points.map((p) => (p.index === 5 ? { ...p, cusumHigh: 3 } : p))
    };
    expect(observationsSourced(tampered)).toBe(true);
    expect(cusumConsistent(tampered)).toBe(false);
  });

  it("is false when the reported signal doesn't match the recompute", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);
    expect(cusumConsistent({ ...d, signal: "in-control" })).toBe(false);
  });

  it("is false when the alarm index is wrong", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);
    expect(cusumConsistent({ ...d, alarmIndex: 4 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(cusumConsistent(undefined)).toBe(false);
  });
});

describe("noAutonomousIntervention", () => {
  it("is true for a produced detection", () => {
    expect(noAutonomousIntervention(evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST))).toBe(true);
  });

  it("is false when auto-actioned", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);
    expect(noAutonomousIntervention({ ...d, autoActioned: true as unknown as false })).toBe(false);
  });

  it("is false when quality review is skipped", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);
    expect(noAutonomousIntervention({ ...d, requiresQualityReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousIntervention(null)).toBe(false);
  });
});

describe("qualityShiftSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);
    expect(qualityShiftSummary(d)).toEqual({
      measureRef: "measure-mammography-screening-rate",
      signal: "shift-up-detected",
      alarmIndex: 5,
      alarmDirection: "up",
      observationCount: 7,
      peakHigh: 15,
      peakLow: 0,
      requiresQualityReview: true,
      synthetic: true
    });
  });
});
