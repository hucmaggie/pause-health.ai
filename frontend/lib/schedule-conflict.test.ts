import { describe, expect, it } from "vitest";

import {
  DEMO_SCHEDULE_CONFLICT_MAXIMIZE_REQUEST,
  DEMO_SCHEDULE_CONFLICT_REQUEST,
  DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST,
  evaluateScheduleConflict,
  intervalsOverlap,
  scheduleConflictFree,
  scheduleConflictSummary,
  scheduleIntervalsSourced,
  scheduleNoAutonomousBooking,
  toEpochMs
} from "./schedule-conflict";

describe("toEpochMs", () => {
  it("passes through epoch-ms numbers", () => {
    expect(toEpochMs(1000)).toBe(1000);
    expect(toEpochMs(1000.9)).toBe(1000);
  });
  it("parses ISO strings deterministically (UTC)", () => {
    expect(toEpochMs("2026-03-02T09:00:00Z")).toBe(Date.parse("2026-03-02T09:00:00Z"));
  });
  it("returns null for garbage", () => {
    expect(toEpochMs("not-a-date")).toBeNull();
    expect(toEpochMs(Number.NaN)).toBeNull();
  });
});

describe("intervalsOverlap", () => {
  it("touching intervals do NOT overlap", () => {
    expect(intervalsOverlap(0, 10, 10, 20)).toBe(false);
  });
  it("overlapping intervals do", () => {
    expect(intervalsOverlap(0, 10, 5, 15)).toBe(true);
  });
});

describe("evaluateScheduleConflict", () => {
  it("schedules non-overlapping requests conflict-free", () => {
    const d = evaluateScheduleConflict(DEMO_SCHEDULE_CONFLICT_REQUEST);
    expect(d.disposition).toBe("conflict-free");
    expect(d.scheduledCount).toBe(3);
    expect(d.conflictCount).toBe(0);
    expect(d.requiresSchedulerReview).toBe(true);
    expect(d.autoBooked).toBe(false);
  });

  it("waitlists overlapping requests via earliest-finish greedy", () => {
    const d = evaluateScheduleConflict(DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST);
    expect(d.disposition).toBe("conflicts-waitlisted");
    expect(d.scheduled.map((s) => s.requestId)).toEqual(["r1", "r3"]);
    expect(d.conflicts.map((c) => c.requestId).sort()).toEqual(["r2", "r4"]);
    // Both conflict with the 9-10 appointment (r1).
    for (const c of d.conflicts) expect(c.conflictsWith).toBe("r1");
  });

  it("maximizes count (two short beat one long)", () => {
    const d = evaluateScheduleConflict(DEMO_SCHEDULE_CONFLICT_MAXIMIZE_REQUEST);
    expect(d.scheduled.map((s) => s.requestId)).toEqual(["r2", "r3"]);
    expect(d.conflicts.map((c) => c.requestId)).toEqual(["r1"]);
  });

  it("skips invalid requests (bad time, zero duration, duplicate id)", () => {
    const d = evaluateScheduleConflict({
      requestRef: "r",
      resourceRef: "res",
      requests: [
        { requestId: "ok", memberId: "m1", start: "2026-03-02T09:00:00Z", end: "2026-03-02T09:30:00Z" },
        { requestId: "bad-time", memberId: "m2", start: "nope", end: "2026-03-02T10:00:00Z" },
        { requestId: "zero", memberId: "m3", start: 5000, end: 5000 },
        { requestId: "ok", memberId: "m4", start: 1000, end: 2000 } // duplicate id
      ]
    });
    expect(d.invalidRequests.sort()).toEqual(["bad-time", "ok", "zero"]);
    expect(d.intervals).toHaveLength(1);
    expect(d.scheduledCount).toBe(1);
  });

  it("is deterministic", () => {
    expect(evaluateScheduleConflict(DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST)).toEqual(
      evaluateScheduleConflict(DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST)
    );
  });

  it("produced determinations satisfy all three guards", () => {
    for (const req of [
      DEMO_SCHEDULE_CONFLICT_REQUEST,
      DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST,
      DEMO_SCHEDULE_CONFLICT_MAXIMIZE_REQUEST
    ]) {
      const d = evaluateScheduleConflict(req);
      expect(scheduleIntervalsSourced(d)).toBe(true);
      expect(scheduleConflictFree(d)).toBe(true);
      expect(scheduleNoAutonomousBooking(d)).toBe(true);
    }
  });
});

