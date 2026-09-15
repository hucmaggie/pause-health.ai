import { describe, expect, it } from "vitest";

import {
  DEMO_STATUS_TIMELINE_INCOMPRESSIBLE_REQUEST,
  DEMO_STATUS_TIMELINE_REQUEST,
  DEMO_STATUS_TIMELINE_STABLE_REQUEST,
  encodingSourced,
  evaluateStatusTimeline,
  noAutonomousWrite,
  runLengthDecode,
  runLengthEncode,
  runsCanonical,
  statusTimelineSummary
} from "./status-timeline-rle";

describe("runLengthEncode / runLengthDecode", () => {
  it("coalesces maximal runs and round-trips losslessly", () => {
    const runs = runLengthEncode(DEMO_STATUS_TIMELINE_REQUEST.statuses);
    expect(runs).toEqual([
      { value: "normal", length: 5 },
      { value: "high", length: 3 },
      { value: "normal", length: 4 },
      { value: "sync-error", length: 1 },
      { value: "normal", length: 3 }
    ]);
    expect(runLengthDecode(runs)).toEqual(DEMO_STATUS_TIMELINE_REQUEST.statuses);
  });

  it("yields one run per slot when nothing repeats", () => {
    expect(runLengthEncode(["on", "off", "on"]).length).toBe(3);
  });

  it("handles the empty stream", () => {
    expect(runLengthEncode([])).toEqual([]);
    expect(runLengthDecode([])).toEqual([]);
  });
});

describe("evaluateStatusTimeline", () => {
  it("classifies a compressible stream", () => {
    const d = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST);
    expect(d.disposition).toBe("compressible");
    expect(d.runCount).toBe(5);
    expect(d.originalLength).toBe(16);
    expect(d.compressionRatio).toBe(3.2);
    expect(d.longestRun).toBe(5);
    expect(d.dominantStatus).toBe("normal");
    expect(d.requiresStewardReview).toBe(true);
    expect(d.autoWritten).toBe(false);
  });

  it("classifies an incompressible (alternating) stream", () => {
    const d = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_INCOMPRESSIBLE_REQUEST);
    expect(d.disposition).toBe("incompressible");
    expect(d.compressionRatio).toBe(1);
  });

  it("maximally compresses one long stable run", () => {
    const d = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_STABLE_REQUEST);
    expect(d.runCount).toBe(1);
    expect(d.compressionRatio).toBe(8);
    expect(d.longestRun).toBe(8);
  });

  it("is deterministic", () => {
    expect(evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST)).toEqual(
      evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST)
    );
  });
});

describe("encodingSourced", () => {
  it("is true for each demo determination", () => {
    expect(encodingSourced(evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST))).toBe(true);
    expect(encodingSourced(evaluateStatusTimeline(DEMO_STATUS_TIMELINE_INCOMPRESSIBLE_REQUEST))).toBe(true);
    expect(encodingSourced(evaluateStatusTimeline(DEMO_STATUS_TIMELINE_STABLE_REQUEST))).toBe(true);
  });

  it("is true for an over-split (non-canonical) encoding that still decodes (isolated from runs-canonical)", () => {
    const d = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_STABLE_REQUEST);
    // Split the single occupied×8 run into occupied×5 + occupied×3 — still decodes to the same stream.
    const runs = [
      { value: "occupied", length: 5 },
      { value: "occupied", length: 3 }
    ];
    const tampered = { ...d, runs, runCount: 2, compressionRatio: 4, longestRun: 5 };
    expect(encodingSourced(tampered)).toBe(true);
    expect(runsCanonical(tampered)).toBe(false);
  });

  it("is false for a run list that doesn't decode to the stream", () => {
    const d = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST);
    const runs = d.runs.map((r, i) => (i === 0 ? { ...r, length: r.length + 1 } : r));
    expect(encodingSourced({ ...d, runs })).toBe(false);
  });

  it("is false for a zero-length run", () => {
    const d = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST);
    const runs = [{ value: "normal", length: 0 }, ...d.runs];
    expect(encodingSourced({ ...d, runs })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(encodingSourced(null)).toBe(false);
  });
});

describe("runsCanonical", () => {
  it("is true for each demo determination", () => {
    expect(runsCanonical(evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST))).toBe(true);
    expect(runsCanonical(evaluateStatusTimeline(DEMO_STATUS_TIMELINE_STABLE_REQUEST))).toBe(true);
  });

  it("is false for a mis-merged run list", () => {
    const d = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST);
    // Drop a length so the runs no longer reproduce the canonical encoding.
    const runs = d.runs.map((r, i) => (i === 2 ? { ...r, length: r.length - 1 } : r));
    expect(runsCanonical({ ...d, runs })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(runsCanonical(undefined)).toBe(false);
  });
});

describe("noAutonomousWrite", () => {
  it("is true for a produced encoding", () => {
    expect(noAutonomousWrite(evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST))).toBe(true);
  });

  it("is false when auto-written", () => {
    const d = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST);
    expect(noAutonomousWrite({ ...d, autoWritten: true as unknown as false })).toBe(false);
  });

  it("is false when steward review is skipped", () => {
    const d = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST);
    expect(noAutonomousWrite({ ...d, requiresStewardReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousWrite(null)).toBe(false);
  });
});

describe("statusTimelineSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST);
    expect(statusTimelineSummary(d)).toEqual({
      streamRef: "rpm-device-status-2026-6601",
      disposition: "compressible",
      originalLength: 16,
      runCount: 5,
      compressionRatio: 3.2,
      longestRun: 5,
      dominantStatus: "normal",
      requiresStewardReview: true,
      synthetic: true
    });
  });
});
