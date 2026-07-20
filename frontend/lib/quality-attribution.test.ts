import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_METHODOLOGIES,
  DEMO_ATTRIBUTION_PANEL,
  DEMO_CONTRACT_EXCLUDED_PATIENT,
  DEMO_TIE_BREAK_PATIENT,
  DOCUMENTED_TIE_BREAKS,
  VBC_CONTRACTS,
  attributePanel,
  attributePatient,
  attributionTieBreaksAreDocumented,
  attributionsHonorContractTerms,
  attributionsTraceToCatalog,
  getContract,
  getMethodology,
  isAttributionMethodology,
  isDocumentedTieBreak,
  isVbcContract,
  rollUpAttributions
} from "./quality-attribution";

/**
 * Tests for lib/quality-attribution.ts — the deterministic patient-to-
 * provider / -to-contract attribution behind the Quality-Measure Attribution
 * Agent. Attribution is a pure function of the visits + contract terms +
 * asOfDate (no randomness, no clock), so the same context always yields the
 * same attribution + rollup. These pin determinism, catalog-sourced
 * methodologies + contracts + tie-breaks, contract-exclusion detection, the
 * documented tie-break chain, and the three honest governance signals.
 */

describe("catalogs", () => {
  it("exposes the methodology + contract + tie-break catalogs", () => {
    expect(ATTRIBUTION_METHODOLOGIES.length).toBe(4);
    for (const m of ATTRIBUTION_METHODOLOGIES) expect(m.synthetic).toBe(true);
    expect(VBC_CONTRACTS.length).toBe(2);
    for (const c of VBC_CONTRACTS) expect(c.synthetic).toBe(true);
    expect(DOCUMENTED_TIE_BREAKS).toEqual([
      "most-recent-visit-wins",
      "provider-ref-lexical-ascending"
    ]);
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const m of ATTRIBUTION_METHODOLOGIES) {
      expect(isAttributionMethodology(m.id)).toBe(true);
      expect(getMethodology(m.id)?.label).toBe(m.label);
    }
    expect(isAttributionMethodology("methodology.coin-flip")).toBe(false);
    for (const c of VBC_CONTRACTS) {
      expect(isVbcContract(c.id)).toBe(true);
      expect(getContract(c.id)?.label).toBe(c.label);
    }
    expect(isVbcContract("contract.made-up")).toBe(false);
    for (const r of DOCUMENTED_TIE_BREAKS) expect(isDocumentedTieBreak(r)).toBe(true);
    expect(isDocumentedTieBreak("coin-flip")).toBe(false);
    expect(isDocumentedTieBreak(42)).toBe(false);
  });
});

