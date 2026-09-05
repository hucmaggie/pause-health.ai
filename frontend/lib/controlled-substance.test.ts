import { describe, expect, it } from "vitest";

import {
  DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST,
  DEMO_CONTROLLED_SUBSTANCE_OPIOID_BENZO_REQUEST,
  DEMO_CONTROLLED_SUBSTANCE_REQUEST,
  controlledSubstanceGuidelineSourced,
  controlledSubstanceMmeComputed,
  controlledSubstanceNoAutonomousDecision,
  controlledSubstanceSummary,
  evaluateControlledSubstance,
  getControlledSubstanceGuideline
} from "./controlled-substance";

describe("evaluateControlledSubstance", () => {
  it("classifies a modest opioid with no history as low risk", () => {
    const det = evaluateControlledSubstance(DEMO_CONTROLLED_SUBSTANCE_REQUEST);
    expect(det.totalMmePerDay).toBe(30);
    expect(det.exceedsCaution).toBe(false);
    expect(det.riskLevel).toBe("low");
    expect(det.disposition).toBe("proceed-low-risk");
    expect(det.requiresPrescriberReview).toBe(false);
    expect(det.autoDecision).toBe(false);
  });

  it("sums stacked opioids over the high-risk threshold", () => {
    const det = evaluateControlledSubstance(DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST);
    expect(det.proposedOpioidMmePerDay).toBe(60);
    expect(det.concurrentOpioidMmePerDay).toBe(40);
    expect(det.totalMmePerDay).toBe(100);
    expect(det.exceedsHighRisk).toBe(true);
    expect(det.riskLevel).toBe("high");
    expect(det.disposition).toBe("prescriber-review");
    expect(det.requiresPrescriberReview).toBe(true);
  });

  it("flags a concurrent opioid + benzodiazepine as high risk", () => {
    const det = evaluateControlledSubstance(DEMO_CONTROLLED_SUBSTANCE_OPIOID_BENZO_REQUEST);
    expect(det.concurrentOpioidBenzo).toBe(true);
    expect(det.riskLevel).toBe("high");
    expect(det.requiresPrescriberReview).toBe(true);
    expect(det.riskFactors.some((f) => f.includes("benzodiazepine"))).toBe(true);
  });

  it("does not count a non-opioid proposed drug toward the opioid total", () => {
    const det = evaluateControlledSubstance({
      requestRef: "cs-x",
      guidelineId: "guideline.cdc-2022-mme",
      proposed: {
        drug: "alprazolam 1",
        drugClass: "benzodiazepine",
        mmePerDay: 0,
        daysSupply: 30,
        prescriber: "dr-a",
        pharmacy: "ph-1"
      },
      pdmpHistory: []
    });
    expect(det.proposedOpioidMmePerDay).toBe(0);
    expect(det.totalMmePerDay).toBe(0);
    expect(det.riskLevel).toBe("low");
  });

  it("handles an off-catalog guideline with zero thresholds", () => {
    const det = evaluateControlledSubstance({
      ...DEMO_CONTROLLED_SUBSTANCE_REQUEST,
      guidelineId: "guideline.made-up"
    });
    expect(det.cautionMme).toBe(0);
    expect(getControlledSubstanceGuideline(det.guidelineId)).toBeUndefined();
  });

  it("is deterministic — same request yields identical determination", () => {
    const a = evaluateControlledSubstance(DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST);
    const b = evaluateControlledSubstance(DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST);
    expect(a).toEqual(b);
  });
});

describe("guard functions", () => {
  it("controlledSubstanceGuidelineSourced: false for an off-catalog guideline id", () => {
    expect(
      controlledSubstanceGuidelineSourced(
        evaluateControlledSubstance(DEMO_CONTROLLED_SUBSTANCE_REQUEST)
      )
    ).toBe(true);
    expect(controlledSubstanceGuidelineSourced({ guidelineId: "guideline.made-up" })).toBe(false);
    expect(controlledSubstanceGuidelineSourced(null)).toBe(false);
  });

  it("controlledSubstanceMmeComputed: false when the total does not match the sum", () => {
    expect(
      controlledSubstanceMmeComputed(
        evaluateControlledSubstance(DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST)
      )
    ).toBe(true);
    expect(
      controlledSubstanceMmeComputed({
        proposedOpioidMmePerDay: 60,
        concurrentOpioidMmePerDay: 40,
        totalMmePerDay: 30
      })
    ).toBe(false);
    expect(
      controlledSubstanceMmeComputed({
        proposedOpioidMmePerDay: 60,
        concurrentOpioidMmePerDay: 40,
        totalMmePerDay: 100
      })
    ).toBe(true);
    expect(controlledSubstanceMmeComputed(null)).toBe(false);
  });

  it("controlledSubstanceNoAutonomousDecision: false when auto-decided or high-unreviewed", () => {
    expect(
      controlledSubstanceNoAutonomousDecision(
        evaluateControlledSubstance(DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST)
      )
    ).toBe(true);
    expect(
      controlledSubstanceNoAutonomousDecision({
        autoDecision: true,
        riskLevel: "high",
        requiresPrescriberReview: true
      })
    ).toBe(false);
    expect(
      controlledSubstanceNoAutonomousDecision({
        autoDecision: false,
        riskLevel: "high",
        requiresPrescriberReview: false
      })
    ).toBe(false);
    expect(
      controlledSubstanceNoAutonomousDecision({
        autoDecision: false,
        riskLevel: "low",
        requiresPrescriberReview: false
      })
    ).toBe(true);
    expect(controlledSubstanceNoAutonomousDecision(null)).toBe(false);
  });
});

describe("controlledSubstanceSummary", () => {
  it("is a compact projection of the determination", () => {
    const det = evaluateControlledSubstance(DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST);
    const s = controlledSubstanceSummary(det);
    expect(s).toEqual({
      requestRef: "cs-request-002",
      guidelineId: "guideline.cdc-2022-mme",
      totalMmePerDay: 100,
      concurrentOpioidBenzo: false,
      distinctPrescribers: 1,
      distinctPharmacies: 1,
      riskLevel: "high",
      disposition: "prescriber-review",
      requiresPrescriberReview: true,
      synthetic: true
    });
  });
});
