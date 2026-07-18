import { describe, expect, it } from "vitest";
import {
  DEMO_PANEL,
  MAX_SCORE,
  PROTECTED_CLASS_ATTRIBUTES,
  RISK_FACTORS,
  TIER_CUTOFFS,
  buildWorklist,
  excludesProtectedAttributes,
  getRiskFactor,
  isProtectedClassAttribute,
  isRiskFactor,
  modelScoringFactorIds,
  riskScoreTracesToFactors,
  scorePatient,
  stratifyPanel,
  tierActionsReviewedByHuman,
  tierForScore,
  type PatientPanelSignals
} from "./population-health";

/**
 * Tests for lib/population-health.ts — the deterministic, transparent risk model
 * behind the Population Health & Risk Stratification Agent. Scoring is a pure,
 * additive/weighted function of already-produced per-patient signals (no
 * randomness, no clock), so the same panel always yields the same tiers +
 * worklist ordering. These pin determinism, the additive scoring + tier cutoffs,
 * the stable worklist tie-break, and the three honest governance signals
 * (transparent-risk-model + no-protected-class-factors + no-autonomous-care-decision).
 */

describe("risk-factor catalog + tier model", () => {
  it("exposes a non-empty catalog with stable ids, labels, weights, rationales", () => {
    expect(RISK_FACTORS.length).toBeGreaterThan(0);
    for (const f of RISK_FACTORS) {
      expect(f.id).toMatch(/^factor\./);
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.rationale.length).toBeGreaterThan(0);
      expect(f.weight).toBeGreaterThan(0);
    }
  });

  it("covers the six care-management signals (no protected-class factor)", () => {
    const ids = RISK_FACTORS.map((f) => f.id);
    expect(ids).toContain("factor.intake-severity");
    expect(ids).toContain("factor.assessment-band");
    expect(ids).toContain("factor.care-gaps");
    expect(ids).toContain("factor.sdoh-burden");
    expect(ids).toContain("factor.medication-nonadherence");
    expect(ids).toContain("factor.monitoring-trend");
    // Not one of the model's factors is a protected-class attribute.
    for (const id of ids) expect(isProtectedClassAttribute(id)).toBe(false);
  });

  it("isRiskFactor / getRiskFactor agree with the catalog", () => {
    for (const f of RISK_FACTORS) {
      expect(isRiskFactor(f.id)).toBe(true);
      expect(getRiskFactor(f.id)?.label).toBe(f.label);
    }
    expect(isRiskFactor("factor.totally-made-up")).toBe(false);
    expect(getRiskFactor("factor.totally-made-up")).toBeUndefined();
  });

  it("MAX_SCORE equals the sum of the weights and cutoffs are ordered", () => {
    expect(MAX_SCORE).toBe(RISK_FACTORS.reduce((s, f) => s + f.weight, 0));
    expect(TIER_CUTOFFS.high).toBeGreaterThan(TIER_CUTOFFS.rising);
    expect(TIER_CUTOFFS.rising).toBeGreaterThan(0);
  });

  it("tierForScore applies the fixed cutoffs", () => {
    expect(tierForScore(0)).toBe("low");
    expect(tierForScore(TIER_CUTOFFS.rising - 1)).toBe("low");
    expect(tierForScore(TIER_CUTOFFS.rising)).toBe("rising");
    expect(tierForScore(TIER_CUTOFFS.high - 1)).toBe("rising");
    expect(tierForScore(TIER_CUTOFFS.high)).toBe("high");
    expect(tierForScore(MAX_SCORE)).toBe("high");
  });
});

describe("scorePatient · determinism + additive scoring", () => {
  it("is deterministic — the same signals yield the same profile", () => {
    const signals: PatientPanelSignals = {
      patientRef: "p-x",
      intakeSeverity: "high",
      assessmentBand: "moderate"
    };
    expect(scorePatient(signals)).toEqual(scorePatient(signals));
  });

  it("scores a severe patient into the high tier with citable factors", () => {
    const profile = scorePatient(DEMO_PANEL[0]);
    expect(profile.patientRef).toBe("panel-patient-001");
    expect(profile.score).toBe(12);
    expect(profile.tier).toBe("high");
    // Every contribution references a defined catalog factor.
    for (const c of profile.contributingFactors) {
      expect(isRiskFactor(c.factorId)).toBe(true);
      expect(c.points).toBeGreaterThan(0);
    }
    // The score is the sum of the contributing factors.
    expect(
      profile.contributingFactors.reduce((s, c) => s + c.points, 0)
    ).toBe(profile.score);
  });

  it("scores a moderate patient into the rising tier", () => {
    const profile = scorePatient(DEMO_PANEL[1]);
    expect(profile.score).toBe(5);
    expect(profile.tier).toBe("rising");
  });

  it("scores a patient with no positive signals into the low tier (no factors)", () => {
    const profile = scorePatient(DEMO_PANEL[4]);
    expect(profile.score).toBe(0);
    expect(profile.tier).toBe("low");
    expect(profile.contributingFactors).toHaveLength(0);
  });
});

