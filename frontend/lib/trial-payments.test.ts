import { describe, expect, it } from "vitest";
import {
  DEMO_EXTRA_PROCEDURE,
  DEMO_MISSED_VISIT,
  DEMO_NO_CONSENT,
  DEMO_STANDARD_PAYMENT,
  DEMO_TRAVEL_OUT_OF_RANGE,
  TRIAL_PAYMENT_REASON_CODES,
  TRIAL_PAYMENT_RULES,
  TRIAL_PAYMENT_SCHEDULES,
  TRIAL_VISIT_TYPES,
  computePayment,
  deviationRequiresCoordinatorCosign,
  evaluatePayment,
  evaluateTrialPaymentRules,
  getTrialPaymentRule,
  getTrialSchedule,
  getTrialVisitType,
  isTrialPaymentReasonCode,
  isTrialPaymentRule,
  isTrialSchedule,
  isTrialVisitType,
  paymentHasParticipantConsent,
  paymentsTraceToCatalog,
  summarizeTrialPaymentDecision
} from "./trial-payments";

describe("catalogs", () => {
  it("exposes visit type + schedule + rule + reason catalogs", () => {
    expect(TRIAL_VISIT_TYPES.length).toBe(5);
    for (const v of TRIAL_VISIT_TYPES) {
      expect(v.id).toMatch(/^visit\./);
      expect(v.synthetic).toBe(true);
    }
    expect(TRIAL_PAYMENT_SCHEDULES.length).toBe(3);
    for (const s of TRIAL_PAYMENT_SCHEDULES) {
      expect(s.trialId).toMatch(/^trial\./);
      expect(s.synthetic).toBe(true);
      expect(s.travelReimbursementCentsPerMile).toBeGreaterThan(0);
    }
    expect(TRIAL_PAYMENT_RULES.length).toBe(5);
    expect(TRIAL_PAYMENT_REASON_CODES.length).toBe(5);
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const v of TRIAL_VISIT_TYPES) {
      expect(isTrialVisitType(v.id)).toBe(true);
      expect(getTrialVisitType(v.id)?.label).toBe(v.label);
    }
    for (const s of TRIAL_PAYMENT_SCHEDULES) {
      expect(isTrialSchedule(s.trialId)).toBe(true);
      expect(getTrialSchedule(s.trialId)?.trialLabel).toBe(s.trialLabel);
    }
    for (const r of TRIAL_PAYMENT_RULES) {
      expect(isTrialPaymentRule(r.id)).toBe(true);
      expect(getTrialPaymentRule(r.id)?.label).toBe(r.label);
    }
    expect(isTrialVisitType("visit.made-up")).toBe(false);
    expect(isTrialSchedule("trial.made-up")).toBe(false);
    expect(isTrialPaymentRule("rule.made-up")).toBe(false);
    expect(isTrialPaymentReasonCode("reason.TP-100")).toBe(true);
    expect(isTrialPaymentReasonCode("reason.made-up")).toBe(false);
  });
});

