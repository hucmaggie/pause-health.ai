import { describe, expect, it } from "vitest";

import {
  CHARGE_MASTER,
  DEMO_GFE_IMAGING_REQUEST,
  DEMO_GFE_REQUEST,
  EXPECTED_COITEMS,
  GFE_DISPUTE_THRESHOLD,
  evaluateGoodFaithEstimate,
  expectedItemsFor,
  getServiceCode,
  gfeChargeMasterSourced,
  gfeEstimateNotBinding,
  gfeExpectedItemsComplete,
  goodFaithEstimateSummary,
  isServiceCode
} from "./good-faith-estimate";

describe("good-faith-estimate charge master", () => {
  it("exposes recognized service ids with unique entries", () => {
    const ids = CHARGE_MASTER.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isServiceCode(id)).toBe(true);
    expect(isServiceCode("svc.we-made-this-up")).toBe(false);
    expect(isServiceCode(undefined)).toBe(false);
  });

  it("keeps every expected co-item pointing at a real charge-master service", () => {
    for (const [primary, coItems] of Object.entries(EXPECTED_COITEMS)) {
      expect(isServiceCode(primary)).toBe(true);
      for (const co of coItems) expect(isServiceCode(co)).toBe(true);
    }
  });

  it("builds the expected-item set as the primary + its co-items", () => {
    expect(expectedItemsFor("svc.menopause-consult-comprehensive")).toEqual([
      "svc.menopause-consult-comprehensive",
      "svc.lab-panel-hormone"
    ]);
    // A primary with no configured co-items expects only itself.
    expect(expectedItemsFor("svc.hrt-injection-admin")).toEqual(["svc.hrt-injection-admin"]);
  });
});

describe("evaluateGoodFaithEstimate · pricing", () => {
  it("prices a complete consult estimate from the charge master", () => {
    const det = evaluateGoodFaithEstimate(DEMO_GFE_REQUEST);
    expect(det.totalEstimate).toBe(580);
    expect(det.allLineItemsSourced).toBe(true);
    expect(det.expectedItemsComplete).toBe(true);
    expect(det.missingExpectedItems).toEqual([]);
    expect(det.binding).toBe(false);
    expect(det.requiresPatientConfirmation).toBe(true);
    expect(det.disputeThreshold).toBe(GFE_DISPUTE_THRESHOLD);
  });

  it("prices a complete imaging estimate (DEXA + expected office visit)", () => {
    const det = evaluateGoodFaithEstimate(DEMO_GFE_IMAGING_REQUEST);
    expect(det.totalEstimate).toBe(470);
    expect(det.expectedItemsComplete).toBe(true);
  });

  it("honors quantity when summing a line item", () => {
    const det = evaluateGoodFaithEstimate({
      patientRef: "p",
      providerRef: "d",
      primaryServiceId: "svc.hrt-injection-admin",
      lineItems: [{ serviceId: "svc.hrt-injection-admin", quantity: 3 }]
    });
    expect(det.totalEstimate).toBe(270);
    expect(getServiceCode("svc.hrt-injection-admin")!.amount).toBe(90);
  });

  it("flags a missing reasonably-expected co-item", () => {
    const det = evaluateGoodFaithEstimate({
      patientRef: "p",
      providerRef: "d",
      primaryServiceId: "svc.menopause-consult-comprehensive",
      lineItems: [{ serviceId: "svc.menopause-consult-comprehensive", quantity: 1 }]
    });
    expect(det.expectedItemsComplete).toBe(false);
    expect(det.missingExpectedItems).toContain("svc.lab-panel-hormone");
  });

  it("flags an off-catalog line item as un-sourced (priced 0)", () => {
    const det = evaluateGoodFaithEstimate({
      patientRef: "p",
      providerRef: "d",
      primaryServiceId: "svc.menopause-consult-comprehensive",
      lineItems: [
        { serviceId: "svc.menopause-consult-comprehensive", quantity: 1 },
        { serviceId: "svc.lab-panel-hormone", quantity: 1 },
        { serviceId: "svc.unknown", quantity: 1 }
      ]
    });
    expect(det.allLineItemsSourced).toBe(false);
    expect(det.lineItems.find((li) => li.serviceId === "svc.unknown")?.lineTotal).toBe(0);
  });

  it("is deterministic — the same request yields the same estimate", () => {
    expect(evaluateGoodFaithEstimate(DEMO_GFE_REQUEST)).toEqual(
      evaluateGoodFaithEstimate(DEMO_GFE_REQUEST)
    );
  });
});

describe("good-faith-estimate honesty guards", () => {
  it("gfeChargeMasterSourced is false when a line item isn't charge-master-sourced", () => {
    expect(gfeChargeMasterSourced(evaluateGoodFaithEstimate(DEMO_GFE_REQUEST))).toBe(true);
    // Off-catalog service id.
    expect(
      gfeChargeMasterSourced({ lineItems: [{ serviceId: "svc.nope", unitAmount: 10 }] })
    ).toBe(false);
    // A mismatched amount for a real service is not sourced.
    expect(
      gfeChargeMasterSourced({
        lineItems: [{ serviceId: "svc.lab-panel-hormone", unitAmount: 999 }]
      })
    ).toBe(false);
    // Empty line items is a violation.
    expect(gfeChargeMasterSourced({ lineItems: [] })).toBe(false);
    expect(gfeChargeMasterSourced(null)).toBe(false);
  });

  it("gfeExpectedItemsComplete is false when an expected item is missing", () => {
    expect(gfeExpectedItemsComplete(evaluateGoodFaithEstimate(DEMO_GFE_REQUEST))).toBe(true);
    expect(
      gfeExpectedItemsComplete({
        primaryServiceId: "svc.menopause-consult-comprehensive",
        lineItems: [{ serviceId: "svc.menopause-consult-comprehensive" }]
      })
    ).toBe(false);
    expect(gfeExpectedItemsComplete(null)).toBe(false);
  });

  it("gfeEstimateNotBinding is false only for a determination asserted as a binding bill", () => {
    expect(gfeEstimateNotBinding(evaluateGoodFaithEstimate(DEMO_GFE_REQUEST))).toBe(true);
    expect(gfeEstimateNotBinding({ binding: true })).toBe(false);
    expect(gfeEstimateNotBinding({ binding: false })).toBe(true);
    expect(gfeEstimateNotBinding(null)).toBe(false);
  });

  it("goodFaithEstimateSummary carries only structured, PHI-safe fields", () => {
    const summary = goodFaithEstimateSummary(evaluateGoodFaithEstimate(DEMO_GFE_REQUEST));
    expect(summary.patientRef).toBe("gfe-patient-001");
    expect(summary.primaryServiceId).toBe("svc.menopause-consult-comprehensive");
    expect(summary.totalEstimate).toBe(580);
    expect(summary.binding).toBe(false);
    expect(summary.synthetic).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("note");
  });
});
