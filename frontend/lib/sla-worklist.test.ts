import { describe, expect, it } from "vitest";

import {
  DEMO_WORKLIST_ALL_ON_TIME_REQUEST,
  DEMO_WORKLIST_REQUEST,
  DEMO_WORKLIST_TIGHT_REQUEST,
  edfSchedule,
  evaluateWorklist,
  noAutonomousDispatch,
  scheduleOrdered,
  scheduleSourced,
  worklistSummary
} from "./sla-worklist";

describe("edfSchedule", () => {
  it("orders by earliest deadline and chains completion times", () => {
    const s = edfSchedule(DEMO_WORKLIST_REQUEST.tasks);
    expect(s.map((x) => x.taskId)).toEqual(["auth-502", "auth-501", "auth-504", "auth-503"]);
    expect(s.map((x) => x.completionTime)).toEqual([20, 50, 75, 115]);
    expect(s.find((x) => x.taskId === "auth-504")?.late).toBe(true);
  });

  it("breaks deadline ties by lexical case id", () => {
    const s = edfSchedule([
      { taskId: "b", duration: 5, deadline: 10 },
      { taskId: "a", duration: 5, deadline: 10 }
    ]);
    expect(s.map((x) => x.taskId)).toEqual(["a", "b"]);
  });

  it("returns empty for no tasks", () => {
    expect(edfSchedule([])).toEqual([]);
  });
});

describe("evaluateWorklist", () => {
  it("classifies a worklist with breaches", () => {
    const d = evaluateWorklist(DEMO_WORKLIST_REQUEST);
    expect(d.disposition).toBe("breaches-present");
    expect(d.lateCount).toBe(1);
    expect(d.onTimeCount).toBe(3);
    expect(d.total).toBe(4);
    expect(d.requiresReviewerReview).toBe(true);
    expect(d.autoDispatched).toBe(false);
  });

  it("classifies an all-on-time worklist", () => {
    const d = evaluateWorklist(DEMO_WORKLIST_ALL_ON_TIME_REQUEST);
    expect(d.disposition).toBe("all-on-time");
    expect(d.lateCount).toBe(0);
  });

  it("flags an over-committed worklist (two breaches)", () => {
    const d = evaluateWorklist(DEMO_WORKLIST_TIGHT_REQUEST);
    expect(d.lateCount).toBe(2);
    expect(d.disposition).toBe("breaches-present");
  });

  it("is deterministic", () => {
    expect(evaluateWorklist(DEMO_WORKLIST_REQUEST)).toEqual(evaluateWorklist(DEMO_WORKLIST_REQUEST));
  });
});

describe("scheduleSourced", () => {
  it("is true for each demo schedule", () => {
    expect(scheduleSourced(evaluateWorklist(DEMO_WORKLIST_REQUEST))).toBe(true);
    expect(scheduleSourced(evaluateWorklist(DEMO_WORKLIST_ALL_ON_TIME_REQUEST))).toBe(true);
    expect(scheduleSourced(evaluateWorklist(DEMO_WORKLIST_TIGHT_REQUEST))).toBe(true);
  });

  it("is false for a fabricated case (isolated from edf-ordered)", () => {
    const d = evaluateWorklist(DEMO_WORKLIST_REQUEST);
    // Replace the last scheduled entry's id with a phantom, keeping the real cases' order intact.
    const scheduled = d.scheduled.map((s) =>
      s.taskId === "auth-503" ? { ...s, taskId: "phantom-case" } : s
    );
    const tampered = { ...d, scheduled };
    expect(scheduleSourced(tampered)).toBe(false);
    expect(scheduleOrdered(tampered)).toBe(true);
  });

  it("is false for a mis-chained completion time", () => {
    const d = evaluateWorklist(DEMO_WORKLIST_REQUEST);
    const scheduled = d.scheduled.map((s, i) =>
      i === 1 ? { ...s, completionTime: s.completionTime + 5 } : s
    );
    expect(scheduleSourced({ ...d, scheduled })).toBe(false);
  });

  it("is false when the counts don't add up", () => {
    const d = evaluateWorklist(DEMO_WORKLIST_REQUEST);
    expect(scheduleSourced({ ...d, lateCount: 0 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(scheduleSourced(null)).toBe(false);
  });
});

describe("scheduleOrdered", () => {
  it("is true for each demo schedule", () => {
    expect(scheduleOrdered(evaluateWorklist(DEMO_WORKLIST_REQUEST))).toBe(true);
    expect(scheduleOrdered(evaluateWorklist(DEMO_WORKLIST_TIGHT_REQUEST))).toBe(true);
  });

  it("is false for a non-EDF order (while schedule-sourced stays true)", () => {
    const d = evaluateWorklist(DEMO_WORKLIST_REQUEST);
    // Swap auth-501 (deadline 60) ahead of auth-502 (deadline 40) — a non-EDF order, self-consistently timed.
    const scheduled = [
      { taskId: "auth-501", duration: 30, deadline: 60, startTime: 0, completionTime: 30, late: false, label: "Prior-auth review" },
      { taskId: "auth-502", duration: 20, deadline: 40, startTime: 30, completionTime: 50, late: true, label: "Urgent prior-auth" },
      { taskId: "auth-504", duration: 25, deadline: 70, startTime: 50, completionTime: 75, late: true, label: "Prior-auth review" },
      { taskId: "auth-503", duration: 40, deadline: 200, startTime: 75, completionTime: 115, late: false, label: "Concurrent review" }
    ];
    const tampered = { ...d, scheduled, lateCount: 2, onTimeCount: 2, disposition: "breaches-present" as const };
    expect(scheduleSourced(tampered)).toBe(true);
    expect(scheduleOrdered(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(scheduleOrdered(undefined)).toBe(false);
  });
});

describe("noAutonomousDispatch", () => {
  it("is true for a produced worklist", () => {
    expect(noAutonomousDispatch(evaluateWorklist(DEMO_WORKLIST_REQUEST))).toBe(true);
  });

  it("is false when auto-dispatched", () => {
    const d = evaluateWorklist(DEMO_WORKLIST_REQUEST);
    expect(noAutonomousDispatch({ ...d, autoDispatched: true as unknown as false })).toBe(false);
  });

  it("is false when reviewer review is skipped", () => {
    const d = evaluateWorklist(DEMO_WORKLIST_REQUEST);
    expect(noAutonomousDispatch({ ...d, requiresReviewerReview: false as unknown as true })).toBe(
      false
    );
  });

  it("is false for a non-object", () => {
    expect(noAutonomousDispatch(null)).toBe(false);
  });
});

describe("worklistSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateWorklist(DEMO_WORKLIST_REQUEST);
    expect(worklistSummary(d)).toEqual({
      queueRef: "um-worklist-am",
      disposition: "breaches-present",
      taskCount: 4,
      lateCount: 1,
      onTimeCount: 3,
      total: 4,
      requiresReviewerReview: true,
      synthetic: true
    });
  });
});
