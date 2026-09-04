import { describe, expect, it } from "vitest";

import {
  DEMO_LAB_RESULT_ABNORMAL_REQUEST,
  DEMO_LAB_RESULT_CRITICAL_LOW_REQUEST,
  DEMO_LAB_RESULT_CRITICAL_REQUEST,
  DEMO_LAB_RESULT_REQUEST,
  LAB_ANALYTES,
  classifyValue,
  evaluateLabResult,
  getLabAnalyte,
  isLabAnalyte,
  labClinicianReviewed,
  labCriticalValueNotified,
  labRangeCited,
  labResultSummary
} from "./lab-result";

describe("lab-result catalog", () => {
  it("exposes recognized analyte ids with unique entries", () => {
    const ids = LAB_ANALYTES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isLabAnalyte(id)).toBe(true);
    expect(isLabAnalyte("analyte.we-just-decided")).toBe(false);
    expect(isLabAnalyte(undefined)).toBe(false);
  });

  it("keeps each analyte's thresholds ordered (criticalLow ≤ refLow < refHigh ≤ criticalHigh)", () => {
    for (const a of LAB_ANALYTES) {
      expect(a.criticalLow).toBeLessThanOrEqual(a.refLow);
      expect(a.refLow).toBeLessThan(a.refHigh);
      expect(a.refHigh).toBeLessThanOrEqual(a.criticalHigh);
    }
  });

  it("resolves an analyte by id", () => {
    expect(getLabAnalyte("analyte.potassium")?.label).toBe("Potassium (K+)");
    expect(getLabAnalyte("analyte.unknown")).toBeUndefined();
  });
});

describe("classifyValue", () => {
  const k = getLabAnalyte("analyte.potassium")!;

  it("classifies against the reference range + critical thresholds", () => {
    expect(classifyValue(k, 4.2)).toBe("normal");
    expect(classifyValue(k, 5.5)).toBe("abnormal-high");
    expect(classifyValue(k, 3.0)).toBe("abnormal-low");
    expect(classifyValue(k, 6.8)).toBe("critical-high");
    expect(classifyValue(k, 2.1)).toBe("critical-low");
  });

  it("treats critical thresholds as inclusive and taking precedence", () => {
    expect(classifyValue(k, k.criticalHigh)).toBe("critical-high");
    expect(classifyValue(k, k.criticalLow)).toBe("critical-low");
  });
});

describe("evaluateLabResult · classification", () => {
  it("returns normal for a value inside the reference range", () => {
    const det = evaluateLabResult(DEMO_LAB_RESULT_REQUEST);
    expect(det.classification).toBe("normal");
    expect(det.isCritical).toBe(false);
    expect(det.requiresProviderNotification).toBe(false);
    expect(det.requiresClinicianReview).toBe(false);
  });

  it("flags a critical-high value for mandatory notification + review", () => {
    const det = evaluateLabResult(DEMO_LAB_RESULT_CRITICAL_REQUEST);
    expect(det.classification).toBe("critical-high");
    expect(det.isCritical).toBe(true);
    expect(det.requiresProviderNotification).toBe(true);
    expect(det.requiresClinicianReview).toBe(true);
  });

  it("flags a critical-low value for mandatory notification", () => {
    const det = evaluateLabResult(DEMO_LAB_RESULT_CRITICAL_LOW_REQUEST);
    expect(det.classification).toBe("critical-low");
    expect(det.requiresProviderNotification).toBe(true);
  });

  it("flags an abnormal (non-critical) value for review but not notification", () => {
    const det = evaluateLabResult(DEMO_LAB_RESULT_ABNORMAL_REQUEST);
    expect(det.classification).toBe("abnormal-high");
    expect(det.isCritical).toBe(false);
    expect(det.requiresProviderNotification).toBe(false);
    expect(det.requiresClinicianReview).toBe(true);
  });

  it("returns an un-sourced placeholder for an off-catalog analyte", () => {
    const det = evaluateLabResult({
      patientRef: "p",
      providerRef: "d",
      analyteId: "analyte.unknown",
      value: 99
    });
    expect(det.classification).toBe("normal");
    expect(Number.isNaN(det.refLow)).toBe(true);
    expect(labRangeCited(det)).toBe(false);
  });

  it("is deterministic — the same request yields the same determination", () => {
    expect(evaluateLabResult(DEMO_LAB_RESULT_CRITICAL_REQUEST)).toEqual(
      evaluateLabResult(DEMO_LAB_RESULT_CRITICAL_REQUEST)
    );
  });
});

describe("lab-result honesty guards", () => {
  it("labCriticalValueNotified is false only for a suppressed critical value", () => {
    expect(labCriticalValueNotified(evaluateLabResult(DEMO_LAB_RESULT_CRITICAL_REQUEST))).toBe(true);
    expect(labCriticalValueNotified({ isCritical: true, requiresProviderNotification: false })).toBe(
      false
    );
    expect(labCriticalValueNotified({ isCritical: true, requiresProviderNotification: true })).toBe(
      true
    );
    // A non-critical result never trips this guard.
    expect(labCriticalValueNotified({ isCritical: false, requiresProviderNotification: false })).toBe(
      true
    );
    expect(labCriticalValueNotified(null)).toBe(false);
  });

  it("labRangeCited is true for a catalog analyte, false for an off-catalog analyte", () => {
    expect(labRangeCited(evaluateLabResult(DEMO_LAB_RESULT_REQUEST))).toBe(true);
    expect(labRangeCited({ analyteId: "analyte.we-just-decided" })).toBe(false);
    expect(labRangeCited(null)).toBe(false);
  });

  it("labClinicianReviewed is false only for an autonomous action on a non-normal result", () => {
    expect(labClinicianReviewed(evaluateLabResult(DEMO_LAB_RESULT_ABNORMAL_REQUEST))).toBe(true);
    // A normal result needs no review.
    expect(labClinicianReviewed({ classification: "normal", requiresClinicianReview: false })).toBe(
      true
    );
    expect(
      labClinicianReviewed({ classification: "abnormal-high", requiresClinicianReview: false })
    ).toBe(false);
    expect(
      labClinicianReviewed({ classification: "critical-high", requiresClinicianReview: true })
    ).toBe(true);
    expect(labClinicianReviewed(null)).toBe(false);
  });

  it("labResultSummary carries only structured, PHI-safe fields", () => {
    const summary = labResultSummary(evaluateLabResult(DEMO_LAB_RESULT_CRITICAL_REQUEST));
    expect(summary.patientRef).toBe("lab-patient-002");
    expect(summary.analyteId).toBe("analyte.potassium");
    expect(summary.classification).toBe("critical-high");
    expect(summary.isCritical).toBe(true);
    expect(summary.synthetic).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("note");
  });
});
