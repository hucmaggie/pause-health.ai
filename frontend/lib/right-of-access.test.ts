import { describe, expect, it } from "vitest";

import {
  ACCESS_EXCEPTIONS,
  DEMO_ACCESS_ENDANGER_REQUEST,
  DEMO_ACCESS_EXTENSION_REQUEST,
  DEMO_ACCESS_PSYCH_REQUEST,
  DEMO_ACCESS_REQUEST,
  accessDeadlineComputed,
  accessGroundSourced,
  accessNoAutonomousDenialOrRelease,
  accessSummary,
  addDays,
  daysBetween,
  evaluateAccess,
  getAccessException
} from "./right-of-access";

describe("date helpers", () => {
  it("addDays does pure UTC date math", () => {
    expect(addDays("2026-08-20", 30)).toBe("2026-09-19");
    expect(addDays("2026-08-20", 60)).toBe("2026-10-19");
    expect(addDays("2026-07-15", 30)).toBe("2026-08-14");
  });
  it("daysBetween is signed", () => {
    expect(daysBetween("2026-09-07", "2026-09-19")).toBe(12);
    expect(daysBetween("2026-09-07", "2026-08-14")).toBe(-24);
  });
});

describe("evaluateAccess", () => {
  it("grants a routine copy request in full, deadline +30", () => {
    const d = evaluateAccess(DEMO_ACCESS_REQUEST);
    expect(d.disposition).toBe("grant-in-full");
    expect(d.accessGranted).toBe(true);
    expect(d.responseDeadline).toBe("2026-09-19");
    expect(d.daysUntilDeadline).toBe(12);
    expect(d.autoReleased).toBe(false);
    expect(d.requiresHumanReview).toBe(true);
    expect(d.exceptionType).toBe("none");
  });

  it("denies psychotherapy notes as an unreviewable ground", () => {
    const d = evaluateAccess(DEMO_ACCESS_PSYCH_REQUEST);
    expect(d.disposition).toBe("deny-unreviewable");
    expect(d.accessGranted).toBe(false);
    expect(d.exceptionType).toBe("unreviewable");
    expect(d.responseDeadline).toBe("2026-09-24");
    expect(d.requiresHumanReview).toBe(true);
  });

  it("routes an endangerment concern to a reviewable denial (overdue as-of)", () => {
    const d = evaluateAccess(DEMO_ACCESS_ENDANGER_REQUEST);
    expect(d.disposition).toBe("deny-reviewable-needs-review");
    expect(d.exceptionType).toBe("reviewable");
    expect(d.responseDeadline).toBe("2026-08-14");
    expect(d.daysUntilDeadline).toBe(-24);
  });

  it("computes a +60 deadline when the extension is invoked", () => {
    const d = evaluateAccess(DEMO_ACCESS_EXTENSION_REQUEST);
    expect(d.disposition).toBe("grant-in-full");
    expect(d.extensionInvoked).toBe(true);
    expect(d.responseDeadline).toBe("2026-10-19");
    expect(d.daysUntilDeadline).toBe(42);
  });

  it("marks a request outside the designated record set", () => {
    const d = evaluateAccess({ ...DEMO_ACCESS_REQUEST, inDesignatedRecordSet: false });
    expect(d.disposition).toBe("not-accessible-outside-record-set");
    expect(d.accessGranted).toBe(false);
    expect(d.requiresHumanReview).toBe(true);
  });

  it("conservatively denies an off-catalog ground as unknown", () => {
    const d = evaluateAccess({ ...DEMO_ACCESS_REQUEST, exceptionId: "exception.nope" });
    expect(d.exceptionType).toBe("unknown");
    expect(d.disposition).toBe("deny-unreviewable");
    expect(d.accessGranted).toBe(false);
  });

  it("is deterministic — same request yields the same determination", () => {
    expect(evaluateAccess(DEMO_ACCESS_PSYCH_REQUEST)).toEqual(
      evaluateAccess(DEMO_ACCESS_PSYCH_REQUEST)
    );
  });
});

describe("getAccessException", () => {
  it("resolves a cataloged ground with its type", () => {
    expect(getAccessException("exception.psychotherapy-notes")?.type).toBe("unreviewable");
    expect(getAccessException("exception.endangerment-to-self-or-others")?.type).toBe("reviewable");
  });
  it("returns undefined for an off-catalog ground", () => {
    expect(getAccessException("exception.nope")).toBeUndefined();
  });
  it("every catalog entry has a type", () => {
    for (const e of ACCESS_EXCEPTIONS) {
      expect(["unreviewable", "reviewable"]).toContain(e.type);
    }
  });
});

describe("accessGroundSourced", () => {
  it("passes a full grant (no ground cited)", () => {
    expect(accessGroundSourced(evaluateAccess(DEMO_ACCESS_REQUEST))).toBe(true);
  });
  it("passes a cataloged denial ground", () => {
    expect(accessGroundSourced(evaluateAccess(DEMO_ACCESS_PSYCH_REQUEST))).toBe(true);
  });
  it("fails an off-catalog / unknown ground", () => {
    expect(
      accessGroundSourced({ exceptionId: "exception.nope", exceptionType: "unknown" })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(accessGroundSourced(null)).toBe(false);
  });
});

describe("accessDeadlineComputed", () => {
  it("passes a produced determination (with request context)", () => {
    const d = evaluateAccess(DEMO_ACCESS_REQUEST);
    expect(
      accessDeadlineComputed(d, {
        requestDate: DEMO_ACCESS_REQUEST.requestDate,
        asOfDate: DEMO_ACCESS_REQUEST.asOfDate
      })
    ).toBe(true);
  });
  it("fails a mis-stated deadline", () => {
    const d = evaluateAccess(DEMO_ACCESS_REQUEST);
    expect(
      accessDeadlineComputed(
        { ...d, responseDeadline: "2026-11-01" },
        { requestDate: DEMO_ACCESS_REQUEST.requestDate, asOfDate: DEMO_ACCESS_REQUEST.asOfDate }
      )
    ).toBe(false);
  });
  it("fails when request context is missing", () => {
    expect(accessDeadlineComputed({ responseDeadline: "2026-09-19" })).toBe(false);
  });
  it("fails a null input", () => {
    expect(accessDeadlineComputed(null)).toBe(false);
  });
});

describe("accessNoAutonomousDenialOrRelease", () => {
  it("passes a produced determination", () => {
    expect(accessNoAutonomousDenialOrRelease(evaluateAccess(DEMO_ACCESS_REQUEST))).toBe(true);
  });
  it("fails an auto-released determination", () => {
    expect(
      accessNoAutonomousDenialOrRelease({ autoReleased: true, requiresHumanReview: true })
    ).toBe(false);
  });
  it("fails an un-reviewed determination", () => {
    expect(
      accessNoAutonomousDenialOrRelease({ autoReleased: false, requiresHumanReview: false })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(accessNoAutonomousDenialOrRelease(null)).toBe(false);
  });
});

describe("accessSummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = accessSummary(evaluateAccess(DEMO_ACCESS_PSYCH_REQUEST));
    expect(s.disposition).toBe("deny-unreviewable");
    expect(s.responseDeadline).toBe("2026-09-24");
    expect(s.requiresHumanReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
