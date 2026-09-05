import { describe, expect, it } from "vitest";

import {
  DEMO_ACCOUNTING_MIXED_REQUEST,
  DEMO_ACCOUNTING_REQUEST,
  DEMO_ACCOUNTING_TPO_ONLY_REQUEST,
  accountingComplete,
  accountingNoAutonomousSuppression,
  accountingPurposeSourced,
  accountingSummary,
  evaluateAccounting,
  getDisclosurePurpose,
  isAccountablePurpose,
  subtractYears
} from "./accounting-of-disclosures";

describe("subtractYears", () => {
  it("subtracts whole years in UTC, returning a date-only string", () => {
    expect(subtractYears("2026-09-01", 6)).toBe("2020-09-01");
    expect(subtractYears("2026-09-01T12:34:56Z", 6)).toBe("2020-09-01");
  });
});

describe("evaluateAccounting", () => {
  it("classifies a mixed log — TPO excluded, non-TPO accountable, old out-of-window", () => {
    const det = evaluateAccounting(DEMO_ACCOUNTING_REQUEST);
    expect(det.windowStart).toBe("2020-09-01");
    expect(det.totalDisclosures).toBe(5);
    expect(det.accountableCount).toBe(2); // public-health + law-enforcement in window
    expect(det.excludedCount).toBe(2); // treatment + payment
    expect(det.outOfWindowCount).toBe(1); // 2019 public-health report
    expect(det.requiresPrivacyOfficerReview).toBe(true);
    expect(det.autonomousSuppression).toBe(false);

    const byId = Object.fromEntries(det.classified.map((c) => [c.disclosureId, c]));
    expect(byId["disc-001"].disposition).toBe("excluded-tpo"); // treatment
    expect(byId["disc-002"].disposition).toBe("excluded-tpo"); // payment
    expect(byId["disc-003"].disposition).toBe("in-accounting"); // public-health
    expect(byId["disc-004"].disposition).toBe("in-accounting"); // law-enforcement
    expect(byId["disc-005"].disposition).toBe("out-of-window"); // 2019
  });

  it("accounts judicial + research and excludes a patient-authorized disclosure", () => {
    const det = evaluateAccounting(DEMO_ACCOUNTING_MIXED_REQUEST);
    expect(det.accountableCount).toBe(2); // judicial + research
    expect(det.excludedCount).toBe(1); // patient-authorized
    const byId = Object.fromEntries(det.classified.map((c) => [c.disclosureId, c]));
    expect(byId["disc-101"].disposition).toBe("in-accounting"); // judicial
    expect(byId["disc-102"].disposition).toBe("in-accounting"); // research (IRB waiver)
    expect(byId["disc-103"].disposition).toBe("excluded-authorized"); // authorized
  });

  it("produces an empty accounting for an all-TPO log, still requiring review", () => {
    const det = evaluateAccounting(DEMO_ACCOUNTING_TPO_ONLY_REQUEST);
    expect(det.accountableCount).toBe(0);
    expect(det.excludedCount).toBe(2);
    expect(det.requiresPrivacyOfficerReview).toBe(true);
  });

  it("conservatively includes a disclosure with an off-catalog purpose (in window)", () => {
    const det = evaluateAccounting({
      ...DEMO_ACCOUNTING_TPO_ONLY_REQUEST,
      disclosures: [
        {
          disclosureId: "disc-unknown",
          date: "2026-05-01",
          recipient: "Mystery recipient",
          purposeId: "purpose.made-up"
        }
      ]
    });
    expect(det.classified[0].disposition).toBe("in-accounting");
    expect(det.classified[0].category).toBe("unknown");
    expect(det.classified[0].purposeLabel).toBe("unknown purpose");
  });

  it("is deterministic — same log yields identical determination", () => {
    const a = evaluateAccounting(DEMO_ACCOUNTING_REQUEST);
    const b = evaluateAccounting(DEMO_ACCOUNTING_REQUEST);
    expect(a).toEqual(b);
  });
});

describe("purpose catalog helpers", () => {
  it("resolves cataloged purposes and reports accountability", () => {
    expect(getDisclosurePurpose("purpose.treatment")?.accountable).toBe(false);
    expect(getDisclosurePurpose("purpose.law-enforcement")?.accountable).toBe(true);
    expect(getDisclosurePurpose("purpose.made-up")).toBeUndefined();
  });

  it("isAccountablePurpose treats an off-catalog purpose as accountable", () => {
    expect(isAccountablePurpose("purpose.treatment")).toBe(false);
    expect(isAccountablePurpose("purpose.public-health-mandated")).toBe(true);
    expect(isAccountablePurpose("purpose.made-up")).toBe(true);
  });
});

describe("guard functions", () => {
  it("accountingPurposeSourced: false when any disclosure cites an off-catalog purpose", () => {
    expect(accountingPurposeSourced(evaluateAccounting(DEMO_ACCOUNTING_REQUEST))).toBe(true);
    expect(
      accountingPurposeSourced({
        classified: [{ purposeId: "purpose.made-up" }]
      })
    ).toBe(false);
    expect(accountingPurposeSourced(null)).toBe(false);
  });

  it("accountingComplete: false when an accountable, in-window disclosure is dropped", () => {
    expect(accountingComplete(evaluateAccounting(DEMO_ACCOUNTING_REQUEST))).toBe(true);
    // An accountable, in-window disclosure mis-labeled excluded.
    expect(
      accountingComplete({
        classified: [
          {
            purposeId: "purpose.law-enforcement",
            inWindow: true,
            disposition: "excluded-tpo"
          }
        ]
      })
    ).toBe(false);
    // A TPO disclosure excluded is fine.
    expect(
      accountingComplete({
        classified: [
          {
            purposeId: "purpose.treatment",
            inWindow: true,
            disposition: "excluded-tpo"
          }
        ]
      })
    ).toBe(true);
    // An accountable disclosure that is out of window need not be in the accounting.
    expect(
      accountingComplete({
        classified: [
          {
            purposeId: "purpose.law-enforcement",
            inWindow: false,
            disposition: "out-of-window"
          }
        ]
      })
    ).toBe(true);
    expect(accountingComplete(null)).toBe(false);
  });

  it("accountingNoAutonomousSuppression: false for suppression / unreviewed release", () => {
    expect(
      accountingNoAutonomousSuppression(evaluateAccounting(DEMO_ACCOUNTING_REQUEST))
    ).toBe(true);
    expect(accountingNoAutonomousSuppression({ autonomousSuppression: true })).toBe(false);
    expect(
      accountingNoAutonomousSuppression({ requiresPrivacyOfficerReview: false })
    ).toBe(false);
    expect(accountingNoAutonomousSuppression(null)).toBe(false);
  });
});

describe("accountingSummary", () => {
  it("is a compact projection of the determination", () => {
    const det = evaluateAccounting(DEMO_ACCOUNTING_REQUEST);
    expect(accountingSummary(det)).toEqual({
      requestRef: "acct-req-001",
      patientRef: "patient-acct-001",
      windowStart: "2020-09-01",
      totalDisclosures: 5,
      accountableCount: 2,
      excludedCount: 2,
      outOfWindowCount: 1,
      requiresPrivacyOfficerReview: true,
      synthetic: true
    });
  });
});
