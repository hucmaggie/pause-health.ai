import { describe, expect, it } from "vitest";
import {
  APPROVED_MATERIALS,
  DEMO_EQUITY_GAP_PATIENT,
  DEMO_LANGUAGE_PATIENT,
  INTERPRETER_MODALITIES,
  SUPPORTED_LANGUAGES,
  arrangeInterpreter,
  assessLanguageAccess,
  defaultConsentCommunicationPlan,
  getLanguage,
  getMaterial,
  isApprovedMaterial,
  isApprovedTranslation,
  isInterpreterModality,
  isSupportedLanguage,
  materialsTraceToApprovedSource,
  noMachineTranslationForConsent,
  usesQualifiedInterpreter
} from "./language-access";

/**
 * Tests for lib/language-access.ts — the deterministic language-access planner
 * behind the Language Access & Health Equity Agent. The assessment is a pure
 * function of the structured patient context (no randomness, no clock), so the
 * same context always yields the same assessment. These pin determinism, the
 * catalog-sourced materials, the qualified-interpreter-only posture, the
 * equity-gap flagging (a safe output, not a block), and the three honest
 * governance signals (qualified-interpreter-only + translated-material-source-
 * integrity + no-machine-translation-for-consent).
 */

describe("catalogs", () => {
  it("exposes a supported-language catalog with stable codes + labels + modality", () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThan(0);
    for (const l of SUPPORTED_LANGUAGES) {
      expect(l.code.length).toBeGreaterThan(0);
      expect(l.label.length).toBeGreaterThan(0);
      expect(INTERPRETER_MODALITIES).toContain(l.preferredModality);
      expect(typeof l.qualifiedInterpreterAvailable).toBe("boolean");
    }
    // A deliberately supported-but-unstaffed language exists (the equity gap).
    const unstaffed = SUPPORTED_LANGUAGES.find((l) => !l.qualifiedInterpreterAvailable);
    expect(unstaffed).toBeDefined();
  });

  it("exposes a clearly-synthetic approved-materials catalog with provenance", () => {
    expect(APPROVED_MATERIALS.length).toBeGreaterThan(0);
    for (const m of APPROVED_MATERIALS) {
      expect(m.id).toMatch(/^material\./);
      expect(m.synthetic).toBe(true);
      expect(m.translations.length).toBeGreaterThan(0);
      // English is always the original source of record.
      expect(m.translations.some((t) => t.languageCode === "en")).toBe(true);
      for (const t of m.translations) {
        expect(t.source.length).toBeGreaterThan(0);
      }
    }
    // The consent form is deliberately NOT translated into every language.
    const consent = APPROVED_MATERIALS.find((m) => m.isConsentDocument);
    expect(consent).toBeDefined();
    expect(consent!.translations.some((t) => t.languageCode === "vi")).toBe(false);
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const l of SUPPORTED_LANGUAGES) {
      expect(isSupportedLanguage(l.code)).toBe(true);
      expect(getLanguage(l.code)?.label).toBe(l.label);
    }
    expect(isSupportedLanguage("xx")).toBe(false);
    for (const m of APPROVED_MATERIALS) {
      expect(isApprovedMaterial(m.id)).toBe(true);
      expect(getMaterial(m.id)?.label).toBe(m.label);
    }
    expect(isApprovedMaterial("material.made-up")).toBe(false);
    expect(isInterpreterModality("video")).toBe(true);
    expect(isInterpreterModality("carrier-pigeon")).toBe(false);
    expect(isApprovedTranslation("material.clinical-consent-form", "es")).toBe(true);
    expect(isApprovedTranslation("material.clinical-consent-form", "vi")).toBe(false);
    expect(isApprovedTranslation("material.made-up", "es")).toBe(false);
  });
});

