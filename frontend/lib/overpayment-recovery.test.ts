import { describe, expect, it } from "vitest";

import {
  DEMO_RECOVERY_COB_REQUEST,
  DEMO_RECOVERY_PAST_WINDOW_REQUEST,
  DEMO_RECOVERY_REQUEST,
  RECOVERY_REASONS,
  addDaysIso,
  evaluateRecovery,
  getRecoveryReason,
  isRecoveryReason,
  isWithinWindow,
  recoveryClawbackHumanReviewed,
  recoveryReasonCited,
  recoverySummary,
  recoveryWithinLookback
} from "./overpayment-recovery";

describe("overpayment-recovery catalog", () => {
  it("exposes recognized recovery reason ids with unique entries", () => {
    const ids = RECOVERY_REASONS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isRecoveryReason(id)).toBe(true);
    expect(isRecoveryReason("reason.recovery.we-just-decided")).toBe(false);
    expect(isRecoveryReason(undefined)).toBe(false);
  });

  it("looks up a reason by id, undefined for off-catalog", () => {
    expect(getRecoveryReason("reason.recovery.duplicate-payment")?.lookbackDays).toBe(365);
    expect(getRecoveryReason("reason.recovery.nope")).toBeUndefined();
  });

  it("has positive whole-day lookback windows for every reason", () => {
    for (const r of RECOVERY_REASONS) {
      expect(Number.isInteger(r.lookbackDays)).toBe(true);
      expect(r.lookbackDays).toBeGreaterThan(0);
    }
  });
});

describe("date helpers", () => {
  it("adds whole days deterministically", () => {
    expect(addDaysIso("2025-10-01", 365)).toBe("2026-10-01T00:00:00.000Z");
    expect(addDaysIso("not-a-date", 10)).toBe("not-a-date");
  });

  it("checks at/before the deadline inclusively", () => {
    expect(isWithinWindow("2026-10-01T00:00:00Z", "2026-03-01T00:00:00Z")).toBe(true);
    expect(isWithinWindow("2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z")).toBe(true);
    expect(isWithinWindow("2026-10-01T00:00:00Z", "2027-01-01T00:00:00Z")).toBe(false);
    expect(isWithinWindow("bad", "2026-03-01T00:00:00Z")).toBe(false);
  });
});

describe("evaluateRecovery · classification", () => {
  it("marks a duplicate payment within its lookback window recoverable, requiring human review", () => {
    const det = evaluateRecovery(DEMO_RECOVERY_REQUEST);
    expect(det.overpaymentAmount).toBe(600);
    expect(det.recoverable).toBe("recoverable");
    expect(det.requiresHumanReview).toBe(true);
    expect(det.withinLookbackWindow).toBe(true);
    expect(det.recoveryReasonId).toBe("reason.recovery.duplicate-payment");
    expect(det.recoveryDeadline).toBe("2026-10-01T00:00:00.000Z");
  });

  it("marks a COB-primary-elsewhere overpayment within its 2-year window recoverable", () => {
    const det = evaluateRecovery(DEMO_RECOVERY_COB_REQUEST);
    expect(det.overpaymentAmount).toBe(600);
    expect(det.recoverable).toBe("recoverable");
    expect(det.recoveryReasonId).toBe("reason.recovery.cob-primary-elsewhere");
  });

  it("marks an overpayment past its lookback window not-recoverable-within-window", () => {
    const det = evaluateRecovery(DEMO_RECOVERY_PAST_WINDOW_REQUEST);
    expect(det.overpaymentAmount).toBe(800);
    expect(det.recoverable).toBe("not-recoverable-within-window");
    expect(det.withinLookbackWindow).toBe(false);
    expect(det.requiresHumanReview).toBe(false);
  });

  it("returns no-overpayment when paid does not exceed correct", () => {
    const det = evaluateRecovery({
      ...DEMO_RECOVERY_REQUEST,
      paidAmount: 500,
      correctAmount: 600
    });
    expect(det.overpaymentAmount).toBe(0);
    expect(det.recoverable).toBe("no-overpayment");
    expect(det.requiresHumanReview).toBe(false);
  });

  it("rounds fractional overpayment to cents", () => {
    const det = evaluateRecovery({
      ...DEMO_RECOVERY_REQUEST,
      paidAmount: 100.555,
      correctAmount: 100.1
    });
    expect(det.overpaymentAmount).toBe(0.46);
  });

  it("is deterministic — the same claim yields the same determination", () => {
    expect(evaluateRecovery(DEMO_RECOVERY_REQUEST)).toEqual(
      evaluateRecovery(DEMO_RECOVERY_REQUEST)
    );
  });
});

describe("overpayment-recovery honesty guards", () => {
  it("recoveryWithinLookback is true for produced determinations, false for a past-window clawback", () => {
    expect(recoveryWithinLookback(evaluateRecovery(DEMO_RECOVERY_REQUEST))).toBe(true);
    expect(recoveryWithinLookback(evaluateRecovery(DEMO_RECOVERY_PAST_WINDOW_REQUEST))).toBe(
      true
    );
    expect(
      recoveryWithinLookback({ recoverable: "recoverable", withinLookbackWindow: false })
    ).toBe(false);
    expect(recoveryWithinLookback(null)).toBe(false);
  });

  it("recoveryReasonCited is true for a catalog reason, false for an off-catalog reason", () => {
    expect(recoveryReasonCited(evaluateRecovery(DEMO_RECOVERY_REQUEST))).toBe(true);
    expect(
      recoveryReasonCited({ recoveryReasonId: "reason.recovery.we-just-decided" })
    ).toBe(false);
    expect(recoveryReasonCited(null)).toBe(false);
  });

  it("recoveryClawbackHumanReviewed is false only for an autonomous recoverable clawback", () => {
    expect(recoveryClawbackHumanReviewed(evaluateRecovery(DEMO_RECOVERY_REQUEST))).toBe(true);
    // Non-recovery determinations are vacuously fine.
    expect(
      recoveryClawbackHumanReviewed({ recoverable: "no-overpayment", requiresHumanReview: false })
    ).toBe(true);
    expect(
      recoveryClawbackHumanReviewed({ recoverable: "recoverable", requiresHumanReview: false })
    ).toBe(false);
    expect(recoveryClawbackHumanReviewed(null)).toBe(false);
  });

  it("recoverySummary carries only structured, PHI-safe fields", () => {
    const summary = recoverySummary(evaluateRecovery(DEMO_RECOVERY_REQUEST));
    expect(summary.claimId).toBe("recovery-claim-001");
    expect(summary.recoverable).toBe("recoverable");
    expect(summary.recoveryReasonId).toBe("reason.recovery.duplicate-payment");
    expect(summary.synthetic).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("note");
  });
});
