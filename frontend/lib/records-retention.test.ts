import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION_RULE,
  DEMO_LEGAL_HOLD_REQUEST,
  DEMO_PURGE_ELIGIBLE_REQUEST,
  DEMO_RETENTION_REQUEST,
  RETENTION_REASON,
  RETENTION_SCHEDULES,
  addYearsIso,
  computeRetentionExpiry,
  evaluateRetention,
  getRetentionSchedule,
  isPastRetention,
  isRecordType,
  isRetentionRule,
  purgeHumanApproved,
  retentionRespectsLegalHold,
  retentionRuleCited,
  retentionSummary
} from "./records-retention";

/**
 * Tests for lib/records-retention.ts — the deterministic, transparent
 * records-lifecycle core behind the Data Retention & Records Lifecycle Management
 * Agent. The disposition is a pure function of the record's dates + the request's
 * own atTime (no randomness, no clock), so the same request always yields the same
 * recommendation + cited rule + expiry. These pin determinism, the retention
 * schedule catalog, the legal-hold-overrides-purge short-circuit, the
 * recommendation vs governance-block posture, and the three honest governance
 * signals (legal-hold-overrides-purge + schedule-sourced + no-autonomous-purge).
 */

describe("retention schedule catalog", () => {
  it("exposes a non-empty catalog with stable ids, labels, rules, periods", () => {
    expect(RETENTION_SCHEDULES.length).toBeGreaterThan(0);
    for (const s of RETENTION_SCHEDULES) {
      expect(s.id.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.ruleId.length).toBeGreaterThan(0);
      expect(s.ruleLabel.length).toBeGreaterThan(0);
      expect(s.retentionYears).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      // Every schedule rule id is a recognized retention rule.
      expect(isRetentionRule(s.ruleId)).toBe(true);
    }
  });

  it("isRecordType / getRetentionSchedule agree with the catalog", () => {
    for (const s of RETENTION_SCHEDULES) {
      expect(isRecordType(s.id)).toBe(true);
      expect(getRetentionSchedule(s.id)?.ruleId).toBe(s.ruleId);
    }
    expect(isRecordType("made-up-record")).toBe(false);
    expect(getRetentionSchedule("made-up-record")).toBeUndefined();
  });

  it("recognizes the default retain-unscheduled rule but not an ad-hoc rule", () => {
    expect(isRetentionRule(DEFAULT_RETENTION_RULE.id)).toBe(true);
    expect(isRetentionRule("rule.retention.we-just-decided")).toBe(false);
    expect(isRetentionRule("")).toBe(false);
    expect(isRetentionRule(undefined)).toBe(false);
  });
});

describe("addYearsIso / computeRetentionExpiry / isPastRetention · deterministic", () => {
  it("adds whole years to an ISO date (no clock)", () => {
    expect(addYearsIso("2016-03-01", 7)).toBe("2023-03-01T00:00:00.000Z");
    expect(addYearsIso("2025-06-15", 7)).toBe("2032-06-15T00:00:00.000Z");
  });

  it("anchors from-last-touched to the last-touched date + retention years", () => {
    const clinical = getRetentionSchedule("clinical-record")!;
    expect(
      computeRetentionExpiry(clinical, {
        createdAt: "2024-01-10",
        lastTouchedAt: "2025-06-15"
      })
    ).toBe("2032-06-15T00:00:00.000Z");
    // Falls back to createdAt when last-touched is absent.
    expect(computeRetentionExpiry(clinical, { createdAt: "2020-01-01" })).toBe(
      "2027-01-01T00:00:00.000Z"
    );
  });

  it("anchors until-age-of-majority to the DOB + majority + tail years", () => {
    const minor = getRetentionSchedule("minor-record")!;
    // DOB 2015-05-01 + (18 + 3) = 2036-05-01.
    expect(
      computeRetentionExpiry(minor, { createdAt: "2016-01-01", patientDob: "2015-05-01" })
    ).toBe("2036-05-01T00:00:00.000Z");
  });

  it("isPastRetention is true only at/after the expiry", () => {
    expect(isPastRetention("2023-03-01T00:00:00.000Z", "2026-03-01T00:00:00Z")).toBe(true);
    expect(isPastRetention("2032-06-15T00:00:00.000Z", "2026-03-01T00:00:00Z")).toBe(false);
    expect(isPastRetention(undefined, "2026-03-01T00:00:00Z")).toBe(false);
  });
});

