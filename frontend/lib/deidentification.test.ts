import { describe, expect, it } from "vitest";

import {
  DEMO_DEIDENTIFICATION_EXPERT_REQUEST,
  DEMO_DEIDENTIFICATION_INCOMPLETE_REQUEST,
  DEMO_DEIDENTIFICATION_REQUEST,
  DEMO_DEIDENTIFICATION_RETAINED_REQUEST,
  NON_IDENTIFIER,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_CATEGORY_COUNT,
  deidAllCategoriesScreened,
  deidMethodCited,
  deidNoReleaseOfReidentifiable,
  deidentificationSummary,
  evaluateDeidentification,
  getSafeHarborCategory,
  isSafeHarborCategory
} from "./deidentification";

describe("Safe Harbor category catalog", () => {
  it("has exactly eighteen categories with unique codes", () => {
    expect(SAFE_HARBOR_CATEGORY_COUNT).toBe(18);
    expect(SAFE_HARBOR_CATEGORIES).toHaveLength(18);
    const codes = SAFE_HARBOR_CATEGORIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(18);
    for (const code of codes) expect(isSafeHarborCategory(code)).toBe(true);
    expect(isSafeHarborCategory("made-up")).toBe(false);
    expect(isSafeHarborCategory(undefined)).toBe(false);
  });

  it("only makes geographic and dates generalizable", () => {
    const generalizable = SAFE_HARBOR_CATEGORIES.filter((c) => c.generalizable).map(
      (c) => c.code
    );
    expect(generalizable.sort()).toEqual(["dates", "geographic"]);
    expect(getSafeHarborCategory("mrn")!.generalizable).toBe(false);
    expect(getSafeHarborCategory("nope")).toBeUndefined();
  });
});

describe("evaluateDeidentification · screen + decision", () => {
  it("de-identifies a fully-scrubbed Safe Harbor dataset", () => {
    const det = evaluateDeidentification(DEMO_DEIDENTIFICATION_REQUEST);
    expect(det.allCategoriesScreened).toBe(true);
    expect(det.categoriesScreened.length).toBe(18);
    expect(det.remainingIdentifierCategories).toEqual([]);
    expect(det.methodCited).toBe(true);
    expect(det.deidentified).toBe(true);
    expect(det.releaseApproved).toBe(true);
    expect(det.requiresHumanReview).toBe(false);
  });

  it("de-identifies under a cited expert determination", () => {
    const det = evaluateDeidentification(DEMO_DEIDENTIFICATION_EXPERT_REQUEST);
    expect(det.method).toBe("expert-determination");
    expect(det.methodCited).toBe(true);
    expect(det.deidentified).toBe(true);
  });

  it("does NOT cite the method for an expert determination missing a reference", () => {
    const det = evaluateDeidentification({
      ...DEMO_DEIDENTIFICATION_EXPERT_REQUEST,
      expertDeterminationRef: undefined
    });
    expect(det.methodCited).toBe(false);
    expect(det.deidentified).toBe(false);
    expect(det.requiresHumanReview).toBe(true);
  });

  it("does not de-identify a dataset with a retained identifier", () => {
    const det = evaluateDeidentification(DEMO_DEIDENTIFICATION_RETAINED_REQUEST);
    expect(det.remainingIdentifierCategories).toContain("mrn");
    expect(det.deidentified).toBe(false);
    expect(det.releaseApproved).toBe(false);
    expect(det.requiresHumanReview).toBe(true);
  });

  it("does not de-identify an incomplete screen", () => {
    const det = evaluateDeidentification(DEMO_DEIDENTIFICATION_INCOMPLETE_REQUEST);
    expect(det.allCategoriesScreened).toBe(false);
    expect(det.deidentified).toBe(false);
    expect(det.requiresHumanReview).toBe(true);
  });

  it("treats a non-generalizable identifier as remaining even when generalized", () => {
    const det = evaluateDeidentification({
      datasetRef: "d",
      method: "safe-harbor",
      fields: [{ name: "ssn", category: "ssn", action: "generalized" }],
      attestedAbsentCategories: SAFE_HARBOR_CATEGORIES.map((c) => c.code).filter(
        (c) => c !== "ssn"
      )
    });
    // SSN is not generalizable, so a generalized SSN still remains identifiable.
    expect(det.remainingIdentifierCategories).toContain("ssn");
    expect(det.deidentified).toBe(false);
  });

  it("does not count a removed identifier or a non-identifier field as remaining", () => {
    const det = evaluateDeidentification({
      datasetRef: "d",
      method: "safe-harbor",
      fields: [
        { name: "email", category: "email", action: "removed" },
        { name: "dx", category: NON_IDENTIFIER, action: "retained" }
      ],
      attestedAbsentCategories: SAFE_HARBOR_CATEGORIES.map((c) => c.code).filter(
        (c) => c !== "email"
      )
    });
    expect(det.remainingIdentifierCategories).toEqual([]);
    expect(det.deidentified).toBe(true);
  });

  it("is deterministic — the same dataset yields the same determination", () => {
    expect(evaluateDeidentification(DEMO_DEIDENTIFICATION_REQUEST)).toEqual(
      evaluateDeidentification(DEMO_DEIDENTIFICATION_REQUEST)
    );
  });

  it("always marks the determination synthetic", () => {
    expect(evaluateDeidentification(DEMO_DEIDENTIFICATION_REQUEST).synthetic).toBe(true);
  });
});

