import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claudeRoute,
  scriptedRoute,
  type Data360GroundingHint,
  type IntakeRecord
} from "./care-router";

/**
 * Tests for lib/care-router.ts.
 *
 * The Care Router is the highest-stakes piece of business logic on
 * the public surface -- a wrong pathway recommendation in production
 * would route a patient to the wrong place. The deterministic
 * scriptedRoute() is exercised here against every branch of its
 * decision tree; the Claude-backed claudeRoute() is exercised against
 * its fallback path (no ANTHROPIC_API_KEY), which is what the
 * prototype actually runs today (the home-page "What's live today"
 * card honestly pills the Care Router as `partial` for this reason).
 *
 * Structure:
 *
 *   1. Red-flag branch: any acknowledged red flag dominates severity.
 *      Three sub-branches by primarySymptom (bleeding / mood / other).
 *
 *   2. Non-red-flag branches: bleeding, severe mood, severe / moderate /
 *      mild severity, plus the cycleStatus and ageBand modifiers.
 *
 *   3. Data 360 grounding: every cited insight ID adds rationale; the
 *      vasomotor-burden / cohort-percentile thresholds promote virtual
 *      MSCP visits to in-person.
 *
 *   4. claudeRoute fallback: ANTHROPIC_API_KEY absent -> deterministic
 *      output with an explanatory rationale line; modelProvenance
 *      reports `pause-scripted`.
 */

const baseIntake: IntakeRecord = {
  preferredName: "Test Patient",
  ageBand: "45-49",
  cycleStatus: "perimenopausal",
  primarySymptom: "vasomotor",
  severity: "moderate",
  redFlagsAcknowledged: "no"
};

describe("scriptedRoute · red-flag branch", () => {
  it("routes acknowledged red-flag + bleeding to urgent-gynecology", () => {
    const out = scriptedRoute({
      ...baseIntake,
      primarySymptom: "bleeding",
      redFlagsAcknowledged: "yes"
    });
    expect(out.pathway).toBe("urgent-gynecology");
    expect(out.redFlagsTriggered).toHaveLength(1);
    expect(out.acuity).toBe("expedited");
  });

  it("routes acknowledged red-flag + mood to behavioral-health-handoff", () => {
    const out = scriptedRoute({
      ...baseIntake,
      primarySymptom: "mood",
      redFlagsAcknowledged: "yes"
    });
    expect(out.pathway).toBe("behavioral-health-handoff");
    expect(out.acuity).toBe("urgent");
  });

  it("routes any other acknowledged red-flag to ed-referral", () => {
    const out = scriptedRoute({
      ...baseIntake,
      primarySymptom: "vasomotor",
      severity: "moderate",
      redFlagsAcknowledged: "yes"
    });
    expect(out.pathway).toBe("ed-referral");
    expect(out.acuity).toBe("emergent");
  });

  it("does NOT trip the red-flag branch when redFlagsAcknowledged is 'no'", () => {
    const out = scriptedRoute({
      ...baseIntake,
      severity: "moderate",
      redFlagsAcknowledged: "no"
    });
    expect(out.pathway).not.toBe("ed-referral");
    expect(out.redFlagsTriggered).toEqual([]);
  });
});

