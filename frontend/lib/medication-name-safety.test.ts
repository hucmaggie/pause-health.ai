import { describe, expect, it } from "vitest";

import {
  type MedicationNameSafetyDetermination,
  DEFAULT_EDIT_DISTANCE_THRESHOLD,
  DEFAULT_FORMULARY_CATALOG,
  DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST,
  DEMO_MEDICATION_NAME_SAFETY_REQUEST,
  DEMO_MEDICATION_NAME_SAFETY_UNRECOGNIZED_REQUEST,
  evaluateMedicationNameSafety,
  lasaCandidatesSourced,
  lasaDistancesConsistent,
  lasaNoAutonomousSubstitution,
  levenshtein,
  medicationNameSafetySummary,
  normalizeDrugName
} from "./medication-name-safety";

describe("levenshtein", () => {
  it("is 0 for identical strings", () => {
    expect(levenshtein("premarin", "premarin")).toBe(0);
  });

  it("counts a single substitution", () => {
    expect(levenshtein("premarin", "premarim")).toBe(1);
  });

  it("computes the classic LASA pair premarin/primaxin as distance 2", () => {
    expect(levenshtein("premarin", "primaxin")).toBe(2);
  });

  it("counts pure insertions / deletions against the empty string", () => {
    expect(levenshtein("", "abcd")).toBe(4);
    expect(levenshtein("abcd", "")).toBe(4);
  });

  it("is symmetric", () => {
    expect(levenshtein("estradiol", "estradol")).toBe(levenshtein("estradol", "estradiol"));
  });
});

describe("normalizeDrugName", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeDrugName("  Estradiol   Valerate ")).toBe("estradiol valerate");
  });
});

describe("evaluateMedicationNameSafety", () => {
  it("recognizes an exact match with no look-alike as recognized-clear", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_REQUEST);
    expect(d.disposition).toBe("recognized-clear");
    expect(d.exactMatch).toBe(true);
    expect(d.nearestMatch?.name).toBe("gabapentin");
    expect(d.nearestMatch?.editDistance).toBe(0);
    expect(d.confusable).toHaveLength(0);
    expect(d.editDistanceThreshold).toBe(DEFAULT_EDIT_DISTANCE_THRESHOLD);
    expect(d.requiresPharmacistReview).toBe(true);
    expect(d.autoSubstituted).toBe(false);
  });

  it("flags an exact match that has a look-alike within the threshold as lasa-warning", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    expect(d.disposition).toBe("lasa-warning");
    expect(d.exactMatch).toBe(true);
    expect(d.nearestMatch?.name).toBe("premarin");
    expect(d.confusable.map((c) => c.name)).toEqual(["primaxin"]);
    expect(d.confusable[0].editDistance).toBe(2);
  });

  it("flags a near-miss misspelling as lasa-warning", () => {
    const d = evaluateMedicationNameSafety({
      requestRef: "mns-x",
      patientRef: "patient-x",
      prescribedName: "estradol"
    });
    expect(d.disposition).toBe("lasa-warning");
    expect(d.exactMatch).toBe(false);
    expect(d.nearestMatch?.name).toBe("estradiol");
    expect(d.nearestMatch?.editDistance).toBe(1);
    expect(d.confusable.map((c) => c.name)).toContain("estradiol");
  });

  it("reports an out-of-range name as unrecognized", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_UNRECOGNIZED_REQUEST);
    expect(d.disposition).toBe("unrecognized");
    expect(d.exactMatch).toBe(false);
    expect(d.confusable).toHaveLength(0);
    expect((d.nearestMatch?.editDistance ?? 0)).toBeGreaterThan(d.editDistanceThreshold);
  });

  it("respects a caller-supplied threshold", () => {
    // At threshold 3, hydroxyzine and hydralazine (distance 4) still don't pair,
    // but a wider threshold pulls in more neighbors for a misspelling.
    const d = evaluateMedicationNameSafety({
      requestRef: "mns-t",
      patientRef: "patient-t",
      prescribedName: "premarim", // distance 1 to premarin, distance 3 to primaxin
      editDistanceThreshold: 3
    });
    const ids = d.confusable.map((c) => c.drugId).sort();
    expect(ids).toContain("drug-premarin");
    expect(ids).toContain("drug-primaxin");
  });

  it("is deterministic — identical inputs yield identical findings", () => {
    const a = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    const b = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    expect(a).toEqual(b);
  });

  it("echoes the catalog so the guards can recompute end-to-end", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_REQUEST);
    expect(d.catalogSize).toBe(DEFAULT_FORMULARY_CATALOG.length);
    expect(d.catalog).toHaveLength(DEFAULT_FORMULARY_CATALOG.length);
  });
});

