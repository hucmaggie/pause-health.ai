import { describe, expect, it } from "vitest";
import {
  CCM_ACTIVITY_CATALOG,
  CCM_BILLING_THRESHOLDS,
  CHRONIC_CONDITION_CATALOG,
  DEMO_COMPLEX_PATIENT,
  DEMO_ELIGIBLE_PATIENT,
  DEMO_INELIGIBLE_PATIENT,
  MEDICARE_ELIGIBLE_AGE,
  assembleCcmBillingPackage,
  assembleCcmMonthReport,
  billingRequiresHumanApproval,
  eligibilityTracesToCatalog,
  evaluateCcmEligibility,
  getCcmActivity,
  getChronicCondition,
  isCcmActivity,
  isChronicCondition,
  pickCptCode,
  summarizeCcmTime,
  timeEntriesAddUp
} from "./complex-care-management";

/**
 * Tests for lib/complex-care-management.ts — the deterministic CCM core
 * behind the Complex Care Management Agent. Assembly is a pure function of
 * the context (no randomness, no clock), so the same context always yields
 * the same eligibility + time summary + CPT selection + billing package.
 * These pin determinism, catalog-sourced eligibility criteria + activity
 * catalog, the CPT-code ladder, and the three honest governance signals.
 */

describe("catalogs", () => {
  it("exposes the chronic-condition + CCM-activity catalogs + thresholds", () => {
    expect(CHRONIC_CONDITION_CATALOG.length).toBeGreaterThan(0);
    for (const c of CHRONIC_CONDITION_CATALOG) {
      expect(c.id).toMatch(/^condition\./);
      expect(c.synthetic).toBe(true);
    }
    expect(CCM_ACTIVITY_CATALOG.length).toBeGreaterThan(0);
    for (const a of CCM_ACTIVITY_CATALOG) {
      expect(a.id).toMatch(/^activity\./);
      expect(a.synthetic).toBe(true);
    }
    expect(MEDICARE_ELIGIBLE_AGE).toBe(65);
    expect(CCM_BILLING_THRESHOLDS.notBillableBelow).toBe(20);
    expect(CCM_BILLING_THRESHOLDS.cpt99490).toBe(20);
    expect(CCM_BILLING_THRESHOLDS.cpt99491).toBe(40);
    expect(CCM_BILLING_THRESHOLDS.cpt99487).toBe(60);
    expect(CCM_BILLING_THRESHOLDS.cpt99489).toBe(90);
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const c of CHRONIC_CONDITION_CATALOG) {
      expect(isChronicCondition(c.id)).toBe(true);
      expect(getChronicCondition(c.id)?.label).toBe(c.label);
    }
    expect(isChronicCondition("condition.made-up")).toBe(false);
    for (const a of CCM_ACTIVITY_CATALOG) {
      expect(isCcmActivity(a.id)).toBe(true);
      expect(getCcmActivity(a.id)?.label).toBe(a.label);
    }
    expect(isCcmActivity("activity.made-up")).toBe(false);
    expect(isChronicCondition(42)).toBe(false);
  });
});

describe("evaluateCcmEligibility", () => {
  it("is deterministic — same context always yields the same result", () => {
    expect(evaluateCcmEligibility(DEMO_ELIGIBLE_PATIENT)).toEqual(
      evaluateCcmEligibility(DEMO_ELIGIBLE_PATIENT)
    );
  });

  it("marks a Medicare-age, consented, ≥ 2-condition patient eligible", () => {
    const e = evaluateCcmEligibility(DEMO_ELIGIBLE_PATIENT);
    expect(e.eligible).toBe(true);
    expect(e.qualifyingConditions).toHaveLength(3);
    expect(e.hasTwoOrMoreConditions).toBe(true);
    expect(e.meetsAgeGate).toBe(true);
    expect(e.medicareCoverageOnFile).toBe(true);
    expect(e.consentOnFile).toBe(true);
    expect(e.ineligibilityReasons).toEqual([]);
  });

  it("marks an under-age patient ineligible with a clear reason", () => {
    const e = evaluateCcmEligibility(DEMO_INELIGIBLE_PATIENT);
    expect(e.eligible).toBe(false);
    expect(e.ineligibilityReasons.some((r) => r.includes("Medicare"))).toBe(true);
  });

  it("filters off-catalog chronic conditions from the qualifying set", () => {
    const e = evaluateCcmEligibility({
      ...DEMO_ELIGIBLE_PATIENT,
      chronicConditions: ["condition.hypertension", "condition.made-up"]
    });
    // Off-catalog condition doesn't count → 1 qualifying → ineligible.
    expect(e.qualifyingConditions).toEqual(["condition.hypertension"]);
    expect(e.hasTwoOrMoreConditions).toBe(false);
    expect(e.eligible).toBe(false);
  });
});

