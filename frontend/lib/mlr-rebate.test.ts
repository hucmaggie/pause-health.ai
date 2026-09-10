import { describe, expect, it } from "vitest";

import {
  DEMO_MLR_REBATE_MEETS_REQUEST,
  DEMO_MLR_REBATE_REQUEST,
  DEMO_MLR_REBATE_SMALL_GROUP_REQUEST,
  MLR_STANDARDS,
  apportionLargestRemainder,
  evaluateMlrRebate,
  getMlrStandard,
  mlrAllocationConsistent,
  mlrInputsSourced,
  mlrNoAutonomousDisbursement,
  mlrRebateSummary
} from "./mlr-rebate";

describe("MLR_STANDARDS catalog", () => {
  it("has the ACA market standards", () => {
    expect(MLR_STANDARDS.individual).toBe(0.8);
    expect(MLR_STANDARDS["small-group"]).toBe(0.8);
    expect(MLR_STANDARDS["large-group"]).toBe(0.85);
    expect(getMlrStandard("nope")).toBeUndefined();
  });
});

describe("apportionLargestRemainder", () => {
  it("sums exactly to the total (no penny lost)", () => {
    const alloc = apportionLargestRemainder(2110000, [40000000, 35000000, 25000000]);
    expect(alloc.reduce((s, x) => s + x, 0)).toBe(2110000);
    expect(alloc).toEqual([844000, 738500, 527500]);
  });

  it("distributes the leftover cent to the largest fractional remainder", () => {
    // total 100 cents across weights 1,1,1 → 33.33 each; leftover 1 goes to index 0 (tie → lowest index)
    const alloc = apportionLargestRemainder(100, [1, 1, 1]);
    expect(alloc.reduce((s, x) => s + x, 0)).toBe(100);
    expect(alloc).toEqual([34, 33, 33]);
  });

  it("returns zeros for a zero total or empty weights", () => {
    expect(apportionLargestRemainder(0, [1, 2])).toEqual([0, 0]);
    expect(apportionLargestRemainder(500, [])).toEqual([]);
    expect(apportionLargestRemainder(500, [0, 0])).toEqual([0, 0]);
  });
});

describe("evaluateMlrRebate", () => {
  it("individual plan below standard → rebate apportioned exactly", () => {
    const d = evaluateMlrRebate(DEMO_MLR_REBATE_REQUEST);
    expect(d.mlr).toBe(0.7789);
    expect(d.meetsStandard).toBe(false);
    expect(d.totalRebate).toBe(21100);
    expect(d.allocations.map((a) => a.rebate)).toEqual([8440, 7385, 5275]);
    expect(d.allocatedTotal).toBe(21100);
    expect(d.requiresTreasuryReview).toBe(true);
    expect(d.autoDisbursed).toBe(false);
  });

  it("large-group plan meeting standard → no rebate", () => {
    const d = evaluateMlrRebate(DEMO_MLR_REBATE_MEETS_REQUEST);
    expect(d.mlr).toBe(0.8958);
    expect(d.meetsStandard).toBe(true);
    expect(d.totalRebate).toBe(0);
    expect(d.allocations.every((a) => a.rebate === 0)).toBe(true);
  });

  it("small-group with uneven premiums → penny-exact split summing to total", () => {
    const d = evaluateMlrRebate(DEMO_MLR_REBATE_SMALL_GROUP_REQUEST);
    expect(d.meetsStandard).toBe(false);
    expect(d.totalRebate).toBe(8400);
    expect(d.allocatedTotal).toBe(8400);
    const sum = d.allocations.reduce((s, a) => s + a.rebate, 0);
    expect(Math.round(sum * 100)).toBe(Math.round(d.totalRebate * 100));
    expect(mlrAllocationConsistent(d)).toBe(true);
  });

  it("is deterministic — same request yields the same determination", () => {
    expect(evaluateMlrRebate(DEMO_MLR_REBATE_REQUEST)).toEqual(
      evaluateMlrRebate(DEMO_MLR_REBATE_REQUEST)
    );
  });
});

