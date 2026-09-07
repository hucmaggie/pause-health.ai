import { describe, expect, it } from "vitest";

import {
  AMENDMENT_DENIAL_GROUNDS,
  DEMO_AMENDMENT_ACCURATE_REQUEST,
  DEMO_AMENDMENT_EXTENSION_REQUEST,
  DEMO_AMENDMENT_NOT_ORIGINATOR_REQUEST,
  DEMO_AMENDMENT_REQUEST,
  addDays,
  amendmentDeadlineComputed,
  amendmentGroundSourced,
  amendmentNoAutonomousWrite,
  amendmentSummary,
  daysBetween,
  deriveDenialGround,
  evaluateAmendment,
  getAmendmentDenialGround
} from "./amendment-request";

describe("date helpers", () => {
  it("adds days across month boundaries (UTC)", () => {
    expect(addDays("2026-08-15", 60)).toBe("2026-10-14");
    expect(addDays("2026-08-15", 90)).toBe("2026-11-13");
  });
  it("counts whole days between dates", () => {
    expect(daysBetween("2026-09-07", "2026-10-14")).toBe(37);
    expect(daysBetween("2026-10-14", "2026-09-07")).toBe(-37);
  });
});

describe("deriveDenialGround", () => {
  const base = {
    inDesignatedRecordSet: true,
    coveredEntityIsOriginator: true,
    originatorAvailable: true,
    availableForAccess: true,
    recordAccurateAndComplete: false
  };
  it("returns null when the amendment should be accepted", () => {
    expect(deriveDenialGround(base)).toBeNull();
  });
  it("denies outside the designated record set first", () => {
    expect(deriveDenialGround({ ...base, inDesignatedRecordSet: false })).toBe(
      "ground.not-in-designated-record-set"
    );
  });
  it("denies when not available for access", () => {
    expect(deriveDenialGround({ ...base, availableForAccess: false })).toBe(
      "ground.not-available-for-access"
    );
  });
  it("denies when the CE is not the originator and the originator is available", () => {
    expect(
      deriveDenialGround({ ...base, coveredEntityIsOriginator: false, originatorAvailable: true })
    ).toBe("ground.not-originator");
  });
  it("accepts when the CE is not the originator but the originator is unavailable", () => {
    expect(
      deriveDenialGround({ ...base, coveredEntityIsOriginator: false, originatorAvailable: false })
    ).toBeNull();
  });
  it("denies when the record is accurate and complete", () => {
    expect(deriveDenialGround({ ...base, recordAccurateAndComplete: true })).toBe(
      "ground.accurate-and-complete"
    );
  });
});

describe("evaluateAmendment", () => {
  it("recommends accept for a correctable clinical note, due in 60 days", () => {
    const d = evaluateAmendment(DEMO_AMENDMENT_REQUEST);
    expect(d.disposition).toBe("recommend-accept");
    expect(d.deniedOnGround).toBeNull();
    expect(d.responseDeadline).toBe("2026-10-14");
    expect(d.daysUntilDeadline).toBe(37);
    expect(d.patientMayStatementOfDisagreement).toBe(false);
    expect(d.autoAmended).toBe(false);
    expect(d.autoDenied).toBe(false);
    expect(d.requiresHumanReview).toBe(true);
  });

  it("recommends deny on the accurate-and-complete ground", () => {
    const d = evaluateAmendment(DEMO_AMENDMENT_ACCURATE_REQUEST);
    expect(d.disposition).toBe("recommend-deny");
    expect(d.deniedOnGround).toBe("ground.accurate-and-complete");
    expect(d.patientMayStatementOfDisagreement).toBe(true);
  });

  it("recommends deny on the not-originator ground", () => {
    const d = evaluateAmendment(DEMO_AMENDMENT_NOT_ORIGINATOR_REQUEST);
    expect(d.disposition).toBe("recommend-deny");
    expect(d.deniedOnGround).toBe("ground.not-originator");
  });

  it("computes a 90-day deadline when the extension is invoked", () => {
    const d = evaluateAmendment(DEMO_AMENDMENT_EXTENSION_REQUEST);
    expect(d.extensionInvoked).toBe(true);
    expect(d.responseDeadline).toBe("2026-11-13");
    expect(d.disposition).toBe("recommend-accept");
  });

  it("is deterministic — same request yields the same determination", () => {
    expect(evaluateAmendment(DEMO_AMENDMENT_ACCURATE_REQUEST)).toEqual(
      evaluateAmendment(DEMO_AMENDMENT_ACCURATE_REQUEST)
    );
  });
});

