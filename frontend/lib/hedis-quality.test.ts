import { describe, expect, it } from "vitest";
import {
  DEMO_AS_OF_PERIOD,
  DEMO_PANEL,
  HEDIS_MEASURES,
  assembleSubmission,
  collectAppliedExclusions,
  exclusionsTraceToCatalog,
  getMeasure,
  isAllowedExclusion,
  isHedisMeasure,
  measuresTraceToCatalog,
  rollUpPanel,
  scoreMeasure,
  submissionRequiresHumanApproval
} from "./hedis-quality";

/**
 * Tests for lib/hedis-quality.ts — the deterministic HEDIS / quality-reporting
 * roll-up behind the HEDIS & Quality Reporting Agent. The report is a pure
 * function of the panel signals + the caller-provided `asOfPeriod` (no
 * randomness, no clock), so the same panel + period always yields the same
 * rates. These pin determinism, the catalog-sourced measures, the catalog-
 * sourced exclusions, and the three honest governance signals (measure-
 * catalog-sourced + exclusion-integrity + no-autonomous-submission).
 */

describe("catalog", () => {
  it("exposes a stable, clearly-synthetic HEDIS measure catalog", () => {
    expect(HEDIS_MEASURES.length).toBeGreaterThan(0);
    for (const m of HEDIS_MEASURES) {
      expect(m.id).toMatch(/^measure\./);
      expect(m.code.length).toBeGreaterThan(0);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.synthetic).toBe(true);
      expect(m.ageRange.maxAge).toBeGreaterThanOrEqual(m.ageRange.minAge);
      expect(m.allowedExclusions.length).toBeGreaterThan(0);
      for (const e of m.allowedExclusions) {
        expect(e.id).toMatch(/^exclusion\./);
      }
    }
  });

  it("catalog lookups agree with the catalog", () => {
    for (const m of HEDIS_MEASURES) {
      expect(isHedisMeasure(m.id)).toBe(true);
      expect(getMeasure(m.id)?.code).toBe(m.code);
      for (const e of m.allowedExclusions) {
        expect(isAllowedExclusion(m.id, e.id)).toBe(true);
      }
      expect(isAllowedExclusion(m.id, "exclusion.made-up")).toBe(false);
    }
    expect(isHedisMeasure("measure.made-up")).toBe(false);
    expect(isHedisMeasure(42)).toBe(false);
    expect(isAllowedExclusion("measure.made-up", "exclusion.hospice")).toBe(false);
  });
});

describe("rollUpPanel", () => {
  it("is deterministic — same panel + period always yields the same rates", () => {
    const a = rollUpPanel(DEMO_PANEL, DEMO_AS_OF_PERIOD);
    const b = rollUpPanel(DEMO_PANEL, DEMO_AS_OF_PERIOD);
    expect(a).toEqual(b);
  });

  it("respects age / sex / care-relationship / diagnosis denominators", () => {
    const report = rollUpPanel(DEMO_PANEL, DEMO_AS_OF_PERIOD);
    const osw = report.perMeasure.find(
      (m) => m.measureId === "measure.osteoporosis-screening-women"
    );
    expect(osw).toBeDefined();
    // patient-001 (68F, DEXA) → compliant, patient-002 (72F, hospice) → excluded,
    // patient-005 (61F, no DEXA, age below 65) → not-in-denominator,
    // patient-006 (52F, age below 65) → not-in-denominator. Male / young are
    // filtered by sex+age.
    expect(osw!.eligible).toBe(2);
    expect(osw!.excluded).toBe(1);
    expect(osw!.denominator).toBe(1);
    expect(osw!.numerator).toBe(1);
    expect(osw!.rate).toBe(1);
    expect(osw!.gapPatientRefs).toEqual([]);

    const bcs = report.perMeasure.find((m) => m.measureId === "measure.breast-cancer-screening");
    // Eligible females aged 50-74 with care relationship: 001, 002, 003, 005, 006.
    // 002 is hospice-excluded, 001/003/005 compliant, 006 non-compliant.
    expect(bcs!.eligible).toBe(5);
    expect(bcs!.excluded).toBe(1);
    expect(bcs!.denominator).toBe(4);
    expect(bcs!.numerator).toBe(3);
    expect(bcs!.gapPatientRefs).toEqual(["hedis-patient-006"]);
  });

  it("scores CBP by the most-recent BP threshold", () => {
    const report = rollUpPanel(DEMO_PANEL, DEMO_AS_OF_PERIOD);
    const cbp = report.perMeasure.find(
      (m) => m.measureId === "measure.controlling-high-blood-pressure"
    );
    // Denominator: HTN patients — 003 (128/78 ✓), 004 (152/98 ✗), 006 (138/85 ✓).
    expect(cbp!.denominator).toBe(3);
    expect(cbp!.numerator).toBe(2);
    expect(cbp!.gapPatientRefs).toEqual(["hedis-patient-004"]);
    expect(cbp!.rate).toBeCloseTo(2 / 3);
  });

  it("respects the statin-intolerance exclusion on SPC", () => {
    const report = rollUpPanel(DEMO_PANEL, DEMO_AS_OF_PERIOD);
    const spc = report.perMeasure.find((m) => m.measureId === "measure.statin-therapy-cvd");
    // Eligible ASCVD patients: 003 (compliant, on statin), 005 (excluded).
    expect(spc!.eligible).toBe(2);
    expect(spc!.excluded).toBe(1);
    expect(spc!.denominator).toBe(1);
    expect(spc!.numerator).toBe(1);
    expect(spc!.rate).toBe(1);
  });

  it("scores tobacco cessation counseling only on current users", () => {
    const report = rollUpPanel(DEMO_PANEL, DEMO_AS_OF_PERIOD);
    const tcc = report.perMeasure.find(
      (m) => m.measureId === "measure.tobacco-cessation-counseling"
    );
    // Denominator: patients with a known tobacco status — 001 (never ✓), 003
    // (former ✓), 004 (current, no counseling ✗), 006 (never ✓). Non-currents
    // count as trivially compliant with the counseling numerator.
    expect(tcc!.denominator).toBe(4);
    expect(tcc!.numerator).toBe(3);
    expect(tcc!.gapPatientRefs).toEqual(["hedis-patient-004"]);
  });

  it("returns a null rate for a zero-denominator measure", () => {
    const emptyPanel = [
      {
        patientRef: "hedis-patient-x",
        age: 40,
        sex: "male" as const,
        activeCareRelationship: true
      }
    ];
    const report = rollUpPanel(emptyPanel, DEMO_AS_OF_PERIOD);
    const osw = report.perMeasure.find(
      (m) => m.measureId === "measure.osteoporosis-screening-women"
    );
    expect(osw!.denominator).toBe(0);
    expect(osw!.rate).toBeNull();
  });

  it("ignores ad-hoc / unlisted exclusions when scoring (they surface via the integrity signal)", () => {
    const measure = HEDIS_MEASURES[0];
    const panel = [
      {
        patientRef: "hedis-patient-adhoc",
        age: 70,
        sex: "female" as const,
        activeCareRelationship: true,
        hasRecentDexa: false,
        exclusions: [{ measureId: measure.id, exclusionId: "exclusion.made-up" }]
      }
    ];
    const report = scoreMeasure(measure, panel);
    // Ad-hoc exclusion isn't honored — patient still counts in the denominator
    // as non-compliant.
    expect(report.excluded).toBe(0);
    expect(report.denominator).toBe(1);
    expect(report.numerator).toBe(0);
    expect(report.gapPatientRefs).toEqual(["hedis-patient-adhoc"]);
  });
});