describe("attributePatient", () => {
  it("is deterministic — same context always yields the same attribution", () => {
    const a = attributePatient(DEMO_ATTRIBUTION_PANEL[0]);
    const b = attributePatient(DEMO_ATTRIBUTION_PANEL[0]);
    expect(a).toEqual(b);
  });

  it("plurality-of-visits: picks the provider with the most primary-care visits, no tie-break", () => {
    const a = attributePatient(DEMO_ATTRIBUTION_PANEL[0]);
    expect(a.methodologyId).toBe("methodology.plurality-of-visits");
    expect(a.providerRef).toBe("provider-a");
    expect(a.clinicRef).toBe("clinic-north");
    expect(a.tieBreakApplied).toBeNull();
    expect(a.excludedByContract).toBe(false);
  });

  it("plurality-of-visits: breaks a tie via most-recent-visit-wins", () => {
    const a = attributePatient(DEMO_TIE_BREAK_PATIENT);
    // 2 visits each to provider-a and provider-b; provider-b has the more
    // recent visit (2026-06-15) so provider-b wins.
    expect(a.providerRef).toBe("provider-b");
    expect(a.tieBreakApplied).toBe("most-recent-visit-wins");
    expect(isDocumentedTieBreak(a.tieBreakApplied!)).toBe(true);
  });

  it("plurality-of-visits: falls to lexical tie-break when recency is also tied", () => {
    const a = attributePatient({
      patientRef: "attr-tie-lex-001",
      asOfDate: "2026-07-01",
      age: 55,
      inNetwork: true,
      methodologyId: "methodology.plurality-of-visits",
      contractId: "contract.commercial-vbc-my2026",
      visitHistory: [
        { providerRef: "provider-x", clinicRef: "clinic-x", date: "2026-06-01", isPrimaryCare: true },
        { providerRef: "provider-y", clinicRef: "clinic-y", date: "2026-06-01", isPrimaryCare: true }
      ]
    });
    // Same count, same latest date → lexical tie-break picks provider-x.
    expect(a.providerRef).toBe("provider-x");
    expect(a.tieBreakApplied).toBe("provider-ref-lexical-ascending");
  });

  it("pcp-of-record: uses pcpOfRecordRef, ignoring visit-count winner", () => {
    const a = attributePatient(DEMO_ATTRIBUTION_PANEL[2]);
    expect(a.methodologyId).toBe("methodology.pcp-of-record");
    expect(a.providerRef).toBe("provider-c");
    expect(a.tieBreakApplied).toBeNull();
  });

  it("prospective-medicare-advantage: uses the prospective assignment", () => {
    const a = attributePatient({
      patientRef: "attr-prospective-001",
      asOfDate: "2026-07-01",
      age: 70,
      inNetwork: true,
      methodologyId: "methodology.prospective-medicare-advantage",
      contractId: "contract.medicare-advantage-hedis-my2026",
      prospectiveProviderRef: "provider-p",
      visitHistory: [
        { providerRef: "provider-a", clinicRef: "clinic-north", date: "2026-01-15", isPrimaryCare: true }
      ]
    });
    expect(a.providerRef).toBe("provider-p");
  });

  it("contract-defined-window: only counts visits within the contract window", () => {
    const a = attributePatient(DEMO_ATTRIBUTION_PANEL[3]);
    expect(a.providerRef).toBe("provider-d");
    expect(a.excludedByContract).toBe(false);
  });

  it("respects contract exclusion (age out of band)", () => {
    const a = attributePatient(DEMO_CONTRACT_EXCLUDED_PATIENT);
    // Age 52 patient on Medicare Advantage HEDIS (65-120) → excluded.
    expect(a.excludedByContract).toBe(true);
    expect(a.exclusionReasons.some((r) => r.includes("outside contract range"))).toBe(
      true
    );
  });

  it("respects contract exclusion (out-of-network)", () => {
    const a = attributePatient({
      patientRef: "attr-oon-001",
      asOfDate: "2026-07-01",
      age: 55,
      inNetwork: false,
      methodologyId: "methodology.plurality-of-visits",
      contractId: "contract.commercial-vbc-my2026",
      visitHistory: [
        { providerRef: "provider-a", clinicRef: "clinic-north", date: "2026-04-01", isPrimaryCare: true }
      ]
    });
    expect(a.excludedByContract).toBe(true);
    expect(a.exclusionReasons.some((r) => r.includes("in-network"))).toBe(true);
  });

  it("respects contract exclusion (exclusion code)", () => {
    const a = attributePatient({
      patientRef: "attr-hospice-001",
      asOfDate: "2026-07-01",
      age: 55,
      inNetwork: true,
      patientExclusionCodes: ["exclusion.hospice"],
      methodologyId: "methodology.plurality-of-visits",
      contractId: "contract.commercial-vbc-my2026",
      visitHistory: [
        { providerRef: "provider-a", clinicRef: "clinic-north", date: "2026-04-01", isPrimaryCare: true }
      ]
    });
    expect(a.excludedByContract).toBe(true);
    expect(a.exclusionReasons.some((r) => r.includes("exclusion.hospice"))).toBe(true);
  });

  it("returns an unattributed record for an off-catalog methodology", () => {
    const a = attributePatient({
      patientRef: "attr-offcat-001",
      asOfDate: "2026-07-01",
      age: 55,
      inNetwork: true,
      methodologyId: "methodology.coin-flip",
      contractId: "contract.commercial-vbc-my2026"
    });
    expect(a.providerRef).toBeNull();
    expect(a.excludedByContract).toBe(true);
  });

  it("ignores primary-care visits outside the contract's attribution window", () => {
    const a = attributePatient({
      patientRef: "attr-window-001",
      asOfDate: "2026-07-01",
      age: 55,
      inNetwork: true,
      methodologyId: "methodology.plurality-of-visits",
      contractId: "contract.commercial-vbc-my2026",
      visitHistory: [
        // 3 years old — well outside the 730-day commercial window.
        { providerRef: "provider-old", clinicRef: "clinic-old", date: "2023-01-15", isPrimaryCare: true },
        { providerRef: "provider-old", clinicRef: "clinic-old", date: "2023-06-01", isPrimaryCare: true },
        { providerRef: "provider-fresh", clinicRef: "clinic-fresh", date: "2026-05-01", isPrimaryCare: true }
      ]
    });
    expect(a.providerRef).toBe("provider-fresh");
  });

  it("ignores non-primary-care visits for plurality-of-visits", () => {
    const a = attributePatient({
      patientRef: "attr-nonpc-001",
      asOfDate: "2026-07-01",
      age: 55,
      inNetwork: true,
      methodologyId: "methodology.plurality-of-visits",
      contractId: "contract.commercial-vbc-my2026",
      visitHistory: [
        { providerRef: "provider-spec", clinicRef: "clinic-spec", date: "2026-01-15", isPrimaryCare: false },
        { providerRef: "provider-spec", clinicRef: "clinic-spec", date: "2026-02-15", isPrimaryCare: false },
        { providerRef: "provider-spec", clinicRef: "clinic-spec", date: "2026-03-15", isPrimaryCare: false },
        { providerRef: "provider-pcp", clinicRef: "clinic-pcp", date: "2026-04-01", isPrimaryCare: true }
      ]
    });
    expect(a.providerRef).toBe("provider-pcp");
  });
});