describe("assessLanguageAccess · determinism + catalog-sourced materials", () => {
  it("is deterministic — the same context yields the same assessment", () => {
    expect(assessLanguageAccess(DEMO_LANGUAGE_PATIENT)).toEqual(
      assessLanguageAccess(DEMO_LANGUAGE_PATIENT)
    );
  });

  it("Spanish patient: qualified video interpreter + full in-language materials, no gaps", () => {
    const a = assessLanguageAccess(DEMO_LANGUAGE_PATIENT);
    expect(a.patientRef).toBe("langaccess-patient-001");
    expect(a.preferredLanguage.code).toBe("es");
    expect(a.preferredLanguage.supported).toBe(true);
    expect(a.interpreterNeeded).toBe(true);
    expect(a.qualifiedInterpreterAvailable).toBe(true);
    expect(a.recommendedModality).toBe("video");
    expect(a.materialsInLanguage.every((m) => m.available)).toBe(true);
    // Every available material traces to an approved catalog source.
    expect(materialsTraceToApprovedSource(a.materialsInLanguage)).toBe(true);
    expect(a.equityGaps).toHaveLength(0);
  });

  it("English patient: no interpreter needed, no gaps", () => {
    const a = assessLanguageAccess({ patientRef: "en-1", preferredLanguageCode: "en" });
    expect(a.interpreterNeeded).toBe(false);
    expect(a.qualifiedInterpreterAvailable).toBe(true);
    expect(a.recommendedModality).toBeNull();
    expect(a.equityGaps).toHaveLength(0);
  });

  it("defaults an unset preferred language to English (clinical default)", () => {
    const a = assessLanguageAccess({ patientRef: "def-1" });
    expect(a.preferredLanguage.code).toBe("en");
    expect(a.interpreterNeeded).toBe(false);
  });

  it("Vietnamese patient: consent form only in English is flagged as an equity gap", () => {
    const a = assessLanguageAccess({ patientRef: "vi-1", preferredLanguageCode: "vi" });
    expect(a.interpreterNeeded).toBe(true);
    expect(a.qualifiedInterpreterAvailable).toBe(true);
    const consentGap = a.equityGaps.find(
      (g) => g.kind === "consent-material-not-in-language"
    );
    expect(consentGap).toBeDefined();
    expect(consentGap!.severity).toBe("urgent");
    // The materials assessment still traces to approved sources (unavailable
    // materials make no claim).
    expect(materialsTraceToApprovedSource(a.materialsInLanguage)).toBe(true);
  });

  it("rare unstaffed language: no qualified interpreter + material gaps (all flagged)", () => {
    const a = assessLanguageAccess(DEMO_EQUITY_GAP_PATIENT);
    expect(a.interpreterNeeded).toBe(true);
    expect(a.qualifiedInterpreterAvailable).toBe(false);
    expect(a.recommendedModality).toBeNull();
    expect(a.equityGaps.some((g) => g.kind === "no-qualified-interpreter")).toBe(true);
    // Urgent gaps rank first (documented severity ordering).
    expect(a.equityGaps[0].severity).toBe("urgent");
    // No in-language materials for the rare language.
    expect(a.materialsInLanguage.every((m) => !m.available)).toBe(true);
  });

  it("an off-catalog preferred language is an unsupported-language equity gap", () => {
    const a = assessLanguageAccess({ patientRef: "xx-1", preferredLanguageCode: "xx" });
    expect(a.preferredLanguage.supported).toBe(false);
    expect(a.interpreterNeeded).toBe(true);
    expect(a.qualifiedInterpreterAvailable).toBe(false);
    expect(a.equityGaps.some((g) => g.kind === "unsupported-language")).toBe(true);
  });

  it("ignores off-catalog needed material ids (never fabricated)", () => {
    const a = assessLanguageAccess({
      patientRef: "sub-1",
      preferredLanguageCode: "es",
      neededMaterialIds: ["material.clinical-consent-form", "material.made-up"]
    });
    expect(a.materialsInLanguage).toHaveLength(1);
    expect(a.materialsInLanguage[0].materialId).toBe("material.clinical-consent-form");
  });
});

