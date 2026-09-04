import { describe, expect, it } from "vitest";

import {
  DEMO_BALANCE_BILLING_ANCILLARY_REQUEST,
  DEMO_BALANCE_BILLING_GROUND_AMBULANCE_REQUEST,
  DEMO_BALANCE_BILLING_REQUEST,
  DEMO_BALANCE_BILLING_WAIVER_REQUEST,
  PROTECTION_BASES,
  balanceBillBasisCited,
  balanceBillCostShareInNetwork,
  balanceBillProhibitionHonored,
  balanceBillingSummary,
  evaluateBalanceBilling,
  getProtectionBasis,
  isProtectionBasis
} from "./balance-billing";

describe("balance-billing protection-basis catalog", () => {
  it("exposes recognized bases with unique ids", () => {
    const ids = PROTECTION_BASES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isProtectionBasis(id)).toBe(true);
    expect(isProtectionBasis("basis.we-made-this-up")).toBe(false);
    expect(isProtectionBasis(undefined)).toBe(false);
  });

  it("marks emergency, oon-at-innetwork-facility, and air-ambulance protected; ground-ambulance not", () => {
    expect(getProtectionBasis("basis.emergency")!.protected).toBe(true);
    expect(getProtectionBasis("basis.oon-at-innetwork-facility")!.protected).toBe(true);
    expect(getProtectionBasis("basis.air-ambulance")!.protected).toBe(true);
    expect(getProtectionBasis("basis.ground-ambulance")!.protected).toBe(false);
    expect(getProtectionBasis("basis.in-network")!.protected).toBe(false);
    expect(getProtectionBasis("basis.nope")).toBeUndefined();
  });

  it("only makes oon-at-innetwork-facility waivable", () => {
    expect(getProtectionBasis("basis.oon-at-innetwork-facility")!.waivable).toBe(true);
    expect(getProtectionBasis("basis.emergency")!.waivable).toBe(false);
    expect(getProtectionBasis("basis.air-ambulance")!.waivable).toBe(false);
  });
});

describe("evaluateBalanceBilling · protection + cost-share basis", () => {
  it("protects an out-of-network emergency and prohibits balance billing", () => {
    const det = evaluateBalanceBilling(DEMO_BALANCE_BILLING_REQUEST);
    expect(det.protected).toBe(true);
    expect(det.balanceBillProhibited).toBe(true);
    expect(det.costShareBasis).toBe("in-network-qpa");
    expect(det.patientCostShareBasisAmount).toBe(1200);
    expect(det.balanceBillAmount).toBe(0);
    expect(det.balanceBillAllowed).toBe(false);
    expect(det.requiresHumanReview).toBe(false);
  });

  it("cannot waive an ancillary service even when a waiver is claimed", () => {
    const det = evaluateBalanceBilling(DEMO_BALANCE_BILLING_ANCILLARY_REQUEST);
    expect(det.protected).toBe(true);
    expect(det.waiverEffective).toBe(false);
    expect(det.balanceBillProhibited).toBe(true);
    expect(det.costShareBasis).toBe("in-network-qpa");
  });

  it("honors a valid waiver for a non-ancillary service → permitted balance bill requiring review", () => {
    const det = evaluateBalanceBilling(DEMO_BALANCE_BILLING_WAIVER_REQUEST);
    expect(det.protected).toBe(false);
    expect(det.waiverEffective).toBe(true);
    expect(det.balanceBillProhibited).toBe(false);
    expect(det.costShareBasis).toBe("billed-charge");
    expect(det.balanceBillAmount).toBe(1200); // 3000 - 1800
    expect(det.balanceBillAllowed).toBe(true);
    expect(det.requiresHumanReview).toBe(true);
  });

  it("does not protect an out-of-network ground ambulance (NSA gap)", () => {
    const det = evaluateBalanceBilling(DEMO_BALANCE_BILLING_GROUND_AMBULANCE_REQUEST);
    expect(det.protected).toBe(false);
    expect(det.balanceBillProhibited).toBe(false);
    expect(det.balanceBillAmount).toBe(1100); // 1800 - 700
    expect(det.balanceBillAllowed).toBe(true);
    expect(det.requiresHumanReview).toBe(true);
  });

  it("treats an off-catalog basis as un-sourced and not protected", () => {
    const det = evaluateBalanceBilling({
      claimRef: "c",
      patientRef: "p",
      basisId: "basis.made-up",
      serviceType: "x",
      billedCharge: 500,
      inNetworkAllowed: 200
    });
    expect(det.protected).toBe(false);
    expect(det.costShareBasis).toBe("billed-charge");
    expect(balanceBillBasisCited(det)).toBe(false);
  });

  it("is deterministic — the same claim yields the same determination", () => {
    expect(evaluateBalanceBilling(DEMO_BALANCE_BILLING_REQUEST)).toEqual(
      evaluateBalanceBilling(DEMO_BALANCE_BILLING_REQUEST)
    );
  });

  it("always marks the determination synthetic", () => {
    expect(evaluateBalanceBilling(DEMO_BALANCE_BILLING_REQUEST).synthetic).toBe(true);
  });
});

describe("balance-billing honesty guards", () => {
  it("balanceBillBasisCited is true for a catalog basis, false otherwise", () => {
    expect(balanceBillBasisCited(evaluateBalanceBilling(DEMO_BALANCE_BILLING_REQUEST))).toBe(
      true
    );
    expect(balanceBillBasisCited({ basisId: "basis.nope" })).toBe(false);
    expect(balanceBillBasisCited(null)).toBe(false);
  });

  it("balanceBillCostShareInNetwork is false only for a protected claim on the billed-charge basis", () => {
    expect(
      balanceBillCostShareInNetwork(evaluateBalanceBilling(DEMO_BALANCE_BILLING_REQUEST))
    ).toBe(true);
    expect(
      balanceBillCostShareInNetwork({ protected: true, costShareBasis: "billed-charge" })
    ).toBe(false);
    expect(
      balanceBillCostShareInNetwork({ protected: true, costShareBasis: "in-network-qpa" })
    ).toBe(true);
    // A non-protected claim on the billed-charge basis is fine.
    expect(
      balanceBillCostShareInNetwork({ protected: false, costShareBasis: "billed-charge" })
    ).toBe(true);
    expect(balanceBillCostShareInNetwork(null)).toBe(false);
  });

  it("balanceBillProhibitionHonored is false only when a protected claim allows a balance bill", () => {
    expect(
      balanceBillProhibitionHonored(evaluateBalanceBilling(DEMO_BALANCE_BILLING_REQUEST))
    ).toBe(true);
    expect(
      balanceBillProhibitionHonored({ protected: true, balanceBillAllowed: true })
    ).toBe(false);
    expect(
      balanceBillProhibitionHonored({ protected: true, balanceBillAllowed: false })
    ).toBe(true);
    // A non-protected claim may allow a balance bill.
    expect(
      balanceBillProhibitionHonored({ protected: false, balanceBillAllowed: true })
    ).toBe(true);
    expect(balanceBillProhibitionHonored(null)).toBe(false);
  });

  it("balanceBillingSummary carries only structured, PHI-safe fields", () => {
    const summary = balanceBillingSummary(
      evaluateBalanceBilling(DEMO_BALANCE_BILLING_REQUEST)
    );
    expect(summary.claimRef).toBe("bb-claim-001");
    expect(summary.basisId).toBe("basis.emergency");
    expect(summary.protected).toBe(true);
    expect(summary.balanceBillProhibited).toBe(true);
    expect(summary.costShareBasis).toBe("in-network-qpa");
    expect(summary.synthetic).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("note");
  });
});
