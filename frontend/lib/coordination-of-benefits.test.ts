import { describe, expect, it } from "vitest";

import {
  COB_RULES,
  DEMO_COB_BIRTHDAY_REQUEST,
  DEMO_COB_DECREE_REQUEST,
  DEMO_COB_MSP_REQUEST,
  DEMO_COB_REQUEST,
  cobDecreeHonored,
  cobHumanCosigned,
  cobRuleCited,
  cobSummary,
  evaluateCoordinationOfBenefits,
  isCobRule
} from "./coordination-of-benefits";

describe("coordination-of-benefits catalog", () => {
  it("exposes recognized COB rule ids with unique entries", () => {
    const ids = COB_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isCobRule(id)).toBe(true);
    expect(isCobRule("rule.cob.we-just-picked")).toBe(false);
    expect(isCobRule(undefined)).toBe(false);
  });
});

describe("evaluateCoordinationOfBenefits · order-of-benefits rules", () => {
  it("orders a subscriber plan before a dependent plan (subscriber-before-dependent)", () => {
    const det = evaluateCoordinationOfBenefits(DEMO_COB_REQUEST);
    expect(det.primaryCoverageId).toBe("coverage-own-ppo");
    expect(det.orderedCoverages[0].decidingRuleId).toBe(
      "rule.cob.subscriber-before-dependent"
    );
    expect(det.requiresHumanCosign).toBe(true);
    expect(det.custodyDecreeApplied).toBe(false);
  });

  it("applies the birthday rule for a dependent child under both parents", () => {
    const det = evaluateCoordinationOfBenefits(DEMO_COB_BIRTHDAY_REQUEST);
    // Mother's birthday 03-14 is earlier in the year than father's 06-20.
    expect(det.primaryCoverageId).toBe("coverage-mom-ppo");
    expect(det.orderedCoverages[0].decidingRuleId).toBe("rule.cob.birthday-rule");
    expect(det.custodyDecreeApplied).toBe(false);
  });

  it("lets a custody decree override the birthday rule", () => {
    const det = evaluateCoordinationOfBenefits(DEMO_COB_DECREE_REQUEST);
    // The decree names the father's plan primary even though mother's birthday wins.
    expect(det.primaryCoverageId).toBe("coverage-dad-hmo");
    expect(det.orderedCoverages[0].decidingRuleId).toBe(
      "rule.cob.custody-decree-overrides-birthday"
    );
    expect(det.custodyDecreeApplied).toBe(true);
  });

  it("makes the active-employment group plan primary over Medicare (MSP)", () => {
    const det = evaluateCoordinationOfBenefits(DEMO_COB_MSP_REQUEST);
    expect(det.primaryCoverageId).toBe("coverage-employer-group");
    expect(det.orderedCoverages[1].coverageId).toBe("coverage-medicare-a-b");
    expect(det.citedRuleIds).toContain("rule.cob.medicare-secondary-payer");
  });

  it("treats a sole coverage as primary by default", () => {
    const det = evaluateCoordinationOfBenefits({
      patientRef: "cob-solo",
      isDependentChild: false,
      coverages: [DEMO_COB_REQUEST.coverages[0]],
      atTime: "2026-03-01T00:00:00Z"
    });
    expect(det.orderedCoverages).toHaveLength(1);
    expect(det.orderedCoverages[0].decidingRuleId).toBe("rule.cob.sole-coverage-primary");
  });

  it("handles no coverage on file without inventing a rule", () => {
    const det = evaluateCoordinationOfBenefits({
      patientRef: "cob-none",
      isDependentChild: false,
      coverages: [],
      atTime: "2026-03-01T00:00:00Z"
    });
    expect(det.orderedCoverages).toHaveLength(0);
    expect(det.primaryCoverageId).toBe("");
    // Vacuously rule-sourced (nothing was ordered on an un-sourced rule).
    expect(cobRuleCited(det)).toBe(true);
  });

  it("is deterministic — the same request yields the same order + cited rules", () => {
    const a = evaluateCoordinationOfBenefits(DEMO_COB_MSP_REQUEST);
    const b = evaluateCoordinationOfBenefits(DEMO_COB_MSP_REQUEST);
    expect(a).toEqual(b);
  });

  it("cites a recorded COB rule for every ordered coverage", () => {
    for (const req of [
      DEMO_COB_REQUEST,
      DEMO_COB_BIRTHDAY_REQUEST,
      DEMO_COB_DECREE_REQUEST,
      DEMO_COB_MSP_REQUEST
    ]) {
      const det = evaluateCoordinationOfBenefits(req);
      for (const c of det.orderedCoverages) expect(isCobRule(c.decidingRuleId)).toBe(true);
    }
  });
});

describe("coordination-of-benefits honesty guards", () => {
  it("cobRuleCited is true for produced determinations, false for an off-catalog rule", () => {
    expect(cobRuleCited(evaluateCoordinationOfBenefits(DEMO_COB_REQUEST))).toBe(true);
    expect(
      cobRuleCited({
        orderedCoverages: [
          { coverageId: "x", payerName: "X", planType: "commercial-group", role: "subscriber", rank: 1, decidingRuleId: "rule.cob.we-just-picked", decidingRuleLabel: "" }
        ]
      })
    ).toBe(false);
    expect(cobRuleCited(null)).toBe(false);
  });

  it("cobDecreeHonored is true when the decree-named plan is primary, false when ignored", () => {
    expect(cobDecreeHonored(evaluateCoordinationOfBenefits(DEMO_COB_DECREE_REQUEST))).toBe(
      true
    );
    expect(
      cobDecreeHonored({
        isDependentChild: true,
        custodyDecreePrimaryCoverageId: "coverage-dad-hmo",
        primaryCoverageId: "coverage-mom-ppo"
      })
    ).toBe(false);
    // No decree on file → nothing to honor.
    expect(
      cobDecreeHonored({
        isDependentChild: true,
        custodyDecreePrimaryCoverageId: undefined,
        primaryCoverageId: "coverage-mom-ppo"
      })
    ).toBe(true);
    expect(cobDecreeHonored(null)).toBe(false);
  });

  it("cobHumanCosigned is true only when requiresHumanCosign is true", () => {
    expect(cobHumanCosigned({ requiresHumanCosign: true })).toBe(true);
    expect(cobHumanCosigned({ requiresHumanCosign: false })).toBe(false);
    expect(cobHumanCosigned(null)).toBe(false);
  });

  it("cobSummary carries only structured, PHI-safe fields", () => {
    const summary = cobSummary(evaluateCoordinationOfBenefits(DEMO_COB_MSP_REQUEST));
    expect(summary.primaryCoverageId).toBe("coverage-employer-group");
    expect(summary.order.map((o) => o.rank)).toEqual([1, 2]);
    expect(summary.requiresHumanCosign).toBe(true);
    expect(summary.synthetic).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("subscriberBirthday");
  });
});
