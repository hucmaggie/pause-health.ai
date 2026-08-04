import { describe, expect, it } from "vitest";
import {
  DEMO_OVERCODED_CONTEXT,
  DEMO_RISK_ADJUSTMENT_CONTEXT,
  HCC_CATALOG,
  SUPPORTING_EVIDENCE,
  assessRiskAdjustment,
  codesTraceToClinicalEvidence,
  codingRequiresClinicianValidation,
  computeRafScore,
  getHcc,
  getSupportingEvidence,
  hccSupportedByEvidence,
  isCatalogHcc,
  isSupportingEvidence,
  noAutonomousCodeSubmission,
  suspectHccs
} from "./risk-adjustment";

/**
 * Tests for lib/risk-adjustment.ts — the deterministic risk-adjustment / HCC
 * coding suspector behind the Risk Adjustment & HCC Coding Agent. The assessment
 * is a pure function of the structured clinical context (no randomness, no clock),
 * so the same context always yields the same assessment. These pin determinism,
 * the catalog-sourced HCCs + evidence, the confirmed/suspected/unsupported
 * tri-state, the RAF-style score, the coding-gap vs unsupported-flag distinction
 * (both safe outputs, not blocks), and the three honest governance signals
 * (evidence-supported-coding + clinician-validation-required + no-autonomous-
 * submission).
 */

describe("catalogs", () => {
  it("exposes an HCC catalog with stable ids, labels, illustrative RAF weights + evidence", () => {
    expect(HCC_CATALOG.length).toBeGreaterThan(0);
    for (const h of HCC_CATALOG) {
      expect(h.id).toMatch(/^hcc\./);
      expect(h.label.length).toBeGreaterThan(0);
      expect(h.rafWeight).toBeGreaterThan(0);
      expect(h.supportingEvidence.length).toBeGreaterThan(0);
      // Every supporting-evidence id an HCC references is a catalog id.
      for (const e of h.supportingEvidence) {
        expect(isSupportingEvidence(e)).toBe(true);
      }
    }
  });

  it("exposes a supporting-evidence catalog with stable ids + labels + descriptions", () => {
    expect(SUPPORTING_EVIDENCE.length).toBeGreaterThan(0);
    for (const e of SUPPORTING_EVIDENCE) {
      expect(e.id).toMatch(/^evidence\./);
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
    }
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const h of HCC_CATALOG) {
      expect(isCatalogHcc(h.id)).toBe(true);
      expect(getHcc(h.id)?.label).toBe(h.label);
    }
    expect(isCatalogHcc("hcc.made-up")).toBe(false);
    for (const e of SUPPORTING_EVIDENCE) {
      expect(isSupportingEvidence(e.id)).toBe(true);
      expect(getSupportingEvidence(e.id)?.label).toBe(e.label);
    }
    expect(isSupportingEvidence("evidence.made-up")).toBe(false);
  });

  it("hccSupportedByEvidence requires the FULL documented evidence set", () => {
    expect(
      hccSupportedByEvidence("hcc.diabetes-with-complication", [
        "evidence.a1c-elevated",
        "evidence.diabetic-complication"
      ])
    ).toBe(true);
    // Missing one required signal → not supported.
    expect(
      hccSupportedByEvidence("hcc.diabetes-with-complication", [
        "evidence.a1c-elevated"
      ])
    ).toBe(false);
    expect(hccSupportedByEvidence("hcc.made-up", ["evidence.a1c-elevated"])).toBe(false);
    expect(hccSupportedByEvidence("hcc.chf", null)).toBe(false);
  });
});

describe("suspectHccs · determinism + catalog-sourced tri-state", () => {
  it("is deterministic — the same context yields the same HCCs", () => {
    expect(suspectHccs(DEMO_RISK_ADJUSTMENT_CONTEXT)).toEqual(
      suspectHccs(DEMO_RISK_ADJUSTMENT_CONTEXT)
    );
  });

  it("confirms a coded + evidence-supported HCC", () => {
    const hccs = suspectHccs(DEMO_RISK_ADJUSTMENT_CONTEXT);
    const dm = hccs.find((h) => h.hccId === "hcc.diabetes-with-complication");
    expect(dm?.status).toBe("confirmed");
    expect(dm?.missingEvidence).toHaveLength(0);
    expect(dm?.supportingEvidence.length).toBeGreaterThan(0);
  });

  it("suspects an evidence-supported but uncoded HCC (a coding gap)", () => {
    const hccs = suspectHccs(DEMO_RISK_ADJUSTMENT_CONTEXT);
    const dep = hccs.find((h) => h.hccId === "hcc.major-depression");
    expect(dep?.status).toBe("suspected");
    expect(dep?.missingEvidence).toHaveLength(0);
  });

  it("flags a coded but unsupported HCC as unsupported (over-coded)", () => {
    const hccs = suspectHccs(DEMO_OVERCODED_CONTEXT);
    const copd = hccs.find((h) => h.hccId === "hcc.copd");
    expect(copd?.status).toBe("unsupported");
    expect(copd!.missingEvidence.length).toBeGreaterThan(0);
  });

  it("omits an HCC that is neither coded nor evidence-supported", () => {
    const hccs = suspectHccs({ patientRef: "empty-1" });
    expect(hccs).toHaveLength(0);
  });

  it("ignores off-catalog evidence + coded ids (never fabricated)", () => {
    const hccs = suspectHccs({
      patientRef: "sub-1",
      documentedEvidence: ["evidence.made-up", "evidence.a1c-elevated"],
      codedConditions: ["hcc.made-up"]
    });
    // The lone real evidence signal doesn't fully support any HCC on its own.
    expect(hccs).toHaveLength(0);
  });
});