describe("evaluateRetention · deterministic recommendation", () => {
  it("is deterministic — the same request yields the same disposition", () => {
    expect(evaluateRetention(DEMO_RETENTION_REQUEST)).toEqual(
      evaluateRetention(DEMO_RETENTION_REQUEST)
    );
  });

  it("RETAINS a record within its retention period, citing the schedule rule", () => {
    const d = evaluateRetention(DEMO_RETENTION_REQUEST);
    expect(d.recommendation).toBe("retain");
    expect(d.retentionRuleId).toBe("rule.retention.clinical-record-7y");
    expect(d.retentionExpiresAt).toBe("2032-06-15T00:00:00.000Z");
    expect(d.underLegalHold).toBe(false);
    expect(d.requiresHumanApproval).toBe(false);
    expect(d.reason).toBe(RETENTION_REASON.retain);
    expect(d.synthetic).toBe(true);
  });

  it("recommends ELIGIBLE-FOR-PURGE past expiry with no hold — a recommendation, human-approval-gated (not a block)", () => {
    const d = evaluateRetention(DEMO_PURGE_ELIGIBLE_REQUEST);
    expect(d.recommendation).toBe("eligible-for-purge");
    expect(d.retentionRuleId).toBe("rule.retention.billing-claim-7y");
    expect(d.retentionExpiresAt).toBe("2023-03-01T00:00:00.000Z");
    expect(d.underLegalHold).toBe(false);
    // A purge is only ever a recommendation requiring human approval.
    expect(d.requiresHumanApproval).toBe(true);
    expect(d.reason).toBe(RETENTION_REASON.eligibleForPurge);
  });

  it("HOLDS a past-expiry record under an active legal hold — the hold overrides the purge", () => {
    const d = evaluateRetention(DEMO_LEGAL_HOLD_REQUEST);
    // Past its 7-year expiry, but on legal hold → hold, never eligible-for-purge.
    expect(d.retentionExpiresAt).toBe("2018-01-01T00:00:00.000Z");
    expect(d.recommendation).toBe("hold");
    expect(d.underLegalHold).toBe(true);
    expect(d.requiresHumanApproval).toBe(false);
    expect(d.reason).toBe(RETENTION_REASON.hold);
  });

  it("RETAINS an off-catalog record type by default, citing the default rule", () => {
    const d = evaluateRetention({
      ...DEMO_RETENTION_REQUEST,
      recordType: "made-up-record"
    });
    expect(d.recommendation).toBe("retain");
    expect(d.retentionRuleId).toBe(DEFAULT_RETENTION_RULE.id);
    expect(d.reason).toBe(RETENTION_REASON.unscheduled);
    // Never purged without a cited schedule — it stays schedule-sourced.
    expect(retentionRuleCited(d)).toBe(true);
  });

  it("every produced disposition satisfies all three honest signals", () => {
    for (const req of [
      DEMO_RETENTION_REQUEST,
      DEMO_PURGE_ELIGIBLE_REQUEST,
      DEMO_LEGAL_HOLD_REQUEST
    ]) {
      const d = evaluateRetention(req);
      expect(retentionRespectsLegalHold(d)).toBe(true);
      expect(retentionRuleCited(d)).toBe(true);
      expect(purgeHumanApproved(d)).toBe(true);
    }
  });
});

describe("retentionRespectsLegalHold · legal-hold-overrides-purge signal", () => {
  it("is true for anything evaluateRetention produces", () => {
    expect(retentionRespectsLegalHold(evaluateRetention(DEMO_LEGAL_HOLD_REQUEST))).toBe(true);
  });

  it("is false for a purge asserted while under an active legal hold", () => {
    expect(
      retentionRespectsLegalHold({
        recommendation: "eligible-for-purge",
        underLegalHold: true
      })
    ).toBe(false);
    // A hold or retain under a hold trivially passes.
    expect(retentionRespectsLegalHold({ recommendation: "hold", underLegalHold: true })).toBe(
      true
    );
    // A purge with no hold passes (it is a legitimate recommendation).
    expect(
      retentionRespectsLegalHold({ recommendation: "eligible-for-purge", underLegalHold: false })
    ).toBe(true);
    expect(retentionRespectsLegalHold(null)).toBe(false);
  });
});

describe("retentionRuleCited · schedule-sourced signal", () => {
  it("is true for anything evaluateRetention produces", () => {
    expect(retentionRuleCited(evaluateRetention(DEMO_RETENTION_REQUEST))).toBe(true);
  });

  it("is false for an ad-hoc disposition with no cited schedule", () => {
    expect(retentionRuleCited({ retentionRuleId: "rule.retention.we-just-decided" })).toBe(false);
    expect(retentionRuleCited({ retentionRuleId: "" })).toBe(false);
    expect(retentionRuleCited({ retentionRuleId: "rule.retention.clinical-record-7y" })).toBe(
      true
    );
    expect(retentionRuleCited(null)).toBe(false);
  });
});

describe("purgeHumanApproved · no-autonomous-purge signal", () => {
  it("is true for anything evaluateRetention produces", () => {
    expect(purgeHumanApproved(evaluateRetention(DEMO_PURGE_ELIGIBLE_REQUEST))).toBe(true);
  });

  it("is false for an autonomous / unapproved purge", () => {
    expect(
      purgeHumanApproved({ recommendation: "eligible-for-purge", requiresHumanApproval: false })
    ).toBe(false);
    // A human-approval-gated purge recommendation passes.
    expect(
      purgeHumanApproved({ recommendation: "eligible-for-purge", requiresHumanApproval: true })
    ).toBe(true);
    // A retain / hold trivially passes (nothing to purge).
    expect(
      purgeHumanApproved({ recommendation: "retain", requiresHumanApproval: false })
    ).toBe(true);
    expect(purgeHumanApproved(null)).toBe(false);
  });
});

describe("retentionSummary · trace-safe summary", () => {
  it("summarizes the disposition with refs, the recommendation, cited rule, expiry, and flags", () => {
    const d = evaluateRetention(DEMO_PURGE_ELIGIBLE_REQUEST);
    const summary = retentionSummary(d);
    expect(summary.recordId).toBe("retention-record-002");
    expect(summary.patientRef).toBe("retention-patient-002");
    expect(summary.recordType).toBe("billing-claim");
    expect(summary.recommendation).toBe("eligible-for-purge");
    expect(summary.retentionRuleId).toBe("rule.retention.billing-claim-7y");
    expect(summary.retentionExpiresAt).toBe("2023-03-01T00:00:00.000Z");
    expect(summary.underLegalHold).toBe(false);
    expect(summary.requiresHumanApproval).toBe(true);
    expect(summary.synthetic).toBe(true);
  });
});
