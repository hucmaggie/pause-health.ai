import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMPARED_FIELDS,
  DEMO_ENROLLMENT_RECONCILIATION_CLEAN_REQUEST,
  DEMO_ENROLLMENT_RECONCILIATION_NEW_GROUP_REQUEST,
  DEMO_ENROLLMENT_RECONCILIATION_REQUEST,
  enrollmentReconciliationSummary,
  evaluateEnrollmentReconciliation,
  fieldDeltas,
  reconciliationActionsSourced,
  reconciliationComplete,
  reconciliationNoAutonomousChange
} from "./enrollment-reconciliation";

describe("fieldDeltas", () => {
  it("returns only genuinely-differing fields", () => {
    const a = { memberId: "M", name: "X", coverageTier: "family", planId: "P", status: "active" };
    const b = { memberId: "M", name: "X", coverageTier: "employee-only", planId: "P", status: "active" };
    const deltas = fieldDeltas(a, b, [...DEFAULT_COMPARED_FIELDS]);
    expect(deltas).toEqual([
      { field: "coverageTier", sourceValue: "family", carrierValue: "employee-only" }
    ]);
  });
});

describe("evaluateEnrollmentReconciliation", () => {
  it("classifies enroll / terminate / update / no-change on drifted rosters", () => {
    const d = evaluateEnrollmentReconciliation(DEMO_ENROLLMENT_RECONCILIATION_REQUEST);
    expect(d.totalMembers).toBe(4);
    expect(d.counts).toEqual({ enroll: 1, terminate: 1, update: 1, noChange: 1 });
    const byId = Object.fromEntries(d.actions.map((a) => [a.memberId, a]));
    expect(byId.M1.action).toBe("no-change");
    expect(byId.M2.action).toBe("update");
    expect(byId.M2.differingFields).toEqual([
      { field: "coverageTier", sourceValue: "employee-only", carrierValue: "family" }
    ]);
    expect(byId.M3.action).toBe("enroll");
    expect(byId.M4.action).toBe("terminate");
    expect(d.requiresBenefitsAdminReview).toBe(true);
    expect(d.autoApplied).toBe(false);
  });

  it("emits all no-change when the rosters agree", () => {
    const d = evaluateEnrollmentReconciliation(DEMO_ENROLLMENT_RECONCILIATION_CLEAN_REQUEST);
    expect(d.counts).toEqual({ enroll: 0, terminate: 0, update: 0, noChange: 2 });
  });

  it("emits all enroll for a new group with an empty carrier", () => {
    const d = evaluateEnrollmentReconciliation(DEMO_ENROLLMENT_RECONCILIATION_NEW_GROUP_REQUEST);
    expect(d.counts).toEqual({ enroll: 2, terminate: 0, update: 0, noChange: 0 });
  });

  it("sorts actions by memberId and is deterministic", () => {
    const d = evaluateEnrollmentReconciliation(DEMO_ENROLLMENT_RECONCILIATION_REQUEST);
    expect(d.actions.map((a) => a.memberId)).toEqual(["M1", "M2", "M3", "M4"]);
    expect(evaluateEnrollmentReconciliation(DEMO_ENROLLMENT_RECONCILIATION_REQUEST)).toEqual(d);
  });

  it("respects a custom comparedFields list", () => {
    const d = evaluateEnrollmentReconciliation({
      requestRef: "r",
      groupRef: "g",
      comparedFields: ["status"], // ignore coverageTier
      sourceOfTruth: [
        { memberId: "M2", name: "Sam", coverageTier: "employee-only", planId: "P", status: "active" }
      ],
      carrier: [
        { memberId: "M2", name: "Sam", coverageTier: "family", planId: "P", status: "active" }
      ]
    });
    // coverageTier differs but is not compared → no-change
    expect(d.counts.noChange).toBe(1);
    expect(d.counts.update).toBe(0);
  });
});

describe("reconciliationComplete", () => {
  it("passes a produced determination", () => {
    expect(reconciliationComplete(evaluateEnrollmentReconciliation(DEMO_ENROLLMENT_RECONCILIATION_REQUEST))).toBe(true);
  });
  it("fails when a member is dropped (totalMembers > actions)", () => {
    expect(
      reconciliationComplete({
        totalMembers: 4,
        actions: [
          { memberId: "M1", action: "no-change" },
          { memberId: "M3", action: "enroll" }
        ],
        counts: { enroll: 1, terminate: 0, update: 0, noChange: 1 }
      })
    ).toBe(false);
  });
  it("fails when the counts don't match the tallies", () => {
    expect(
      reconciliationComplete({
        totalMembers: 2,
        actions: [
          { memberId: "M1", action: "no-change" },
          { memberId: "M3", action: "enroll" }
        ],
        counts: { enroll: 2, terminate: 0, update: 0, noChange: 0 }
      })
    ).toBe(false);
  });
  it("fails on a duplicate memberId", () => {
    expect(
      reconciliationComplete({
        totalMembers: 2,
        actions: [
          { memberId: "M1", action: "no-change" },
          { memberId: "M1", action: "enroll" }
        ],
        counts: { enroll: 1, terminate: 0, update: 0, noChange: 1 }
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(reconciliationComplete(null)).toBe(false);
  });
});

describe("reconciliationActionsSourced", () => {
  it("passes a produced determination", () => {
    expect(reconciliationActionsSourced(evaluateEnrollmentReconciliation(DEMO_ENROLLMENT_RECONCILIATION_REQUEST))).toBe(true);
  });
  it("fails an update with no differing fields", () => {
    expect(
      reconciliationActionsSourced({
        actions: [{ action: "update", differingFields: [] }]
      })
    ).toBe(false);
  });
  it("fails a fabricated discrepancy (values identical)", () => {
    expect(
      reconciliationActionsSourced({
        actions: [
          { action: "update", differingFields: [{ field: "coverageTier", sourceValue: "family", carrierValue: "family" }] }
        ]
      })
    ).toBe(false);
  });
  it("fails a no-change that carries deltas", () => {
    expect(
      reconciliationActionsSourced({
        actions: [
          { action: "no-change", differingFields: [{ field: "status", sourceValue: "a", carrierValue: "b" }] }
        ]
      })
    ).toBe(false);
  });
  it("fails an unknown action kind", () => {
    expect(reconciliationActionsSourced({ actions: [{ action: "delete" }] })).toBe(false);
  });
});

describe("reconciliationNoAutonomousChange", () => {
  it("passes a produced determination", () => {
    expect(reconciliationNoAutonomousChange(evaluateEnrollmentReconciliation(DEMO_ENROLLMENT_RECONCILIATION_REQUEST))).toBe(true);
  });
  it("fails an autonomously-applied determination", () => {
    expect(
      reconciliationNoAutonomousChange({ autoApplied: true, requiresBenefitsAdminReview: true })
    ).toBe(false);
  });
  it("fails an un-reviewed determination", () => {
    expect(
      reconciliationNoAutonomousChange({ autoApplied: false, requiresBenefitsAdminReview: false })
    ).toBe(false);
  });
});

describe("enrollmentReconciliationSummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = enrollmentReconciliationSummary(evaluateEnrollmentReconciliation(DEMO_ENROLLMENT_RECONCILIATION_REQUEST));
    expect(s.totalMembers).toBe(4);
    expect(s.enroll).toBe(1);
    expect(s.terminate).toBe(1);
    expect(s.update).toBe(1);
    expect(s.noChange).toBe(1);
    expect(s.requiresBenefitsAdminReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
