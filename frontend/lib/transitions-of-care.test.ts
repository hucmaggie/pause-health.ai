import { describe, expect, it } from "vitest";
import {
  APPROVED_MEDICATION_SOURCES,
  DEMO_AWAITING_SCHEDULE_PATIENT,
  DEMO_TOC_PATIENT,
  FOLLOW_UP_WINDOW_DAYS,
  RED_FLAG_CATALOG,
  UNIVERSAL_TEACH_BACK,
  assembleTransitionOfCare,
  followUpScheduledNotRecommended,
  getRedFlag,
  isApprovedMedicationSource,
  isEncounterReasonCategory,
  medicationsTraceToApprovedSource,
  proposeMedicationChange,
  reconcileMedications,
  reconciliationChangeRequiresClinician
} from "./transitions-of-care";

/**
 * Tests for lib/transitions-of-care.ts — the deterministic transitions-of-
 * care planner behind the Discharge & Transitions of Care Agent. Assembly is
 * a pure function of the patient context + discharge date + provided lists
 * (no randomness, no clock — timestamps are accepted as data), so the same
 * context always yields the same package. These pin determinism, catalog-
 * sourced medications + red-flag warnings + teach-back items, the safe
 * awaiting-schedule interim answer, and the three honest governance signals.
 */

describe("catalogs", () => {
  it("exposes a stable, illustrative red-flag catalog keyed by encounter reason", () => {
    for (const [category, list] of Object.entries(RED_FLAG_CATALOG)) {
      expect(list.length).toBeGreaterThan(0);
      expect(isEncounterReasonCategory(category)).toBe(true);
      for (const r of list) {
        expect(r.id).toMatch(/^warn\./);
        expect(r.synthetic).toBe(true);
      }
    }
  });

  it("exposes a stable universal teach-back checklist + follow-up window", () => {
    expect(UNIVERSAL_TEACH_BACK.length).toBeGreaterThan(0);
    for (const t of UNIVERSAL_TEACH_BACK) expect(t.id).toMatch(/^teach\./);
    expect(FOLLOW_UP_WINDOW_DAYS).toBe(14);
  });

  it("catalog lookups agree with the catalog", () => {
    const anyWarn = RED_FLAG_CATALOG.cardiovascular[0];
    expect(getRedFlag(anyWarn.id)?.label).toBe(anyWarn.label);
    expect(getRedFlag("warn.made-up")).toBeUndefined();
    expect(isEncounterReasonCategory("cardiovascular")).toBe(true);
    expect(isEncounterReasonCategory("made-up")).toBe(false);
    for (const s of APPROVED_MEDICATION_SOURCES) {
      expect(isApprovedMedicationSource(s)).toBe(true);
    }
    expect(isApprovedMedicationSource("verbal-not-documented")).toBe(false);
    expect(isApprovedMedicationSource(42)).toBe(false);
  });
});

describe("reconcileMedications", () => {
  it("classifies added / removed / dose-changed / unchanged deterministically", () => {
    const r = reconcileMedications(
      DEMO_TOC_PATIENT.preAdmitMedications!,
      DEMO_TOC_PATIENT.dischargeMedications!
    );
    const byId = new Map(r.lines.map((l) => [l.medicationId, l]));
    // Metoprolol dose changed (25→50 mg BID)
    expect(byId.get("med.metoprolol-25")?.changeKind).toBe("dose-changed");
    // Estradiol unchanged (same dose across pre/post)
    expect(byId.get("med.estradiol-patch")?.changeKind).toBe("unchanged");
    // Apixaban added on discharge
    expect(byId.get("med.apixaban-5")?.changeKind).toBe("added");
    // No removes on the demo patient.
    expect(Array.from(byId.values()).some((l) => l.changeKind === "removed")).toBe(false);
    expect(r.changes).toBe(2);
    // Sorted by medication id.
    const ids = r.lines.map((l) => l.medicationId);
    expect(ids).toEqual([...ids].sort());
    // Always draft, never applied.
    expect(r.requiresClinicianSignoff).toBe(true);
    expect(r.applied).toBe(false);
  });

  it("filters off-source entries from the reconciliation (source-integrity guard fires separately)", () => {
    const r = reconcileMedications(
      [
        {
          medicationId: "med.metoprolol-25",
          label: "Metoprolol",
          dose: "25 mg PO BID",
          source: "pre-admit-verified"
        }
      ],
      [
        {
          medicationId: "med.made-up",
          label: "Made-up med",
          dose: "5 mg",
          source: "verbal-not-documented"
        }
      ]
    );
    // The verbal entry is not on the reconciliation lines.
    expect(r.lines.some((l) => l.medicationId === "med.made-up")).toBe(false);
    // But the metoprolol survives as removed (no discharge counterpart).
    expect(r.lines.find((l) => l.medicationId === "med.metoprolol-25")?.changeKind).toBe(
      "removed"
    );
  });
});