describe("lasaCandidatesSourced", () => {
  it("is true for a produced determination", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    expect(lasaCandidatesSourced(d)).toBe(true);
  });

  it("is false when a candidate's name doesn't match its catalog entry", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    const tampered = {
      ...d,
      nearestMatch: { drugId: "drug-premarin", name: "premaryn", editDistance: 0 }
    };
    expect(lasaCandidatesSourced(tampered)).toBe(false);
  });

  it("is false when a candidate's drugId is not in the catalog", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    const tampered = {
      ...d,
      confusable: [{ drugId: "drug-phantom", name: "phantom", editDistance: 2 }]
    };
    expect(lasaCandidatesSourced(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(lasaCandidatesSourced(null)).toBe(false);
    expect(lasaCandidatesSourced(undefined)).toBe(false);
  });
});

describe("lasaDistancesConsistent", () => {
  it("is true for a produced determination", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    expect(lasaDistancesConsistent(d)).toBe(true);
  });

  it("is true for each demo disposition", () => {
    expect(
      lasaDistancesConsistent(evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_REQUEST))
    ).toBe(true);
    expect(
      lasaDistancesConsistent(
        evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_UNRECOGNIZED_REQUEST)
      )
    ).toBe(true);
  });

  it("is false when the disposition doesn't follow the recomputed distances", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    // A look-alike exists, so it cannot be recognized-clear.
    expect(lasaDistancesConsistent({ ...d, disposition: "recognized-clear" })).toBe(false);
  });

  it("is false when a reported distance is wrong", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    const tampered = {
      ...d,
      confusable: [{ drugId: "drug-primaxin", name: "primaxin", editDistance: 1 }]
    };
    expect(lasaDistancesConsistent(tampered)).toBe(false);
  });

  it("is false when a look-alike is omitted from the confusable set", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    expect(lasaDistancesConsistent({ ...d, confusable: [] })).toBe(false);
  });

  it("is unaffected by a candidate's echoed name (recomputes from the catalog) — isolated from sourced", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    // Mislabel the nearest match's name but keep its drugId + distance correct.
    const tampered = {
      ...d,
      nearestMatch: { drugId: "drug-premarin", name: "premaryn", editDistance: 0 }
    };
    expect(lasaDistancesConsistent(tampered)).toBe(true);
    expect(lasaCandidatesSourced(tampered)).toBe(false);
  });

  it("is false for a bad threshold", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    expect(lasaDistancesConsistent({ ...d, editDistanceThreshold: 0 })).toBe(false);
  });
});

describe("lasaNoAutonomousSubstitution", () => {
  it("is true for a produced determination", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    expect(lasaNoAutonomousSubstitution(d)).toBe(true);
  });

  it("is false when a drug was substituted autonomously", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    expect(
      lasaNoAutonomousSubstitution({
        ...(d as MedicationNameSafetyDetermination),
        autoSubstituted: true as unknown as false
      })
    ).toBe(false);
  });

  it("is false when pharmacist review is skipped", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    expect(
      lasaNoAutonomousSubstitution({
        ...(d as MedicationNameSafetyDetermination),
        requiresPharmacistReview: false as unknown as true
      })
    ).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(lasaNoAutonomousSubstitution(null)).toBe(false);
  });
});

describe("medicationNameSafetySummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateMedicationNameSafety(DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST);
    const s = medicationNameSafetySummary(d);
    expect(s).toEqual({
      requestRef: "mns-002",
      patientRef: "patient-6640",
      disposition: "lasa-warning",
      exactMatch: true,
      nearestName: "premarin",
      nearestDistance: 0,
      confusableCount: 1,
      requiresPharmacistReview: true,
      synthetic: true
    });
  });
});
