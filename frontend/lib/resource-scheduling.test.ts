import { describe, expect, it } from "vitest";

import {
  DEMO_BLOCK_SCHEDULE_ALL_REQUEST,
  DEMO_BLOCK_SCHEDULE_REQUEST,
  DEMO_BLOCK_SCHEDULE_WEIGHTED_REQUEST,
  blockScheduleSummary,
  evaluateBlockSchedule,
  noAutonomousBooking,
  selectionOptimal,
  selectionSourced,
  weightedIntervalSchedule
} from "./resource-scheduling";

describe("weightedIntervalSchedule", () => {
  it("selects the max-weight non-overlapping subset", () => {
    const r = weightedIntervalSchedule(DEMO_BLOCK_SCHEDULE_REQUEST.requests);
    expect(r.weight).toBe(11);
    expect(r.selected).toEqual(["infusion-1101", "infusion-1104"]);
  });

  it("prefers weight over count (one long block beats two short ones)", () => {
    const r = weightedIntervalSchedule(DEMO_BLOCK_SCHEDULE_WEIGHTED_REQUEST.requests);
    expect(r.weight).toBe(10);
    expect(r.selected).toEqual(["mri-3301"]);
  });

  it("selects all when nothing overlaps", () => {
    const r = weightedIntervalSchedule(DEMO_BLOCK_SCHEDULE_ALL_REQUEST.requests);
    expect(r.weight).toBe(12);
    expect(r.selected).toEqual(["or-2201", "or-2202", "or-2203"]);
  });

  it("returns empty for no requests", () => {
    expect(weightedIntervalSchedule([])).toEqual({ selected: [], weight: 0 });
  });
});

describe("evaluateBlockSchedule", () => {
  it("classifies a contended resource", () => {
    const d = evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST);
    expect(d.disposition).toBe("contended");
    expect(d.totalWeight).toBe(11);
    expect(d.scheduledCount).toBe(2);
    expect(d.contendedCount).toBe(3);
    expect(d.total).toBe(5);
    expect(d.requiresSchedulerReview).toBe(true);
    expect(d.autoBooked).toBe(false);
  });

  it("classifies an all-scheduled resource", () => {
    const d = evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_ALL_REQUEST);
    expect(d.disposition).toBe("all-scheduled");
    expect(d.contendedCount).toBe(0);
  });

  it("is deterministic", () => {
    expect(evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST)).toEqual(
      evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST)
    );
  });
});

describe("selectionSourced", () => {
  it("is true for each demo schedule", () => {
    expect(selectionSourced(evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST))).toBe(true);
    expect(selectionSourced(evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_ALL_REQUEST))).toBe(true);
    expect(selectionSourced(evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_WEIGHTED_REQUEST))).toBe(true);
  });

  it("is false for a fabricated block (isolated from schedule-optimal)", () => {
    const d = evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST);
    // Swap a selected id for one not in the batch; keep totalWeight at the optimum.
    const selected = d.selected.map((id) => (id === "infusion-1104" ? "phantom-block" : id));
    const tampered = { ...d, selected };
    expect(selectionSourced(tampered)).toBe(false);
    expect(selectionOptimal(tampered)).toBe(true);
  });

  it("is false for a double-booked resource (overlapping selection)", () => {
    const d = evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST);
    // infusion-1101 [0,3) and infusion-1102 [2,5) overlap.
    const tampered = {
      ...d,
      selected: ["infusion-1101", "infusion-1102"],
      totalWeight: 9,
      scheduledCount: 2,
      contendedCount: 3
    };
    expect(selectionSourced(tampered)).toBe(false);
  });

  it("is false when totalWeight doesn't match the selected sum", () => {
    const d = evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST);
    expect(selectionSourced({ ...d, totalWeight: 99 })).toBe(false);
  });

  it("is false when the counts don't add up", () => {
    const d = evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST);
    expect(selectionSourced({ ...d, contendedCount: 0 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(selectionSourced(null)).toBe(false);
  });
});

describe("selectionOptimal", () => {
  it("is true for each demo schedule", () => {
    expect(selectionOptimal(evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST))).toBe(true);
    expect(selectionOptimal(evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_WEIGHTED_REQUEST))).toBe(true);
  });

  it("is false for a sub-optimal schedule (while selection-sourced stays true)", () => {
    const d = evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST);
    // A feasible but sub-optimal subset: { infusion-1101 [0,3), infusion-1103 [4,7) } = weight 8 < 11.
    const tampered = {
      ...d,
      selected: ["infusion-1101", "infusion-1103"],
      totalWeight: 8,
      scheduledCount: 2,
      contendedCount: 3,
      disposition: "contended" as const
    };
    expect(selectionSourced(tampered)).toBe(true);
    expect(selectionOptimal(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(selectionOptimal(undefined)).toBe(false);
  });
});

describe("noAutonomousBooking", () => {
  it("is true for a produced schedule", () => {
    expect(noAutonomousBooking(evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST))).toBe(true);
  });

  it("is false when auto-booked", () => {
    const d = evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST);
    expect(noAutonomousBooking({ ...d, autoBooked: true as unknown as false })).toBe(false);
  });

  it("is false when scheduler review is skipped", () => {
    const d = evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST);
    expect(noAutonomousBooking({ ...d, requiresSchedulerReview: false as unknown as true })).toBe(
      false
    );
  });

  it("is false for a non-object", () => {
    expect(noAutonomousBooking(null)).toBe(false);
  });
});

describe("blockScheduleSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST);
    expect(blockScheduleSummary(d)).toEqual({
      resourceRef: "infusion-chair-3",
      disposition: "contended",
      requestCount: 5,
      scheduledCount: 2,
      contendedCount: 3,
      totalWeight: 11,
      total: 5,
      requiresSchedulerReview: true,
      synthetic: true
    });
  });
});
