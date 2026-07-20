import { describe, expect, it } from "vitest";
import {
  DEMO_UR_APPROVE,
  DEMO_UR_NON_COVERED,
  DEMO_UR_P2P,
  DEMO_UR_PEND,
  DEMO_UR_URGENT_PEND,
  UR_REASON_CODES,
  UR_RULES,
  UR_SERVICE_TYPES,
  UR_SLA_WINDOW_HOURS,
  computeSlaDeadline,
  criteriaTraceToCatalog,
  denialRequiresClinicianCosign,
  evaluateUrRules,
  getUrRule,
  getUrServiceType,
  isUrCriterion,
  isUrReasonCode,
  isUrRule,
  isUrServiceType,
  isUrgencyLevel,
  reviewUtilization,
  slaTracesToCatalog,
  summarizeUrDecision
} from "./utilization-review";

describe("catalogs", () => {
  it("exposes service-type + rule + reason catalogs", () => {
    expect(UR_SERVICE_TYPES.length).toBe(5);
    for (const s of UR_SERVICE_TYPES) {
      expect(s.id).toMatch(/^service\./);
      expect(s.synthetic).toBe(true);
    }
    expect(UR_RULES.length).toBe(5);
    expect(UR_REASON_CODES.length).toBe(4);
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const s of UR_SERVICE_TYPES) {
      expect(isUrServiceType(s.id)).toBe(true);
      expect(getUrServiceType(s.id)?.label).toBe(s.label);
      for (const c of s.criteria) {
        expect(isUrCriterion(c.id)).toBe(true);
      }
    }
    for (const r of UR_RULES) {
      expect(isUrRule(r.id)).toBe(true);
      expect(getUrRule(r.id)?.label).toBe(r.label);
    }
    expect(isUrServiceType("service.made-up")).toBe(false);
    expect(isUrRule("rule.made-up")).toBe(false);
    expect(isUrReasonCode("reason.UR-100")).toBe(true);
    expect(isUrReasonCode("reason.made-up")).toBe(false);
    expect(isUrgencyLevel("standard")).toBe(true);
    expect(isUrgencyLevel("banana")).toBe(false);
  });

  it("SLA window hours are illustrative CMS timelines", () => {
    expect(UR_SLA_WINDOW_HOURS.standard).toBe(72);
    expect(UR_SLA_WINDOW_HOURS.urgent).toBe(24);
    expect(UR_SLA_WINDOW_HOURS["concurrent-review"]).toBe(24);
  });
});

describe("evaluateUrRules", () => {
  it("fires all-required-met for a full evidence case", () => {
    const rules = evaluateUrRules(DEMO_UR_APPROVE);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.all-required-met"]);
    expect(rules[0].reasonCode).toBe("reason.UR-100");
  });

  it("fires missing-required + sla for a partial-evidence pend", () => {
    const rules = evaluateUrRules(DEMO_UR_PEND);
    const ids = rules.map((r) => r.ruleId);
    expect(ids).toContain("rule.missing-required-criterion");
    expect(ids).toContain("rule.sla-window-required");
    expect(ids).toEqual([...ids].sort());
  });

  it("fires partial-p2p + sla when provider requests peer-to-peer", () => {
    const rules = evaluateUrRules(DEMO_UR_P2P);
    const ids = rules.map((r) => r.ruleId);
    expect(ids).toContain("rule.partial-criteria-p2p");
    expect(ids).toContain("rule.sla-window-required");
  });

  it("fires non-covered exclusively for a non-covered service", () => {
    const rules = evaluateUrRules(DEMO_UR_NON_COVERED);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.non-covered-service"]);
    expect(rules[0].reasonCode).toBe("reason.UR-300");
  });
});

describe("summarizeUrDecision", () => {
  it("approves-meets-criteria when no rules", () => {
    const s = summarizeUrDecision([]);
    expect(s.decision).toBe("approves-meets-criteria");
    expect(s.routedTo).toBe("auto-approve");
  });

  it("non-covered wins over pend-for-clinical-review", () => {
    const rules = [
      ...evaluateUrRules(DEMO_UR_PEND),
      ...evaluateUrRules(DEMO_UR_NON_COVERED)
    ];
    const s = summarizeUrDecision(rules);
    expect(s.decision).toBe("blocked-non-covered");
    expect(s.routedTo).toBe("blocked-non-covered-appeal");
  });

  it("peer-to-peer wins over pend-for-clinical-review", () => {
    const rules = [
      {
        ruleId: "rule.missing-required-criterion",
        ruleLabel: "x",
        reasonCode: "reason.UR-200",
        reasonLabel: "y",
        detail: "z"
      },
      {
        ruleId: "rule.partial-criteria-p2p",
        ruleLabel: "x",
        reasonCode: "reason.UR-201",
        reasonLabel: "y",
        detail: "z"
      }
    ];
    const s = summarizeUrDecision(rules);
    expect(s.decision).toBe("require-peer-to-peer");
    expect(s.routedTo).toBe("peer-to-peer-scheduling");
  });
});

describe("computeSlaDeadline", () => {
  it("adds the urgency-window hours to the asOfDate", () => {
    const deadline = computeSlaDeadline("2026-07-05T00:00:00.000Z", "standard");
    expect(deadline).toBe("2026-07-08T00:00:00.000Z"); // +72h
    const urgent = computeSlaDeadline("2026-07-05T00:00:00.000Z", "urgent");
    expect(urgent).toBe("2026-07-06T00:00:00.000Z"); // +24h
  });
});