describe("assembleTransitionOfCare", () => {
  it("is deterministic — same context always yields the same package", () => {
    const a = assembleTransitionOfCare(DEMO_TOC_PATIENT);
    const b = assembleTransitionOfCare(DEMO_TOC_PATIENT);
    expect(a).toEqual(b);
  });

  it("returns ready-for-clinician-signoff with a scheduled follow-up in the 14-day window", () => {
    const a = assembleTransitionOfCare(DEMO_TOC_PATIENT);
    expect(a.state).toBe("ready-for-clinician-signoff");
    expect(a.followUp.scheduled).toBe(true);
    expect(a.followUp.awaitingSchedule).toBe(false);
    // The demo patient discharges 2026-07-01, follow-up 2026-07-08 → 7 days.
    expect(a.followUp.daysFromDischarge).toBe(7);
    expect(a.followUp.daysFromDischarge!).toBeLessThanOrEqual(FOLLOW_UP_WINDOW_DAYS);
    // Red-flags come from the cardiovascular category (catalog-sourced).
    expect(a.redFlagWarnings).toEqual(RED_FLAG_CATALOG.cardiovascular);
  });

  it("returns awaiting-schedule when no follow-up is booked (a safe interim answer)", () => {
    const a = assembleTransitionOfCare(DEMO_AWAITING_SCHEDULE_PATIENT);
    expect(a.state).toBe("awaiting-schedule");
    expect(a.followUp.scheduled).toBe(false);
    expect(a.followUp.awaitingSchedule).toBe(true);
    expect(a.followUp.slotStart).toBeUndefined();
    // Red-flags come from the behavioral category.
    expect(a.redFlagWarnings).toEqual(RED_FLAG_CATALOG.behavioral);
    // The reconciliation is still catalog-sourced (a new SSRI on discharge).
    expect(a.reconciliation.lines).toHaveLength(1);
    expect(a.reconciliation.lines[0].changeKind).toBe("added");
  });

  it("falls to the general red-flag list for an unknown encounter-reason category", () => {
    const a = assembleTransitionOfCare({
      ...DEMO_TOC_PATIENT,
      encounterReasonCategory: undefined
    });
    expect(a.encounterReasonCategory).toBe("general");
    expect(a.redFlagWarnings).toEqual(RED_FLAG_CATALOG.general);
  });
});

describe("proposeMedicationChange", () => {
  it("always requires clinician sign-off; never applied autonomously", () => {
    const p = proposeMedicationChange({
      medicationId: "med.metoprolol-25",
      changeKind: "dose-changed",
      rationale: "titrated to 50 mg BID on discharge"
    });
    expect(p.requiresClinicianSignoff).toBe(true);
    expect(p.applied).toBe(false);
    expect(p.state).toBe("ready-for-clinician-signoff");
    expect(p.changeKind).toBe("dose-changed");
  });
});

describe("governance signals", () => {
  const proposal = proposeMedicationChange({
    medicationId: "med.metoprolol-25",
    changeKind: "dose-changed",
    rationale: "titrated"
  });

  it("medicationsTraceToApprovedSource: true for the demo lists, false for verbal / off-source", () => {
    expect(
      medicationsTraceToApprovedSource({
        preAdmit: DEMO_TOC_PATIENT.preAdmitMedications,
        discharge: DEMO_TOC_PATIENT.dischargeMedications
      })
    ).toBe(true);
    expect(
      medicationsTraceToApprovedSource({
        preAdmit: [],
        discharge: [
          {
            source: "verbal-not-documented"
          }
        ]
      })
    ).toBe(false);
    expect(medicationsTraceToApprovedSource(null)).toBe(false);
    expect(medicationsTraceToApprovedSource(undefined)).toBe(false);
  });

  it("reconciliationChangeRequiresClinician: true for produced proposals, false when applied or unapproved", () => {
    expect(reconciliationChangeRequiresClinician([proposal])).toBe(true);
    expect(reconciliationChangeRequiresClinician([])).toBe(true);
    expect(
      reconciliationChangeRequiresClinician([
        {
          ...proposal,
          applied: true
        } as unknown as typeof proposal
      ])
    ).toBe(false);
    expect(
      reconciliationChangeRequiresClinician([
        {
          requiresClinicianSignoff: false,
          applied: false
        }
      ])
    ).toBe(false);
    expect(reconciliationChangeRequiresClinician(null)).toBe(false);
  });

  it("followUpScheduledNotRecommended: true for a real slot or awaiting-schedule, false for a fake 'scheduled' without a slot", () => {
    // Real scheduled slot.
    expect(
      followUpScheduledNotRecommended({
        scheduled: true,
        awaitingSchedule: false,
        slotStart: "2026-07-08T15:00:00Z",
        providerRef: "provider-card-001"
      })
    ).toBe(true);
    // Explicit awaiting-schedule — safe interim.
    expect(
      followUpScheduledNotRecommended({
        scheduled: false,
        awaitingSchedule: true
      })
    ).toBe(true);
    // The violation: scheduled:true but no slotStart / providerRef.
    expect(followUpScheduledNotRecommended({ scheduled: true })).toBe(false);
    expect(
      followUpScheduledNotRecommended({
        scheduled: true,
        slotStart: "2026-07-08T15:00:00Z"
      })
    ).toBe(false);
    // Neither scheduled nor awaiting — an ambiguous / recommended-only plan.
    expect(
      followUpScheduledNotRecommended({
        scheduled: false,
        awaitingSchedule: false
      })
    ).toBe(false);
    expect(followUpScheduledNotRecommended(null)).toBe(false);
  });

  it("the produced package satisfies all three signals for the demo patient", () => {
    const a = assembleTransitionOfCare(DEMO_TOC_PATIENT);
    expect(
      medicationsTraceToApprovedSource({
        preAdmit: DEMO_TOC_PATIENT.preAdmitMedications,
        discharge: DEMO_TOC_PATIENT.dischargeMedications
      })
    ).toBe(true);
    expect(followUpScheduledNotRecommended(a.followUp)).toBe(true);
    // The reconciliation itself carries the clinician-signoff flags.
    expect(a.reconciliation.requiresClinicianSignoff).toBe(true);
    expect(a.reconciliation.applied).toBe(false);
  });
});
