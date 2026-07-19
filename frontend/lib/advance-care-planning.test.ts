import { describe, expect, it } from "vitest";
import {
  ACP_DIRECTIVES,
  APPROVED_SOURCES,
  DEMO_ACP_PATIENT,
  DEMO_LEP_ACP_PATIENT,
  STALENESS_THRESHOLD_DAYS,
  assessAdvanceCarePlanning,
  directiveChangeRequiresHumanSignoff,
  directivesTraceToCatalog,
  getDirective,
  isAcpDirective,
  isApprovedSource,
  languageAccessSatisfied,
  proposeDirectiveChange
} from "./advance-care-planning";

/**
 * Tests for lib/advance-care-planning.ts — the deterministic ACP planner
 * behind the Advance Care Planning Agent. The assessment is a pure function
 * of the caller-provided asOfDate + directives-on-file (no randomness, no
 * clock), so the same context always yields the same assessment. These pin
 * determinism, catalog-sourced directives + approved sources, the LEP
 * withheld / language-access-required path (a safe answer, not a block), and
 * the three honest governance signals (directive-source-integrity +
 * no-autonomous-directive-change + language-access-integrity).
 */

describe("catalog", () => {
  it("exposes a stable, illustrative directive catalog + approved-source list", () => {
    expect(ACP_DIRECTIVES.length).toBeGreaterThan(0);
    for (const d of ACP_DIRECTIVES) {
      expect(d.id).toMatch(/^directive\./);
      expect(d.synthetic).toBe(true);
    }
    // At least one directive is universally recommended (living will / DPOA-HC).
    expect(ACP_DIRECTIVES.some((d) => d.universallyRecommended)).toBe(true);
    // POLST is conditional — not universally recommended (serious-illness only).
    const polst = ACP_DIRECTIVES.find((d) => d.id === "directive.polst");
    expect(polst?.universallyRecommended).toBe(false);
    // Verbal / ad-hoc sources are deliberately excluded from the approved list.
    expect(APPROVED_SOURCES).not.toContain("verbal-not-documented");
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const d of ACP_DIRECTIVES) {
      expect(isAcpDirective(d.id)).toBe(true);
      expect(getDirective(d.id)?.label).toBe(d.label);
    }
    expect(isAcpDirective("directive.made-up")).toBe(false);
    expect(isAcpDirective(42)).toBe(false);
    for (const s of APPROVED_SOURCES) expect(isApprovedSource(s)).toBe(true);
    expect(isApprovedSource("verbal-not-documented")).toBe(false);
  });
});

describe("assessAdvanceCarePlanning", () => {
  it("is deterministic — same context always yields the same assessment", () => {
    const a = assessAdvanceCarePlanning(DEMO_ACP_PATIENT);
    const b = assessAdvanceCarePlanning(DEMO_ACP_PATIENT);
    expect(a).toEqual(b);
  });

  it("flags a missing universal directive and drafts an actionable conversation prompt", () => {
    const a = assessAdvanceCarePlanning(DEMO_ACP_PATIENT);
    // DPOA-HC is on file; living will is missing (universally recommended).
    const dpoahc = a.perDirective.find((d) => d.directiveId === "directive.dpoahc");
    const livingWill = a.perDirective.find((d) => d.directiveId === "directive.living-will");
    expect(dpoahc?.status).toBe("on-file");
    expect(livingWill?.status).toBe("missing");
    expect(a.flags.some((f) => f.kind === "missing-universal-directive")).toBe(true);
    // POLST is NOT applicable without a serious-illness flag.
    const polst = a.perDirective.find((d) => d.directiveId === "directive.polst");
    expect(polst?.status).toBe("not-applicable");
    // Prompt is drafted (English patient, no interpreter needed).
    expect(a.conversationPrompt.state).toBe("drafted");
    expect(a.conversationPrompt.actionable).toBe(true);
    // Completeness: 1 of 2 universally-recommended directives on file.
    expect(a.completeness).toBeCloseTo(0.5);
  });

  it("flags a stale directive when older than the threshold", () => {
    const stale = assessAdvanceCarePlanning({
      ...DEMO_ACP_PATIENT,
      directivesOnFile: [
        {
          directiveId: "directive.dpoahc",
          source: "attorney-executed",
          executedDate: "2010-01-01",
          languageCode: "en"
        }
      ]
    });
    const dpoahc = stale.perDirective.find((d) => d.directiveId === "directive.dpoahc");
    expect(dpoahc?.status).toBe("on-file-stale");
    expect(dpoahc?.ageInDays).toBeGreaterThan(STALENESS_THRESHOLD_DAYS);
    expect(stale.flags.some((f) => f.kind === "stale-directive")).toBe(true);
  });

  it("recommends POLST only when serious-illness is flagged", () => {
    const withSerious = assessAdvanceCarePlanning({
      ...DEMO_ACP_PATIENT,
      seriousIllness: true
    });
    const polst = withSerious.perDirective.find(
      (d) => d.directiveId === "directive.polst"
    );
    expect(polst?.recommended).toBe(true);
    expect(polst?.status).toBe("missing");
    expect(
      withSerious.flags.some((f) => f.kind === "conditional-directive-recommended")
    ).toBe(true);
  });

  it("WITHHOLDS the prompt for an LEP patient with no interpreter plan (safe answer, not a block)", () => {
    const a = assessAdvanceCarePlanning(DEMO_LEP_ACP_PATIENT);
    expect(a.conversationPrompt.state).toBe("withheld-language-access-required");
    expect(a.conversationPrompt.actionable).toBe(false);
    expect(a.flags.some((f) => f.kind === "language-access-required")).toBe(true);
  });

  it("draftS an actionable prompt for an LEP patient WITH a qualified-interpreter plan", () => {
    const a = assessAdvanceCarePlanning({
      ...DEMO_LEP_ACP_PATIENT,
      qualifiedInterpreterPlanned: true
    });
    expect(a.conversationPrompt.state).toBe("drafted");
    expect(a.conversationPrompt.actionable).toBe(true);
    expect(a.flags.some((f) => f.kind === "language-access-required")).toBe(false);
  });

  it("surfaces off-catalog / verbal-not-documented sources as flags (integrity guard fires separately)", () => {
    const a = assessAdvanceCarePlanning({
      ...DEMO_ACP_PATIENT,
      directivesOnFile: [
        {
          directiveId: "directive.dpoahc",
          source: "verbal-not-documented",
          executedDate: "2024-01-01"
        }
      ]
    });
    expect(a.flags.some((f) => f.kind === "off-catalog-source")).toBe(true);
    // The illegitimate claim doesn't count as on-file — DPOA-HC stays "missing".
    const dpoahc = a.perDirective.find((d) => d.directiveId === "directive.dpoahc");
    expect(dpoahc?.status).toBe("missing");
  });
});

