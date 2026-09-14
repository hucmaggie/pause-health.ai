import { describe, expect, it } from "vitest";

import {
  DEMO_BENEFIT_ACCUMULATOR_IMMEDIATE_REQUEST,
  DEMO_BENEFIT_ACCUMULATOR_REQUEST,
  DEMO_BENEFIT_ACCUMULATOR_UNDER_REQUEST,
  FenwickTree,
  accumulatorExact,
  benefitAccumulatorSummary,
  crossoverViaFenwick,
  evaluateBenefitAccumulator,
  ledgerSourced,
  noAutonomousAdjust,
  runningTotalsOf
} from "./benefit-accumulator";

describe("FenwickTree", () => {
  it("supports point add + prefix-sum queries", () => {
    const t = new FenwickTree(5);
    [3, 1, 4, 1, 5].forEach((v, i) => t.add(i + 1, v));
    expect(t.prefixSum(1)).toBe(3);
    expect(t.prefixSum(3)).toBe(8);
    expect(t.prefixSum(5)).toBe(14);
  });

  it("lowerBound finds the first prefix >= target", () => {
    const t = new FenwickTree(5);
    [3, 1, 4, 1, 5].forEach((v, i) => t.add(i + 1, v));
    // prefixes are [3, 4, 8, 9, 14]
    expect(t.lowerBound(8)).toBe(3); // 8 first reached at position 3
    expect(t.lowerBound(9)).toBe(4); // 9 first reached at position 4
    expect(t.lowerBound(10)).toBe(5); // 10 first reached at position 5 (prefix 14)
    expect(t.lowerBound(100)).toBe(6); // never reached → n+1
    expect(t.lowerBound(0)).toBe(1);
  });
});

describe("runningTotalsOf / crossoverViaFenwick", () => {
  it("computes the running cumulative totals", () => {
    expect(runningTotalsOf([400, 650, 900, 500, 800, 300])).toEqual([
      400, 1050, 1950, 2450, 3250, 3550
    ]);
  });

  it("locates the crossover via the Fenwick descent", () => {
    expect(crossoverViaFenwick([400, 650, 900, 500, 800, 300], 3000)).toBe(4);
    expect(crossoverViaFenwick([300, 450, 275, 600], 5000)).toBe(-1);
    expect(crossoverViaFenwick([2500, 100, 100], 2000)).toBe(0);
    expect(crossoverViaFenwick([], 100)).toBe(-1);
  });
});

describe("evaluateBenefitAccumulator", () => {
  it("classifies a ledger that meets the OOP max", () => {
    const d = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST);
    expect(d.disposition).toBe("oop-max-met");
    expect(d.totalApplied).toBe(3550);
    expect(d.crossoverIndex).toBe(4);
    expect(d.remainingBeforeOopMax).toBe(0);
    expect(d.requiresAnalystReview).toBe(true);
    expect(d.autoAdjusted).toBe(false);
  });

  it("classifies a ledger under the OOP max", () => {
    const d = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_UNDER_REQUEST);
    expect(d.disposition).toBe("under-oop-max");
    expect(d.crossoverIndex).toBe(-1);
    expect(d.remainingBeforeOopMax).toBe(3375);
  });

  it("handles an immediate crossover at claim 0", () => {
    const d = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_IMMEDIATE_REQUEST);
    expect(d.crossoverIndex).toBe(0);
    expect(d.disposition).toBe("oop-max-met");
  });

  it("is deterministic", () => {
    expect(evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST)).toEqual(
      evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST)
    );
  });
});

describe("ledgerSourced", () => {
  it("is true for each demo determination", () => {
    expect(ledgerSourced(evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST))).toBe(true);
    expect(ledgerSourced(evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_UNDER_REQUEST))).toBe(true);
    expect(ledgerSourced(evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_IMMEDIATE_REQUEST))).toBe(true);
  });

  it("is false for a fabricated running total", () => {
    const d = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST);
    const runningTotals = d.runningTotals.map((t, i) => (i === 2 ? t + 100 : t));
    expect(ledgerSourced({ ...d, runningTotals })).toBe(false);
  });

  it("is false for a dishonest total applied", () => {
    const d = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST);
    expect(ledgerSourced({ ...d, totalApplied: d.totalApplied + 1 })).toBe(false);
  });

  it("is false for an out-of-range crossover index", () => {
    const d = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST);
    expect(ledgerSourced({ ...d, crossoverIndex: 99 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(ledgerSourced(null)).toBe(false);
  });
});

describe("accumulatorExact", () => {
  it("is true for each demo determination", () => {
    expect(accumulatorExact(evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST))).toBe(true);
    expect(accumulatorExact(evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_UNDER_REQUEST))).toBe(true);
  });

  it("is false for a mislocated crossover (while ledger-sourced stays true)", () => {
    const d = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST);
    // Claim 3 (index 3) is a valid in-range index but not where the OOP max is actually crossed (index 4).
    const tampered = { ...d, crossoverIndex: 3 };
    expect(ledgerSourced(tampered)).toBe(true); // in-range index, honest totals
    expect(accumulatorExact(tampered)).toBe(false); // but the Fenwick descent says index 4
  });

  it("is false for running totals that disagree with the Fenwick re-derivation", () => {
    const d = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST);
    const runningTotals = d.runningTotals.map((t, i) => (i === 1 ? t + 50 : t));
    expect(accumulatorExact({ ...d, runningTotals })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(accumulatorExact(undefined)).toBe(false);
  });
});

describe("noAutonomousAdjust", () => {
  it("is true for a produced ledger", () => {
    expect(noAutonomousAdjust(evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST))).toBe(true);
  });

  it("is false when auto-adjusted", () => {
    const d = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST);
    expect(noAutonomousAdjust({ ...d, autoAdjusted: true as unknown as false })).toBe(false);
  });

  it("is false when analyst review is skipped", () => {
    const d = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST);
    expect(noAutonomousAdjust({ ...d, requiresAnalystReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousAdjust(null)).toBe(false);
  });
});

describe("benefitAccumulatorSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST);
    expect(benefitAccumulatorSummary(d)).toEqual({
      ledgerRef: "member-accum-2026-7781",
      disposition: "oop-max-met",
      claimCount: 6,
      totalApplied: 3550,
      oopMax: 3000,
      crossoverIndex: 4,
      remainingBeforeOopMax: 0,
      requiresAnalystReview: true,
      synthetic: true
    });
  });
});
