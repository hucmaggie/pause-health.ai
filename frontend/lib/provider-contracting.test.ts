import { describe, expect, it } from "vitest";
import {
  BENCHMARK_METHODOLOGIES,
  CONTRACTING_REASON_CODES,
  CONTRACTING_RULES,
  CONTRACT_TYPES,
  DEMO_CONTRACT_FFS,
  DEMO_CONTRACT_GOOD_STANDING,
  DEMO_CONTRACT_QUALITY_MISS,
  DEMO_CONTRACT_SPEND_DRIFT,
  DEMO_CONTRACT_TERM_CHANGE,
  benchmarksTraceToMethodology,
  computeSpendDrift,
  contractChangeRequiresOwnerCosign,
  contractsTraceToCatalog,
  evaluateContract,
  evaluateContractingRules,
  getBenchmarkMethodology,
  getContractType,
  getContractingRule,
  isBenchmarkMethodology,
  isContractType,
  isContractingReasonCode,
  isContractingRule,
  summarizeContractingDecision
} from "./provider-contracting";

describe("catalogs", () => {
  it("exposes contract-type + methodology + rule + reason catalogs", () => {
    expect(CONTRACT_TYPES.length).toBe(6);
    for (const c of CONTRACT_TYPES) {
      expect(c.id).toMatch(/^contract-type\./);
      expect(c.synthetic).toBe(true);
    }
    expect(BENCHMARK_METHODOLOGIES.length).toBe(4);
    for (const m of BENCHMARK_METHODOLOGIES) {
      expect(m.id).toMatch(/^methodology\./);
      expect(m.qualityGateThreshold).toBeGreaterThan(0);
      expect(m.spendDriftTolerance).toBeGreaterThan(0);
    }
    expect(CONTRACTING_RULES.length).toBe(5);
    expect(CONTRACTING_REASON_CODES.length).toBe(5);
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const c of CONTRACT_TYPES) {
      expect(isContractType(c.id)).toBe(true);
      expect(getContractType(c.id)?.label).toBe(c.label);
    }
    for (const m of BENCHMARK_METHODOLOGIES) {
      expect(isBenchmarkMethodology(m.id)).toBe(true);
      expect(getBenchmarkMethodology(m.id)?.label).toBe(m.label);
    }
    for (const r of CONTRACTING_RULES) {
      expect(isContractingRule(r.id)).toBe(true);
      expect(getContractingRule(r.id)?.label).toBe(r.label);
    }
    expect(isContractType("contract-type.made-up")).toBe(false);
    expect(isBenchmarkMethodology("methodology.made-up")).toBe(false);
    expect(isContractingReasonCode("reason.PC-100")).toBe(true);
    expect(isContractingReasonCode("reason.made-up")).toBe(false);
  });
});

describe("computeSpendDrift", () => {
  it("returns the fractional drift", () => {
    expect(computeSpendDrift(100_00, 105_00)).toBeCloseTo(0.05);
    expect(computeSpendDrift(100_00, 90_00)).toBeCloseTo(-0.1);
  });
  it("returns 0 when benchmark is 0 (avoid div-by-zero)", () => {
    expect(computeSpendDrift(0, 100_00)).toBe(0);
  });
});

