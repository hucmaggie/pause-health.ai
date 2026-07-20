import { describe, expect, it } from "vitest";
import {
  DEMO_INTERACTION_REQUEST,
  DEMO_NON_FORMULARY_REQUEST,
  DEMO_PREFERRED_REQUEST,
  DEMO_QUANTITY_LIMIT_REQUEST,
  DEMO_STEP_THERAPY_REQUEST,
  FORMULARY_DRUG_CATALOG,
  FORMULARY_REASON_CODE_CATALOG,
  FORMULARY_RULE_CATALOG,
  INTERACTION_PAIRS,
  STEP_THERAPY_CHAINS,
  evaluateFormularyRules,
  exceptionRequiresClinicianCosign,
  getFormularyDrug,
  getFormularyRule,
  isFormularyDrug,
  isFormularyReasonCode,
  isFormularyRule,
  reviewFormularyRequest,
  rulesTraceToCatalog,
  stepTherapyIsHonored,
  summarizeFormularyDecision
} from "./formulary-review";

/**
 * Tests for lib/formulary-review.ts — the deterministic formulary / DUR
 * reviewer behind the Formulary & Drug Utilization Review Agent. The
 * decision is a pure function of the request + patient history + catalog
 * + asOfDate (no randomness, no clock), so the same context always yields
 * the same decision + applied rules + reason code.
 */

describe("catalogs", () => {
  it("exposes the drug + rule + reason-code catalogs", () => {
    expect(FORMULARY_DRUG_CATALOG.length).toBeGreaterThan(0);
    for (const d of FORMULARY_DRUG_CATALOG) {
      expect(d.id).toMatch(/^drug\./);
      expect(d.synthetic).toBe(true);
    }
    expect(FORMULARY_RULE_CATALOG.length).toBe(4);
    for (const r of FORMULARY_RULE_CATALOG) {
      expect(r.id).toMatch(/^rule\./);
      expect(r.synthetic).toBe(true);
    }
    expect(FORMULARY_REASON_CODE_CATALOG.length).toBe(5);
    expect(INTERACTION_PAIRS.length).toBeGreaterThan(0);
    expect(Object.keys(STEP_THERAPY_CHAINS).length).toBeGreaterThan(0);
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const d of FORMULARY_DRUG_CATALOG) {
      expect(isFormularyDrug(d.id)).toBe(true);
      expect(getFormularyDrug(d.id)?.label).toBe(d.label);
    }
    for (const r of FORMULARY_RULE_CATALOG) {
      expect(isFormularyRule(r.id)).toBe(true);
      expect(getFormularyRule(r.id)?.label).toBe(r.label);
    }
    expect(isFormularyDrug("drug.made-up")).toBe(false);
    expect(isFormularyRule("rule.made-up")).toBe(false);
    expect(isFormularyReasonCode("reason.PF-100")).toBe(true);
    expect(isFormularyReasonCode("reason.made-up")).toBe(false);
  });
});

describe("evaluateFormularyRules", () => {
  it("returns an empty array for a preferred-tier, in-quantity request with no interactions", () => {
    expect(evaluateFormularyRules(DEMO_PREFERRED_REQUEST)).toEqual([]);
  });

  it("fires step-therapy when a chain is required but no documented trial", () => {
    const hits = evaluateFormularyRules(DEMO_STEP_THERAPY_REQUEST);
    expect(hits.map((h) => h.ruleId)).toEqual(["rule.step-therapy-required"]);
    expect(hits[0].reasonCode).toBe("reason.PF-200");
  });

  it("does NOT fire step-therapy when a documented trial is on file", () => {
    const req = {
      ...DEMO_STEP_THERAPY_REQUEST,
      priorTherapy: [
        {
          drugId: "drug.estradiol-oral-1mg",
          startedOn: "2025-01-01",
          endedOn: "2025-06-30",
          documented: true
        }
      ]
    };
    const hits = evaluateFormularyRules(req);
    expect(hits.some((h) => h.ruleId === "rule.step-therapy-required")).toBe(false);
  });

  it("fires quantity-limit when requested > limit", () => {
    const hits = evaluateFormularyRules(DEMO_QUANTITY_LIMIT_REQUEST);
    expect(hits.map((h) => h.ruleId)).toEqual(["rule.quantity-limit-exceeded"]);
    expect(hits[0].reasonCode).toBe("reason.PF-201");
  });

  it("fires drug-drug interaction when a documented pair is present", () => {
    const hits = evaluateFormularyRules(DEMO_INTERACTION_REQUEST);
    expect(hits.map((h) => h.ruleId)).toEqual(["rule.drug-drug-interaction"]);
    expect(hits[0].reasonCode).toBe("reason.PF-202");
  });

  it("fires non-formulary for a non-formulary-tier drug", () => {
    const hits = evaluateFormularyRules(DEMO_NON_FORMULARY_REQUEST);
    // Fezolinetant is non-formulary AND has a step-therapy chain, so BOTH
    // rules fire — deterministic ordering by rule-id ascending.
    expect(hits.map((h) => h.ruleId)).toEqual([
      "rule.non-formulary",
      "rule.step-therapy-required"
    ]);
  });

  it("returns empty for an off-catalog drug (the fabric catches it separately)", () => {
    expect(
      evaluateFormularyRules({
        ...DEMO_PREFERRED_REQUEST,
        proposedDrugId: "drug.made-up"
      })
    ).toEqual([]);
  });
});

