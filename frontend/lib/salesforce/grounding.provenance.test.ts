import { describe, it, expect } from "vitest";

import { buildGroundingContext } from "./grounding";
import type { CalculatedInsight, FederatedSource } from "../data-360";

/**
 * Regression guard for the Phase-2 grounding-provenance honesty bug.
 *
 * getWearableInsights (data-cloud.ts) returns a NON-null object
 * { hrv, vasomotor, sleep } whenever Data Cloud is configured — each field
 * is independently null when that Calculated Insight returns no rows. The
 * old buildGroundingContext keyed its Phase-2 label + wearable sourcesQueried
 * on `wearable` being truthy, so a configured-but-empty Data Cloud made the
 * grounding trace advertise "Data Cloud Calculated Insights (HRV/vasomotor/
 * sleep)" and list dbdp-wearable-features + jupyterhealth-fhir as queried —
 * while every insight had actually fallen back to the intake baseline.
 *
 * The fix keys provenance on whether any CI actually returned data and names
 * only the live ones. These tests pin that.
 */

function contact() {
  return {
    Id: "003000000000001",
    FirstName: "Demo",
    LastName: "Patient",
    Description:
      "Age band: 46-50\nPrimary symptom: Hot flashes\nVasomotor: 7/10\nSleep: 6/10\nMood: 4/10",
    AccountId: null
  };
}

function ci(
  kind: CalculatedInsight["kind"],
  federatedFrom: FederatedSource[]
): CalculatedInsight {
  return {
    id: `insight.${kind}`,
    kind,
    name: `Live ${kind}`,
    description: "live CI",
    value: 42,
    computedAt: new Date().toISOString(),
    sourceWindow: "30d",
    federatedFrom
  };
}

function build(wearable: Parameters<typeof buildGroundingContext>[0]["wearable"]) {
  return buildGroundingContext({
    patientId: "003000000000001",
    contact: contact(),
    enrollee: null,
    carePlan: null,
    latestCase: null,
    cohortSize: 12,
    durationMs: 5,
    wearable
  });
}

describe("buildGroundingContext · Phase-2 provenance honesty", () => {
  it("reports Phase 1 when Data Cloud is not queried at all (wearable = null)", () => {
    const prov = build(null).groundingProvenance;
    expect(prov.federatedQuery).toMatch(/^Phase 1:/);
    expect(prov.sourcesQueried).toEqual([
      "epic-health-cloud",
      "agentforce-intake-history"
    ]);
  });

  it("reports Phase 1 (NOT Phase 2) when Data Cloud returned an all-null object", () => {
    // This is the regression: configured but no CI rows for this patient.
    const prov = build({ hrv: null, vasomotor: null, sleep: null })
      .groundingProvenance;
    expect(prov.federatedQuery).toMatch(/^Phase 1:/);
    expect(prov.federatedQuery).not.toContain("Data Cloud");
    expect(prov.sourcesQueried).not.toContain("dbdp-wearable-features");
    expect(prov.sourcesQueried).not.toContain("jupyterhealth-fhir");
  });

  it("names only the live insight when a single CI returned data", () => {
    const prov = build({
      hrv: null,
      vasomotor: ci("vasomotor-burden", [
        "dbdp-wearable-features",
        "agentforce-intake-history"
      ]),
      sleep: null
    }).groundingProvenance;
    expect(prov.federatedQuery).toBe(
      "Phase 2: SOQL (Health Cloud) + Data Cloud Calculated Insights (vasomotor)"
    );
    // vasomotor's only *new* source is dbdp-wearable-features; jupyterhealth
    // was never queried, so it must not appear.
    expect(prov.sourcesQueried).toContain("dbdp-wearable-features");
    expect(prov.sourcesQueried).not.toContain("jupyterhealth-fhir");
  });

  it("names all live insights and unions their real sources when every CI returned data", () => {
    const prov = build({
      hrv: ci("hrv-variability", ["dbdp-wearable-features", "jupyterhealth-fhir"]),
      vasomotor: ci("vasomotor-burden", [
        "dbdp-wearable-features",
        "agentforce-intake-history"
      ]),
      sleep: ci("sleep-disruption", ["dbdp-wearable-features", "jupyterhealth-fhir"])
    }).groundingProvenance;
    expect(prov.federatedQuery).toBe(
      "Phase 2: SOQL (Health Cloud) + Data Cloud Calculated Insights (HRV/vasomotor/sleep)"
    );
    expect(prov.sourcesQueried).toContain("dbdp-wearable-features");
    expect(prov.sourcesQueried).toContain("jupyterhealth-fhir");
    // Base sources stay first and are not duplicated by the union.
    expect(prov.sourcesQueried[0]).toBe("epic-health-cloud");
    expect(
      prov.sourcesQueried.filter((s) => s === "agentforce-intake-history")
    ).toHaveLength(1);
  });

  it("keeps computedInsightsCount in step with the insight array", () => {
    const ctx = build({ hrv: null, vasomotor: null, sleep: null });
    expect(ctx.groundingProvenance.computedInsightsCount).toBe(
      ctx.calculatedInsights.length
    );
  });
});