describe("arrangeInterpreter · qualified-only, never an unqualified fallback", () => {
  it("arranges a qualified interpreter when one is available", () => {
    const a = assessLanguageAccess(DEMO_LANGUAGE_PATIENT);
    const req = arrangeInterpreter(a);
    expect(req.state).toBe("arranged");
    expect(req.qualified).toBe(true);
    expect(req.modality).toBe("video");
    expect(req.escalated).toBe(false);
    expect(req.routedTo).toBeNull();
  });

  it("returns not-needed for an English patient", () => {
    const a = assessLanguageAccess({ patientRef: "en-2", preferredLanguageCode: "en" });
    const req = arrangeInterpreter(a);
    expect(req.state).toBe("not-needed");
    expect(req.qualified).toBe(true);
    expect(req.escalated).toBe(false);
  });

  it("escalates (never falls back) when no qualified interpreter is available", () => {
    const a = assessLanguageAccess(DEMO_EQUITY_GAP_PATIENT);
    const req = arrangeInterpreter(a);
    expect(req.state).toBe("equity-gap-escalation");
    // Still qualified:true — it NEVER proposes an unqualified fallback.
    expect(req.qualified).toBe(true);
    expect(req.requiresQualifiedInterpreter).toBe(true);
    expect(req.escalated).toBe(true);
    expect(req.routedTo).toBe("language-access-coordinator");
    // Escalation is a SAFE output — the qualified-interpreter signal still holds.
    expect(usesQualifiedInterpreter(req)).toBe(true);
  });
});

describe("usesQualifiedInterpreter · qualified-interpreter-only signal", () => {
  it("is true for anything arrangeInterpreter produces", () => {
    for (const ctx of [DEMO_LANGUAGE_PATIENT, DEMO_EQUITY_GAP_PATIENT]) {
      expect(usesQualifiedInterpreter(arrangeInterpreter(assessLanguageAccess(ctx)))).toBe(
        true
      );
    }
  });

  it("is false for a family / ad-hoc / machine interpreter for clinical use", () => {
    expect(usesQualifiedInterpreter({ interpreterType: "family" })).toBe(false);
    expect(usesQualifiedInterpreter({ interpreterType: "ad-hoc" })).toBe(false);
    expect(usesQualifiedInterpreter({ interpreterType: "machine-translation" })).toBe(
      false
    );
    expect(usesQualifiedInterpreter({ qualified: false })).toBe(false);
  });

  it("is false for a non-object input", () => {
    expect(usesQualifiedInterpreter(null)).toBe(false);
    expect(usesQualifiedInterpreter(undefined)).toBe(false);
  });
});

describe("materialsTraceToApprovedSource · source-integrity signal", () => {
  it("is true for anything assessLanguageAccess produces", () => {
    expect(
      materialsTraceToApprovedSource(
        assessLanguageAccess(DEMO_LANGUAGE_PATIENT).materialsInLanguage
      )
    ).toBe(true);
  });

  it("is false for an available material with no approved translation (ad-hoc)", () => {
    expect(
      materialsTraceToApprovedSource([
        { materialId: "material.clinical-consent-form", languageCode: "vi", available: true }
      ])
    ).toBe(false);
    expect(
      materialsTraceToApprovedSource([
        { materialId: "material.made-up", languageCode: "es", available: true }
      ])
    ).toBe(false);
  });

  it("is true when an unavailable material makes no claim; false for non-arrays", () => {
    expect(
      materialsTraceToApprovedSource([
        { materialId: "material.clinical-consent-form", languageCode: "vi", available: false }
      ])
    ).toBe(true);
    expect(materialsTraceToApprovedSource(null)).toBe(false);
    expect(materialsTraceToApprovedSource(undefined)).toBe(false);
  });
});

describe("noMachineTranslationForConsent · no-machine-translation signal", () => {
  it("is true for the default consent-safe plan", () => {
    expect(
      noMachineTranslationForConsent(
        defaultConsentCommunicationPlan(assessLanguageAccess(DEMO_LANGUAGE_PATIENT))
      )
    ).toBe(true);
  });

  it("is false when machine translation is used for clinical consent / decision", () => {
    expect(
      noMachineTranslationForConsent({
        translationMethod: "machine-translation",
        forClinicalConsent: true
      })
    ).toBe(false);
    expect(
      noMachineTranslationForConsent({
        translationMethod: "auto-translate",
        forClinicalDecision: true
      })
    ).toBe(false);
  });

  it("is true when machine translation is NOT for clinical consent; false for non-objects", () => {
    // Machine translation of a non-clinical wayfinding sign is not a consent violation.
    expect(
      noMachineTranslationForConsent({
        translationMethod: "machine-translation",
        forClinicalConsent: false
      })
    ).toBe(true);
    expect(noMachineTranslationForConsent(null)).toBe(false);
    expect(noMachineTranslationForConsent(undefined)).toBe(false);
  });
});