describe("evaluateTrialPaymentRules", () => {
  it("fires standard-visit-completed for a routine completed visit", () => {
    const rules = evaluateTrialPaymentRules(DEMO_STANDARD_PAYMENT);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.standard-visit-completed"]);
    expect(rules[0].reasonCode).toBe("reason.TP-100");
  });

  it("fires missed-visit-partial-comp on a missed visit", () => {
    const rules = evaluateTrialPaymentRules(DEMO_MISSED_VISIT);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.missed-visit-partial-comp"]);
    expect(rules[0].reasonCode).toBe("reason.TP-200");
  });

  it("fires travel-out-of-range when miles exceed schedule max", () => {
    const rules = evaluateTrialPaymentRules(DEMO_TRAVEL_OUT_OF_RANGE);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.travel-out-of-range"]);
    expect(rules[0].reasonCode).toBe("reason.TP-201");
  });

  it("fires extra-procedure when requested", () => {
    const rules = evaluateTrialPaymentRules(DEMO_EXTRA_PROCEDURE);
    expect(rules.map((r) => r.ruleId)).toEqual(["rule.extra-procedure-comp"]);
    expect(rules[0].reasonCode).toBe("reason.TP-202");
  });

  it("fires consent-missing (highest priority) when consent absent", () => {
    const rules = evaluateTrialPaymentRules(DEMO_NO_CONSENT);
    expect(rules.map((r) => r.ruleId)).toContain("rule.consent-missing");
  });

  it("fires multiple rules and sorts by rule-id ascending", () => {
    const rules = evaluateTrialPaymentRules({
      ...DEMO_TRAVEL_OUT_OF_RANGE,
      visitOutcome: "missed",
      requestsExtraProcedureCompensation: true
    });
    // Should fire: extra-procedure, missed-visit-partial-comp, travel-out-of-range
    const ids = rules.map((r) => r.ruleId);
    expect(ids).toContain("rule.missed-visit-partial-comp");
    expect(ids).toContain("rule.travel-out-of-range");
    expect(ids).toContain("rule.extra-procedure-comp");
    expect(ids).toEqual([...ids].sort());
  });
});

describe("summarizeTrialPaymentDecision", () => {
  it("schedule-approved when no rules", () => {
    const s = summarizeTrialPaymentDecision([]);
    expect(s.decision).toBe("schedule-approved");
    expect(s.routedTo).toBe("schedule-auto-pay");
  });

  it("blocked-no-consent wins over pend-coordinator-review", () => {
    const rules = evaluateTrialPaymentRules({
      ...DEMO_MISSED_VISIT,
      hasResearchPaymentConsent: false
    });
    const s = summarizeTrialPaymentDecision(rules);
    expect(s.decision).toBe("blocked-no-consent");
    expect(s.routedTo).toBe("blocked-hold");
  });

  it("pend-coordinator-review when only pend rules fire", () => {
    const rules = evaluateTrialPaymentRules(DEMO_TRAVEL_OUT_OF_RANGE);
    const s = summarizeTrialPaymentDecision(rules);
    expect(s.decision).toBe("pend-coordinator-review");
    expect(s.routedTo).toBe("study-coordinator-review");
  });
});

describe("computePayment", () => {
  it("uses schedule stipend + travel * mileage rate for a completed visit", () => {
    // Treatment visit standard stipend = $150.00 = 15000c.
    // Travel: 40 miles * 21c = 840c.
    const p = computePayment(DEMO_STANDARD_PAYMENT);
    expect(p.stipendAmountCents).toBe(15000);
    expect(p.travelReimbursementCents).toBe(840);
  });

  it("applies visit stipend override when present", () => {
    // HRT trial: follow-up override = 12500c.
    const p = computePayment({
      ...DEMO_STANDARD_PAYMENT,
      trialId: "trial.mn-hrt-transdermal-p4",
      visitTypeId: "visit.follow-up",
      travelMilesRoundTrip: 20
    });
    expect(p.stipendAmountCents).toBe(12500);
    expect(p.travelReimbursementCents).toBe(20 * 21);
  });

  it("caps travel at maxReimbursableMiles", () => {
    // Fezolinetant trial max = 100. Request 200 → caps at 100.
    const p = computePayment({
      ...DEMO_STANDARD_PAYMENT,
      travelMilesRoundTrip: 200
    });
    expect(p.travelReimbursementCents).toBe(100 * 21);
  });

  it("returns zero when consent missing or visit not completed", () => {
    expect(computePayment(DEMO_NO_CONSENT).stipendAmountCents).toBe(0);
    expect(
      computePayment({ ...DEMO_STANDARD_PAYMENT, visitOutcome: "missed" }).stipendAmountCents
    ).toBe(0);
  });

  it("returns zero for off-catalog trial", () => {
    const p = computePayment({ ...DEMO_STANDARD_PAYMENT, trialId: "trial.made-up" });
    expect(p.stipendAmountCents).toBe(0);
  });
});

