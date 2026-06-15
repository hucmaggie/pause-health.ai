import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attachRecommendedProviders,
  claudeRoute,
  route,
  scriptedRoute,
  type Data360GroundingHint,
  type IntakeRecord,
  type ProviderLookup
} from "./care-router";
import type { ProviderRecord } from "./mulesoft-mocks";

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

describe("attachRecommendedProviders · provider-graph wiring", () => {
  function provider(over: Partial<ProviderRecord> = {}): ProviderRecord {
    return {
      npi: "1000000001",
      name: "Dr. Test, MD, MSCP",
      credentials: ["MD", "MSCP"],
      specialty: "Obstetrics & Gynecology",
      menopauseCertified: true,
      city: "Irvine",
      state: "CA",
      zip: "92614",
      acceptingNewPatients: true,
      telehealth: true,
      graphScore: 0.9,
      ...over
    };
  }

  function stubLookup(
    providers: ProviderRecord[],
    source: "live" | "mock" = "mock"
  ): { lookup: ProviderLookup; calls: Array<{ zip?: string; menopauseOnly?: boolean; limit?: number }> } {
    const calls: Array<{ zip?: string; menopauseOnly?: boolean; limit?: number }> = [];
    const lookup: ProviderLookup = async (query) => {
      calls.push(query);
      return { source, result: { total: providers.length, providers } };
    };
    return { lookup, calls };
  }

  it("does NOT attach providers for a non-MSCP pathway", async () => {
    const decision = scriptedRoute({ ...baseIntake, severity: "mild" }); // self-care
    const { lookup, calls } = stubLookup([provider()]);
    const out = await attachRecommendedProviders(decision, baseIntake, {
      providerLookup: lookup
    });
    expect(out.recommendedProviders).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("attaches a ranked MSCP list for a virtual visit, telehealth-first", async () => {
    const decision = scriptedRoute({ ...baseIntake, severity: "moderate" }); // virtual
    expect(decision.pathway).toBe("mscp-virtual-visit");
    const { lookup, calls } = stubLookup(
      [
        provider({ npi: "in-person-1", telehealth: false, graphScore: 0.95 }),
        provider({ npi: "tele-1", telehealth: true, graphScore: 0.8 })
      ],
      "mock"
    );
    const out = await attachRecommendedProviders(decision, baseIntake, {
      providerLookup: lookup
    });
    expect(out.recommendedProviders?.modality).toBe("virtual");
    expect(out.recommendedProviders?.source).toBe("mock");
    // Telehealth-capable clinician should be pulled to the front despite
    // a lower graphScore.
    expect(out.recommendedProviders?.providers[0].npi).toBe("tele-1");
    expect(calls[0].menopauseOnly).toBe(true);
    expect(out.rationale.join(" ")).toMatch(/Provider graph/);
  });

  it("ranks in-person visits accepting-new-patients first", async () => {
    const decision = scriptedRoute({ ...baseIntake, severity: "severe" }); // in-person
    expect(decision.pathway).toBe("mscp-in-person");
    const { lookup } = stubLookup([
      provider({ npi: "closed", acceptingNewPatients: false, graphScore: 0.95 }),
      provider({ npi: "open", acceptingNewPatients: true, graphScore: 0.7 })
    ]);
    const out = await attachRecommendedProviders(decision, baseIntake, {
      providerLookup: lookup
    });
    expect(out.recommendedProviders?.modality).toBe("in-person");
    expect(out.recommendedProviders?.providers[0].npi).toBe("open");
  });

  it("caps the list at 3 and forwards the patient ZIP to the lookup", async () => {
    const decision = scriptedRoute({ ...baseIntake, severity: "moderate" });
    const { lookup, calls } = stubLookup(
      Array.from({ length: 8 }, (_, i) => provider({ npi: `p${i}` }))
    );
    const out = await attachRecommendedProviders(
      decision,
      { ...baseIntake, severity: "moderate", patientZip: "92614" },
      { providerLookup: lookup }
    );
    expect(out.recommendedProviders?.providers).toHaveLength(3);
    expect(out.recommendedProviders?.total).toBe(8);
    expect(calls[0].zip).toBe("92614");
    expect(out.recommendedProviders?.query.zip).toBe("92614");
  });

  it("omits recommendations when the directory returns none", async () => {
    const decision = scriptedRoute({ ...baseIntake, severity: "moderate" });
    const { lookup } = stubLookup([]);
    const out = await attachRecommendedProviders(decision, baseIntake, {
      providerLookup: lookup
    });
    expect(out.recommendedProviders).toBeUndefined();
  });

  it("never throws — a provider-graph failure leaves routing intact", async () => {
    const decision = scriptedRoute({ ...baseIntake, severity: "moderate" });
    const failing: ProviderLookup = async () => {
      throw new Error("directory unavailable");
    };
    const out = await attachRecommendedProviders(decision, baseIntake, {
      providerLookup: failing
    });
    expect(out.pathway).toBe("mscp-virtual-visit");
    expect(out.recommendedProviders).toBeUndefined();
  });

  it("route() enriches the decision through the injected lookup", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { lookup } = stubLookup([provider()], "mock");
    const out = await route({ ...baseIntake, severity: "moderate" }, undefined, {
      providerLookup: lookup
    });
    expect(out.recommendedProviders?.providers).toHaveLength(1);
  });

  it("forwards the patient ZIP centroid and propagates distanceMiles onto the recommendations", async () => {
    // 92614 (Irvine, CA) resolves to a Census centroid in the bundled gazetteer,
    // so the lookup should be called with `zipCentroid` and the rationale
    // should report distance ranking. The stub doesn't compute distances —
    // it just records what `distanceMiles` it was handed and echoes them
    // back, mirroring what queryProviderDirectory would do under real centroids.
    const calls: Array<{ zip?: string; zipCentroid?: { latitude: number; longitude: number } | null }> = [];
    const distanceLookup: ProviderLookup = async (query) => {
      calls.push({ zip: query.zip, zipCentroid: query.zipCentroid ?? null });
      return {
        source: "mock",
        result: {
          total: 2,
          providers: [
            { ...provider({ npi: "near", graphScore: 0.7 }), distanceMiles: 1.4 },
            { ...provider({ npi: "far", graphScore: 0.95 }), distanceMiles: 18.6 }
          ]
        }
      };
    };
    const decision = scriptedRoute({ ...baseIntake, severity: "moderate" });
    const out = await attachRecommendedProviders(
      decision,
      { ...baseIntake, severity: "moderate", patientZip: "92614" },
      { providerLookup: distanceLookup }
    );
    expect(calls[0].zip).toBe("92614");
    expect(calls[0].zipCentroid).not.toBeNull();
    expect(typeof calls[0].zipCentroid?.latitude).toBe("number");
    expect(typeof calls[0].zipCentroid?.longitude).toBe("number");
    // distanceMiles rides through onto every recommendation.
    const recs = out.recommendedProviders?.providers ?? [];
    expect(recs).toHaveLength(2);
    for (const r of recs) {
      expect(typeof r.distanceMiles).toBe("number");
    }
    // Rationale calls out distance ranking when the lookup returned
    // distance-stamped rows.
    expect(out.rationale.join(" ")).toMatch(/ranked by distance/);
  });

  it("falls back to score-only rationale when no distances are returned", async () => {
    const decision = scriptedRoute({ ...baseIntake, severity: "moderate" });
    const { lookup } = stubLookup([provider({ npi: "p1" })], "mock");
    const out = await attachRecommendedProviders(decision, baseIntake, {
      providerLookup: lookup
    });
    expect(out.rationale.join(" ")).toMatch(/ranked by graph score/);
    expect(out.recommendedProviders?.providers[0].distanceMiles).toBeNull();
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
