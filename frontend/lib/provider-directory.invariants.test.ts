import { describe, expect, it } from "vitest";
import type { ProviderRecord } from "./mulesoft-mocks";
import { MSCP_OVERLAY_NPIS } from "./mscp-overlay";
import generated from "./provider-directory.generated.json";
import generatedMeta from "./provider-directory.generated.meta.json";

/**
 * Data-quality invariants on the COMMITTED provider directory.
 *
 * These don't test code — they test the generated artifact that actually ships
 * (provider-directory.generated.json + its .meta.json sidecar), so a future
 * `refresh_national.sh` run can't silently regress the quality/coverage wins or
 * let the sidecar drift from the data. They also make the investor-facing claims
 * ("all 50 states + DC across 930 ZIP-3 prefixes", "every provider is a
 * placeable US ZIP") test-enforced rather than prose.
 *
 * Floors (not exact counts) where a monthly NPPES refresh legitimately wiggles
 * the numbers; exact equality only where the sidecar must mirror the array.
 */

const DIRECTORY = generated as ProviderRecord[];

const FIFTY_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

describe("provider directory · committed-artifact invariants", () => {
  it("is a non-empty national dataset within a sane bundle ceiling", () => {
    expect(DIRECTORY.length).toBeGreaterThan(1000);
    // The non-certified breadth is capped at 2000 (+ all certified). Guard the
    // ceiling so the server bundle can't balloon from a mis-set --limit.
    expect(DIRECTORY.length).toBeLessThanOrEqual(2100);
  });

  it("every provider is placeable: ZIP is exactly 5 US digits (US-ZIP gate holds)", () => {
    const bad = DIRECTORY.filter((r) => !/^\d{5}$/.test(r.zip));
    expect(bad.map((r) => `${r.npi}:${r.zip}`)).toEqual([]);
  });

  it("every provider carries a 10-digit NPI and a numeric graphScore", () => {
    for (const r of DIRECTORY) {
      expect(r.npi, r.npi).toMatch(/^\d{10}$/);
      expect(Number.isFinite(r.graphScore), r.npi).toBe(true);
    }
  });

  it("covers a near-national ZIP-3 footprint", () => {
    const zip3 = new Set(DIRECTORY.map((r) => r.zip.slice(0, 3)));
    // ~930 real US ZIP-3 prefixes today; floor at 900 so a refresh has headroom
    // but a coverage regression (e.g. dropping --coverage) is caught.
    expect(zip3.size).toBeGreaterThanOrEqual(900);
  });

  it("spans all 50 states + DC", () => {
    const states = new Set(DIRECTORY.map((r) => r.state));
    const missing = FIFTY_STATES.filter((s) => !states.has(s));
    expect(missing).toEqual([]);
    expect(states.has("DC")).toBe(true);
  });

  it("retains menopause-certified providers (the demo personas at minimum)", () => {
    const certified = DIRECTORY.filter((r) => r.menopauseCertified);
    expect(certified.length).toBeGreaterThanOrEqual(7);
    // Certified rows are placeable too (the gate runs before keep-all-certified).
    expect(certified.every((r) => /^\d{5}$/.test(r.zip))).toBe(true);
  });

  it("keeps a self-reported certified cohort (national NPPES detection contributed)", () => {
    // The committed artifact is overlay (7 demo NPIs) + self-reported MSCP/NCMP
    // providers found in the national run. If a refresh dropped every
    // self-reporter, the overlay personas alone would keep the >= 7 floor green
    // and hide the regression — so assert the non-overlay certified cohort is
    // non-empty directly on the shipped data.
    const certified = DIRECTORY.filter((r) => r.menopauseCertified);
    const selfReported = certified.filter((r) => !MSCP_OVERLAY_NPIS.has(r.npi));
    expect(selfReported.length).toBeGreaterThan(0);
  });

  it("sidecar metadata mirrors the array (no drift)", () => {
    const p = generatedMeta.providers;
    expect(p.total).toBe(DIRECTORY.length);
    expect(p.certified).toBe(DIRECTORY.filter((r) => r.menopauseCertified).length);
    expect(p.zip3Prefixes).toBe(new Set(DIRECTORY.map((r) => r.zip.slice(0, 3))).size);
    expect(p.states).toBe(new Set(DIRECTORY.map((r) => r.state)).size);
  });
});
