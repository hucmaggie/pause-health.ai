import { describe, expect, it } from "vitest";

import {
  DEMO_FINANCIAL_ASSISTANCE_NOT_ELIGIBLE_REQUEST,
  DEMO_FINANCIAL_ASSISTANCE_PARTIAL_REQUEST,
  DEMO_FINANCIAL_ASSISTANCE_PRESUMPTIVE_REQUEST,
  DEMO_FINANCIAL_ASSISTANCE_REQUEST,
  FAP_SCHEDULE,
  PRESUMPTIVE_REASONS,
  ecaGatedOnScreening,
  evaluateFinancialAssistance,
  fapTierForFplPercent,
  finAssistHumanReviewed,
  finAssistScheduleCited,
  financialAssistanceSummary,
  fplForHousehold,
  isFapTier,
  isPresumptiveReason
} from "./financial-assistance";

describe("financial-assistance catalog", () => {
  it("exposes recognized FAP tier ids with unique entries", () => {
    const ids = FAP_SCHEDULE.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isFapTier(id)).toBe(true);
    expect(isFapTier("fap.tier.we-just-decided")).toBe(false);
    expect(isFapTier(undefined)).toBe(false);
  });

  it("exposes recognized presumptive-eligibility reason ids", () => {
    for (const r of PRESUMPTIVE_REASONS) expect(isPresumptiveReason(r.id)).toBe(true);
    expect(isPresumptiveReason("presumptive.nope")).toBe(false);
    expect(isPresumptiveReason(undefined)).toBe(false);
  });

  it("maps FPL percentages to the correct FAP tier bracket", () => {
    expect(fapTierForFplPercent(116).id).toBe("fap.tier.full-charity");
    expect(fapTierForFplPercent(200).id).toBe("fap.tier.full-charity");
    expect(fapTierForFplPercent(254).id).toBe("fap.tier.partial-75");
    expect(fapTierForFplPercent(350).id).toBe("fap.tier.partial-50");
    expect(fapTierForFplPercent(465).id).toBe("fap.tier.not-eligible");
  });
});

describe("fplForHousehold", () => {
  it("returns the table value for tabulated household sizes", () => {
    expect(fplForHousehold(1)).toBe(15060);
    expect(fplForHousehold(3)).toBe(25820);
    expect(fplForHousehold(8)).toBe(52720);
  });

  it("extrapolates by the increment above the largest tabulated household", () => {
    expect(fplForHousehold(9)).toBe(52720 + 5380);
  });

  it("falls back to the 1-person base for a non-positive size", () => {
    expect(fplForHousehold(0)).toBe(15060);
  });
});

