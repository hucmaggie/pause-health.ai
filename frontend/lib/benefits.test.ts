import { describe, expect, it } from "vitest";
import {
  CONTRACTED_PAYERS,
  DEFAULT_SERVICE_TYPE,
  coverageQueryFromIntake,
  coverageSummary,
  hasEbvSource,
  isKnownPayer,
  normalizePayer,
  verifyCoverage,
  type CoverageBenefitResult,
  type CoverageQuery
} from "./benefits";

/**
 * Tests for lib/benefits.ts — the deterministic synthetic eligibility
 * behind the Benefits & Coverage Verification (EBV) Agent. Every value is
 * a deterministic function of the query (hashed member/plan string, no
 * randomness, no clock), so the same query always verifies identically.
 * These tests pin determinism, realistic ranges, in/out-of-network logic,
 * source-provenance presence, and the known-payer allow-list.
 */

describe("payer normalization + allow-list", () => {
  it("folds common synonyms onto a canonical key", () => {
    expect(normalizePayer("United")).toBe("uhc");
    expect(normalizePayer("United Healthcare")).toBe("uhc");
    expect(normalizePayer("Blue Cross")).toBe("bcbs");
    expect(normalizePayer("Aetna")).toBe("aetna");
    expect(normalizePayer("Kaiser Permanente")).toBe("kaiser");
  });

  it("treats self-pay / uninsured / empty as no payer", () => {
    for (const t of ["", "self-pay", "Self Pay", "none", "Uninsured", "no insurance"]) {
      expect(normalizePayer(t)).toBe("");
    }
    expect(normalizePayer(undefined)).toBe("");
  });

  it("keeps a named-but-unknown payer as a deterministic slug", () => {
    expect(normalizePayer("FooCare")).toBe("foocare");
    expect(isKnownPayer("FooCare")).toBe(false);
  });

  it("isKnownPayer recognizes the known payers and rejects others", () => {
    expect(isKnownPayer("Aetna")).toBe(true);
    expect(isKnownPayer("United")).toBe(true);
    expect(isKnownPayer("Medicare")).toBe(true);
    expect(isKnownPayer("self-pay")).toBe(false);
    expect(isKnownPayer(undefined)).toBe(false);
  });
});

describe("verifyCoverage · determinism", () => {
  it("returns exactly the same result for the same query", () => {
    const q: CoverageQuery = { payer: "Aetna", memberId: "M-1001", patientZip: "94110" };
    expect(verifyCoverage(q)).toEqual(verifyCoverage(q));
  });

  it("differs across members but is stable per member", () => {
    const a = verifyCoverage({ payer: "Aetna", memberId: "M-1" });
    const b = verifyCoverage({ payer: "Aetna", memberId: "M-2" });
    // Stable per member...
    expect(verifyCoverage({ payer: "Aetna", memberId: "M-1" })).toEqual(a);
    // ...and the profile selection is member-sensitive (not all identical).
    // At least one of plan/deductible/visit cost should vary across members.
    const differs =
      a.planName !== b.planName ||
      a.deductibleTotal !== b.deductibleTotal ||
      a.deductibleMet !== b.deductibleMet ||
      a.estimatedVisitCost !== b.estimatedVisitCost;
    expect(differs).toBe(true);
  });

  it("defaults the service type to the MSCP specialist visit", () => {
    expect(verifyCoverage({ payer: "Cigna" }).serviceType).toBe(DEFAULT_SERVICE_TYPE);
    expect(verifyCoverage({ payer: "Cigna", serviceType: "telehealth" }).serviceType).toBe(
      "telehealth"
    );
  });
});

