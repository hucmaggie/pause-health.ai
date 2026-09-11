import { describe, expect, it } from "vitest";

import {
  DEMO_OUTREACH_ALL_REQUEST,
  DEMO_OUTREACH_REQUEST,
  DEMO_OUTREACH_TIGHT_REQUEST,
  allocationOptimal,
  evaluateOutreachPrioritization,
  knapsack,
  noAutonomousSchedule,
  outreachSummary,
  selectionsSourced
} from "./outreach-prioritization";

describe("knapsack", () => {
  it("selects the optimal max-benefit feasible subset", () => {
    const { selected, optimum } = knapsack(DEMO_OUTREACH_REQUEST.candidates, 10);
    expect(optimum).toBe(140);
    expect(selected.map((s) => s.id).sort()).toEqual(
      ["iv-dexa-reminder", "iv-education", "iv-hrt-titration"].sort()
    );
  });

  it("returns everything when capacity is ample", () => {
    const { optimum } = knapsack(DEMO_OUTREACH_ALL_REQUEST.candidates, 14);
    expect(optimum).toBe(180);
  });
});

describe("evaluateOutreachPrioritization", () => {
  it("defers a lower-value intervention under a tight-ish capacity (some-deferred)", () => {
    const d = evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST);
    expect(d.disposition).toBe("some-deferred");
    expect(d.totalBenefit).toBe(140);
    expect(d.totalCost).toBe(10);
    expect(d.remainingCapacity).toBe(0);
    expect(d.deferred.map((c) => c.id)).toEqual(["iv-sdoh-checkin"]);
    expect(d.requiresCareLeadReview).toBe(true);
    expect(d.autoScheduled).toBe(false);
  });

  it("schedules everything when capacity fits all candidates (all-scheduled)", () => {
    const d = evaluateOutreachPrioritization(DEMO_OUTREACH_ALL_REQUEST);
    expect(d.disposition).toBe("all-scheduled");
    expect(d.deferred).toHaveLength(0);
    expect(d.totalBenefit).toBe(180);
  });

  it("defers two interventions under a tight capacity", () => {
    const d = evaluateOutreachPrioritization(DEMO_OUTREACH_TIGHT_REQUEST);
    expect(d.disposition).toBe("some-deferred");
    expect(d.totalBenefit).toBe(80);
    expect(d.selected.map((c) => c.id)).toEqual(["iv-dexa-reminder", "iv-education"]);
  });

  it("is deterministic", () => {
    expect(evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST)).toEqual(
      evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST)
    );
  });
});

describe("selectionsSourced", () => {
  it("is true for each demo allocation", () => {
    expect(selectionsSourced(evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST))).toBe(true);
    expect(selectionsSourced(evaluateOutreachPrioritization(DEMO_OUTREACH_ALL_REQUEST))).toBe(true);
    expect(selectionsSourced(evaluateOutreachPrioritization(DEMO_OUTREACH_TIGHT_REQUEST))).toBe(true);
  });

  it("is false when a phantom intervention is added (isolated from allocation-optimal)", () => {
    const d = evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST);
    const tampered = {
      ...d,
      selected: [...d.selected, { id: "phantom", cost: 0, benefit: 0 }]
    };
    expect(selectionsSourced(tampered)).toBe(false);
    // The optimality check filters the phantom out and still recomputes the real optimum.
    expect(allocationOptimal(tampered)).toBe(true);
  });

  it("is false when a candidate is dropped from both lists", () => {
    const d = evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST);
    const tampered = { ...d, deferred: [] };
    expect(selectionsSourced(tampered)).toBe(false);
  });

  it("is false when a selected item's cost doesn't match the candidate", () => {
    const d = evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST);
    const tampered = {
      ...d,
      selected: d.selected.map((s) => (s.id === "iv-hrt-titration" ? { ...s, cost: 99 } : s))
    };
    expect(selectionsSourced(tampered)).toBe(false);
  });

  it("is false when the total benefit is miscounted", () => {
    const d = evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST);
    expect(selectionsSourced({ ...d, totalBenefit: 999 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(selectionsSourced(null)).toBe(false);
  });
});

describe("allocationOptimal", () => {
  it("is true for each demo allocation", () => {
    expect(allocationOptimal(evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST))).toBe(true);
    expect(allocationOptimal(evaluateOutreachPrioritization(DEMO_OUTREACH_ALL_REQUEST))).toBe(true);
    expect(allocationOptimal(evaluateOutreachPrioritization(DEMO_OUTREACH_TIGHT_REQUEST))).toBe(true);
  });

  it("is false for a sub-optimal allocation (while selections-sourced stays true)", () => {
    const d = evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST);
    const hrt = d.candidates.find((c) => c.id === "iv-hrt-titration")!;
    const sdoh = d.candidates.find((c) => c.id === "iv-sdoh-checkin")!;
    const dexa = d.candidates.find((c) => c.id === "iv-dexa-reminder")!;
    const edu = d.candidates.find((c) => c.id === "iv-education")!;
    // A real, feasible, but sub-optimal subset: {hrt, sdoh} = benefit 100 < optimum 140.
    const tampered = {
      ...d,
      selected: [hrt, sdoh],
      deferred: [dexa, edu],
      totalCost: 9,
      totalBenefit: 100,
      remainingCapacity: 1
    };
    expect(selectionsSourced(tampered)).toBe(true);
    expect(allocationOptimal(tampered)).toBe(false);
  });

  it("is false for an over-capacity allocation", () => {
    const d = evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST);
    const tampered = { ...d, selected: [...d.candidates], deferred: [] };
    expect(allocationOptimal(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(allocationOptimal(undefined)).toBe(false);
  });
});

describe("noAutonomousSchedule", () => {
  it("is true for a produced allocation", () => {
    expect(noAutonomousSchedule(evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST))).toBe(true);
  });

  it("is false when auto-scheduled", () => {
    const d = evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST);
    expect(noAutonomousSchedule({ ...d, autoScheduled: true as unknown as false })).toBe(false);
  });

  it("is false when care-lead review is skipped", () => {
    const d = evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST);
    expect(noAutonomousSchedule({ ...d, requiresCareLeadReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousSchedule(null)).toBe(false);
  });
});

describe("outreachSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST);
    expect(outreachSummary(d)).toEqual({
      cycleRef: "outreach-cycle-001",
      disposition: "some-deferred",
      candidateCount: 4,
      selectedCount: 3,
      deferredCount: 1,
      totalBenefit: 140,
      totalCost: 10,
      remainingCapacity: 0,
      requiresCareLeadReview: true,
      synthetic: true
    });
  });
});