describe("assessRiskAdjustment · RAF score + coding gaps + unsupported flags", () => {
  it("is deterministic", () => {
    expect(assessRiskAdjustment(DEMO_RISK_ADJUSTMENT_CONTEXT)).toEqual(
      assessRiskAdjustment(DEMO_RISK_ADJUSTMENT_CONTEXT)
    );
  });

  it("happy path: 2 confirmed HCCs + RAF score + 1 suspected coding gap, no unsupported", () => {
    const a = assessRiskAdjustment(DEMO_RISK_ADJUSTMENT_CONTEXT);
    expect(a.patientRef).toBe("riskadj-patient-001");
    const confirmed = a.hccs.filter((h) => h.status === "confirmed");
    expect(confirmed.map((h) => h.hccId).sort()).toEqual([
      "hcc.diabetes-with-complication",
      "hcc.osteoporosis-fracture"
    ]);
    // RAF is the sum of the confirmed weights (0.302 + 0.437).
    expect(a.rafScore).toBeCloseTo(0.739, 3);
    expect(a.codingGaps.map((h) => h.hccId)).toEqual(["hcc.major-depression"]);
    expect(a.unsupportedFlags).toHaveLength(0);
    expect(a.requiresClinicianValidation).toBe(true);
    expect(a.submitted).toBe(false);
    expect(a.synthetic).toBe(true);
  });

  it("over-coded context surfaces an unsupported flag as a SAFE output (not a block)", () => {
    const a = assessRiskAdjustment(DEMO_OVERCODED_CONTEXT);
    expect(a.unsupportedFlags.map((h) => h.hccId)).toContain("hcc.copd");
    // The over-coded COPD entry contributes nothing to the RAF — only the
    // evidence-supported, confirmed diabetes-without-complication (0.105) does.
    expect(a.hccs.find((h) => h.hccId === "hcc.copd")?.status).toBe("unsupported");
    expect(a.rafScore).toBe(0.105);
    // Its own output still passes the anti-upcoding signal — an unsupported flag
    // is honestly labeled and makes no support claim.
    expect(codesTraceToClinicalEvidence(a.hccs)).toBe(true);
  });

  it("computeRafScore sums confirmed weights deterministically", () => {
    expect(computeRafScore([{ rafWeight: 0.302 }, { rafWeight: 0.437 }])).toBe(0.739);
    expect(computeRafScore([])).toBe(0);
  });
});

describe("codesTraceToClinicalEvidence · evidence-supported-coding signal", () => {
  it("is true for anything assessRiskAdjustment produces", () => {
    for (const ctx of [DEMO_RISK_ADJUSTMENT_CONTEXT, DEMO_OVERCODED_CONTEXT]) {
      expect(codesTraceToClinicalEvidence(assessRiskAdjustment(ctx).hccs)).toBe(true);
    }
  });

  it("is false for a confirmed / suspected HCC presented as supported with no evidence (upcoding)", () => {
    expect(
      codesTraceToClinicalEvidence([
        { hccId: "hcc.chf", status: "confirmed", supportingEvidence: [] }
      ])
    ).toBe(false);
    // Partial evidence doesn't cover the catalog's required set.
    expect(
      codesTraceToClinicalEvidence([
        {
          hccId: "hcc.chf",
          status: "suspected",
          supportingEvidence: [{ id: "evidence.echo-reduced-ef" }]
        }
      ])
    ).toBe(false);
    // An off-catalog HCC presented as confirmed.
    expect(
      codesTraceToClinicalEvidence([
        { hccId: "hcc.made-up", status: "confirmed", supportingEvidence: [] }
      ])
    ).toBe(false);
  });

  it("exempts an unsupported flag (it makes no support claim); false for non-arrays", () => {
    expect(
      codesTraceToClinicalEvidence([
        { hccId: "hcc.copd", status: "unsupported", supportingEvidence: [] }
      ])
    ).toBe(true);
    expect(codesTraceToClinicalEvidence(null)).toBe(false);
    expect(codesTraceToClinicalEvidence(undefined)).toBe(false);
  });
});

describe("codingRequiresClinicianValidation · clinician-validation signal", () => {
  it("is true for an assess and for a clinician-validated submit", () => {
    expect(codingRequiresClinicianValidation()).toBe(true);
    expect(codingRequiresClinicianValidation({ kind: "assess" })).toBe(true);
    expect(
      codingRequiresClinicianValidation({ kind: "submit", clinicianValidated: true })
    ).toBe(true);
  });

  it("is false for a submit that skips clinician validation", () => {
    expect(codingRequiresClinicianValidation({ kind: "submit" })).toBe(false);
    expect(
      codingRequiresClinicianValidation({ kind: "submit", clinicianValidated: false })
    ).toBe(false);
  });
});

describe("noAutonomousCodeSubmission · no-autonomous-submission signal", () => {
  it("is true for an assess and for a submit that hasn't been autonomously filed", () => {
    expect(noAutonomousCodeSubmission()).toBe(true);
    expect(noAutonomousCodeSubmission({ kind: "assess" })).toBe(true);
    expect(
      noAutonomousCodeSubmission({ kind: "submit", clinicianValidated: true })
    ).toBe(true);
  });

  it("is false when an autonomous submission / claim adjustment is asserted", () => {
    expect(noAutonomousCodeSubmission({ kind: "submit", submitted: true })).toBe(false);
    expect(noAutonomousCodeSubmission({ kind: "assess", submitted: true })).toBe(false);
  });
});