describe("reviewUtilization", () => {
  it("is deterministic", () => {
    expect(reviewUtilization(DEMO_UR_APPROVE)).toEqual(reviewUtilization(DEMO_UR_APPROVE));
  });

  it("approves-meets-criteria with met criteria populated and no missing", () => {
    const d = reviewUtilization(DEMO_UR_APPROVE);
    expect(d.decision).toBe("approves-meets-criteria");
    expect(d.criteriaMet.length).toBeGreaterThan(0);
    expect(d.criteriaMissing).toEqual([]);
    expect(d.requiresClinicianCosign).toBe(false);
    expect(d.cosigned).toBe(false);
    expect(d.routedTo).toBe("auto-approve");
    expect(d.slaWindowHours).toBe(72);
  });

  it("pend-for-clinical-review lists missing required criteria and requires cosign", () => {
    const d = reviewUtilization(DEMO_UR_PEND);
    expect(d.decision).toBe("pend-for-clinical-review");
    expect(d.criteriaMissing).toContain("criterion.hyst.first-line-failed");
    expect(d.requiresClinicianCosign).toBe(true);
    expect(d.routedTo).toBe("clinical-reviewer-queue");
  });

  it("require-peer-to-peer when provider requests it and partial met", () => {
    const d = reviewUtilization(DEMO_UR_P2P);
    expect(d.decision).toBe("require-peer-to-peer");
    expect(d.routedTo).toBe("peer-to-peer-scheduling");
    expect(d.slaWindowHours).toBe(24);
  });

  it("blocked-non-covered for the illustrative cosmetic service", () => {
    const d = reviewUtilization(DEMO_UR_NON_COVERED);
    expect(d.decision).toBe("blocked-non-covered");
    expect(d.routedTo).toBe("blocked-non-covered-appeal");
  });

  it("SLA deadline traces to asOfDate + urgency window", () => {
    const d = reviewUtilization(DEMO_UR_URGENT_PEND);
    expect(d.decision).toBe("pend-for-clinical-review");
    expect(d.slaWindowHours).toBe(24);
    expect(d.slaDeadline).toBe(computeSlaDeadline(d.asOfDate, "urgent"));
  });
});

describe("governance signals", () => {
  const approved = reviewUtilization(DEMO_UR_APPROVE);
  const pend = reviewUtilization(DEMO_UR_PEND);
  const p2p = reviewUtilization(DEMO_UR_P2P);
  const blocked = reviewUtilization(DEMO_UR_NON_COVERED);

  it("criteriaTraceToCatalog: true for produced decisions", () => {
    expect(criteriaTraceToCatalog(approved)).toBe(true);
    expect(criteriaTraceToCatalog(pend)).toBe(true);
    expect(criteriaTraceToCatalog(p2p)).toBe(true);
    expect(criteriaTraceToCatalog(blocked)).toBe(true);
    expect(
      criteriaTraceToCatalog({
        serviceTypeId: "service.made-up",
        criteriaMet: [],
        criteriaMissing: [],
        appliedRules: []
      })
    ).toBe(false);
    expect(
      criteriaTraceToCatalog({
        ...approved,
        appliedRules: [{ ruleId: "rule.made-up", reasonCode: "reason.UR-100" }]
      })
    ).toBe(false);
    expect(
      criteriaTraceToCatalog({
        ...approved,
        criteriaMet: ["criterion.made-up"] as unknown as string[]
      })
    ).toBe(false);
    expect(criteriaTraceToCatalog(null)).toBe(false);
  });

  it("denialRequiresClinicianCosign: true when properly gated, false when bypassed", () => {
    expect(denialRequiresClinicianCosign(approved)).toBe(true);
    expect(denialRequiresClinicianCosign(pend)).toBe(true);
    expect(denialRequiresClinicianCosign(p2p)).toBe(true);
    expect(denialRequiresClinicianCosign(blocked)).toBe(true);
    expect(
      denialRequiresClinicianCosign({ ...pend, cosigned: true as unknown as false })
    ).toBe(false);
    expect(
      denialRequiresClinicianCosign({ ...pend, requiresClinicianCosign: false })
    ).toBe(false);
    expect(denialRequiresClinicianCosign(null)).toBe(false);
  });

  it("slaTracesToCatalog: true for produced decisions, false when caller lies", () => {
    expect(slaTracesToCatalog(approved)).toBe(true);
    expect(slaTracesToCatalog(pend)).toBe(true);
    expect(slaTracesToCatalog(p2p)).toBe(true);
    expect(
      slaTracesToCatalog({
        urgency: "standard",
        asOfDate: "2026-07-05T00:00:00.000Z",
        slaWindowHours: 168 as unknown as number, // silently extended
        slaDeadline: "2026-07-12T00:00:00.000Z"
      })
    ).toBe(false);
    expect(
      slaTracesToCatalog({
        urgency: "standard",
        asOfDate: "2026-07-05T00:00:00.000Z",
        slaWindowHours: 72,
        slaDeadline: "2027-01-01T00:00:00.000Z" // deadline doesn't match
      })
    ).toBe(false);
    expect(slaTracesToCatalog({ urgency: "banana" as unknown as "standard" })).toBe(false);
    expect(slaTracesToCatalog(null)).toBe(false);
  });
});
