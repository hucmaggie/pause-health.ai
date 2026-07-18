import { describe, expect, it } from "vitest";
import {
  DEMO_TRIAL_PATIENT,
  STUDY_CATALOG,
  TRIAL_CRITERIA,
  draftTrialOutreach,
  eligibilityTracesToCriteria,
  enrollmentRequiresHuman,
  getStudy,
  getTrialCriterion,
  isCatalogStudy,
  isTrialCriterion,
  matchStudy,
  matchTrials,
  outreachHasResearchConsent,
  rankMatches,
  type PatientTrialContext
} from "./clinical-trials";

/**
 * Tests for lib/clinical-trials.ts — the deterministic eligibility matcher +
 * consent-gated outreach behind the Clinical Trials & Research Matching Agent.
 * Matching is a pure function of the structured patient context against the
 * defined criteria (no randomness, no clock), so the same context always yields
 * the same matches + ranking + outreach state. These pin determinism, the
 * criteria-sourced matching, the stable ranking tie-break, the consent-gated /
 * never-enrolled outreach, and the three honest governance signals
 * (eligibility-criteria-sourced + research-consent-required + no-autonomous-enrollment).
 */

describe("criteria + study catalog", () => {
  it("exposes a non-empty criterion catalog with stable ids, labels, kinds, rationales", () => {
    expect(TRIAL_CRITERIA.length).toBeGreaterThan(0);
    for (const c of TRIAL_CRITERIA) {
      expect(c.id).toMatch(/^crit\./);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.rationale.length).toBeGreaterThan(0);
      expect(["inclusion", "exclusion"]).toContain(c.kind);
    }
  });

  it("exposes a non-empty, clearly-synthetic study catalog whose criteria are all defined", () => {
    expect(STUDY_CATALOG.length).toBeGreaterThan(0);
    for (const s of STUDY_CATALOG) {
      expect(s.id).toMatch(/^study\./);
      expect(s.synthetic).toBe(true);
      expect(s.sponsor.toLowerCase()).toContain("synthetic");
      expect(s.criteriaIds.length).toBeGreaterThan(0);
      for (const cid of s.criteriaIds) expect(isTrialCriterion(cid)).toBe(true);
    }
  });

  it("isTrialCriterion / getTrialCriterion / isCatalogStudy / getStudy agree with the catalog", () => {
    for (const c of TRIAL_CRITERIA) {
      expect(isTrialCriterion(c.id)).toBe(true);
      expect(getTrialCriterion(c.id)?.label).toBe(c.label);
    }
    expect(isTrialCriterion("crit.totally-made-up")).toBe(false);
    expect(getTrialCriterion("crit.totally-made-up")).toBeUndefined();
    for (const s of STUDY_CATALOG) {
      expect(isCatalogStudy(s.id)).toBe(true);
      expect(getStudy(s.id)?.title).toBe(s.title);
    }
    expect(isCatalogStudy("study.made-up")).toBe(false);
  });
});

describe("matchStudy + matchTrials · determinism + criteria-sourced matching", () => {
  it("is deterministic — the same context yields the same result", () => {
    expect(matchTrials(DEMO_TRIAL_PATIENT, { researchConsent: true })).toEqual(
      matchTrials(DEMO_TRIAL_PATIENT, { researchConsent: true })
    );
  });

  it("matches the demo patient into eligible + failed studies with citable criteria", () => {
    const result = matchTrials(DEMO_TRIAL_PATIENT, { researchConsent: true });
    expect(result.patientRef).toBe("trial-patient-001");
    expect(result.matches).toHaveLength(STUDY_CATALOG.length);
    expect(result.eligibleCount).toBe(3);
    // The bone-health registry fails (no osteoporosis risk on record).
    const bone = result.matches.find((m) => m.studyId === "study.bone-health-registry");
    expect(bone?.eligible).toBe(false);
    expect(bone?.failedCriteria.map((c) => c.criterionId)).toContain(
      "crit.osteoporosis-risk"
    );
    // Every emitted criterion traces to the catalog.
    expect(eligibilityTracesToCriteria(result.matches)).toBe(true);
    for (const m of result.matches) {
      for (const c of [...m.matchedCriteria, ...m.failedCriteria]) {
        expect(isTrialCriterion(c.criterionId)).toBe(true);
      }
      // matchScore equals the number of met criteria.
      expect(m.matchScore).toBe(m.matchedCriteria.length);
      // eligible iff no failed criteria.
      expect(m.eligible).toBe(m.failedCriteria.length === 0);
    }
  });

  it("ranks eligible studies first, then by score, then by studyId (stable tie-break)", () => {
    const result = matchTrials(DEMO_TRIAL_PATIENT, { researchConsent: true });
    // vms + hrt both score 5 (eligible) → tie broken by studyId asc (hrt < vms);
    // sleep scores 3 (eligible); bone is not eligible → last.
    expect(result.recommendedStudyIds).toEqual([
      "study.hrt-initiation-rct",
      "study.vms-nonhormonal-rct",
      "study.sleep-cbt-observational"
    ]);
    expect(result.matches[result.matches.length - 1].studyId).toBe(
      "study.bone-health-registry"
    );
  });

  it("rankMatches breaks ties on studyId ascending", () => {
    const a: PatientTrialContext = { patientRef: "p" };
    const matches = [
      { ...matchStudy(getStudy("study.vms-nonhormonal-rct")!, a) },
      { ...matchStudy(getStudy("study.hrt-initiation-rct")!, a) }
    ];
    // Both fail identically → same eligible/score → studyId asc.
    const ranked = rankMatches(matches);
    expect(ranked[0].studyId.localeCompare(ranked[1].studyId)).toBeLessThanOrEqual(0);
  });
});