describe("getAmendmentDenialGround", () => {
  it("resolves a cataloged ground", () => {
    expect(getAmendmentDenialGround("ground.not-originator")?.name).toContain("did not create");
  });
  it("returns undefined off-catalog", () => {
    expect(getAmendmentDenialGround("ground.nope")).toBeUndefined();
  });
  it("every ground has a description", () => {
    for (const g of AMENDMENT_DENIAL_GROUNDS) {
      expect(g.description).toBeTruthy();
    }
  });
});

describe("amendmentGroundSourced", () => {
  it("passes a produced accept (no ground)", () => {
    expect(amendmentGroundSourced(evaluateAmendment(DEMO_AMENDMENT_REQUEST))).toBe(true);
  });
  it("passes a produced deny (cataloged ground)", () => {
    expect(amendmentGroundSourced(evaluateAmendment(DEMO_AMENDMENT_ACCURATE_REQUEST))).toBe(true);
  });
  it("fails a deny on an off-catalog ground", () => {
    expect(
      amendmentGroundSourced({ disposition: "recommend-deny", deniedOnGround: "ground.nope" })
    ).toBe(false);
  });
  it("fails a deny with no ground", () => {
    expect(amendmentGroundSourced({ disposition: "recommend-deny", deniedOnGround: null })).toBe(
      false
    );
  });
  it("fails an accept that asserts a ground", () => {
    expect(
      amendmentGroundSourced({ disposition: "recommend-accept", deniedOnGround: "ground.not-originator" })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(amendmentGroundSourced(null)).toBe(false);
  });
});

describe("amendmentDeadlineComputed", () => {
  it("passes a produced determination", () => {
    expect(amendmentDeadlineComputed(evaluateAmendment(DEMO_AMENDMENT_REQUEST))).toBe(true);
  });
  it("passes the 90-day extension case", () => {
    expect(amendmentDeadlineComputed(evaluateAmendment(DEMO_AMENDMENT_EXTENSION_REQUEST))).toBe(true);
  });
  it("fails a mis-stated deadline", () => {
    const d = evaluateAmendment(DEMO_AMENDMENT_REQUEST);
    expect(amendmentDeadlineComputed({ ...d, responseDeadline: "2026-12-31" })).toBe(false);
  });
  it("uses requestContext when the determination omits the dates", () => {
    expect(
      amendmentDeadlineComputed(
        { responseDeadline: "2026-10-14", daysUntilDeadline: 37 },
        { requestDate: "2026-08-15", asOfDate: "2026-09-07" }
      )
    ).toBe(true);
  });
  it("fails a null / malformed input", () => {
    expect(amendmentDeadlineComputed(null)).toBe(false);
    expect(amendmentDeadlineComputed({})).toBe(false);
  });
});

describe("amendmentNoAutonomousWrite", () => {
  it("passes a produced determination", () => {
    expect(amendmentNoAutonomousWrite(evaluateAmendment(DEMO_AMENDMENT_REQUEST))).toBe(true);
  });
  it("fails an autonomously-amended record", () => {
    expect(
      amendmentNoAutonomousWrite({ autoAmended: true, autoDenied: false, requiresHumanReview: true })
    ).toBe(false);
  });
  it("fails an autonomously-denied request", () => {
    expect(
      amendmentNoAutonomousWrite({ autoAmended: false, autoDenied: true, requiresHumanReview: true })
    ).toBe(false);
  });
  it("fails an un-reviewed determination", () => {
    expect(
      amendmentNoAutonomousWrite({ autoAmended: false, autoDenied: false, requiresHumanReview: false })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(amendmentNoAutonomousWrite(null)).toBe(false);
  });
});

describe("amendmentSummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = amendmentSummary(evaluateAmendment(DEMO_AMENDMENT_ACCURATE_REQUEST));
    expect(s.disposition).toBe("recommend-deny");
    expect(s.deniedOnGround).toBe("ground.accurate-and-complete");
    expect(s.requiresHumanReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