describe("evaluatePayment", () => {
  it("is deterministic", () => {
    expect(evaluatePayment(DEMO_STANDARD_PAYMENT)).toEqual(
      evaluatePayment(DEMO_STANDARD_PAYMENT)
    );
  });

  it("schedule-approved auto-pays with computed amounts", () => {
    const d = evaluatePayment(DEMO_STANDARD_PAYMENT);
    expect(d.decision).toBe("schedule-approved");
    expect(d.stipendAmountCents).toBe(15000);
    expect(d.travelReimbursementCents).toBe(840);
    expect(d.routedTo).toBe("schedule-auto-pay");
    expect(d.requiresCoordinatorCosign).toBe(false);
    expect(d.cosigned).toBe(false);
  });

  it("pend-coordinator-review zeros out amounts (coord decides)", () => {
    const d = evaluatePayment(DEMO_TRAVEL_OUT_OF_RANGE);
    expect(d.decision).toBe("pend-coordinator-review");
    expect(d.stipendAmountCents).toBe(0);
    expect(d.travelReimbursementCents).toBe(0);
    expect(d.requiresCoordinatorCosign).toBe(true);
  });

  it("blocked-no-consent zeros out and holds", () => {
    const d = evaluatePayment(DEMO_NO_CONSENT);
    expect(d.decision).toBe("blocked-no-consent");
    expect(d.stipendAmountCents).toBe(0);
    expect(d.travelReimbursementCents).toBe(0);
    expect(d.routedTo).toBe("blocked-hold");
  });
});

describe("governance signals", () => {
  const approved = evaluatePayment(DEMO_STANDARD_PAYMENT);
  const pend = evaluatePayment(DEMO_TRAVEL_OUT_OF_RANGE);
  const blocked = evaluatePayment(DEMO_NO_CONSENT);

  it("paymentsTraceToCatalog: true for produced decisions", () => {
    expect(paymentsTraceToCatalog(approved)).toBe(true);
    expect(paymentsTraceToCatalog(pend)).toBe(true);
    expect(paymentsTraceToCatalog(blocked)).toBe(true);
    expect(
      paymentsTraceToCatalog({
        trialId: "trial.made-up",
        visitTypeId: "visit.treatment",
        appliedRules: []
      })
    ).toBe(false);
    expect(
      paymentsTraceToCatalog({
        ...approved,
        appliedRules: [{ ruleId: "rule.made-up", reasonCode: "reason.TP-100" }]
      })
    ).toBe(false);
    expect(paymentsTraceToCatalog(null)).toBe(false);
  });

  it("deviationRequiresCoordinatorCosign: true when properly gated, false when bypassed", () => {
    expect(deviationRequiresCoordinatorCosign(approved)).toBe(true); // no cosign needed
    expect(deviationRequiresCoordinatorCosign(pend)).toBe(true);
    expect(deviationRequiresCoordinatorCosign(blocked)).toBe(true);
    expect(
      deviationRequiresCoordinatorCosign({
        ...pend,
        cosigned: true as unknown as false
      })
    ).toBe(false);
    expect(
      deviationRequiresCoordinatorCosign({
        ...pend,
        requiresCoordinatorCosign: false
      })
    ).toBe(false);
    expect(deviationRequiresCoordinatorCosign(null)).toBe(false);
  });

  it("paymentHasParticipantConsent: true for consented + auto-approved, true for safe blocked, false when caller lies", () => {
    expect(
      paymentHasParticipantConsent({
        decision: approved.decision,
        hasResearchPaymentConsent: true
      })
    ).toBe(true);
    // Blocked-no-consent is the SAFE ANSWER, satisfies the invariant.
    expect(
      paymentHasParticipantConsent({
        decision: blocked.decision,
        hasResearchPaymentConsent: false
      })
    ).toBe(true);
    // Caller claims schedule-approved but no consent — the load-bearing lie.
    expect(
      paymentHasParticipantConsent({
        decision: "schedule-approved",
        hasResearchPaymentConsent: false
      })
    ).toBe(false);
    expect(paymentHasParticipantConsent(null)).toBe(false);
  });
});