describe("mlrInputsSourced", () => {
  it("passes a produced determination", () => {
    expect(mlrInputsSourced(evaluateMlrRebate(DEMO_MLR_REBATE_REQUEST))).toBe(true);
  });
  it("fails an off-catalog market", () => {
    expect(mlrInputsSourced({ market: "platinum-market", standard: 0.5 })).toBe(false);
  });
  it("fails a mis-stated standard for a real market", () => {
    expect(mlrInputsSourced({ market: "individual", standard: 0.5 })).toBe(false);
  });
  it("fails a null input", () => {
    expect(mlrInputsSourced(null)).toBe(false);
  });
});

describe("mlrAllocationConsistent", () => {
  it("passes produced determinations", () => {
    expect(mlrAllocationConsistent(evaluateMlrRebate(DEMO_MLR_REBATE_REQUEST))).toBe(true);
    expect(mlrAllocationConsistent(evaluateMlrRebate(DEMO_MLR_REBATE_MEETS_REQUEST))).toBe(true);
  });
  it("fails when the allocations don't sum to the total", () => {
    const d = evaluateMlrRebate(DEMO_MLR_REBATE_REQUEST);
    const broken = {
      ...d,
      allocations: [
        { subscriberRef: "sub-A", premiumPaid: 400000, rebate: 8400 },
        { subscriberRef: "sub-B", premiumPaid: 350000, rebate: 7350 },
        { subscriberRef: "sub-C", premiumPaid: 250000, rebate: 5250 }
      ]
    };
    expect(mlrAllocationConsistent(broken)).toBe(false);
  });
  it("fails when the MLR doesn't match the recomputation", () => {
    const d = evaluateMlrRebate(DEMO_MLR_REBATE_REQUEST);
    expect(mlrAllocationConsistent({ ...d, mlr: 0.99 })).toBe(false);
  });
  it("fails when the total rebate is wrong", () => {
    const d = evaluateMlrRebate(DEMO_MLR_REBATE_REQUEST);
    expect(mlrAllocationConsistent({ ...d, totalRebate: 30000 })).toBe(false);
  });
  it("fails a negative allocation", () => {
    const d = evaluateMlrRebate(DEMO_MLR_REBATE_REQUEST);
    const broken = {
      ...d,
      allocations: [
        { subscriberRef: "sub-A", premiumPaid: 400000, rebate: 30000 },
        { subscriberRef: "sub-B", premiumPaid: 350000, rebate: -8900 },
        { subscriberRef: "sub-C", premiumPaid: 250000, rebate: 0 }
      ]
    };
    expect(mlrAllocationConsistent(broken)).toBe(false);
  });
  it("fails a null input", () => {
    expect(mlrAllocationConsistent(null)).toBe(false);
  });
});

describe("mlrNoAutonomousDisbursement", () => {
  it("passes a produced determination", () => {
    expect(mlrNoAutonomousDisbursement(evaluateMlrRebate(DEMO_MLR_REBATE_REQUEST))).toBe(true);
  });
  it("fails an autonomous disbursement", () => {
    expect(
      mlrNoAutonomousDisbursement({ autoDisbursed: true, requiresTreasuryReview: true })
    ).toBe(false);
  });
  it("fails an un-reviewed determination", () => {
    expect(
      mlrNoAutonomousDisbursement({ autoDisbursed: false, requiresTreasuryReview: false })
    ).toBe(false);
  });
});

describe("mlrRebateSummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = mlrRebateSummary(evaluateMlrRebate(DEMO_MLR_REBATE_REQUEST));
    expect(s.totalRebate).toBe(21100);
    expect(s.meetsStandard).toBe(false);
    expect(s.subscriberCount).toBe(3);
    expect(s.requiresTreasuryReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
