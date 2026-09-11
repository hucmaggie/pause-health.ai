import { describe, expect, it } from "vitest";

import {
  type MergedEntry,
  DEMO_TIMELINE_MERGE_CLEAN_REQUEST,
  DEMO_TIMELINE_MERGE_REQUEST,
  DEMO_TIMELINE_MERGE_SINGLE_REQUEST,
  dedupKeyOf,
  eventsSourced,
  evaluateTimelineMerge,
  kWayMerge,
  mergeConsistent,
  noAutonomousMerge,
  timelineMergeSummary
} from "./timeline-merge";

describe("dedupKeyOf", () => {
  it("uses the explicit key when present, else kind|timestamp", () => {
    expect(dedupKeyOf({ eventId: "e", source: "s", timestamp: 5, kind: "visit" })).toBe("visit|5");
    expect(
      dedupKeyOf({ eventId: "e", source: "s", timestamp: 5, kind: "visit", dedupKey: "K" })
    ).toBe("K");
  });
});

describe("kWayMerge", () => {
  it("merges sorted streams into one chronological order (ties by source then eventId)", () => {
    const order = kWayMerge(DEMO_TIMELINE_MERGE_REQUEST.streams).map((e) => e.eventId);
    expect(order).toEqual(["a1", "b1", "a2", "c1", "b2", "c2"]);
  });

  it("sorts each stream defensively before merging", () => {
    const order = kWayMerge([
      {
        source: "s",
        events: [
          { eventId: "y", source: "s", timestamp: 20, kind: "k" },
          { eventId: "x", source: "s", timestamp: 10, kind: "k2" }
        ]
      }
    ]).map((e) => e.eventId);
    expect(order).toEqual(["x", "y"]);
  });
});

describe("evaluateTimelineMerge", () => {
  it("flags cross-source duplicates (duplicates-found)", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);
    expect(d.disposition).toBe("duplicates-found");
    expect(d.timeline.map((t) => t.eventId)).toEqual(["a1", "b1", "a2", "c1", "b2", "c2"]);
    expect(d.timeline.find((t) => t.eventId === "b1")?.duplicateOf).toBe("a1");
    expect(d.timeline.find((t) => t.eventId === "c1")?.duplicateOf).toBe("a2");
    expect(d.keptCount).toBe(4);
    expect(d.duplicateCount).toBe(2);
    expect(d.totalSubmitted).toBe(6);
    expect(d.requiresStewardReview).toBe(true);
    expect(d.autoWritten).toBe(false);
  });

  it("tallies per-source contributions sorted by source", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);
    expect(d.sourceContributions).toEqual([
      { source: "ehr-a", submitted: 2, kept: 2, duplicates: 0 },
      { source: "ehr-b", submitted: 2, kept: 1, duplicates: 1 },
      { source: "pharmacy", submitted: 2, kept: 1, duplicates: 1 }
    ]);
  });

  it("produces a clean merge when no content keys collide", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_CLEAN_REQUEST);
    expect(d.disposition).toBe("clean-merge");
    expect(d.duplicateCount).toBe(0);
    expect(d.timeline.map((t) => t.eventId)).toEqual(["a1", "d1", "a2", "d2"]);
  });

  it("handles a single already-ordered stream", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_SINGLE_REQUEST);
    expect(d.disposition).toBe("clean-merge");
    expect(d.timeline).toHaveLength(3);
  });

  it("is deterministic", () => {
    expect(evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST)).toEqual(
      evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST)
    );
  });
});

describe("eventsSourced", () => {
  it("is true for each demo merge", () => {
    expect(eventsSourced(evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST))).toBe(true);
    expect(eventsSourced(evaluateTimelineMerge(DEMO_TIMELINE_MERGE_CLEAN_REQUEST))).toBe(true);
    expect(eventsSourced(evaluateTimelineMerge(DEMO_TIMELINE_MERGE_SINGLE_REQUEST))).toBe(true);
  });

  it("is false when a phantom event is appended (isolated from merge-consistent)", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);
    const phantom: MergedEntry = {
      eventId: "x9",
      source: "ghost",
      timestamp: 999,
      kind: "phantom",
      dedupKey: "phantom|999",
      duplicateOf: null
    };
    const tampered = { ...d, timeline: [...d.timeline, phantom] };
    expect(eventsSourced(tampered)).toBe(false);
    // The consistency check filters the phantom out and still recomputes the real merge.
    expect(mergeConsistent(tampered)).toBe(true);
  });

  it("is false when a submitted event is dropped", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);
    const tampered = { ...d, timeline: d.timeline.filter((t) => t.eventId !== "c2") };
    expect(eventsSourced(tampered)).toBe(false);
  });

  it("is false when a timeline entry's timestamp doesn't match the submitted event", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);
    const tampered = {
      ...d,
      timeline: d.timeline.map((t) => (t.eventId === "a1" ? { ...t, timestamp: 12345 } : t))
    };
    expect(eventsSourced(tampered)).toBe(false);
  });

  it("is false when a per-source contribution is miscounted", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);
    const tampered = {
      ...d,
      sourceContributions: d.sourceContributions.map((c) =>
        c.source === "ehr-b" ? { ...c, duplicates: 0, kept: 2 } : c
      )
    };
    expect(eventsSourced(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(eventsSourced(null)).toBe(false);
  });
});

describe("mergeConsistent", () => {
  it("is true for each demo merge", () => {
    expect(mergeConsistent(evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST))).toBe(true);
    expect(mergeConsistent(evaluateTimelineMerge(DEMO_TIMELINE_MERGE_CLEAN_REQUEST))).toBe(true);
    expect(mergeConsistent(evaluateTimelineMerge(DEMO_TIMELINE_MERGE_SINGLE_REQUEST))).toBe(true);
  });

  it("is false when two events are out of order (while events-sourced stays true)", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);
    // Swap positions of b1 and a2 → timestamps go 100, 300, 100 (out of order) and the merge order is wrong.
    const reordered = [...d.timeline];
    const iB1 = reordered.findIndex((t) => t.eventId === "b1");
    const iA2 = reordered.findIndex((t) => t.eventId === "a2");
    [reordered[iB1], reordered[iA2]] = [reordered[iA2], reordered[iB1]];
    const tampered = { ...d, timeline: reordered };
    expect(eventsSourced(tampered)).toBe(true);
    expect(mergeConsistent(tampered)).toBe(false);
  });

  it("is false when a duplicate flag is wrong", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);
    const tampered = {
      ...d,
      timeline: d.timeline.map((t) => (t.eventId === "b1" ? { ...t, duplicateOf: null } : t))
    };
    expect(mergeConsistent(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(mergeConsistent(undefined)).toBe(false);
  });
});

describe("noAutonomousMerge", () => {
  it("is true for a produced merge", () => {
    expect(noAutonomousMerge(evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST))).toBe(true);
  });

  it("is false when auto-written", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);
    expect(noAutonomousMerge({ ...d, autoWritten: true as unknown as false })).toBe(false);
  });

  it("is false when steward review is skipped", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);
    expect(noAutonomousMerge({ ...d, requiresStewardReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousMerge(null)).toBe(false);
  });
});

describe("timelineMergeSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);
    expect(timelineMergeSummary(d)).toEqual({
      recordRef: "record-merge-001",
      disposition: "duplicates-found",
      totalSubmitted: 6,
      keptCount: 4,
      duplicateCount: 2,
      sourceCount: 3,
      requiresStewardReview: true,
      synthetic: true
    });
  });
});
