import { describe, expect, it } from "vitest";

import {
  DEMO_MINIMUM_NECESSARY_BULK_REQUEST,
  DEMO_MINIMUM_NECESSARY_INSCOPE_REQUEST,
  DEMO_MINIMUM_NECESSARY_REQUEST,
  DEMO_MINIMUM_NECESSARY_TREATMENT_REQUEST,
  PURPOSE_RULES,
  evaluateMinimumNecessary,
  getPurposeRule,
  isPurposeRule,
  minNecNoAutonomousOverDisclosure,
  minNecPurposeSourced,
  minNecScoped,
  minimumNecessarySummary
} from "./minimum-necessary";

describe("purpose-of-use catalog", () => {
  it("has stable ids and marks treatment as exempt", () => {
    const ids = PURPOSE_RULES.map((r) => r.id);
    expect(ids).toContain("purpose.treatment");
    expect(ids).toContain("purpose.payment");
    expect(ids).toContain("purpose.research");
    expect(ids).toContain("purpose.marketing");
    expect(new Set(ids).size).toBe(ids.length);
    expect(getPurposeRule("purpose.treatment")?.minimumNecessaryExempt).toBe(true);
    expect(getPurposeRule("purpose.payment")?.minimumNecessaryExempt).toBe(false);
  });

  it("recognizes catalog ids and rejects off-catalog ones", () => {
    expect(isPurposeRule("purpose.payment")).toBe(true);
    expect(isPurposeRule("purpose.made-up")).toBe(false);
    expect(isPurposeRule(7)).toBe(false);
    expect(getPurposeRule("nope")).toBeUndefined();
  });
});

describe("evaluateMinimumNecessary", () => {
  it("withholds an out-of-scope clinical note for a payment request", () => {
    const det = evaluateMinimumNecessary(DEMO_MINIMUM_NECESSARY_REQUEST);
    expect(det.releasedCount).toBe(4);
    expect(det.withheldCount).toBe(1);
    expect(det.minimumNecessary).toBe(false);
    expect(det.requiresHumanReview).toBe(true);
    const note = det.fieldDecisions.find((d) => d.category === "clinical-notes");
    expect(note?.decision).toBe("withhold");
  });

  it("releases everything for a fully in-scope payment request (no review)", () => {
    const det = evaluateMinimumNecessary(DEMO_MINIMUM_NECESSARY_INSCOPE_REQUEST);
    expect(det.withheldCount).toBe(0);
    expect(det.minimumNecessary).toBe(true);
    expect(det.requiresHumanReview).toBe(false);
    expect(det.fieldDecisions.every((d) => d.decision === "release")).toBe(true);
  });

  it("releases all fields for an exempt treatment purpose", () => {
    const det = evaluateMinimumNecessary(DEMO_MINIMUM_NECESSARY_TREATMENT_REQUEST);
    expect(det.exempt).toBe(true);
    expect(det.withheldCount).toBe(0);
    expect(det.releasedCount).toBe(4);
    expect(det.requiresHumanReview).toBe(false);
  });

  it("requires human review for an in-scope but bulk cohort pull", () => {
    const det = evaluateMinimumNecessary(DEMO_MINIMUM_NECESSARY_BULK_REQUEST);
    expect(det.withheldCount).toBe(0);
    expect(det.minimumNecessary).toBe(true);
    expect(det.bulk).toBe(true);
    expect(det.requiresHumanReview).toBe(true);
  });

  it("withholds every field when the purpose is not a recorded rule", () => {
    const det = evaluateMinimumNecessary({
      ...DEMO_MINIMUM_NECESSARY_REQUEST,
      purposeId: "purpose.made-up"
    });
    expect(det.releasedCount).toBe(0);
    expect(det.requiresHumanReview).toBe(true);
  });

  it("is deterministic — same request yields identical determination", () => {
    const a = evaluateMinimumNecessary(DEMO_MINIMUM_NECESSARY_REQUEST);
    const b = evaluateMinimumNecessary(DEMO_MINIMUM_NECESSARY_REQUEST);
    expect(a).toEqual(b);
  });
});

describe("guard functions", () => {
  it("minNecPurposeSourced: true for a produced determination, false for an off-catalog purpose", () => {
    expect(minNecPurposeSourced(evaluateMinimumNecessary(DEMO_MINIMUM_NECESSARY_REQUEST))).toBe(true);
    expect(minNecPurposeSourced({ purposeId: "purpose.made-up" })).toBe(false);
    expect(minNecPurposeSourced(null)).toBe(false);
  });

  it("minNecScoped: false when a released field is beyond scope", () => {
    expect(minNecScoped(evaluateMinimumNecessary(DEMO_MINIMUM_NECESSARY_REQUEST))).toBe(true);
    // Treatment is exempt → always scoped.
    expect(minNecScoped(evaluateMinimumNecessary(DEMO_MINIMUM_NECESSARY_TREATMENT_REQUEST))).toBe(true);
    expect(
      minNecScoped({
        purposeId: "purpose.payment",
        fieldDecisions: [
          { name: "x", category: "psychotherapy-notes", decision: "release", reason: "" }
        ]
      })
    ).toBe(false);
    // An un-sourced purpose can't be verified as scoped.
    expect(
      minNecScoped({ purposeId: "purpose.made-up", fieldDecisions: [] })
    ).toBe(false);
    expect(minNecScoped(null)).toBe(false);
  });

  it("minNecNoAutonomousOverDisclosure: false when over-scope/bulk without review", () => {
    expect(
      minNecNoAutonomousOverDisclosure(evaluateMinimumNecessary(DEMO_MINIMUM_NECESSARY_REQUEST))
    ).toBe(true);
    expect(
      minNecNoAutonomousOverDisclosure({
        minimumNecessary: false,
        bulk: false,
        requiresHumanReview: false
      })
    ).toBe(false);
    expect(
      minNecNoAutonomousOverDisclosure({
        minimumNecessary: true,
        bulk: true,
        requiresHumanReview: false
      })
    ).toBe(false);
    expect(
      minNecNoAutonomousOverDisclosure({
        minimumNecessary: true,
        bulk: false,
        requiresHumanReview: false
      })
    ).toBe(true);
    expect(minNecNoAutonomousOverDisclosure(null)).toBe(false);
  });
});

describe("minimumNecessarySummary", () => {
  it("is a compact, PHI-safe projection of the determination", () => {
    const det = evaluateMinimumNecessary(DEMO_MINIMUM_NECESSARY_REQUEST);
    const s = minimumNecessarySummary(det);
    expect(s).toEqual({
      requestRef: "mn-request-001",
      purposeId: "purpose.payment",
      requestorRole: "billing-specialist",
      recordScope: "single-patient",
      exempt: false,
      fieldCount: 5,
      releasedCount: 4,
      withheldCount: 1,
      minimumNecessary: false,
      requiresHumanReview: true,
      synthetic: true
    });
  });
});