describe("scriptedRoute · severity + symptom branches (no red flag)", () => {
  it("routes bleeding (no red flag) to urgent-gynecology", () => {
    const out = scriptedRoute({
      ...baseIntake,
      primarySymptom: "bleeding",
      severity: "mild"
    });
    expect(out.pathway).toBe("urgent-gynecology");
    expect(out.redFlagsTriggered).toEqual([]);
  });

  it("routes severe mood to behavioral-health-handoff", () => {
    const out = scriptedRoute({
      ...baseIntake,
      primarySymptom: "mood",
      severity: "severe"
    });
    expect(out.pathway).toBe("behavioral-health-handoff");
  });

  it("routes severe non-mood symptoms to mscp-in-person", () => {
    const out = scriptedRoute({ ...baseIntake, severity: "severe" });
    expect(out.pathway).toBe("mscp-in-person");
    expect(out.acuity).toBe("routine");
  });

  it("routes moderate symptoms to mscp-virtual-visit", () => {
    expect(
      scriptedRoute({ ...baseIntake, severity: "moderate" }).pathway
    ).toBe("mscp-virtual-visit");
  });

  it("routes mild symptoms to self-care-tracking", () => {
    expect(scriptedRoute({ ...baseIntake, severity: "mild" }).pathway).toBe(
      "self-care-tracking"
    );
  });

  it("defaults to mscp-virtual-visit when severity is missing", () => {
    expect(
      scriptedRoute({ ...baseIntake, severity: undefined }).pathway
    ).toBe("mscp-virtual-visit");
    expect(
      scriptedRoute({ ...baseIntake, severity: "" }).pathway
    ).toBe("mscp-virtual-visit");
  });
});

describe("scriptedRoute · cycleStatus and ageBand modifiers", () => {
  it("postmenopausal patients on the self-care track get an MSCP cadence reminder in rationale", () => {
    const out = scriptedRoute({
      ...baseIntake,
      severity: "mild",
      cycleStatus: "stopped>=12mo"
    });
    expect(out.pathway).toBe("self-care-tracking");
    expect(out.rationale.join(" ")).toMatch(/post-menopause/i);
  });

  it("patients under 40 with menopause-pattern symptoms are promoted to mscp-in-person (rule out POI)", () => {
    const out = scriptedRoute({
      ...baseIntake,
      severity: "moderate",
      ageBand: "<40"
    });
    expect(out.pathway).toBe("mscp-in-person");
    expect(out.rationale.join(" ")).toMatch(/POI|premature/i);
  });

  it("under-40 promotion does NOT override ed-referral", () => {
    const out = scriptedRoute({
      ...baseIntake,
      ageBand: "<40",
      severity: "moderate",
      redFlagsAcknowledged: "yes"
    });
    expect(out.pathway).toBe("ed-referral");
  });
});

