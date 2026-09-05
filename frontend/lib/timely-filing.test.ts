import { describe, expect, it } from "vitest";

import {
  DEMO_TIMELY_FILING_EXCEPTION_REQUEST,
  DEMO_TIMELY_FILING_REQUEST,
  DEMO_TIMELY_FILING_UNTIMELY_REQUEST,
  addDays,
  daysBetween,
  evaluateTimelyFiling,
  getFilingRule,
  timelyFilingDeadlineComputed,
  timelyFilingNoAutonomousWriteOff,
  timelyFilingRuleSourced,
  timelyFilingSummary
} from "./timely-filing";

describe("date math", () => {
  it("addDays is deterministic UTC date arithmetic", () => {
    expect(addDays("2026-01-10", 90)).toBe("2026-04-10");
    expect(addDays("2026-01-10", 365)).toBe("2027-01-10");
    expect(addDays("2026-01-10", 0)).toBe("2026-01-10");
  });

  it("daysBetween counts whole UTC days", () => {
    expect(daysBetween("2026-04-10", "2026-06-01")).toBe(52);
    expect(daysBetween("2026-01-10", "2026-01-10")).toBe(0);
  });
});

describe("evaluateTimelyFiling", () => {
  it("accepts a claim filed within the window", () => {
    const det = evaluateTimelyFiling(DEMO_TIMELY_FILING_REQUEST);
    expect(det.limitDays).toBe(90);
    expect(det.deadline).toBe("2026-04-10");
    expect(det.timely).toBe(true);
    expect(det.daysLate).toBe(0);
    expect(det.disposition).toBe("accept");
    expect(det.requiresHumanReview).toBe(false);
    expect(det.writtenOff).toBe(false);
  });

  it("routes an untimely claim with a recognized exception to appeal", () => {
    const det = evaluateTimelyFiling(DEMO_TIMELY_FILING_EXCEPTION_REQUEST);
    expect(det.timely).toBe(false);
    expect(det.daysLate).toBe(52);
    expect(det.exceptionRecognized).toBe(true);
    expect(det.disposition).toBe("appeal-with-exception");
    expect(det.requiresHumanReview).toBe(true);
  });

  it("routes an untimely claim with no exception to write-off review", () => {
    const det = evaluateTimelyFiling(DEMO_TIMELY_FILING_UNTIMELY_REQUEST);
    expect(det.timely).toBe(false);
    expect(det.exceptionRecognized).toBe(false);
    expect(det.disposition).toBe("write-off-review");
    expect(det.requiresHumanReview).toBe(true);
    expect(det.writtenOff).toBe(false);
  });

  it("does not recognize an exception the rule does not allow", () => {
    const det = evaluateTimelyFiling({
      ...DEMO_TIMELY_FILING_UNTIMELY_REQUEST,
      exceptionClaimed: "exception.administrative-error" // not allowed on the commercial-90day rule
    });
    expect(det.exceptionRecognized).toBe(false);
    expect(det.disposition).toBe("write-off-review");
  });

  it("handles an off-catalog rule with a zero limit and human review", () => {
    const det = evaluateTimelyFiling({
      ...DEMO_TIMELY_FILING_REQUEST,
      filingRuleId: "rule.filing.made-up"
    });
    expect(det.limitDays).toBe(0);
    expect(getFilingRule(det.filingRuleId)).toBeUndefined();
  });

  it("is deterministic — same claim yields identical determination", () => {
    const a = evaluateTimelyFiling(DEMO_TIMELY_FILING_EXCEPTION_REQUEST);
    const b = evaluateTimelyFiling(DEMO_TIMELY_FILING_EXCEPTION_REQUEST);
    expect(a).toEqual(b);
  });
});

describe("guard functions", () => {
  it("timelyFilingRuleSourced: false for an off-catalog rule id", () => {
    expect(timelyFilingRuleSourced(evaluateTimelyFiling(DEMO_TIMELY_FILING_REQUEST))).toBe(true);
    expect(timelyFilingRuleSourced({ filingRuleId: "rule.filing.made-up" })).toBe(false);
    expect(timelyFilingRuleSourced(null)).toBe(false);
  });

  it("timelyFilingDeadlineComputed: false when the deadline does not match", () => {
    expect(timelyFilingDeadlineComputed(evaluateTimelyFiling(DEMO_TIMELY_FILING_REQUEST))).toBe(
      true
    );
    expect(
      timelyFilingDeadlineComputed({
        serviceDate: "2026-01-10",
        limitDays: 90,
        deadline: "2026-07-01"
      })
    ).toBe(false);
    expect(
      timelyFilingDeadlineComputed({
        serviceDate: "2026-01-10",
        limitDays: 90,
        deadline: "2026-04-10"
      })
    ).toBe(true);
    expect(timelyFilingDeadlineComputed(null)).toBe(false);
  });

  it("timelyFilingNoAutonomousWriteOff: false when written off or untimely-unreviewed", () => {
    expect(
      timelyFilingNoAutonomousWriteOff(evaluateTimelyFiling(DEMO_TIMELY_FILING_UNTIMELY_REQUEST))
    ).toBe(true);
    expect(
      timelyFilingNoAutonomousWriteOff({ writtenOff: true, timely: false, requiresHumanReview: true })
    ).toBe(false);
    expect(
      timelyFilingNoAutonomousWriteOff({
        writtenOff: false,
        timely: false,
        requiresHumanReview: false
      })
    ).toBe(false);
    expect(timelyFilingNoAutonomousWriteOff(null)).toBe(false);
  });
});

describe("timelyFilingSummary", () => {
  it("is a compact projection of the determination", () => {
    const det = evaluateTimelyFiling(DEMO_TIMELY_FILING_REQUEST);
    const s = timelyFilingSummary(det);
    expect(s).toEqual({
      claimRef: "claim-tf-001",
      filingRuleId: "rule.filing.commercial-90day",
      limitDays: 90,
      deadline: "2026-04-10",
      daysLate: 0,
      timely: true,
      exceptionRecognized: false,
      disposition: "accept",
      requiresHumanReview: false,
      synthetic: true
    });
  });
});
