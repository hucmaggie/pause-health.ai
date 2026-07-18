import { describe, expect, it } from "vitest";
import {
  ALLOWLISTED_SDOH_SCREENERS,
  COMMUNITY_RESOURCES,
  draftCommunityReferral,
  draftCommunityReferralsForResult,
  getScreenerSpec,
  isAllowlistedSdohScreener,
  isCommunityResource,
  resourceForDomain,
  screenSocialNeeds,
  sdohReferralHasConsent,
  sdohToIntakeSignal,
  usesValidatedSdohScreener,
  type SdohScreener,
  type SdohScreeningResponse
} from "./sdoh";

/**
 * Tests for lib/sdoh.ts — the deterministic HRSN/SDOH screening + community-
 * resource referral drafting behind the SDOH Screening Agent. Screening is real
 * rule-based logic (no LLM), so every expectation is exact and the same
 * responses always screen identically.
 */

/** A fully-negative AHC-HRSN response set (safety items at their 1-min floor). */
function negativeResponses(): SdohScreeningResponse {
  return {
    screener: "ahc-hrsn",
    responses: {
      housing: [0, 0],
      food: [0, 0],
      transportation: [0],
      utilities: [0],
      safety: [1, 1, 1, 1]
    }
  };
}

describe("allow-list", () => {
  it("exposes exactly the validated AHC-HRSN screener", () => {
    expect([...ALLOWLISTED_SDOH_SCREENERS]).toEqual(["ahc-hrsn"]);
  });

  it("isAllowlistedSdohScreener accepts allow-listed ids and rejects others", () => {
    expect(isAllowlistedSdohScreener("ahc-hrsn")).toBe(true);
    expect(isAllowlistedSdohScreener("prapare")).toBe(false);
    expect(isAllowlistedSdohScreener("home-grown-sdoh")).toBe(false);
    expect(isAllowlistedSdohScreener(undefined)).toBe(false);
    expect(isAllowlistedSdohScreener(42)).toBe(false);
  });

  it("usesValidatedSdohScreener mirrors the allow-list guard", () => {
    expect(usesValidatedSdohScreener("ahc-hrsn")).toBe(true);
    expect(usesValidatedSdohScreener("prapare")).toBe(false);
    expect(usesValidatedSdohScreener(undefined)).toBe(false);
  });

  it("screenSocialNeeds rejects a screener off the allow-list", () => {
    expect(() =>
      screenSocialNeeds({
        screener: "prapare" as unknown as SdohScreener,
        responses: {}
      })
    ).toThrow(/allow-list/);
  });
});

describe("input validation", () => {
  it("rejects a wrong-length domain response vector", () => {
    const bad = negativeResponses();
    bad.responses.food = [0]; // Hunger Vital Sign expects 2 items
    expect(() => screenSocialNeeds(bad)).toThrow(/expects 2 responses/);
  });

  it("rejects an out-of-range domain response value", () => {
    const bad = negativeResponses();
    bad.responses.transportation = [2]; // transportation is 0-1
    expect(() => screenSocialNeeds(bad)).toThrow(/out of range/);
    const bad2 = negativeResponses();
    bad2.responses.safety = [0, 1, 1, 1]; // HITS items are 1-5, not 0
    expect(() => screenSocialNeeds(bad2)).toThrow(/out of range/);
  });

  it("rejects a non-integer domain response value", () => {
    const bad = negativeResponses();
    bad.responses.utilities = [1.5];
    expect(() => screenSocialNeeds(bad)).toThrow(/out of range/);
  });

  it("rejects a missing domain vector", () => {
    const bad = negativeResponses();
    delete bad.responses.housing;
    expect(() => screenSocialNeeds(bad)).toThrow(/expects 2 responses/);
  });
});

