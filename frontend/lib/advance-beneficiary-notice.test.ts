import { describe, expect, it } from "vitest";

import {
  DEMO_ABN_EXCLUDED_REQUEST,
  DEMO_ABN_NONCOVERED_REQUEST,
  DEMO_ABN_REQUEST,
  DEMO_ABN_WITH_ABN_REQUEST,
  abnCoverageRuleSourced,
  abnNoAutonomousBeneficiaryLiability,
  abnRequiredWhenNoncovered,
  abnSummary,
  evaluateAbn,
  getCoverageRule
} from "./advance-beneficiary-notice";

describe("evaluateAbn", () => {
  it("passes a service that meets its coverage criteria (likely covered, no ABN)", () => {
    const det = evaluateAbn(DEMO_ABN_REQUEST);
    expect(det.coverageAssessment).toBe("likely-covered");
    expect(det.abnRequired).toBe(false);
    expect(det.abnValid).toBe(false);
    expect(det.patientMayBeBilled).toBe(false);
    expect(det.modifier).toBe("none");
    expect(det.disposition).toBe("proceed-covered");
    expect(det.requiresHumanReview).toBe(false);
    expect(det.autoAssignedLiability).toBe(false);
  });

  it("requires an ABN before the service for a likely-non-covered service with no ABN (GZ)", () => {
    const det = evaluateAbn(DEMO_ABN_NONCOVERED_REQUEST);
    expect(det.coverageAssessment).toBe("likely-non-covered");
    expect(det.abnRequired).toBe(true);
    expect(det.abnValid).toBe(false);
    expect(det.patientMayBeBilled).toBe(false); // provider liable, beneficiary not billed
    expect(det.modifier).toBe("GZ");
    expect(det.disposition).toBe("issue-abn-before-service");
    expect(det.requiresHumanReview).toBe(true);
  });

  it("bills the beneficiary for a non-covered service with a valid pre-service ABN (GA)", () => {
    const det = evaluateAbn(DEMO_ABN_WITH_ABN_REQUEST);
    expect(det.coverageAssessment).toBe("likely-non-covered");
    expect(det.abnRequired).toBe(true);
    expect(det.abnValid).toBe(true);
    expect(det.patientMayBeBilled).toBe(true);
    expect(det.modifier).toBe("GA");
    expect(det.disposition).toBe("bill-beneficiary-with-abn");
    expect(det.requiresHumanReview).toBe(true);
  });

  it("marks a statutorily-excluded service beneficiary-liable (GY)", () => {
    const det = evaluateAbn(DEMO_ABN_EXCLUDED_REQUEST);
    expect(det.coverageAssessment).toBe("statutorily-excluded");
    expect(det.abnRequired).toBe(false); // voluntary ABN, not mandatory
    expect(det.patientMayBeBilled).toBe(true);
    expect(det.modifier).toBe("GY");
    expect(det.disposition).toBe("notify-statutory-exclusion");
    expect(det.requiresHumanReview).toBe(true);
  });

  it("does NOT bill the beneficiary when an ABN was issued but signed after the service", () => {
    const det = evaluateAbn({
      ...DEMO_ABN_WITH_ABN_REQUEST,
      abnSignedBeforeService: false
    });
    expect(det.abnValid).toBe(false);
    expect(det.patientMayBeBilled).toBe(false);
    expect(det.modifier).toBe("GZ");
  });

  it("treats a frequency-limited service within the limit as likely covered", () => {
    const det = evaluateAbn({
      ...DEMO_ABN_WITH_ABN_REQUEST,
      frequencyExceeded: false
    });
    expect(det.coverageAssessment).toBe("likely-covered");
    expect(det.modifier).toBe("none");
  });

  it("handles an off-catalog rule with an unknown category and human review", () => {
    const det = evaluateAbn({
      ...DEMO_ABN_REQUEST,
      coverageRuleId: "rule.abn.made-up"
    });
    expect(det.coverageCategory).toBe("unknown");
    expect(getCoverageRule(det.coverageRuleId)).toBeUndefined();
    expect(det.requiresHumanReview).toBe(true);
  });

  it("is deterministic — same service yields identical determination", () => {
    const a = evaluateAbn(DEMO_ABN_WITH_ABN_REQUEST);
    const b = evaluateAbn(DEMO_ABN_WITH_ABN_REQUEST);
    expect(a).toEqual(b);
  });
});

describe("guard functions", () => {
  it("abnCoverageRuleSourced: false for an off-catalog rule id", () => {
    expect(abnCoverageRuleSourced(evaluateAbn(DEMO_ABN_REQUEST))).toBe(true);
    expect(abnCoverageRuleSourced({ coverageRuleId: "rule.abn.made-up" })).toBe(false);
    expect(abnCoverageRuleSourced(null)).toBe(false);
  });

  it("abnRequiredWhenNoncovered: false when a non-covered service claims no ABN required", () => {
    expect(abnRequiredWhenNoncovered(evaluateAbn(DEMO_ABN_NONCOVERED_REQUEST))).toBe(true);
    expect(
      abnRequiredWhenNoncovered({ coverageAssessment: "likely-non-covered", abnRequired: false })
    ).toBe(false);
    expect(
      abnRequiredWhenNoncovered({ coverageAssessment: "likely-covered", abnRequired: false })
    ).toBe(true);
    expect(abnRequiredWhenNoncovered(null)).toBe(false);
  });

  it("abnNoAutonomousBeneficiaryLiability: false for auto-assign / bill-without-valid-ABN / unreviewed", () => {
    expect(
      abnNoAutonomousBeneficiaryLiability(evaluateAbn(DEMO_ABN_NONCOVERED_REQUEST))
    ).toBe(true);
    // Auto-assigned liability.
    expect(abnNoAutonomousBeneficiaryLiability({ autoAssignedLiability: true })).toBe(false);
    // Billed for a non-covered service with no valid ABN.
    expect(
      abnNoAutonomousBeneficiaryLiability({
        coverageAssessment: "likely-non-covered",
        patientMayBeBilled: true,
        abnValid: false,
        requiresHumanReview: true
      })
    ).toBe(false);
    // Non-covered / excluded assessment without human review.
    expect(
      abnNoAutonomousBeneficiaryLiability({
        coverageAssessment: "statutorily-excluded",
        requiresHumanReview: false
      })
    ).toBe(false);
    // A valid-ABN non-covered bill under review is fine.
    expect(
      abnNoAutonomousBeneficiaryLiability({
        coverageAssessment: "likely-non-covered",
        patientMayBeBilled: true,
        abnValid: true,
        requiresHumanReview: true
      })
    ).toBe(true);
    expect(abnNoAutonomousBeneficiaryLiability(null)).toBe(false);
  });
});

describe("abnSummary", () => {
  it("is a compact projection of the determination", () => {
    const det = evaluateAbn(DEMO_ABN_REQUEST);
    const s = abnSummary(det);
    expect(s).toEqual({
      requestRef: "abn-req-001",
      coverageRuleId: "rule.abn.vitamin-d-testing",
      coverageAssessment: "likely-covered",
      abnRequired: false,
      abnValid: false,
      patientMayBeBilled: false,
      modifier: "none",
      disposition: "proceed-covered",
      requiresHumanReview: false,
      synthetic: true
    });
  });
});
