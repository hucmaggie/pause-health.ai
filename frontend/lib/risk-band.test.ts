import { describe, expect, it } from "vitest";
import {
  computeRisk,
  hrtSuitability,
  suggestedPathway,
  type RiskBand
} from "./risk-band";
import { DEMO_COHORT, type DemoPersona } from "./demo-cohort";

/**
 * Tests for lib/risk-band.ts.
 *
 * The module is the single source of truth for the deterministic
 * intake-derived risk band shown on /demo/patient and used by the
 * suggested-pathway preview that ships to /demo/routing. It is also
 * the function the polished PreBriefPanel reads to surface
 * "risk band: High" before the Agentforce chat opens.
 *
 * Strategy:
 *
 *   1. Threshold tests: synthesize personas that hit each band
 *      boundary so a future refactor can't silently move them.
 *
 *   2. Axis-flag tests: each axis individually at the "elevated"
 *      and "high" cutoffs, and a single-axis-promotes rule.
 *
 *   3. Real-cohort sanity: every persona in DEMO_COHORT lands on
 *      the band the displayRisk label promises on the public queue
 *      card. This is the test that fires if a persona's intake
 *      scores drift out of sync with the queue card label.
 *
 *   4. suggestedPathway: exercises each branch of the mood-led /
 *      Critical / vasomotor-led / mixed-High / Moderate / Low
 *      decision tree against a real persona.
 *
 *   5. hrtSuitability: every regex branch (CVD/BMI, bleeding, GSM,
 *      mood, MSK, default) at least once.
 */

function makePersona(
  overrides: Partial<DemoPersona> & {
    vasomotorScore: number;
    sleepScore: number;
    moodScore: number;
  }
): DemoPersona {
  return {
    id: "test-persona",
    firstName: "Test",
    lastName: "Persona",
    ageBand: "45-49",
    cycleStatus: "Perimenopausal",
    primarySymptom: "Hot flashes",
    profileNote: "Synthetic test persona.",
    displaySymptoms: "n/a",
    displayRisk: "Moderate",
    displayWait: "n/a",
    displaySource: "n/a",
    ...overrides
  };
}

describe("computeRisk · band thresholds", () => {
  it("returns Low when index < 10", () => {
    const persona = makePersona({ vasomotorScore: 3, sleepScore: 3, moodScore: 3 });
    const r = computeRisk(persona);
    expect(r.index).toBe(9);
    expect(r.band).toBe<RiskBand>("Low");
    expect(r.rationale).toMatch(/low burden/i);
  });

  it("promotes to Moderate at the 10 boundary", () => {
    const persona = makePersona({ vasomotorScore: 4, sleepScore: 3, moodScore: 3 });
    expect(computeRisk(persona).band).toBe<RiskBand>("Moderate");
  });

  it("keeps Moderate up to index 15 when no single axis is >= 8", () => {
    const persona = makePersona({ vasomotorScore: 5, sleepScore: 5, moodScore: 5 });
    expect(computeRisk(persona)).toMatchObject<Partial<ReturnType<typeof computeRisk>>>({
      index: 15,
      band: "Moderate"
    });
  });

  it("promotes to High at index 16", () => {
    const persona = makePersona({ vasomotorScore: 6, sleepScore: 5, moodScore: 5 });
    expect(computeRisk(persona).band).toBe<RiskBand>("High");
  });

  it("promotes to High purely on a single axis >= 8 even when total is moderate", () => {
    const persona = makePersona({ vasomotorScore: 8, sleepScore: 2, moodScore: 1 });
    const r = computeRisk(persona);
    expect(r.index).toBe(11);
    expect(r.band).toBe<RiskBand>("High");
    expect(r.rationale).toMatch(/single axis/i);
  });

  it("promotes to Critical at index 22", () => {
    const persona = makePersona({ vasomotorScore: 8, sleepScore: 8, moodScore: 6 });
    expect(computeRisk(persona).band).toBe<RiskBand>("Critical");
  });

  it("normalizes the index against the 0-30 scale", () => {
    const persona = makePersona({ vasomotorScore: 5, sleepScore: 5, moodScore: 5 });
    expect(computeRisk(persona).indexNormalized).toBeCloseTo(0.5, 5);
  });
});

describe("computeRisk · axis flags", () => {
  it("does not flag any axis when all scores are below the elevated threshold", () => {
    const persona = makePersona({ vasomotorScore: 5, sleepScore: 5, moodScore: 5 });
    expect(computeRisk(persona).axisFlags).toEqual([]);
  });

  it("flags an axis as elevated at score 6", () => {
    const persona = makePersona({ vasomotorScore: 6, sleepScore: 0, moodScore: 0 });
    expect(computeRisk(persona).axisFlags).toEqual([
      { axis: "Vasomotor", level: "elevated", score: 6 }
    ]);
  });

  it("flags an axis as high at score 8", () => {
    const persona = makePersona({ vasomotorScore: 0, sleepScore: 8, moodScore: 0 });
    expect(computeRisk(persona).axisFlags).toEqual([
      { axis: "Sleep", level: "high", score: 8 }
    ]);
  });

  it("emits flags in vasomotor -> sleep -> mood order even when severity differs", () => {
    const persona = makePersona({ vasomotorScore: 6, sleepScore: 9, moodScore: 7 });
    const flags = computeRisk(persona).axisFlags;
    expect(flags.map((f) => f.axis)).toEqual(["Vasomotor", "Sleep", "Mood"]);
  });
});