describe("screenSocialNeeds — determinism + per-domain scoring", () => {
  it("screens an all-negative response set as zero positive domains, no red flag", () => {
    const r = screenSocialNeeds(negativeResponses());
    expect(r.positiveDomains).toEqual([]);
    expect(r.positiveDomainCount).toBe(0);
    expect(r.redFlags).toEqual([]);
    expect(r.domains.map((d) => d.id)).toEqual([
      "housing",
      "food",
      "transportation",
      "utilities",
      "safety"
    ]);
    // The safety domain carries its HITS total even when negative.
    expect(r.domains.find((d) => d.id === "safety")?.score).toBe(4);
  });

  it("is deterministic — the same responses always screen identically", () => {
    const input = negativeResponses();
    input.responses.food = [2, 0];
    input.responses.transportation = [1];
    const a = screenSocialNeeds(input);
    const b = screenSocialNeeds(input);
    expect(a).toEqual(b);
  });

  it("flags food + transportation as the two positive domains", () => {
    const input = negativeResponses();
    input.responses.food = [1, 0]; // "sometimes true" endorses food insecurity
    input.responses.transportation = [1];
    const r = screenSocialNeeds(input);
    expect(r.positiveDomains).toEqual(["food", "transportation"]);
    expect(r.positiveDomainCount).toBe(2);
    expect(r.redFlags).toEqual([]);
  });

  it("flags housing on either living-situation OR a quality problem", () => {
    const worried = negativeResponses();
    worried.responses.housing = [1, 0];
    expect(screenSocialNeeds(worried).positiveDomains).toContain("housing");
    const problem = negativeResponses();
    problem.responses.housing = [0, 3];
    expect(screenSocialNeeds(problem).positiveDomains).toContain("housing");
  });

  it("flags utilities on a threatened shutoff or an already-shut-off state", () => {
    const threatened = negativeResponses();
    threatened.responses.utilities = [1];
    expect(screenSocialNeeds(threatened).positiveDomains).toContain("utilities");
    const off = negativeResponses();
    off.responses.utilities = [2];
    const r = screenSocialNeeds(off);
    expect(r.positiveDomains).toContain("utilities");
    expect(r.domains.find((d) => d.id === "utilities")?.detail).toMatch(
      /already shut off/
    );
  });
});

describe("interpersonal-safety red flag (HITS)", () => {
  it("does NOT flag safety at or below the cutoff of 10", () => {
    const atCutoff = negativeResponses();
    atCutoff.responses.safety = [3, 3, 2, 2]; // total 10, not > 10
    const r = screenSocialNeeds(atCutoff);
    expect(r.positiveDomains).not.toContain("safety");
    expect(r.redFlags).toEqual([]);
    expect(r.domains.find((d) => d.id === "safety")?.score).toBe(10);
  });

  it("flags safety above the cutoff and escalates it as a red flag", () => {
    const positive = negativeResponses();
    positive.responses.safety = [3, 3, 3, 3]; // total 12 > 10
    const r = screenSocialNeeds(positive);
    expect(r.positiveDomains).toContain("safety");
    expect(r.redFlags).toHaveLength(1);
    expect(r.redFlags[0].domain).toBe("safety");
    expect(r.redFlags[0].code).toBe("ahc-hrsn-interpersonal-safety");
    expect(r.interpretation).toMatch(/social worker/i);
  });
});

describe("getScreenerSpec", () => {
  it("returns the five core AHC-HRSN domains with their item counts", () => {
    const spec = getScreenerSpec("ahc-hrsn");
    expect(spec.domains.map((d) => d.id)).toEqual([
      "housing",
      "food",
      "transportation",
      "utilities",
      "safety"
    ]);
    expect(spec.domains.find((d) => d.id === "food")?.itemCount).toBe(2);
    expect(spec.domains.find((d) => d.id === "safety")?.itemCount).toBe(4);
  });
});

describe("community-resource catalog", () => {
  it("maps every AHC-HRSN domain (plus a general helpline) to a catalog resource", () => {
    for (const domain of [
      "housing",
      "food",
      "transportation",
      "utilities",
      "safety",
      "general"
    ] as const) {
      const resource = resourceForDomain(domain);
      expect(resource, domain).toBeDefined();
      expect(isCommunityResource(resource!.id)).toBe(true);
    }
    expect(isCommunityResource("resource.totally-invented")).toBe(false);
    expect(COMMUNITY_RESOURCES.length).toBeGreaterThanOrEqual(6);
  });
});

