import { describe, expect, it } from "vitest";
import { DEMO_COHORT, personaToCareRouterIntake } from "./demo-cohort";
import { queryProviderDirectory } from "./mulesoft-mocks";

/**
 * Tests for the demo cohort's patientZip wiring.
 *
 * The Care Router geo-narrows MSCP provider recommendations on the
 * patient's ZIP. For the demo to actually show a *local* specialist (not
 * a top-national fallback), every persona's synthetic ZIP must share a
 * 3-digit prefix with at least one MSCP-credentialed provider in the
 * NPPES-derived directory. These tests pin that invariant so a future
 * directory regen or persona edit can't silently break the demo.
 */

describe("demo cohort · patientZip", () => {
  it("every persona has a 5-digit ZIP", () => {
    for (const p of DEMO_COHORT) {
      expect(p.patientZip, p.id).toMatch(/^\d{5}$/);
    }
  });

  it("personaToCareRouterIntake forwards the patient ZIP", () => {
    for (const p of DEMO_COHORT) {
      expect(personaToCareRouterIntake(p).patientZip).toBe(p.patientZip);
    }
  });

  it("each persona ZIP resolves to a local MSCP-certified provider", () => {
    for (const p of DEMO_COHORT) {
      const local = queryProviderDirectory({
        zip: p.patientZip,
        menopauseOnly: true
      });
      expect(
        local.providers.length,
        `${p.id} (${p.patientZip}) should have >=1 local certified provider`
      ).toBeGreaterThan(0);
      for (const provider of local.providers) {
        expect(provider.zip.slice(0, 3)).toBe(p.patientZip.slice(0, 3));
        expect(provider.menopauseCertified).toBe(true);
      }
    }
  });

  it("each persona has a canonical insurance plan", () => {
    const canonical = new Set([
      "medicare",
      "medicaid",
      "aetna",
      "bcbs",
      "uhc",
      "cigna",
      "humana",
      "kaiser"
    ]);
    for (const p of DEMO_COHORT) {
      expect(canonical.has(p.patientInsurance), `${p.id} insurance "${p.patientInsurance}" not canonical`).toBe(true);
    }
  });

  it("personaToCareRouterIntake forwards the patient insurance plan", () => {
    for (const p of DEMO_COHORT) {
      expect(personaToCareRouterIntake(p).patientInsurance).toBe(p.patientInsurance);
    }
  });

  it("each persona's plan resolves to a local certified provider that accepts it", () => {
    // The synthetic insuranceAccepted derivation can drift on regen, so this
    // test pins the demo invariant: filtering the patient's local certified
    // providers by their plan must STILL yield a non-empty list. If a future
    // hash change breaks this, the persona's plan needs to be re-picked from
    // the local provider's accepted list — never the other way around.
    for (const p of DEMO_COHORT) {
      const filtered = queryProviderDirectory({
        zip: p.patientZip,
        menopauseOnly: true,
        insurance: p.patientInsurance
      });
      expect(
        filtered.providers.length,
        `${p.id} (${p.patientZip}, ${p.patientInsurance}) — pick a plan their local provider accepts`
      ).toBeGreaterThan(0);
      for (const provider of filtered.providers) {
        expect(provider.insuranceAccepted ?? []).toContain(p.patientInsurance);
      }
    }
  });
});