describe("draftTrialOutreach · consent-gated, never enrolled", () => {
  it("drafts an active outreach when research consent is present and studies are eligible", () => {
    const outreach = draftTrialOutreach(["study.vms-nonhormonal-rct"], true);
    expect(outreach.state).toBe("drafted");
    expect(outreach.invitedStudyIds).toEqual(["study.vms-nonhormonal-rct"]);
    expect(outreach.researchConsentPresent).toBe(true);
    expect(outreach.enrolled).toBe(false);
    expect(outreach.requiresHuman).toBe(true);
    expect(outreach.requiresInformedConsent).toBe(true);
  });

  it("withholds an active outreach (consent-required) when research consent is absent", () => {
    const outreach = draftTrialOutreach(["study.vms-nonhormonal-rct"], false);
    expect(outreach.state).toBe("consent-required");
    expect(outreach.invitedStudyIds).toEqual([]);
    expect(outreach.researchConsentPresent).toBe(false);
    expect(outreach.enrolled).toBe(false);
  });

  it("returns no-eligible-studies when there are no eligible studies", () => {
    const outreach = draftTrialOutreach([], true);
    expect(outreach.state).toBe("no-eligible-studies");
    expect(outreach.invitedStudyIds).toEqual([]);
    expect(outreach.enrolled).toBe(false);
  });

  it("matchTrials withholds outreach when research consent is absent (safe answer, not enrolled)", () => {
    const result = matchTrials(DEMO_TRIAL_PATIENT, { researchConsent: false });
    expect(result.eligibleCount).toBeGreaterThan(0);
    expect(result.outreach.state).toBe("consent-required");
    expect(result.outreach.enrolled).toBe(false);
  });
});

describe("eligibilityTracesToCriteria · eligibility-criteria-sourced signal", () => {
  it("is true for anything matchTrials produces", () => {
    expect(
      eligibilityTracesToCriteria(
        matchTrials(DEMO_TRIAL_PATIENT, { researchConsent: true }).matches
      )
    ).toBe(true);
  });

  it("is false for a fabricated / off-catalog criterion", () => {
    expect(
      eligibilityTracesToCriteria([
        {
          matchedCriteria: [{ criterionId: "crit.fabricated-ad-hoc" }],
          failedCriteria: []
        }
      ])
    ).toBe(false);
  });

  it("is false for a non-array input", () => {
    expect(eligibilityTracesToCriteria(null)).toBe(false);
    expect(eligibilityTracesToCriteria(undefined)).toBe(false);
  });
});

describe("outreachHasResearchConsent · research-consent-required signal", () => {
  it("is true for a consent-present drafted outreach and for the withheld states", () => {
    expect(
      outreachHasResearchConsent({ state: "drafted", researchConsentPresent: true })
    ).toBe(true);
    expect(
      outreachHasResearchConsent({ state: "consent-required", researchConsentPresent: false })
    ).toBe(true);
    expect(
      outreachHasResearchConsent({ state: "no-eligible-studies", researchConsentPresent: false })
    ).toBe(true);
  });

  it("is false for an active outreach asserted without research consent, and for non-objects", () => {
    expect(
      outreachHasResearchConsent({ state: "drafted", researchConsentPresent: false })
    ).toBe(false);
    expect(outreachHasResearchConsent(null)).toBe(false);
    expect(outreachHasResearchConsent(undefined)).toBe(false);
  });
});

describe("enrollmentRequiresHuman · no-autonomous-enrollment signal", () => {
  it("is true for anything draftTrialOutreach produces", () => {
    expect(enrollmentRequiresHuman(draftTrialOutreach(["study.vms-nonhormonal-rct"], true))).toBe(
      true
    );
  });

  it("is false for a caller-asserted autonomous enrollment", () => {
    expect(
      enrollmentRequiresHuman({ enrolled: true as never, requiresHuman: true })
    ).toBe(false);
    expect(
      enrollmentRequiresHuman({ enrolled: false, requiresHuman: false as never })
    ).toBe(false);
    expect(enrollmentRequiresHuman(null)).toBe(false);
  });
});