describe("verifyCoverage · realistic ranges", () => {
  const members = Array.from({ length: 40 }, (_, i) => `M-${i}`);
  const payers = ["Aetna", "BCBS", "Cigna", "United", "Kaiser", "Humana", "Medicare"];

  it("keeps deductible, coinsurance, visit cost, and OOP inside realistic bounds", () => {
    for (const payer of payers) {
      for (const memberId of members) {
        const r = verifyCoverage({ payer, memberId });
        // Deductible $1,500–$6,000, in $500 increments met, remaining consistent.
        expect(r.deductibleTotal).toBeGreaterThanOrEqual(1500);
        expect(r.deductibleTotal).toBeLessThanOrEqual(6000);
        expect(r.deductibleMet % 500).toBe(0);
        expect(r.deductibleMet).toBeGreaterThanOrEqual(0);
        expect(r.deductibleMet).toBeLessThanOrEqual(r.deductibleTotal);
        expect(r.deductibleRemaining).toBe(r.deductibleTotal - r.deductibleMet);
        // Coinsurance 0–60% (0 only when a copay applies in-network).
        expect(r.coinsuranceRate).toBeGreaterThanOrEqual(0);
        expect(r.coinsuranceRate).toBeLessThanOrEqual(0.6);
        // Visit $180–$420 in $10 steps.
        expect(r.estimatedVisitCost).toBeGreaterThanOrEqual(180);
        expect(r.estimatedVisitCost).toBeLessThanOrEqual(420);
        expect(r.estimatedVisitCost % 10).toBe(0);
        // Patient never owes more than the visit costs.
        expect(r.estimatedPatientResponsibility).toBeGreaterThanOrEqual(0);
        expect(r.estimatedPatientResponsibility).toBeLessThanOrEqual(
          r.estimatedVisitCost
        );
      }
    }
  });
});

describe("verifyCoverage · in/out-of-network logic", () => {
  it("resolves contracted payers as in-network", () => {
    for (const key of CONTRACTED_PAYERS) {
      const r = verifyCoverage({ payer: key, memberId: "X" });
      expect(r.network, key).toBe("in-network");
      expect(r.eligibilityStatus).toBe("active");
    }
  });

  it("resolves known-but-uncontracted payers (Humana, Medicare) as out-of-network", () => {
    for (const payer of ["Humana", "Medicare"]) {
      const r = verifyCoverage({ payer, memberId: "X" });
      expect(r.network, payer).toBe("out-of-network");
      expect(r.eligibilityStatus).toBe("active");
      // Out-of-network coinsurance is loaded (>= 30%) and there is no copay.
      expect(r.coinsuranceRate).toBeGreaterThanOrEqual(0.3);
      expect(r.copay).toBeUndefined();
    }
  });

  it("resolves a named-but-unknown payer as out-of-network but still active", () => {
    const r = verifyCoverage({ payer: "FooCare", memberId: "X" });
    expect(r.network).toBe("out-of-network");
    expect(r.eligibilityStatus).toBe("active");
  });

  it("exercises both the copay and the coinsurance in-network cost models", () => {
    // Search deterministic space for an in-network copay result and an
    // in-network coinsurance result, then pin each model's math.
    let copayCase: CoverageBenefitResult | undefined;
    let coinsCase: CoverageBenefitResult | undefined;
    for (let i = 0; i < 200 && (!copayCase || !coinsCase); i++) {
      const r = verifyCoverage({ payer: "Aetna", memberId: `seek-${i}` });
      if (r.network !== "in-network") continue;
      if (r.copay !== undefined && !copayCase) copayCase = r;
      if (r.copay === undefined && !coinsCase) coinsCase = r;
    }
    expect(copayCase, "expected at least one in-network copay plan").toBeDefined();
    expect(coinsCase, "expected at least one in-network coinsurance plan").toBeDefined();

    // Copay plan: flat copay, deductible waived, coinsurance 0.
    expect(copayCase!.coinsuranceRate).toBe(0);
    expect(copayCase!.estimatedPatientResponsibility).toBe(
      Math.min(copayCase!.copay!, copayCase!.estimatedVisitCost)
    );

    // Coinsurance plan: deductible-then-coinsurance math.
    const toward = Math.min(
      coinsCase!.estimatedVisitCost,
      coinsCase!.deductibleRemaining
    );
    const after = coinsCase!.estimatedVisitCost - toward;
    expect(coinsCase!.estimatedPatientResponsibility).toBe(
      toward + Math.round(after * coinsCase!.coinsuranceRate)
    );
  });
});