describe("attributePanel + rollUpAttributions", () => {
  it("rolls up per-provider counts deterministically", () => {
    const report = attributePanel(DEMO_ATTRIBUTION_PANEL);
    expect(report.patients).toHaveLength(DEMO_ATTRIBUTION_PANEL.length);
    // At least one provider-b (tie-break winner from patient 2).
    const providerB = report.perProvider.find((p) => p.providerRef === "provider-b");
    expect(providerB?.tieBrokenCount).toBeGreaterThan(0);
  });

  it("counts contract-excluded attributions separately from in-network attributed", () => {
    const report = attributePanel(DEMO_ATTRIBUTION_PANEL);
    const totalExcluded = report.perProvider.reduce(
      (s, p) => s + p.excludedByContractCount,
      0
    );
    expect(totalExcluded).toBeGreaterThan(0);
  });

  it("is deterministic — same panel always yields the same report", () => {
    const a = attributePanel(DEMO_ATTRIBUTION_PANEL);
    const b = attributePanel(DEMO_ATTRIBUTION_PANEL);
    expect(a).toEqual(b);
  });

  it("sorts providers by providerRef ascending for a stable display", () => {
    const report = attributePanel(DEMO_ATTRIBUTION_PANEL);
    const refs = report.perProvider.map((p) => p.providerRef);
    expect(refs).toEqual([...refs].sort());
  });

  it("handles an empty panel gracefully", () => {
    const rollup = rollUpAttributions([]);
    expect(rollup.perProvider).toEqual([]);
    expect(rollup.unattributableCount).toBe(0);
  });
});

describe("governance signals", () => {
  const report = attributePanel(DEMO_ATTRIBUTION_PANEL);

  it("attributionsTraceToCatalog: true for produced attributions, false for off-catalog", () => {
    expect(attributionsTraceToCatalog(report.patients)).toBe(true);
    expect(
      attributionsTraceToCatalog([
        {
          methodologyId: "methodology.coin-flip",
          contractRef: "contract.commercial-vbc-my2026"
        }
      ])
    ).toBe(false);
    expect(
      attributionsTraceToCatalog([
        {
          methodologyId: "methodology.plurality-of-visits",
          contractRef: "contract.made-up"
        }
      ])
    ).toBe(false);
    expect(attributionsTraceToCatalog([])).toBe(true);
    expect(attributionsTraceToCatalog(null)).toBe(false);
  });

  it("attributionsHonorContractTerms: true when asserted excluded matches actual, false when caller-lies-by-omission", () => {
    // Honest: asserted matches actual.
    expect(
      attributionsHonorContractTerms([
        { assertedExcludedByContract: true, actualExcludedByContract: true },
        { assertedExcludedByContract: false, actualExcludedByContract: false }
      ])
    ).toBe(true);
    // Dishonest: contract-excludes the patient but the caller pretends otherwise.
    expect(
      attributionsHonorContractTerms([
        { assertedExcludedByContract: false, actualExcludedByContract: true }
      ])
    ).toBe(false);
    // Fine: caller flagged excluded even when they didn't have to.
    expect(
      attributionsHonorContractTerms([
        { assertedExcludedByContract: true, actualExcludedByContract: false }
      ])
    ).toBe(true);
    expect(attributionsHonorContractTerms([])).toBe(true);
    expect(attributionsHonorContractTerms(null)).toBe(false);
  });

  it("attributionTieBreaksAreDocumented: true when tie-breaks are documented or null, false when opaque", () => {
    expect(attributionTieBreaksAreDocumented(report.patients)).toBe(true);
    expect(
      attributionTieBreaksAreDocumented([
        { tieBreakApplied: null },
        { tieBreakApplied: "most-recent-visit-wins" }
      ])
    ).toBe(true);
    expect(
      attributionTieBreaksAreDocumented([{ tieBreakApplied: "coin-flip" }])
    ).toBe(false);
    expect(attributionTieBreaksAreDocumented([])).toBe(true);
    expect(attributionTieBreaksAreDocumented(null)).toBe(false);
  });
});