describe("evaluateContractingRules", () => {
  it("fires quality-and-spend-in-band for a good-standing VBC", () => {
    const rules = evaluateContractingRules(DEMO_CONTRACT_GOOD_STANDING);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.quality-and-spend-in-band"]);
    expect(rules[0].reasonCode).toBe("reason.PC-100");
  });

  it("fires quality-gate-missed when below threshold", () => {
    const rules = evaluateContractingRules(DEMO_CONTRACT_QUALITY_MISS);
    expect(rules.map((r) => r.ruleId)).toContain("rule.quality-gate-missed");
  });

  it("fires spend-drift-exceeded when above tolerance", () => {
    const rules = evaluateContractingRules(DEMO_CONTRACT_SPEND_DRIFT);
    expect(rules.map((r) => r.ruleId)).toContain("rule.spend-drift-exceeded");
  });

  it("fires term-change-requested when the caller asks", () => {
    const rules = evaluateContractingRules(DEMO_CONTRACT_TERM_CHANGE);
    expect(rules.map((r) => r.ruleId)).toContain("rule.term-change-requested");
    expect(rules.map((r) => r.reasonCode)).toContain("reason.PC-300");
  });

  it("fires non-catalog-contract for an off-catalog contract type", () => {
    const rules = evaluateContractingRules({
      ...DEMO_CONTRACT_GOOD_STANDING,
      contractTypeId: "contract-type.made-up"
    });
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.non-catalog-contract"]);
  });

  it("fires quality-and-spend-in-band for a non-VBC FFS contract with no term change", () => {
    const rules = evaluateContractingRules(DEMO_CONTRACT_FFS);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.quality-and-spend-in-band"]);
  });

  it("sorts applied rules by ruleId ascending", () => {
    const rules = evaluateContractingRules({
      ...DEMO_CONTRACT_QUALITY_MISS,
      actualSpendCents: 300_000_00, // also spend drift
      requestsTermChange: true
    });
    const ids = rules.map((r) => r.ruleId);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("summarizeContractingDecision", () => {
  it("in-good-standing when no rules", () => {
    const s = summarizeContractingDecision([]);
    expect(s.decision).toBe("in-good-standing");
    expect(s.routedTo).toBe("auto-continue");
  });

  it("blocked-non-catalog-contract wins over draft-term-change", () => {
    const rules = [
      {
        ruleId: "rule.term-change-requested",
        ruleLabel: "x",
        reasonCode: "reason.PC-300",
        reasonLabel: "y",
        detail: "z"
      },
      {
        ruleId: "rule.non-catalog-contract",
        ruleLabel: "x",
        reasonCode: "reason.PC-400",
        reasonLabel: "y",
        detail: "z"
      }
    ];
    const s = summarizeContractingDecision(rules);
    expect(s.decision).toBe("blocked-non-catalog-contract");
    expect(s.routedTo).toBe("blocked-hold");
  });

  it("draft-term-change wins over benchmark-drift-review", () => {
    const rules = evaluateContractingRules({
      ...DEMO_CONTRACT_QUALITY_MISS,
      requestsTermChange: true
    });
    const s = summarizeContractingDecision(rules);
    expect(s.decision).toBe("draft-term-change");
    expect(s.routedTo).toBe("account-owner-cosign");
  });
});

describe("evaluateContract", () => {
  it("is deterministic", () => {
    expect(evaluateContract(DEMO_CONTRACT_GOOD_STANDING)).toEqual(
      evaluateContract(DEMO_CONTRACT_GOOD_STANDING)
    );
  });

  it("in-good-standing marks qualityGateMet + no cosign", () => {
    const d = evaluateContract(DEMO_CONTRACT_GOOD_STANDING);
    expect(d.decision).toBe("in-good-standing");
    expect(d.qualityGateMet).toBe(true);
    expect(d.requiresAccountOwnerCosign).toBe(false);
    expect(d.cosigned).toBe(false);
    expect(d.routedTo).toBe("auto-continue");
  });

  it("quality-miss routes to benchmark-drift-review", () => {
    const d = evaluateContract(DEMO_CONTRACT_QUALITY_MISS);
    expect(d.decision).toBe("benchmark-drift-review");
    expect(d.qualityGateMet).toBe(false);
    expect(d.routedTo).toBe("account-manager-drift-review");
  });

  it("spend-drift routes to benchmark-drift-review with drift computed", () => {
    const d = evaluateContract(DEMO_CONTRACT_SPEND_DRIFT);
    expect(d.decision).toBe("benchmark-drift-review");
    expect(d.spendDriftFraction).toBeGreaterThan(0.05);
  });

  it("term-change drafts and requires account-owner cosign", () => {
    const d = evaluateContract(DEMO_CONTRACT_TERM_CHANGE);
    expect(d.decision).toBe("draft-term-change");
    expect(d.requiresAccountOwnerCosign).toBe(true);
    expect(d.cosigned).toBe(false);
    expect(d.routedTo).toBe("account-owner-cosign");
  });

  it("blocked-non-catalog-contract routes to blocked-hold", () => {
    const d = evaluateContract({
      ...DEMO_CONTRACT_GOOD_STANDING,
      contractTypeId: "contract-type.made-up"
    });
    expect(d.decision).toBe("blocked-non-catalog-contract");
    expect(d.routedTo).toBe("blocked-hold");
  });

  it("non-VBC FFS contract with no term-change lands in-good-standing", () => {
    const d = evaluateContract(DEMO_CONTRACT_FFS);
    expect(d.decision).toBe("in-good-standing");
    expect(d.qualityGateMet).toBe(true);
  });
});

describe("governance signals", () => {
  const good = evaluateContract(DEMO_CONTRACT_GOOD_STANDING);
  const qMiss = evaluateContract(DEMO_CONTRACT_QUALITY_MISS);
  const term = evaluateContract(DEMO_CONTRACT_TERM_CHANGE);
  const ffs = evaluateContract(DEMO_CONTRACT_FFS);

  it("contractsTraceToCatalog: true for produced decisions", () => {
    expect(contractsTraceToCatalog(good)).toBe(true);
    expect(contractsTraceToCatalog(qMiss)).toBe(true);
    expect(contractsTraceToCatalog(term)).toBe(true);
    expect(contractsTraceToCatalog(ffs)).toBe(true);
    expect(
      contractsTraceToCatalog({
        contractTypeId: "contract-type.made-up",
        methodologyId: "methodology.ma-star-vbc-my2026",
        appliedRules: []
      })
    ).toBe(false);
    expect(
      contractsTraceToCatalog({
        ...good,
        appliedRules: [{ ruleId: "rule.made-up", reasonCode: "reason.PC-100" }]
      })
    ).toBe(false);
    expect(contractsTraceToCatalog(null)).toBe(false);
  });

  it("contractChangeRequiresOwnerCosign: true for non-term-change / properly-gated term-change, false when bypassed", () => {
    expect(contractChangeRequiresOwnerCosign(good)).toBe(true); // non-term-change trivially safe
    expect(contractChangeRequiresOwnerCosign(term)).toBe(true);
    expect(
      contractChangeRequiresOwnerCosign({ ...term, cosigned: true as unknown as false })
    ).toBe(false);
    expect(
      contractChangeRequiresOwnerCosign({ ...term, requiresAccountOwnerCosign: false })
    ).toBe(false);
    expect(contractChangeRequiresOwnerCosign(null)).toBe(false);
  });

  it("benchmarksTraceToMethodology: true for produced decisions, false when caller drifts", () => {
    expect(benchmarksTraceToMethodology(good)).toBe(true);
    expect(benchmarksTraceToMethodology(qMiss)).toBe(true);
    expect(
      benchmarksTraceToMethodology({
        methodologyId: "methodology.ma-star-vbc-my2026",
        qualityGateThreshold: 0.5, // catalog says 0.75
        spendDriftTolerance: 0.03
      })
    ).toBe(false);
    expect(
      benchmarksTraceToMethodology({
        methodologyId: "methodology.made-up",
        qualityGateThreshold: 0.75,
        spendDriftTolerance: 0.03
      })
    ).toBe(false);
    expect(benchmarksTraceToMethodology(null)).toBe(false);
  });
});