describe("summarizeFormularyDecision", () => {
  it("preferred-approved when no hits", () => {
    const s = summarizeFormularyDecision([]);
    expect(s.decision).toBe("preferred-approved");
    expect(s.primaryReasonCode).toBe("reason.PF-100");
    expect(s.routedTo).toBe("auto-approved");
  });

  it("pend-non-formulary wins over step-therapy (higher severity)", () => {
    const hits = evaluateFormularyRules(DEMO_NON_FORMULARY_REQUEST);
    const s = summarizeFormularyDecision(hits);
    expect(s.decision).toBe("pend-non-formulary");
    expect(s.primaryReasonCode).toBe("reason.PF-203");
    expect(s.routedTo).toBe("clinician-review");
  });

  it("pend-interaction-review routes to pharmacist-review (not clinician)", () => {
    const hits = evaluateFormularyRules(DEMO_INTERACTION_REQUEST);
    const s = summarizeFormularyDecision(hits);
    expect(s.decision).toBe("pend-interaction-review");
    expect(s.routedTo).toBe("pharmacist-review");
  });
});

describe("reviewFormularyRequest", () => {
  it("is deterministic — same request yields the same decision", () => {
    expect(reviewFormularyRequest(DEMO_PREFERRED_REQUEST)).toEqual(
      reviewFormularyRequest(DEMO_PREFERRED_REQUEST)
    );
  });

  it("preferred-approved is not clinician-cosign-gated", () => {
    const d = reviewFormularyRequest(DEMO_PREFERRED_REQUEST);
    expect(d.decision).toBe("preferred-approved");
    expect(d.requiresClinicianCosign).toBe(false);
    expect(d.cosigned).toBe(false);
  });

  it("every pend decision requires clinician cosign; cosigned is always false", () => {
    for (const req of [
      DEMO_STEP_THERAPY_REQUEST,
      DEMO_QUANTITY_LIMIT_REQUEST,
      DEMO_INTERACTION_REQUEST,
      DEMO_NON_FORMULARY_REQUEST
    ]) {
      const d = reviewFormularyRequest(req);
      expect(d.decision).not.toBe("preferred-approved");
      expect(d.requiresClinicianCosign).toBe(true);
      expect(d.cosigned).toBe(false);
    }
  });

  it("off-catalog drug pends for clinician review with PF-203", () => {
    const d = reviewFormularyRequest({
      ...DEMO_PREFERRED_REQUEST,
      proposedDrugId: "drug.made-up"
    });
    expect(d.decision).toBe("pend-non-formulary");
    expect(d.primaryReasonCode).toBe("reason.PF-203");
    expect(d.requiresClinicianCosign).toBe(true);
  });
});

describe("governance signals", () => {
  const preferred = reviewFormularyRequest(DEMO_PREFERRED_REQUEST);
  const stepTherapy = reviewFormularyRequest(DEMO_STEP_THERAPY_REQUEST);

  it("rulesTraceToCatalog: true for produced decisions, false for off-catalog", () => {
    expect(rulesTraceToCatalog(preferred)).toBe(true);
    expect(rulesTraceToCatalog(stepTherapy)).toBe(true);
    expect(
      rulesTraceToCatalog({
        proposedDrugId: "drug.made-up",
        appliedRules: []
      })
    ).toBe(false);
    expect(
      rulesTraceToCatalog({
        proposedDrugId: DEMO_PREFERRED_REQUEST.proposedDrugId,
        appliedRules: [{ ruleId: "rule.made-up", reasonCode: "reason.PF-100" }]
      })
    ).toBe(false);
    expect(rulesTraceToCatalog(null)).toBe(false);
  });

  it("stepTherapyIsHonored: false for step-therapy demo without documented trials", () => {
    expect(stepTherapyIsHonored(DEMO_STEP_THERAPY_REQUEST)).toBe(false);
  });

  it("stepTherapyIsHonored: true when documented trial on file", () => {
    expect(
      stepTherapyIsHonored({
        proposedDrugId: DEMO_STEP_THERAPY_REQUEST.proposedDrugId,
        priorTherapy: [
          {
            drugId: "drug.estradiol-oral-1mg",
            documented: true
          }
        ]
      })
    ).toBe(true);
  });

  it("stepTherapyIsHonored: true when the drug has no step-therapy chain (trivially satisfied)", () => {
    expect(stepTherapyIsHonored(DEMO_PREFERRED_REQUEST)).toBe(true);
  });

  it("stepTherapyIsHonored: false on non-object / bad input", () => {
    expect(stepTherapyIsHonored(null)).toBe(false);
    expect(stepTherapyIsHonored({})).toBe(false);
  });

  it("exceptionRequiresClinicianCosign: true for produced pends, false when cosign bypassed", () => {
    expect(exceptionRequiresClinicianCosign(preferred)).toBe(true); // no cosign needed
    expect(exceptionRequiresClinicianCosign(stepTherapy)).toBe(true);
    expect(
      exceptionRequiresClinicianCosign({
        ...stepTherapy,
        cosigned: true
      } as unknown as typeof stepTherapy)
    ).toBe(false);
    expect(
      exceptionRequiresClinicianCosign({
        ...stepTherapy,
        requiresClinicianCosign: false
      })
    ).toBe(false);
    expect(exceptionRequiresClinicianCosign(null)).toBe(false);
  });
});