describe("proposeDirectiveChange", () => {
  it("always requires clinician + patient sign-off; never applied autonomously", () => {
    const p = proposeDirectiveChange({
      directiveId: "directive.living-will",
      proposedChange: "add a preference against mechanical ventilation"
    });
    expect(p.requiresClinicianAndPatientSignoff).toBe(true);
    expect(p.applied).toBe(false);
    expect(p.state).toBe("ready-for-clinician-and-patient");
  });
});

describe("governance signals", () => {
  const a = assessAdvanceCarePlanning(DEMO_ACP_PATIENT);
  const proposal = proposeDirectiveChange({
    directiveId: "directive.living-will",
    proposedChange: "execute a new living will"
  });

  it("directivesTraceToCatalog: true for legitimate on-file, false for off-catalog / verbal / undated", () => {
    expect(directivesTraceToCatalog(DEMO_ACP_PATIENT.directivesOnFile!)).toBe(true);
    expect(directivesTraceToCatalog([])).toBe(true);
    expect(
      directivesTraceToCatalog([
        {
          directiveId: "directive.made-up",
          source: "attorney-executed",
          executedDate: "2024-01-01"
        }
      ])
    ).toBe(false);
    expect(
      directivesTraceToCatalog([
        {
          directiveId: "directive.dpoahc",
          source: "verbal-not-documented",
          executedDate: "2024-01-01"
        }
      ])
    ).toBe(false);
    expect(
      directivesTraceToCatalog([
        { directiveId: "directive.dpoahc", source: "attorney-executed" }
      ])
    ).toBe(false);
    expect(directivesTraceToCatalog(null)).toBe(false);
  });

  it("directiveChangeRequiresHumanSignoff: true for produced proposals, false when applied or unapproved", () => {
    expect(directiveChangeRequiresHumanSignoff([proposal])).toBe(true);
    expect(directiveChangeRequiresHumanSignoff([])).toBe(true);
    expect(
      directiveChangeRequiresHumanSignoff([
        {
          ...proposal,
          applied: true
        } as unknown as typeof proposal
      ])
    ).toBe(false);
    expect(
      directiveChangeRequiresHumanSignoff([
        {
          requiresClinicianAndPatientSignoff: false,
          applied: false,
          state: "ready-for-clinician-and-patient"
        }
      ])
    ).toBe(false);
    expect(directiveChangeRequiresHumanSignoff(null)).toBe(false);
  });

  it("languageAccessSatisfied: true for non-LEP / LEP-with-plan / LEP-withheld, false for LEP claiming active prompt with no plan", () => {
    // Non-LEP: trivially satisfied.
    expect(languageAccessSatisfied({ preferredLanguageCode: "en" })).toBe(true);
    // LEP with a documented interpreter plan.
    expect(
      languageAccessSatisfied({
        preferredLanguageCode: "es",
        qualifiedInterpreterPlanned: true,
        conversationPromptState: "drafted"
      })
    ).toBe(true);
    // LEP with no interpreter, but the prompt is WITHHELD — the safe answer.
    expect(
      languageAccessSatisfied({
        preferredLanguageCode: "es",
        qualifiedInterpreterPlanned: false,
        conversationPromptState: "withheld-language-access-required"
      })
    ).toBe(true);
    // The violation: LEP + no interpreter + claiming an active drafted prompt.
    expect(
      languageAccessSatisfied({
        preferredLanguageCode: "es",
        qualifiedInterpreterPlanned: false,
        conversationPromptState: "drafted"
      })
    ).toBe(false);
    expect(languageAccessSatisfied(null)).toBe(false);
  });

  it("the produced assessment satisfies all three signals for the demo patient", () => {
    expect(directivesTraceToCatalog(DEMO_ACP_PATIENT.directivesOnFile!)).toBe(true);
    expect(
      languageAccessSatisfied({
        preferredLanguageCode: a.preferredLanguageCode,
        qualifiedInterpreterPlanned: a.qualifiedInterpreterPlanned,
        conversationPromptState: a.conversationPrompt.state
      })
    ).toBe(true);
  });

  it("the LEP demo patient's withheld prompt satisfies language-access (a safe answer, not a block)", () => {
    const lep = assessAdvanceCarePlanning(DEMO_LEP_ACP_PATIENT);
    expect(
      languageAccessSatisfied({
        preferredLanguageCode: lep.preferredLanguageCode,
        qualifiedInterpreterPlanned: lep.qualifiedInterpreterPlanned,
        conversationPromptState: lep.conversationPrompt.state
      })
    ).toBe(true);
  });
});