describe("summarizeCcmTime", () => {
  it("rolls up per-activity minutes deterministically", () => {
    const s = summarizeCcmTime(DEMO_ELIGIBLE_PATIENT.timeEntries);
    expect(s.totalMinutes).toBe(35);
    expect(s.perActivity).toHaveLength(3);
    expect(s.everyActivityIsCatalogSourced).toBe(true);
    // Sorted by activityId ascending for a stable display.
    const ids = s.perActivity.map((e) => e.activityId);
    expect(ids).toEqual([...ids].sort());
  });

  it("flags off-catalog activities via everyActivityIsCatalogSourced:false", () => {
    const s = summarizeCcmTime([
      { activityId: "activity.made-up", minutes: 10, note: "bogus" }
    ]);
    expect(s.everyActivityIsCatalogSourced).toBe(false);
  });

  it("ignores negative/zero minute entries", () => {
    const s = summarizeCcmTime([
      { activityId: "activity.patient-communication", minutes: 5, note: "" },
      { activityId: "activity.patient-communication", minutes: -3, note: "" },
      { activityId: "activity.patient-communication", minutes: 0, note: "" }
    ]);
    expect(s.totalMinutes).toBe(5);
  });
});

describe("pickCptCode", () => {
  it("< 20min → NOT_BILLABLE regardless of complexity", () => {
    expect(pickCptCode(0, "non-complex")).toBe("NOT_BILLABLE");
    expect(pickCptCode(19, "moderate-or-high")).toBe("NOT_BILLABLE");
  });

  it("non-complex ladder: 99490 → 99491 by 40-min threshold", () => {
    expect(pickCptCode(20, "non-complex")).toBe("99490");
    expect(pickCptCode(39, "non-complex")).toBe("99490");
    expect(pickCptCode(40, "non-complex")).toBe("99491");
    expect(pickCptCode(59, "non-complex")).toBe("99491");
    // Non-complex complexity NEVER escalates to 99487 / 99489.
    expect(pickCptCode(90, "non-complex")).toBe("99491");
  });

  it("complex ladder: 99487 → 99489 by 60/90-min thresholds", () => {
    expect(pickCptCode(60, "moderate-or-high")).toBe("99487");
    expect(pickCptCode(89, "moderate-or-high")).toBe("99487");
    expect(pickCptCode(90, "moderate-or-high")).toBe("99489");
  });

  it("complex complexity but under-60 minutes falls back to the non-complex ladder", () => {
    expect(pickCptCode(20, "moderate-or-high")).toBe("99490");
    expect(pickCptCode(45, "moderate-or-high")).toBe("99491");
  });
});

describe("assembleCcmBillingPackage", () => {
  it("always requires human approval; never autonomously submits", () => {
    const p = assembleCcmBillingPackage({
      patientRef: "ccm-x",
      month: "2026-07",
      totalMinutes: 45,
      complexity: "non-complex"
    });
    expect(p.state).toBe("ready-for-quality-team-review");
    expect(p.cptCode).toBe("99491");
    expect(p.requiresQualityTeamApproval).toBe(true);
    expect(p.submitted).toBe(false);
    expect(p.packageId).toContain("ccm-x");
    expect(p.packageId).toContain("2026-07");
  });

  it("returns state:'not-billable' when total < 20min", () => {
    const p = assembleCcmBillingPackage({
      patientRef: "ccm-x",
      month: "2026-07",
      totalMinutes: 10,
      complexity: "non-complex"
    });
    expect(p.state).toBe("not-billable");
    expect(p.cptCode).toBe("NOT_BILLABLE");
    // Even a not-billable package still asserts human approval + not-submitted.
    expect(p.requiresQualityTeamApproval).toBe(true);
    expect(p.submitted).toBe(false);
  });
});