describe("stratifyPanel + buildWorklist · panel-level prioritization", () => {
  it("stratifies the demo panel into a low/rising/high mix with a prioritized worklist", () => {
    const strat = stratifyPanel(DEMO_PANEL);
    expect(strat.perPatient).toHaveLength(5);
    expect(strat.tierCounts).toEqual({ high: 1, rising: 2, low: 2 });
    expect(strat.synthetic).toBe(true);

    // Worklist is ordered by score descending (highest risk first).
    expect(strat.worklist).toEqual([
      "panel-patient-001", // 12
      "panel-patient-002", // 5
      "panel-patient-004", // 4
      "panel-patient-003", // 1
      "panel-patient-005" // 0
    ]);
    // Transparent: every tier traces to the defined factors.
    expect(riskScoreTracesToFactors(strat.perPatient)).toBe(true);
  });

  it("is deterministic — the same panel yields the same stratification", () => {
    expect(stratifyPanel(DEMO_PANEL)).toEqual(stratifyPanel(DEMO_PANEL));
  });

  it("breaks worklist ties on patientRef ascending (stable, documented)", () => {
    const panel: PatientPanelSignals[] = [
      { patientRef: "b-two", intakeSeverity: "high" },
      { patientRef: "a-one", intakeSeverity: "high" }
    ];
    // Same score → tie broken by patientRef ascending.
    expect(buildWorklist(stratifyPanel(panel).perPatient)).toEqual([
      "a-one",
      "b-two"
    ]);
  });
});

describe("riskScoreTracesToFactors · transparent-risk-model signal", () => {
  it("is true for anything stratifyPanel produces", () => {
    expect(riskScoreTracesToFactors(stratifyPanel(DEMO_PANEL).perPatient)).toBe(
      true
    );
  });

  it("is false for an off-catalog (opaque) factor", () => {
    expect(
      riskScoreTracesToFactors([
        {
          score: 5,
          tier: "rising",
          contributingFactors: [
            { factorId: "factor.opaque-blackbox", factorLabel: "?", points: 5, detail: "" }
          ]
        }
      ])
    ).toBe(false);
  });

  it("is false when the score doesn't sum from its factors", () => {
    expect(
      riskScoreTracesToFactors([
        {
          score: 9,
          tier: "high",
          contributingFactors: [
            { factorId: "factor.intake-severity", factorLabel: "x", points: 3, detail: "" }
          ]
        }
      ])
    ).toBe(false);
  });

  it("is false when the tier doesn't match the score, and for non-array input", () => {
    expect(
      riskScoreTracesToFactors([
        { score: 1, tier: "high", contributingFactors: [] }
      ])
    ).toBe(false);
    expect(riskScoreTracesToFactors(null)).toBe(false);
    expect(riskScoreTracesToFactors(undefined)).toBe(false);
  });
});

describe("excludesProtectedAttributes · no-protected-class-factors signal", () => {
  it("is true for the model's own factor ids", () => {
    expect(excludesProtectedAttributes(modelScoringFactorIds())).toBe(true);
  });

  it("is false when a protected-class attribute is asserted as a factor", () => {
    for (const attr of PROTECTED_CLASS_ATTRIBUTES) {
      expect(
        excludesProtectedAttributes(["factor.intake-severity", attr])
      ).toBe(false);
    }
  });

  it("is false for a non-array input", () => {
    expect(excludesProtectedAttributes(null)).toBe(false);
    expect(excludesProtectedAttributes(undefined)).toBe(false);
  });
});

describe("tierActionsReviewedByHuman · no-autonomous-care-decision signal", () => {
  it("is true for an empty set and for care-manager-routed actions", () => {
    expect(tierActionsReviewedByHuman([])).toBe(true);
    expect(
      tierActionsReviewedByHuman([{ routedTo: "care-manager-review" }])
    ).toBe(true);
  });

  it("is false for a caller-asserted autonomous care action", () => {
    expect(
      tierActionsReviewedByHuman([{ routedTo: "auto-enroll" as never }])
    ).toBe(false);
    expect(tierActionsReviewedByHuman(null)).toBe(false);
  });
});