describe("computeRisk · real demo cohort sanity", () => {
  it.each(DEMO_COHORT)(
    "$id displayRisk matches computeRisk band",
    (persona) => {
      const computed = computeRisk(persona).band;
      // The cohort uses the same RiskBand vocabulary as displayRisk,
      // so if the seeded scores drift the queue card label will
      // diverge from what the clinician actually sees on Care Detail.
      expect(computed).toBe(persona.displayRisk);
    }
  );
});

describe("suggestedPathway · routing rules", () => {
  it("routes mood-led High to behavioral-health-handoff (Elena)", () => {
    const elena = DEMO_COHORT.find((p) => p.id === "elena-rossi")!;
    const assessment = computeRisk(elena);
    const out = suggestedPathway(elena, assessment);
    expect(out.pathway).toBe("behavioral-health-handoff");
    expect(out.rationale).toMatch(/mood/i);
  });

  it("routes Critical to urgent-gynecology", () => {
    const persona = makePersona({ vasomotorScore: 9, sleepScore: 8, moodScore: 5 });
    const assessment = computeRisk(persona);
    expect(assessment.band).toBe<RiskBand>("Critical");
    expect(suggestedPathway(persona, assessment).pathway).toBe("urgent-gynecology");
  });

  it("routes vasomotor-led High to mscp-in-person (Deepa)", () => {
    const deepa = DEMO_COHORT.find((p) => p.id === "deepa-krishnan")!;
    const out = suggestedPathway(deepa, computeRisk(deepa));
    expect(out.pathway).toBe("mscp-in-person");
    expect(out.rationale).toMatch(/vasomotor/i);
  });

  it("routes mixed High (no single severe axis) to mscp-virtual-visit (Brianna)", () => {
    const brianna = DEMO_COHORT.find((p) => p.id === "brianna-okafor")!;
    const assessment = computeRisk(brianna);
    // Brianna's sleep=8 trips the axis>=8 promotion to High band, but
    // mood (5) < 7 and vasomotor (5) < 8, so neither the mood-led nor
    // vasomotor-led branch fires -- she lands on the High-mixed
    // fallback.
    expect(assessment.band).toBe<RiskBand>("High");
    expect(suggestedPathway(brianna, assessment).pathway).toBe(
      "mscp-virtual-visit"
    );
  });

  it("routes Moderate to mscp-virtual-visit (Anika, Fatima)", () => {
    for (const id of ["anika-patel", "fatima-khan"]) {
      const persona = DEMO_COHORT.find((p) => p.id === id)!;
      const out = suggestedPathway(persona, computeRisk(persona));
      expect(out.pathway).toBe("mscp-virtual-visit");
    }
  });

  it("routes Low to self-care-tracking (Carmen)", () => {
    const carmen = DEMO_COHORT.find((p) => p.id === "carmen-diaz")!;
    const out = suggestedPathway(carmen, computeRisk(carmen));
    expect(out.pathway).toBe("self-care-tracking");
  });

  it("mood-led rule requires mood-axis dominance, not just mood>=7", () => {
    // Mood = 7 but vasomotor = 9 -- shouldn't trip the mood-led
    // branch even though mood >= 7, because mood is not the
    // predominant axis.
    const persona = makePersona({
      vasomotorScore: 9,
      sleepScore: 3,
      moodScore: 7
    });
    const out = suggestedPathway(persona, computeRisk(persona));
    expect(out.pathway).not.toBe("behavioral-health-handoff");
  });
});

describe("hrtSuitability · clinical heuristic", () => {
  function withNote(profileNote: string): DemoPersona {
    return makePersona({
      vasomotorScore: 6,
      sleepScore: 4,
      moodScore: 3,
      profileNote
    });
  }

  it("defers when CVD red flag is mentioned", () => {
    const out = hrtSuitability(withNote("Patient has CVD risk and BMI 32; menopause-pattern symptoms."));
    expect(out.label).toMatch(/defer/i);
    expect(out.detail).toMatch(/cardiometabolic/i);
  });

  it("defers when postmenopausal bleeding is mentioned", () => {
    const out = hrtSuitability(withNote("Unexpected bleeding 3 months after last cycle."));
    expect(out.label).toMatch(/defer/i);
    expect(out.detail).toMatch(/bleeding/i);
  });

  it("recommends local therapy for GSM-predominant profiles (Carmen)", () => {
    const carmen = DEMO_COHORT.find((p) => p.id === "carmen-diaz")!;
    const out = hrtSuitability(carmen);
    expect(out.label).toMatch(/local therapy/i);
  });

  it("recommends co-management for mood-predominant profiles (Elena)", () => {
    const elena = DEMO_COHORT.find((p) => p.id === "elena-rossi")!;
    const out = hrtSuitability(elena);
    expect(out.label).toMatch(/behavioral health/i);
  });

  it("flags PT/lifestyle for musculoskeletal-predominant profiles (Fatima)", () => {
    const fatima = DEMO_COHORT.find((p) => p.id === "fatima-khan")!;
    const out = hrtSuitability(fatima);
    expect(out.label).toMatch(/lifestyle|PT/i);
  });

  it("returns the candidate default when no red flag matches", () => {
    const out = hrtSuitability(withNote("Healthy perimenopausal patient, daily hot flashes."));
    expect(out.label).toMatch(/candidate/i);
  });
});
