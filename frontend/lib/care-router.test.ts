import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachRecommendedProviders,
  claudeRoute,
  extractJsonObject,
  route,
  scriptedRoute,
  type Data360GroundingHint,
  type IntakeRecord,
  type ProviderLookup
} from "./care-router";
import type { ProviderRecord } from "./mulesoft-mocks";
import { getGroundingContext } from "./data-360";

// Controllable mock for the dynamically-imported Anthropic SDK. `create`
// is what claudeRoute() invokes; each live-path test sets its resolved
// value (a text content block) or makes it reject to prove the fallback.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  }
}));

function claudeTextResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

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

  it("fires the SAME rationale on the LIVE insight ids (the silent-drift regression)", () => {
    // Live Data Cloud / Health Cloud emit different ids than the mock:
    // HRV is hrv-rmssd-30d (not hrv-zscore-30d) and last-contact is
    // days-since-last-clinical-contact (not days-since-mscp-contact). Before
    // the `kind` fix the router keyed on the mock ids, so these silently
    // stopped firing the moment an org went live. Here we feed the LIVE ids
    // with NO kind (the pre-kind shape) and require all three to still fire,
    // citing the live ids.
    const live: Data360GroundingHint = {
      unifiedPatientId: "data360-anika",
      calculatedInsights: [
        { id: "insight.hrv-rmssd-30d", name: "HRV RMSSD 30d", value: 1.4 },
        { id: "insight.vasomotor-burden-30d", name: "Vasomotor 30d", value: 62 },
        {
          id: "insight.days-since-last-clinical-contact",
          name: "Days since clinical contact",
          value: 720
        }
      ]
    };
    const out = scriptedRoute({ ...baseIntake, severity: "moderate" }, live);
    const all = out.rationale.join(" ");
    expect(all).toMatch(/HRV.*1\.40/);
    expect(all).toMatch(/vasomotor burden.*62/i);
    expect(all).toMatch(/720 days/i);
    expect(out.groundingUsed?.insightsCited).toEqual(
      expect.arrayContaining([
        "insight.hrv-rmssd-30d",
        "insight.vasomotor-burden-30d",
        "insight.days-since-last-clinical-contact"
      ])
    );
  });

  it("matches by `kind` even when the insight id is unrecognized", () => {
    // Future-proofing: a renamed id with the right kind must still be cited
    // (and under its own id), so the router never depends on a literal id.
    const renamed: Data360GroundingHint = {
      calculatedInsights: [
        { id: "insight.hrv-v3-experimental", kind: "hrv-variability", name: "HRV", value: 1.4 },
        { id: "insight.vmb-v2", kind: "vasomotor-burden", name: "VMB", value: 62 },
        {
          id: "insight.contact-recency-v2",
          kind: "days-since-clinical-contact",
          name: "Contact",
          value: 720
        }
      ]
    };
    const out = scriptedRoute({ ...baseIntake, severity: "moderate" }, renamed);
    expect(out.groundingUsed?.insightsCited).toEqual(
      expect.arrayContaining([
        "insight.hrv-v3-experimental",
        "insight.vmb-v2",
        "insight.contact-recency-v2"
      ])
    );
  });

  it("hedges the cohort line as an intake estimate (not a live segment) by default", () => {
    // The base fixture has no `basis` → treated as intake-estimate. The
    // rationale must NOT present the percentile as a real cohort rank.
    const out = scriptedRoute({ ...baseIntake, severity: "moderate" }, grounding);
    const all = out.rationale.join(" ");
    expect(all).toMatch(/intake-derived estimate, not a live Data Cloud segment/i);
    expect(all).not.toMatch(/sits at the \d+th percentile of/i);
  });

  it("uses confident cohort phrasing only when basis is a real data-cloud-segment", () => {
    const seg: Data360GroundingHint = {
      ...grounding,
      cohortComparison: { ...grounding.cohortComparison!, basis: "data-cloud-segment" }
    };
    const out = scriptedRoute({ ...baseIntake, severity: "moderate" }, seg);
    const all = out.rationale.join(" ");
    expect(all).toMatch(/sits at the 78th percentile of/i);
    expect(all).not.toMatch(/intake-derived estimate/i);
  });

  it("marks the mock cohort percentile as an intake estimate (honesty flag)", () => {
    const mock = getGroundingContext({
      patientId: "pause-demo-patient-001",
      hint: { ageBand: "45-49", primarySymptom: "vasomotor" }
    });
    expect(mock.cohortComparison.basis).toBe("intake-estimate");
  });

  it("the mock grounding's kinds line up with what the router branches on", () => {
    // Integration guard: feed the real mock GroundingContext (not a hand-built
    // literal) and require all three grounded rationales to fire. If a future
    // edit drops/renames a `kind` on the mock, this fails.
    const mock = getGroundingContext({
      patientId: "pause-demo-patient-001",
      hint: { ageBand: "45-49", primarySymptom: "vasomotor" }
    });
    const out = scriptedRoute({ ...baseIntake, severity: "moderate" }, mock);
    const cited = out.groundingUsed?.insightsCited ?? [];
    expect(cited).toContain("insight.hrv-zscore-30d");
    expect(cited).toContain("insight.vasomotor-burden-30d");
    expect(cited).toContain("insight.days-since-mscp-contact");
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

  it("forwards intake.patientInsurance to the provider lookup and surfaces it on the decision", async () => {
    // The Care Router reads intake.patientInsurance, hands it to the lookup,
    // and reports it on the decision so the agent fabric trace can show
    // which plan filtered the recommendations.
    const calls: Array<{ insurance?: string | null }> = [];
    const insuranceLookup: ProviderLookup = async (query) => {
      calls.push({ insurance: query.insurance ?? null });
      return {
        source: "mock",
        result: {
          total: 1,
          providers: [
            {
              ...provider({ npi: "p1" }),
              insuranceAccepted: ["medicare", "aetna", "bcbs"]
            }
          ]
        }
      };
    };
    const decision = scriptedRoute({ ...baseIntake, severity: "moderate" });
    const out = await attachRecommendedProviders(
      decision,
      { ...baseIntake, severity: "moderate", patientInsurance: "Aetna" },
      { providerLookup: insuranceLookup }
    );
    expect(calls[0].insurance).toBe("Aetna");
    expect(out.recommendedProviders?.query.insurance).toBe("Aetna");
    // Rationale calls out the plan filter so the agent fabric trace tells
    // the truth about why these recommendations came back.
    expect(out.rationale.join(" ")).toMatch(/accepting Aetna/);
    // The recommendations carry the synthesized insuranceAccepted lists.
    expect(out.recommendedProviders?.providers[0].insuranceAccepted).toContain(
      "aetna"
    );
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

  it("stamps a fallbackReason on the missing-key fallback", async () => {
    const out = await claudeRoute({ ...baseIntake, severity: "moderate" });
    expect(out.modelProvenance.via).toBe("scripted-fallback");
    expect(out.fallbackReason).toMatch(/ANTHROPIC_API_KEY not set/);
    // The reason is ONLY the leading diagnostic sentence, not the whole
    // clinical rationale.
    expect(out.fallbackReason).not.toMatch(/menopause specialist/i);
  });
});

describe("extractJsonObject", () => {
  const obj = {
    pathway: "mscp-virtual-visit",
    rationale: ["Moderate symptoms suit a virtual MSCP visit."],
    redFlagsTriggered: []
  };
  const bare = JSON.stringify(obj);

  it("returns bare JSON unchanged (round-trips through JSON.parse)", () => {
    expect(JSON.parse(extractJsonObject(bare))).toEqual(obj);
  });

  it("strips ```json fenced blocks", () => {
    const fenced = "```json\n" + bare + "\n```";
    expect(JSON.parse(extractJsonObject(fenced))).toEqual(obj);
  });

  it("strips bare ``` fenced blocks (no language tag)", () => {
    const fenced = "```\n" + bare + "\n```";
    expect(JSON.parse(extractJsonObject(fenced))).toEqual(obj);
  });

  it("extracts the object from surrounding prose", () => {
    const prose =
      "Here is the routing decision you asked for:\n\n" +
      bare +
      "\n\nHappy to explain the reasoning further.";
    expect(JSON.parse(extractJsonObject(prose))).toEqual(obj);
  });

  it("ignores braces inside string literals", () => {
    const tricky = JSON.stringify({
      pathway: "self-care-tracking",
      rationale: ["Use the tracker { and log } daily."],
      redFlagsTriggered: []
    });
    expect(JSON.parse(extractJsonObject(tricky))).toEqual({
      pathway: "self-care-tracking",
      rationale: ["Use the tracker { and log } daily."],
      redFlagsTriggered: []
    });
  });

  it("throws on a truncated (unbalanced) object", () => {
    const truncated = '{"pathway":"mscp-virtual-visit","rationale":["It was tru';
    expect(() => extractJsonObject(truncated)).toThrow();
  });

  it("throws when there is no JSON object at all", () => {
    expect(() => extractJsonObject("I could not decide.")).toThrow();
  });
});

describe("claudeRoute · live path (mocked SDK)", () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    createMock.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it("parses a ```json fenced response into a claude-api decision", async () => {
    createMock.mockResolvedValue(
      claudeTextResponse(
        "```json\n" +
          JSON.stringify({
            pathway: "mscp-virtual-visit",
            rationale: ["Moderate vasomotor symptoms; virtual MSCP consult."],
            redFlagsTriggered: []
          }) +
          "\n```"
      )
    );
    const out = await claudeRoute({ ...baseIntake, severity: "moderate" });
    expect(out.modelProvenance.provider).toBe("anthropic");
    expect(out.modelProvenance.via).toBe("claude-api");
    expect(out.pathway).toBe("mscp-virtual-visit");
    expect(out.fallbackReason).toBeUndefined();
  });

  it("parses a response wrapped in prose into a claude-api decision", async () => {
    createMock.mockResolvedValue(
      claudeTextResponse(
        "Sure — here's my recommendation:\n" +
          JSON.stringify({
            pathway: "mscp-in-person",
            rationale: ["Severe symptoms warrant in-person evaluation."],
            redFlagsTriggered: []
          }) +
          "\nLet me know if you need anything else."
      )
    );
    const out = await claudeRoute({ ...baseIntake, severity: "severe" });
    expect(out.modelProvenance.via).toBe("claude-api");
    expect(out.pathway).toBe("mscp-in-person");
    expect(out.fallbackReason).toBeUndefined();
  });

  it("normalizes a whitespace-padded pathway before the label lookup", async () => {
    createMock.mockResolvedValue(
      claudeTextResponse(
        JSON.stringify({
          pathway: "  urgent-gynecology\n",
          rationale: ["Unexpected bleeding requires prompt review."],
          redFlagsTriggered: []
        })
      )
    );
    const out = await claudeRoute({
      ...baseIntake,
      primarySymptom: "bleeding"
    });
    expect(out.modelProvenance.via).toBe("claude-api");
    expect(out.pathway).toBe("urgent-gynecology");
    expect(out.pathwayLabel).toBe("Urgent gynecology review");
  });

  it("falls back with a populated fallbackReason when the SDK throws", async () => {
    createMock.mockRejectedValue(new Error("HTTP 529 overloaded"));
    const out = await claudeRoute({ ...baseIntake, severity: "moderate" });
    expect(out.modelProvenance.provider).toBe("pause-scripted");
    expect(out.modelProvenance.via).toBe("scripted-fallback");
    expect(out.fallbackReason).toMatch(/Claude API call failed/);
    expect(out.fallbackReason).toMatch(/HTTP 529 overloaded/);
    // Deterministic decision is preserved.
    expect(out.pathway).toBe("mscp-virtual-visit");
  });

  it("falls back with a fallbackReason when the JSON is truncated", async () => {
    createMock.mockResolvedValue(
      claudeTextResponse('{"pathway":"mscp-virtual-visit","rationale":["trunc')
    );
    const out = await claudeRoute({ ...baseIntake, severity: "moderate" });
    expect(out.modelProvenance.via).toBe("scripted-fallback");
    expect(out.fallbackReason).toMatch(/Claude API call failed/);
  });

  it("requests max_tokens of at least 1500 to avoid truncation", async () => {
    createMock.mockResolvedValue(
      claudeTextResponse(
        JSON.stringify({
          pathway: "self-care-tracking",
          rationale: ["Mild symptoms; structured self-care."],
          redFlagsTriggered: []
        })
      )
    );
    await claudeRoute({ ...baseIntake, severity: "mild" });
    expect(createMock).toHaveBeenCalledTimes(1);
    const args = createMock.mock.calls[0][0] as { max_tokens: number };
    expect(args.max_tokens).toBeGreaterThanOrEqual(1500);
  });
});
