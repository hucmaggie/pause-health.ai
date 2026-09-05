import { describe, expect, it } from "vitest";

import {
  DEMO_SUBROGATION_COMMONFUND_REQUEST,
  DEMO_SUBROGATION_MADEWHOLE_REQUEST,
  DEMO_SUBROGATION_NONE_REQUEST,
  DEMO_SUBROGATION_REQUEST,
  evaluateSubrogation,
  getSubrogationBasis,
  subrogationBasisSourced,
  subrogationNoAutonomousLien,
  subrogationRecoverableWithinPaid,
  subrogationSummary
} from "./subrogation";

describe("evaluateSubrogation", () => {
  it("fully recovers what the plan paid when the settlement exceeds it (review-gated)", () => {
    const det = evaluateSubrogation(DEMO_SUBROGATION_REQUEST);
    expect(det.eligible).toBe(true);
    expect(det.recoverableAmount).toBe(42000);
    expect(det.disposition).toBe("assert-lien-with-review");
    expect(det.requiresHumanReview).toBe(true);
    expect(det.autoAssertedLien).toBe(false);
    expect(det.reductions).toEqual([]);
  });

  it("reduces recovery by the common-fund attorney-fee share", () => {
    const det = evaluateSubrogation(DEMO_SUBROGATION_COMMONFUND_REQUEST);
    expect(det.eligible).toBe(true);
    // 30000 − 33% = 20100.
    expect(det.recoverableAmount).toBe(20100);
    expect(det.reductions.some((r) => r.label.includes("common-fund"))).toBe(true);
    expect(det.disposition).toBe("assert-lien-with-review");
  });

  it("bars recovery under the made-whole doctrine (recoverable 0, notify)", () => {
    const det = evaluateSubrogation(DEMO_SUBROGATION_MADEWHOLE_REQUEST);
    expect(det.eligible).toBe(true);
    expect(det.recoverableAmount).toBe(0);
    expect(det.disposition).toBe("notify-made-whole-bar");
    expect(det.requiresHumanReview).toBe(true);
    expect(det.reductions.some((r) => r.label.includes("made-whole"))).toBe(true);
  });

  it("caps recovery at a settlement below what the plan paid", () => {
    const det = evaluateSubrogation({
      ...DEMO_SUBROGATION_REQUEST,
      planPaidAmount: 42000,
      settlementAmount: 25000
    });
    expect(det.recoverableAmount).toBe(25000);
    expect(det.reductions.some((r) => r.label.includes("settlement"))).toBe(true);
  });

  it("finds no interest for a non-injury claim with no liable third party", () => {
    const det = evaluateSubrogation(DEMO_SUBROGATION_NONE_REQUEST);
    expect(det.eligible).toBe(false);
    expect(det.recoverableAmount).toBe(0);
    expect(det.disposition).toBe("no-subrogation-interest");
    expect(det.requiresHumanReview).toBe(false);
  });

  it("finds no interest when the accident type is none even if flags are set", () => {
    const det = evaluateSubrogation({
      ...DEMO_SUBROGATION_REQUEST,
      accidentType: "none"
    });
    expect(det.eligible).toBe(false);
  });

  it("marks an off-catalog basis as unknown type (not eligible via basis)", () => {
    const det = evaluateSubrogation({
      ...DEMO_SUBROGATION_REQUEST,
      basisId: "basis.made-up"
    });
    expect(det.basisType).toBe("unknown");
    expect(det.eligible).toBe(false);
    expect(getSubrogationBasis(det.basisId)).toBeUndefined();
  });

  it("is deterministic — same case yields identical determination", () => {
    const a = evaluateSubrogation(DEMO_SUBROGATION_COMMONFUND_REQUEST);
    const b = evaluateSubrogation(DEMO_SUBROGATION_COMMONFUND_REQUEST);
    expect(a).toEqual(b);
  });
});

describe("guard functions", () => {
  it("subrogationBasisSourced: false for an off-catalog basis id", () => {
    expect(subrogationBasisSourced(evaluateSubrogation(DEMO_SUBROGATION_REQUEST))).toBe(true);
    expect(subrogationBasisSourced({ basisId: "basis.made-up" })).toBe(false);
    expect(subrogationBasisSourced(null)).toBe(false);
  });

  it("subrogationRecoverableWithinPaid: false when recoverable exceeds paid or settlement", () => {
    expect(
      subrogationRecoverableWithinPaid(evaluateSubrogation(DEMO_SUBROGATION_REQUEST))
    ).toBe(true);
    // Exceeds plan paid.
    expect(
      subrogationRecoverableWithinPaid({ recoverableAmount: 60000, planPaidAmount: 42000 })
    ).toBe(false);
    // Exceeds settlement.
    expect(
      subrogationRecoverableWithinPaid({
        recoverableAmount: 40000,
        planPaidAmount: 42000,
        settlementAmount: 25000
      })
    ).toBe(false);
    // Negative.
    expect(
      subrogationRecoverableWithinPaid({ recoverableAmount: -1, planPaidAmount: 42000 })
    ).toBe(false);
    // Within bounds.
    expect(
      subrogationRecoverableWithinPaid({
        recoverableAmount: 20000,
        planPaidAmount: 42000,
        settlementAmount: 150000
      })
    ).toBe(true);
    expect(subrogationRecoverableWithinPaid(null)).toBe(false);
  });

  it("subrogationNoAutonomousLien: false for auto-asserted lien / eligible-without-review", () => {
    expect(
      subrogationNoAutonomousLien(evaluateSubrogation(DEMO_SUBROGATION_REQUEST))
    ).toBe(true);
    expect(subrogationNoAutonomousLien({ autoAssertedLien: true })).toBe(false);
    expect(
      subrogationNoAutonomousLien({ eligible: true, requiresHumanReview: false })
    ).toBe(false);
    expect(
      subrogationNoAutonomousLien({ eligible: false, requiresHumanReview: false })
    ).toBe(true);
    expect(subrogationNoAutonomousLien(null)).toBe(false);
  });
});

describe("subrogationSummary", () => {
  it("is a compact projection of the determination", () => {
    const det = evaluateSubrogation(DEMO_SUBROGATION_REQUEST);
    expect(subrogationSummary(det)).toEqual({
      caseRef: "subro-case-001",
      basisId: "basis.erisa-plan-reimbursement",
      eligible: true,
      planPaidAmount: 42000,
      recoverableAmount: 42000,
      disposition: "assert-lien-with-review",
      requiresHumanReview: true,
      synthetic: true
    });
  });
});
