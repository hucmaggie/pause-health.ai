import { describe, expect, it } from "vitest";

import {
  BENEFIT_PLANS,
  DEMO_COST_SHARE_DEDUCTIBLE_REQUEST,
  DEMO_COST_SHARE_OOP_REQUEST,
  DEMO_COST_SHARE_REQUEST,
  costShareBenefitSourced,
  costShareMathConsistent,
  costShareNoAutonomousCharge,
  costShareSummary,
  evaluateCostShare,
  getBenefitPlan
} from "./member-cost-share";

describe("evaluateCostShare", () => {
  it("splits a mixed deductible + coinsurance claim", () => {
    const d = evaluateCostShare(DEMO_COST_SHARE_REQUEST);
    // deductible remaining 500 → applied 500; post-deductible 3500 * 0.2 = 700; member 1200.
    expect(d.deductibleApplied).toBe(500);
    expect(d.coinsuranceApplied).toBe(700);
    expect(d.oopCapReduction).toBe(0);
    expect(d.memberResponsibility).toBe(1200);
    expect(d.planPaid).toBe(2800);
    expect(d.memberResponsibility + d.planPaid).toBe(d.allowedAmount);
    expect(d.autoPostedCharge).toBe(false);
    expect(d.requiresAdjudicationReview).toBe(true);
  });

  it("caps the member at the remaining out-of-pocket maximum", () => {
    const d = evaluateCostShare(DEMO_COST_SHARE_OOP_REQUEST);
    // deductible met → 0 applied; 5000 * 0.2 = 1000 coinsurance; OOP remaining 500 caps member.
    expect(d.deductibleApplied).toBe(0);
    expect(d.coinsuranceApplied).toBe(1000);
    expect(d.memberResponsibility).toBe(500);
    expect(d.oopCapReduction).toBe(500);
    expect(d.planPaid).toBe(4500);
  });

  it("puts the whole allowed on the member when no deductible is met", () => {
    const d = evaluateCostShare(DEMO_COST_SHARE_DEDUCTIBLE_REQUEST);
    expect(d.deductibleApplied).toBe(800);
    expect(d.coinsuranceApplied).toBe(0);
    expect(d.memberResponsibility).toBe(800);
    expect(d.planPaid).toBe(0);
  });

  it("marks an off-catalog plan as unknown and does not fabricate a split", () => {
    const d = evaluateCostShare({ ...DEMO_COST_SHARE_REQUEST, planId: "plan.nope" });
    expect(d.planName).toBe("unknown plan");
    expect(d.memberResponsibility).toBe(0);
    expect(d.planPaid).toBe(d.allowedAmount);
  });

  it("updates the accumulators after the claim", () => {
    const d = evaluateCostShare(DEMO_COST_SHARE_REQUEST);
    // deductible remaining was 500, all applied → 0 after.
    expect(d.deductibleRemainingAfter).toBe(0);
    // OOP remaining was 5000, member paid 1200 → 3800 after.
    expect(d.oopRemainingAfter).toBe(3800);
  });

  it("is deterministic — same claim yields the same split", () => {
    expect(evaluateCostShare(DEMO_COST_SHARE_OOP_REQUEST)).toEqual(
      evaluateCostShare(DEMO_COST_SHARE_OOP_REQUEST)
    );
  });
});

describe("getBenefitPlan", () => {
  it("resolves a cataloged plan", () => {
    expect(getBenefitPlan("plan.silver-ppo")?.coinsuranceRate).toBe(0.2);
  });
  it("returns undefined for an off-catalog plan", () => {
    expect(getBenefitPlan("plan.nope")).toBeUndefined();
  });
  it("every plan has sane benefit design", () => {
    for (const p of BENEFIT_PLANS) {
      expect(p.deductible).toBeGreaterThanOrEqual(0);
      expect(p.oopMax).toBeGreaterThanOrEqual(p.deductible);
      expect(p.coinsuranceRate).toBeGreaterThanOrEqual(0);
      expect(p.coinsuranceRate).toBeLessThanOrEqual(1);
    }
  });
});

describe("costShareBenefitSourced", () => {
  it("passes a determination on a cataloged plan", () => {
    expect(costShareBenefitSourced(evaluateCostShare(DEMO_COST_SHARE_REQUEST))).toBe(true);
  });
  it("fails an off-catalog plan", () => {
    expect(costShareBenefitSourced({ planId: "plan.nope" })).toBe(false);
  });
  it("fails a null input", () => {
    expect(costShareBenefitSourced(null)).toBe(false);
  });
});

describe("costShareMathConsistent", () => {
  it("passes a produced determination", () => {
    expect(costShareMathConsistent(evaluateCostShare(DEMO_COST_SHARE_OOP_REQUEST))).toBe(true);
  });
  it("fails when member + plan != allowed", () => {
    const d = evaluateCostShare(DEMO_COST_SHARE_REQUEST);
    expect(costShareMathConsistent({ ...d, planPaid: d.planPaid - 800 })).toBe(false);
  });
  it("fails when the member total != deductible + coinsurance - oop cap", () => {
    const d = evaluateCostShare(DEMO_COST_SHARE_REQUEST);
    // Bump member without touching the components → waterfall identity breaks.
    expect(
      costShareMathConsistent({ ...d, memberResponsibility: 1500, planPaid: 2500 })
    ).toBe(false);
  });
  it("fails when coinsurance != rate * post-deductible remainder", () => {
    const d = evaluateCostShare(DEMO_COST_SHARE_REQUEST);
    expect(costShareMathConsistent({ ...d, coinsuranceApplied: 999 })).toBe(false);
  });
  it("fails a negative member share", () => {
    const d = evaluateCostShare(DEMO_COST_SHARE_REQUEST);
    expect(costShareMathConsistent({ ...d, memberResponsibility: -1 })).toBe(false);
  });
  it("fails a null / malformed input", () => {
    expect(costShareMathConsistent(null)).toBe(false);
    expect(costShareMathConsistent({})).toBe(false);
  });
});

describe("costShareNoAutonomousCharge", () => {
  it("passes a produced determination", () => {
    expect(costShareNoAutonomousCharge(evaluateCostShare(DEMO_COST_SHARE_REQUEST))).toBe(true);
  });
  it("fails a posted member charge", () => {
    expect(
      costShareNoAutonomousCharge({ autoPostedCharge: true, requiresAdjudicationReview: true })
    ).toBe(false);
  });
  it("fails an un-reviewed determination", () => {
    expect(
      costShareNoAutonomousCharge({ autoPostedCharge: false, requiresAdjudicationReview: false })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(costShareNoAutonomousCharge(null)).toBe(false);
  });
});

describe("costShareSummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = costShareSummary(evaluateCostShare(DEMO_COST_SHARE_REQUEST));
    expect(s.memberResponsibility).toBe(1200);
    expect(s.planPaid).toBe(2800);
    expect(s.requiresAdjudicationReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