describe("scriptedRoute · Data 360 grounding", () => {
  const grounding: Data360GroundingHint = {
    unifiedPatientId: "data360-anika",
    calculatedInsights: [
      { id: "insight.hrv-zscore-30d", name: "HRV z-score 30d", value: 1.4 },
      { id: "insight.vasomotor-burden-30d", name: "Vasomotor burden 30d", value: 62 },
      { id: "insight.days-since-mscp-contact", name: "Days since MSCP", value: 720 }
    ],
    cohortComparison: {
      cohortName: "perimenopausal women 45-49 with vasomotor",
      cohortSize: 12_400,
      patientPercentile: 78,
      metric: "vasomotor burden 30d"
    }
  };

  it("cites every elevated insight in the rationale", () => {
    const out = scriptedRoute(
      { ...baseIntake, severity: "moderate" },
      grounding
    );
    const all = out.rationale.join(" ");
    expect(all).toMatch(/HRV.*1\.40/);
    expect(all).toMatch(/vasomotor burden.*62/i);
    expect(all).toMatch(/days.*720|720 days/i);
    expect(out.groundingUsed?.insightsCited).toEqual(
      expect.arrayContaining([
        "insight.hrv-zscore-30d",
        "insight.vasomotor-burden-30d",
        "insight.days-since-mscp-contact"
      ])
    );
  });

  it("does NOT cite insights below threshold", () => {
    const lowBurden: Data360GroundingHint = {
      ...grounding,
      calculatedInsights: [
        { id: "insight.hrv-zscore-30d", name: "HRV", value: 0.3 },
        { id: "insight.vasomotor-burden-30d", name: "Vasomotor", value: 20 },
        { id: "insight.days-since-mscp-contact", name: "MSCP", value: 60 }
      ]
    };
    const out = scriptedRoute(
      { ...baseIntake, severity: "moderate" },
      lowBurden
    );
    expect(out.groundingUsed?.insightsCited ?? []).toEqual([]);
  });

  it("promotes moderate -> mscp-in-person when vasomotor burden >= 60", () => {
    const out = scriptedRoute(
      { ...baseIntake, severity: "moderate" },
      grounding
    );
    expect(out.pathway).toBe("mscp-in-person");
    expect(out.rationale.join(" ")).toMatch(/virtual to in-person/i);
  });

  it("promotes moderate -> mscp-in-person when cohort percentile >= 75 even with moderate burden", () => {
    const promote: Data360GroundingHint = {
      ...grounding,
      calculatedInsights: [
        { id: "insight.vasomotor-burden-30d", name: "Vasomotor", value: 40 }
      ],
      cohortComparison: {
        ...grounding.cohortComparison!,
        patientPercentile: 78
      }
    };
    const out = scriptedRoute(
      { ...baseIntake, severity: "moderate" },
      promote
    );
    expect(out.pathway).toBe("mscp-in-person");
  });

  it("does NOT promote when burden < 60 AND percentile < 75", () => {
    const noPromote: Data360GroundingHint = {
      calculatedInsights: [
        { id: "insight.vasomotor-burden-30d", name: "Vasomotor", value: 40 }
      ],
      cohortComparison: {
        cohortName: "cohort",
        cohortSize: 1000,
        patientPercentile: 50,
        metric: "vasomotor burden 30d"
      }
    };
    const out = scriptedRoute(
      { ...baseIntake, severity: "moderate" },
      noPromote
    );
    expect(out.pathway).toBe("mscp-virtual-visit");
  });

  it("attaches groundingUsed metadata when grounding is present", () => {
    const out = scriptedRoute(
      { ...baseIntake, severity: "moderate" },
      grounding
    );
    expect(out.groundingUsed).toBeDefined();
    expect(out.groundingUsed?.cohortName).toBe(
      "perimenopausal women 45-49 with vasomotor"
    );
  });

  it("omits groundingUsed when no grounding is provided", () => {
    const out = scriptedRoute({ ...baseIntake, severity: "moderate" });
    expect(out.groundingUsed).toBeUndefined();
  });
});

describe("scriptedRoute · modelProvenance + recommendedTargetResponse", () => {
  it("always tags the deterministic policy engine on provenance", () => {
    const out = scriptedRoute(baseIntake);
    expect(out.modelProvenance).toEqual({
      provider: "pause-scripted",
      model: "pause-care-router-policy@1.0",
      via: "scripted-fallback"
    });
  });

  it("emits a non-empty target-response window for every pathway", () => {
    for (const severity of ["mild", "moderate", "severe"] as const) {
      expect(
        scriptedRoute({ ...baseIntake, severity })
          .recommendedTargetResponse.length
      ).toBeGreaterThan(0);
    }
  });
});

describe("claudeRoute · fallback path", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
    }
  });

  it("falls back to scriptedRoute when ANTHROPIC_API_KEY is unset", async () => {
    const out = await claudeRoute({ ...baseIntake, severity: "moderate" });
    expect(out.pathway).toBe("mscp-virtual-visit");
    expect(out.modelProvenance.provider).toBe("pause-scripted");
    expect(out.rationale[0]).toMatch(/ANTHROPIC_API_KEY not set/);
  });

  it("preserves the deterministic decision for severe symptoms in the fallback", async () => {
    const out = await claudeRoute({ ...baseIntake, severity: "severe" });
    expect(out.pathway).toBe("mscp-in-person");
  });

  it("preserves the red-flag branch in the fallback", async () => {
    const out = await claudeRoute({
      ...baseIntake,
      primarySymptom: "bleeding",
      redFlagsAcknowledged: "yes"
    });
    expect(out.pathway).toBe("urgent-gynecology");
    expect(out.redFlagsTriggered).toHaveLength(1);
  });
});