describe("verifyCoverage · self-pay / inactive", () => {
  it("returns an inactive, fully-patient-responsible result for self-pay", () => {
    const r = verifyCoverage({ payer: "self-pay", memberId: "X" });
    expect(r.eligibilityStatus).toBe("inactive");
    expect(r.deductibleTotal).toBe(0);
    expect(r.copay).toBeUndefined();
    expect(r.estimatedPatientResponsibility).toBe(r.estimatedVisitCost);
    // Even a no-coverage answer is a SOURCED EBV response, not a fabrication.
    expect(r.source.responseCode).toBe("no-active-coverage");
    expect(hasEbvSource(r)).toBe(true);
  });
});

describe("source provenance", () => {
  it("always attaches a synthetic EBV source that hasEbvSource accepts", () => {
    const r = verifyCoverage({ payer: "BCBS", memberId: "M-42" });
    expect(r.source.synthetic).toBe(true);
    expect(r.source.transactionId).toMatch(/^ebv-/);
    expect(r.source.clearinghouse).toMatch(/synthetic/i);
    expect(r.source.transactionType).toMatch(/270\/271/);
    expect(r.source.responseCode).toBe("active-coverage");
    expect(hasEbvSource(r)).toBe(true);
  });

  it("hasEbvSource rejects a coverage result with no / partial source", () => {
    expect(hasEbvSource(null)).toBe(false);
    expect(hasEbvSource(undefined)).toBe(false);
    expect(hasEbvSource({ source: undefined as never })).toBe(false);
    // A fabricated result missing the transaction id fails the check.
    const fabricated = {
      source: {
        synthetic: true,
        payer: "Aetna",
        clearinghouse: "Change Healthcare (synthetic)",
        transactionType: "EBV 270/271 (synthetic)",
        transactionId: "",
        responseCode: "active-coverage",
        note: "x"
      }
    } as unknown as CoverageBenefitResult;
    expect(hasEbvSource(fabricated)).toBe(false);
  });
});

describe("intake helpers", () => {
  it("coverageQueryFromIntake maps IntakeRecord fields onto a query", () => {
    const q = coverageQueryFromIntake(
      { patientInsurance: "United", patientZip: "94110" },
      { memberId: "M-9" }
    );
    expect(q.payer).toBe("United");
    expect(q.patientZip).toBe("94110");
    expect(q.memberId).toBe("M-9");
    expect(q.serviceType).toBe(DEFAULT_SERVICE_TYPE);
  });

  it("coverageSummary is a trace-safe projection with the ebv txn id + sourced flag", () => {
    const r = verifyCoverage({ payer: "Cigna", memberId: "M-7" });
    const s = coverageSummary(r);
    expect(s.payerName).toBe(r.payerName);
    expect(s.estimatedPatientResponsibility).toBe(r.estimatedPatientResponsibility);
    expect(s.ebvTransactionId).toBe(r.source.transactionId);
    expect(s.sourced).toBe(true);
    // Only known, trace-safe keys are present (copay optional); no PII.
    const allowedKeys = new Set([
      "coinsuranceRate",
      "copay",
      "deductibleMet",
      "deductibleRemaining",
      "deductibleTotal",
      "ebvTransactionId",
      "eligibilityStatus",
      "estimatedPatientResponsibility",
      "estimatedVisitCost",
      "network",
      "payerName",
      "planName",
      "sourced"
    ]);
    for (const k of Object.keys(s)) {
      expect(allowedKeys.has(k), `unexpected summary key ${k}`).toBe(true);
    }
  });
});