describe("de-identification honesty guards", () => {
  it("deidAllCategoriesScreened is true for a complete screen, false otherwise", () => {
    expect(
      deidAllCategoriesScreened(evaluateDeidentification(DEMO_DEIDENTIFICATION_REQUEST))
    ).toBe(true);
    expect(deidAllCategoriesScreened({ allCategoriesScreened: false })).toBe(false);
    expect(deidAllCategoriesScreened(null)).toBe(false);
  });

  it("deidMethodCited is true for a recognized method, false otherwise", () => {
    expect(deidMethodCited(evaluateDeidentification(DEMO_DEIDENTIFICATION_REQUEST))).toBe(
      true
    );
    expect(deidMethodCited({ methodCited: false })).toBe(false);
    expect(deidMethodCited(null)).toBe(false);
  });

  it("deidNoReleaseOfReidentifiable is false only when a remaining identifier is released", () => {
    expect(
      deidNoReleaseOfReidentifiable(evaluateDeidentification(DEMO_DEIDENTIFICATION_REQUEST))
    ).toBe(true);
    expect(
      deidNoReleaseOfReidentifiable({
        remainingIdentifierCategories: ["mrn"],
        releaseApproved: true,
        deidentified: true
      })
    ).toBe(false);
    expect(
      deidNoReleaseOfReidentifiable({
        remainingIdentifierCategories: ["mrn"],
        releaseApproved: false,
        deidentified: false
      })
    ).toBe(true);
    // No remaining identifiers → release is fine.
    expect(
      deidNoReleaseOfReidentifiable({
        remainingIdentifierCategories: [],
        releaseApproved: true,
        deidentified: true
      })
    ).toBe(true);
    expect(deidNoReleaseOfReidentifiable(null)).toBe(false);
  });

  it("deidentificationSummary carries only structured, PHI-safe fields", () => {
    const summary = deidentificationSummary(
      evaluateDeidentification(DEMO_DEIDENTIFICATION_REQUEST)
    );
    expect(summary.datasetRef).toBe("deid-dataset-001");
    expect(summary.method).toBe("safe-harbor");
    expect(summary.deidentified).toBe(true);
    expect(summary.releaseApproved).toBe(true);
    expect(summary.remainingIdentifierCategoryCount).toBe(0);
    expect(summary.synthetic).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("note");
  });
});