describe("scheduleIntervalsSourced", () => {
  it("fails a fabricated appointment (not a submitted request)", () => {
    expect(
      scheduleIntervalsSourced({
        intervals: [{ requestId: "r1", memberId: "m1", startMs: 0, endMs: 10 }],
        scheduled: [{ requestId: "phantom", memberId: "m1", startMs: 0, endMs: 10 }],
        conflicts: []
      })
    ).toBe(false);
  });
  it("fails an altered attribution", () => {
    expect(
      scheduleIntervalsSourced({
        intervals: [{ requestId: "r1", memberId: "m1", startMs: 0, endMs: 10 }],
        scheduled: [{ requestId: "r1", memberId: "m-ghost", startMs: 0, endMs: 10 }],
        conflicts: []
      })
    ).toBe(false);
  });
  it("fails a dropped request (not accounted for)", () => {
    expect(
      scheduleIntervalsSourced({
        intervals: [
          { requestId: "r1", memberId: "m1", startMs: 0, endMs: 10 },
          { requestId: "r2", memberId: "m2", startMs: 20, endMs: 30 }
        ],
        scheduled: [{ requestId: "r1", memberId: "m1", startMs: 0, endMs: 10 }],
        conflicts: []
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(scheduleIntervalsSourced(null)).toBe(false);
  });
});

describe("scheduleConflictFree", () => {
  it("fails a double-booked scheduled set", () => {
    expect(
      scheduleConflictFree({
        scheduled: [
          { requestId: "r1", startMs: 0, endMs: 100 },
          { requestId: "r2", startMs: 50, endMs: 150 }
        ],
        conflicts: [],
        scheduledCount: 2,
        conflictCount: 0,
        totalRequests: 2
      })
    ).toBe(false);
  });
  it("fails an unjust waitlist (conflict doesn't actually overlap)", () => {
    expect(
      scheduleConflictFree({
        scheduled: [{ requestId: "r1", startMs: 0, endMs: 10 }],
        conflicts: [{ startMs: 20, endMs: 30, conflictsWith: "r1" }],
        scheduledCount: 1,
        conflictCount: 1,
        totalRequests: 2
      })
    ).toBe(false);
  });
  it("fails a conflictsWith that names a non-scheduled interval", () => {
    expect(
      scheduleConflictFree({
        scheduled: [{ requestId: "r1", startMs: 0, endMs: 10 }],
        conflicts: [{ startMs: 5, endMs: 15, conflictsWith: "ghost" }],
        scheduledCount: 1,
        conflictCount: 1,
        totalRequests: 2
      })
    ).toBe(false);
  });
  it("passes a genuinely conflict-free schedule", () => {
    expect(
      scheduleConflictFree({
        scheduled: [
          { requestId: "r1", startMs: 0, endMs: 10 },
          { requestId: "r2", startMs: 10, endMs: 20 }
        ],
        conflicts: [{ startMs: 5, endMs: 15, conflictsWith: "r1" }],
        scheduledCount: 2,
        conflictCount: 1,
        totalRequests: 3
      })
    ).toBe(true);
  });
  it("fails a null input", () => {
    expect(scheduleConflictFree(null)).toBe(false);
  });
});

describe("scheduleNoAutonomousBooking", () => {
  it("fails an auto-booked schedule", () => {
    expect(scheduleNoAutonomousBooking({ autoBooked: true, requiresSchedulerReview: true })).toBe(false);
  });
  it("fails an un-reviewed schedule", () => {
    expect(scheduleNoAutonomousBooking({ autoBooked: false, requiresSchedulerReview: false })).toBe(false);
  });
  it("passes a produced determination", () => {
    expect(scheduleNoAutonomousBooking(evaluateScheduleConflict(DEMO_SCHEDULE_CONFLICT_REQUEST))).toBe(true);
  });
});

describe("scheduleConflictSummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = scheduleConflictSummary(evaluateScheduleConflict(DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST));
    expect(s.disposition).toBe("conflicts-waitlisted");
    expect(s.totalRequests).toBe(4);
    expect(s.scheduledCount).toBe(2);
    expect(s.conflictCount).toBe(2);
    expect(s.requiresSchedulerReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
