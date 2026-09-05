import { describe, expect, it } from "vitest";

import {
  ACIP_SCHEDULE,
  DEMO_IMMUNIZATION_CONTRAINDICATION_REQUEST,
  DEMO_IMMUNIZATION_REQUEST,
  DEMO_IMMUNIZATION_UPTODATE_REQUEST,
  evaluateImmunization,
  getScheduleRule,
  immunizationContraindicationHonored,
  immunizationNoAutonomousAdministration,
  immunizationScheduleCited,
  immunizationSummary,
  isScheduleRule
} from "./immunization";

describe("ACIP schedule catalog", () => {
  it("has stable ids and a midlife-relevant set", () => {
    const ids = ACIP_SCHEDULE.map((r) => r.id);
    expect(ids).toContain("rule.influenza");
    expect(ids).toContain("rule.tdap-booster");
    expect(ids).toContain("rule.zoster-rzv");
    expect(ids).toContain("rule.pneumococcal");
    expect(ids).toContain("rule.covid19");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("recognizes catalog ids and rejects off-catalog ones", () => {
    expect(isScheduleRule("rule.zoster-rzv")).toBe(true);
    expect(isScheduleRule("rule.made-up")).toBe(false);
    expect(isScheduleRule(42)).toBe(false);
    expect(getScheduleRule("rule.pneumococcal")?.minAgeYears).toBe(65);
    expect(getScheduleRule("nope")).toBeUndefined();
  });
});

describe("evaluateImmunization", () => {
  it("forecasts a 52-year-old: flu up-to-date, tdap + zoster overdue, pneumococcal not-indicated, covid due", () => {
    const det = evaluateImmunization(DEMO_IMMUNIZATION_REQUEST);
    expect(det.ageYears).toBe(52);

    const byRule = Object.fromEntries(det.forecast.map((f) => [f.ruleId, f]));
    expect(byRule["rule.influenza"].status).toBe("up-to-date");
    expect(byRule["rule.influenza"].nextDueDate).toBe("2026-10-01");
    expect(byRule["rule.tdap-booster"].status).toBe("overdue");
    expect(byRule["rule.zoster-rzv"].status).toBe("overdue");
    expect(byRule["rule.pneumococcal"].status).toBe("not-indicated");
    expect(byRule["rule.covid19"].status).toBe("due");

    expect(det.dueCount).toBe(1);
    expect(det.overdueCount).toBe(2);
    expect(det.contraindicatedCount).toBe(0);
    expect(det.requiresClinicianOrder).toBe(true);
    expect(det.synthetic).toBe(true);
  });

  it("withholds a contraindicated vaccine (never recommended)", () => {
    const det = evaluateImmunization(DEMO_IMMUNIZATION_CONTRAINDICATION_REQUEST);
    const zoster = det.forecast.find((f) => f.ruleId === "rule.zoster-rzv");
    expect(zoster?.status).toBe("contraindicated");
    expect(zoster?.contraindicated).toBe(true);
    expect(det.contraindicatedCount).toBe(1);
    // A contraindicated vaccine must not be counted as due/overdue.
    expect(det.forecast.every((f) => !(f.contraindicated && (f.status === "due" || f.status === "overdue")))).toBe(true);
  });

  it("reports no clinician order for an up-to-date patient", () => {
    const det = evaluateImmunization(DEMO_IMMUNIZATION_UPTODATE_REQUEST);
    expect(det.ageYears).toBe(40);
    const byRule = Object.fromEntries(det.forecast.map((f) => [f.ruleId, f]));
    expect(byRule["rule.influenza"].status).toBe("up-to-date");
    expect(byRule["rule.tdap-booster"].status).toBe("up-to-date");
    expect(byRule["rule.covid19"].status).toBe("up-to-date");
    expect(byRule["rule.zoster-rzv"].status).toBe("not-indicated");
    expect(byRule["rule.pneumococcal"].status).toBe("not-indicated");
    expect(det.dueCount).toBe(0);
    expect(det.overdueCount).toBe(0);
    expect(det.requiresClinicianOrder).toBe(false);
  });

  it("is deterministic — same request yields identical determination", () => {
    const a = evaluateImmunization(DEMO_IMMUNIZATION_REQUEST);
    const b = evaluateImmunization(DEMO_IMMUNIZATION_REQUEST);
    expect(a).toEqual(b);
  });

  it("cites a recorded schedule rule on every forecast entry", () => {
    const det = evaluateImmunization(DEMO_IMMUNIZATION_REQUEST);
    expect(det.forecast.every((f) => isScheduleRule(f.ruleId))).toBe(true);
  });
});

describe("guard functions", () => {
  it("immunizationScheduleCited: true for a produced determination, false for an off-catalog rule", () => {
    expect(immunizationScheduleCited(evaluateImmunization(DEMO_IMMUNIZATION_REQUEST))).toBe(true);
    expect(
      immunizationScheduleCited({
        forecast: [
          {
            ruleId: "rule.made-up",
            vaccine: "x",
            label: "x",
            status: "due",
            contraindicated: false,
            dosesReceived: 0,
            reason: ""
          }
        ]
      })
    ).toBe(false);
    expect(immunizationScheduleCited({ forecast: [] })).toBe(false);
    expect(immunizationScheduleCited(null)).toBe(false);
  });

  it("immunizationContraindicationHonored: false when a contraindicated vaccine is recommended", () => {
    expect(
      immunizationContraindicationHonored(evaluateImmunization(DEMO_IMMUNIZATION_CONTRAINDICATION_REQUEST))
    ).toBe(true);
    expect(
      immunizationContraindicationHonored({
        forecast: [
          {
            ruleId: "rule.zoster-rzv",
            vaccine: "zoster",
            label: "z",
            status: "overdue",
            contraindicated: true,
            dosesReceived: 0,
            reason: ""
          }
        ]
      })
    ).toBe(false);
    expect(immunizationContraindicationHonored(null)).toBe(false);
  });

  it("immunizationNoAutonomousAdministration: false when due/overdue without a clinician order", () => {
    expect(
      immunizationNoAutonomousAdministration(evaluateImmunization(DEMO_IMMUNIZATION_REQUEST))
    ).toBe(true);
    expect(
      immunizationNoAutonomousAdministration({
        dueCount: 1,
        overdueCount: 0,
        requiresClinicianOrder: false
      })
    ).toBe(false);
    expect(
      immunizationNoAutonomousAdministration({
        dueCount: 0,
        overdueCount: 0,
        requiresClinicianOrder: false
      })
    ).toBe(true);
    expect(immunizationNoAutonomousAdministration(null)).toBe(false);
  });
});

describe("immunizationSummary", () => {
  it("is a compact, PHI-safe projection of the determination", () => {
    const det = evaluateImmunization(DEMO_IMMUNIZATION_REQUEST);
    const s = immunizationSummary(det);
    expect(s).toEqual({
      patientRef: "imm-patient-001",
      asOfDate: "2026-09-05",
      ageYears: 52,
      ruleCount: det.forecast.length,
      dueCount: 1,
      overdueCount: 2,
      contraindicatedCount: 0,
      requiresClinicianOrder: true,
      synthetic: true
    });
  });
});