describe("governance signals", () => {
  const report = rollUpPanel(DEMO_PANEL, DEMO_AS_OF_PERIOD);
  const submission = assembleSubmission(report);

  it("measuresTraceToCatalog: true for a produced report, false when off-catalog", () => {
    expect(measuresTraceToCatalog(report.perMeasure)).toBe(true);
    expect(
      measuresTraceToCatalog([...report.perMeasure, { measureId: "measure.made-up" }])
    ).toBe(false);
    expect(measuresTraceToCatalog(null)).toBe(false);
    expect(measuresTraceToCatalog(undefined)).toBe(false);
  });

  it("exclusionsTraceToCatalog: true for the panel's applied exclusions, false when ad-hoc", () => {
    const applied = collectAppliedExclusions(DEMO_PANEL);
    expect(applied.length).toBeGreaterThan(0);
    expect(exclusionsTraceToCatalog(applied)).toBe(true);
    expect(exclusionsTraceToCatalog([])).toBe(true);
    expect(
      exclusionsTraceToCatalog([
        {
          measureId: "measure.osteoporosis-screening-women",
          exclusionId: "exclusion.made-up"
        }
      ])
    ).toBe(false);
    expect(
      exclusionsTraceToCatalog([
        { measureId: "measure.made-up", exclusionId: "exclusion.hospice" }
      ])
    ).toBe(false);
    expect(exclusionsTraceToCatalog(null)).toBe(false);
  });

  it("submissionRequiresHumanApproval: true for the produced package, false when submitted or unapproved", () => {
    expect(submissionRequiresHumanApproval(submission)).toBe(true);
    expect(
      submissionRequiresHumanApproval({
        ...submission,
        submitted: true
      } as unknown as typeof submission)
    ).toBe(false);
    expect(
      submissionRequiresHumanApproval({
        requiresQualityTeamApproval: false,
        submitted: false,
        state: "ready-for-quality-team-review"
      })
    ).toBe(false);
    expect(submissionRequiresHumanApproval(null)).toBe(false);
    expect(submissionRequiresHumanApproval("not an object" as unknown as never)).toBe(false);
  });
});

describe("assembleSubmission", () => {
  it("is deterministic and always requires human approval, never auto-submits", () => {
    const report = rollUpPanel(DEMO_PANEL, DEMO_AS_OF_PERIOD);
    const a = assembleSubmission(report);
    const b = assembleSubmission(report);
    expect(a).toEqual(b);
    expect(a.state).toBe("ready-for-quality-team-review");
    expect(a.requiresQualityTeamApproval).toBe(true);
    expect(a.submitted).toBe(false);
    expect(a.packageId).toBe(`hedis-pkg-${DEMO_AS_OF_PERIOD}`);
    // Every measure id in the package traces to the catalog.
    for (const id of a.measureIds) expect(isHedisMeasure(id)).toBe(true);
  });
});