describe("assembleCcmMonthReport", () => {
  it("is deterministic — same context always yields the same report", () => {
    expect(assembleCcmMonthReport(DEMO_ELIGIBLE_PATIENT)).toEqual(
      assembleCcmMonthReport(DEMO_ELIGIBLE_PATIENT)
    );
  });

  it("produces a non-complex 99490 package for the eligible demo (35min)", () => {
    const r = assembleCcmMonthReport(DEMO_ELIGIBLE_PATIENT);
    expect(r.eligibility.eligible).toBe(true);
    expect(r.timeSummary.totalMinutes).toBe(35);
    expect(r.billingPackage?.cptCode).toBe("99490");
    expect(r.billingPackage?.requiresQualityTeamApproval).toBe(true);
    expect(r.billingPackage?.submitted).toBe(false);
  });

  it("produces a complex 99487 package for the complex demo (72min)", () => {
    const r = assembleCcmMonthReport(DEMO_COMPLEX_PATIENT);
    expect(r.eligibility.eligible).toBe(true);
    expect(r.timeSummary.totalMinutes).toBe(72);
    expect(r.billingPackage?.cptCode).toBe("99487");
  });

  it("returns null billing package + ineligibility reasons for an ineligible patient", () => {
    const r = assembleCcmMonthReport(DEMO_INELIGIBLE_PATIENT);
    expect(r.eligibility.eligible).toBe(false);
    expect(r.billingPackage).toBeNull();
  });
});

describe("governance signals", () => {
  const r = assembleCcmMonthReport(DEMO_ELIGIBLE_PATIENT);

  it("eligibilityTracesToCatalog: true for the produced eligibility, false for off-catalog", () => {
    expect(eligibilityTracesToCatalog(r.eligibility)).toBe(true);
    expect(
      eligibilityTracesToCatalog({
        qualifyingConditions: ["condition.made-up"]
      })
    ).toBe(false);
    expect(eligibilityTracesToCatalog(null)).toBe(false);
    expect(eligibilityTracesToCatalog({})).toBe(true);
  });

  it("billingRequiresHumanApproval: true for produced package, false when submitted or unapproved", () => {
    expect(billingRequiresHumanApproval(r.billingPackage!)).toBe(true);
    expect(billingRequiresHumanApproval(null)).toBe(true); // no package → trivially safe
    expect(
      billingRequiresHumanApproval({
        ...r.billingPackage!,
        submitted: true
      } as unknown as typeof r.billingPackage)
    ).toBe(false);
    expect(
      billingRequiresHumanApproval({
        ...r.billingPackage!,
        requiresQualityTeamApproval: false
      } as unknown as typeof r.billingPackage)
    ).toBe(false);
  });

  it("timeEntriesAddUp: true when entries are catalog + sum matches, false otherwise", () => {
    expect(
      timeEntriesAddUp({
        entries: DEMO_ELIGIBLE_PATIENT.timeEntries as unknown as { activityId: string; minutes: number }[],
        totalMinutes: r.timeSummary.totalMinutes
      })
    ).toBe(true);
    // Phantom-minute inflation.
    expect(
      timeEntriesAddUp({
        entries: DEMO_ELIGIBLE_PATIENT.timeEntries as unknown as { activityId: string; minutes: number }[],
        totalMinutes: 60
      })
    ).toBe(false);
    // Off-catalog activity.
    expect(
      timeEntriesAddUp({
        entries: [{ activityId: "activity.made-up", minutes: 10 }],
        totalMinutes: 10
      })
    ).toBe(false);
    expect(timeEntriesAddUp(null)).toBe(false);
    expect(timeEntriesAddUp({ entries: [], totalMinutes: 0 })).toBe(true);
  });
});