describe("draftCommunityReferral — consent gating + no autonomous enrollment", () => {
  it("drafts a consented referral that is never an autonomous enrollment", () => {
    const resource = resourceForDomain("food")!;
    const draft = draftCommunityReferral(resource, { patientConsent: true });
    expect(draft.resourceId).toBe(resource.id);
    expect(draft.suppressedForNoConsent).toBe(false);
    expect(draft.requiresPatientConsent).toBe(true);
    expect(draft.autonomousEnrollment).toBe(false);
    expect(draft.requiresHumanApproval).toBe(true);
    expect(draft.sent).toBe(false);
    expect(draft.handoffTo).toBe("community-health-worker");
  });

  it("suppresses a referral drafted without patient consent", () => {
    const resource = resourceForDomain("housing")!;
    const draft = draftCommunityReferral(resource, { patientConsent: false });
    expect(draft.suppressedForNoConsent).toBe(true);
    expect(draft.body).toMatch(/no patient consent/i);
    expect(draft.autonomousEnrollment).toBe(false);
    expect(draft.sent).toBe(false);
  });

  it("hands the interpersonal-safety referral to a social worker", () => {
    const resource = resourceForDomain("safety")!;
    const draft = draftCommunityReferral(resource, { patientConsent: true });
    expect(draft.handoffTo).toBe("social-worker");
  });
});

describe("draftCommunityReferralsForResult", () => {
  it("drafts one referral per positive domain plus the 211 general helpline", () => {
    const input = negativeResponses();
    input.responses.food = [1, 0];
    input.responses.transportation = [1];
    const result = screenSocialNeeds(input);
    const drafts = draftCommunityReferralsForResult(result, {
      patientConsent: true
    });
    const resourceIds = drafts.map((d) => d.resourceId);
    expect(resourceIds).toContain("resource.food-bank");
    expect(resourceIds).toContain("resource.transportation-assistance");
    expect(resourceIds).toContain("resource.211-helpline");
    // Every draft references a catalog resource and is consent-gated.
    for (const d of drafts) {
      expect(isCommunityResource(d.resourceId)).toBe(true);
      expect(d.autonomousEnrollment).toBe(false);
      expect(d.sent).toBe(false);
      expect(d.suppressedForNoConsent).toBe(false);
    }
  });

  it("drafts nothing when there are no positive domains", () => {
    const result = screenSocialNeeds(negativeResponses());
    expect(
      draftCommunityReferralsForResult(result, { patientConsent: true })
    ).toEqual([]);
  });

  it("suppresses every draft when consent is withheld", () => {
    const input = negativeResponses();
    input.responses.food = [2, 0];
    const result = screenSocialNeeds(input);
    const drafts = draftCommunityReferralsForResult(result, {
      patientConsent: false
    });
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) expect(d.suppressedForNoConsent).toBe(true);
  });
});

describe("sdohReferralHasConsent", () => {
  it("is true only when the patient explicitly consented", () => {
    expect(sdohReferralHasConsent({ patientConsent: true })).toBe(true);
    expect(sdohReferralHasConsent({ patientConsent: false })).toBe(false);
    expect(sdohReferralHasConsent({})).toBe(false);
    expect(sdohReferralHasConsent(null)).toBe(false);
    expect(sdohReferralHasConsent()).toBe(false);
  });
});

describe("sdohToIntakeSignal", () => {
  it("raises a care-coordination flag, NOT a clinical severity", () => {
    const input = negativeResponses();
    input.responses.food = [1, 0];
    input.responses.transportation = [1];
    const result = screenSocialNeeds(input);
    const signal = sdohToIntakeSignal(result);
    expect(signal).toEqual({
      socialNeedsIdentified: true,
      positiveDomainCount: 2,
      positiveDomains: ["food", "transportation"],
      safetyEscalation: false
    });
    // Deliberately no `severity` key — SDOH never drives clinical severity.
    expect((signal as Record<string, unknown>).severity).toBeUndefined();
  });

  it("marks a safety escalation when the interpersonal-safety red flag fires", () => {
    const input = negativeResponses();
    input.responses.safety = [4, 4, 4, 4];
    const signal = sdohToIntakeSignal(screenSocialNeeds(input));
    expect(signal.safetyEscalation).toBe(true);
    expect(signal.socialNeedsIdentified).toBe(true);
  });
});