describe("evaluateFinancialAssistance · classification", () => {
  it("grants full charity at or below 200% FPL", () => {
    const det = evaluateFinancialAssistance(DEMO_FINANCIAL_ASSISTANCE_REQUEST);
    expect(det.fplPercent).toBe(116);
    expect(det.assistanceTier).toBe("full-charity");
    expect(det.tierId).toBe("fap.tier.full-charity");
    expect(det.discountPct).toBe(100);
    expect(det.requiresHumanReview).toBe(false);
  });

  it("grants a partial-charity discount in the 201-300% FPL bracket", () => {
    const det = evaluateFinancialAssistance(DEMO_FINANCIAL_ASSISTANCE_PARTIAL_REQUEST);
    expect(det.fplPercent).toBe(254);
    expect(det.assistanceTier).toBe("partial-charity");
    expect(det.tierId).toBe("fap.tier.partial-75");
    expect(det.discountPct).toBe(75);
  });

  it("grants presumptive full charity regardless of documented income", () => {
    const det = evaluateFinancialAssistance(DEMO_FINANCIAL_ASSISTANCE_PRESUMPTIVE_REQUEST);
    expect(det.presumptivelyEligible).toBe(true);
    expect(det.assistanceTier).toBe("full-charity");
    expect(det.screeningComplete).toBe(true);
    expect(det.requiresHumanReview).toBe(false);
  });

  it("denies charity above 400% FPL and requires human review", () => {
    const det = evaluateFinancialAssistance(DEMO_FINANCIAL_ASSISTANCE_NOT_ELIGIBLE_REQUEST);
    expect(det.fplPercent).toBe(465);
    expect(det.assistanceTier).toBe("not-eligible");
    expect(det.requiresHumanReview).toBe(true);
  });

  it("allows an ECA only when requested, screening complete, and not eligible", () => {
    const allowed = evaluateFinancialAssistance({
      ...DEMO_FINANCIAL_ASSISTANCE_NOT_ELIGIBLE_REQUEST,
      ecaRequested: true
    });
    expect(allowed.ecaAllowed).toBe(true);

    const notComplete = evaluateFinancialAssistance({
      ...DEMO_FINANCIAL_ASSISTANCE_NOT_ELIGIBLE_REQUEST,
      ecaRequested: true,
      applicationComplete: false
    });
    expect(notComplete.ecaAllowed).toBe(false);

    // An ECA never applies to a patient eligible for charity.
    const eligible = evaluateFinancialAssistance({
      ...DEMO_FINANCIAL_ASSISTANCE_REQUEST,
      ecaRequested: true
    });
    expect(eligible.ecaAllowed).toBe(false);
  });

  it("is deterministic — the same request yields the same determination", () => {
    expect(evaluateFinancialAssistance(DEMO_FINANCIAL_ASSISTANCE_REQUEST)).toEqual(
      evaluateFinancialAssistance(DEMO_FINANCIAL_ASSISTANCE_REQUEST)
    );
  });
});

describe("financial-assistance honesty guards", () => {
  it("ecaGatedOnScreening is false only when an ECA is asserted before screening", () => {
    expect(ecaGatedOnScreening(evaluateFinancialAssistance(DEMO_FINANCIAL_ASSISTANCE_REQUEST))).toBe(
      true
    );
    expect(ecaGatedOnScreening({ ecaAllowed: true, screeningComplete: false })).toBe(false);
    expect(ecaGatedOnScreening({ ecaAllowed: true, screeningComplete: true })).toBe(true);
    expect(ecaGatedOnScreening(null)).toBe(false);
  });

  it("finAssistScheduleCited is true for a catalog tier, false for an off-catalog tier", () => {
    expect(
      finAssistScheduleCited(evaluateFinancialAssistance(DEMO_FINANCIAL_ASSISTANCE_REQUEST))
    ).toBe(true);
    expect(finAssistScheduleCited({ tierId: "fap.tier.we-just-decided" })).toBe(false);
    expect(finAssistScheduleCited(null)).toBe(false);
  });

  it("finAssistHumanReviewed is false only for an autonomous denial", () => {
    expect(
      finAssistHumanReviewed(evaluateFinancialAssistance(DEMO_FINANCIAL_ASSISTANCE_REQUEST))
    ).toBe(true);
    // A grant needs no denial review.
    expect(finAssistHumanReviewed({ assistanceTier: "full-charity", requiresHumanReview: false })).toBe(
      true
    );
    expect(finAssistHumanReviewed({ assistanceTier: "not-eligible", requiresHumanReview: false })).toBe(
      false
    );
    expect(finAssistHumanReviewed({ assistanceTier: "not-eligible", requiresHumanReview: true })).toBe(
      true
    );
    expect(finAssistHumanReviewed(null)).toBe(false);
  });

  it("financialAssistanceSummary carries only structured, PHI-safe fields", () => {
    const summary = financialAssistanceSummary(
      evaluateFinancialAssistance(DEMO_FINANCIAL_ASSISTANCE_REQUEST)
    );
    expect(summary.patientRef).toBe("finassist-patient-001");
    expect(summary.assistanceTier).toBe("full-charity");
    expect(summary.tierId).toBe("fap.tier.full-charity");
    expect(summary.synthetic).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("note");
  });
});
