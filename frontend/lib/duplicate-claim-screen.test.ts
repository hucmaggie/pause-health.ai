import { describe, expect, it } from "vitest";

import {
  DEMO_DUPLICATE_SCREEN_CLEAR_REQUEST,
  DEMO_DUPLICATE_SCREEN_REQUEST,
  DEMO_DUPLICATE_SCREEN_SATURATED_REQUEST,
  buildBloomBits,
  bloomQuery,
  duplicateScreenSummary,
  estimateFalsePositiveRate,
  evaluateDuplicateScreen,
  filterSourced,
  membershipExact,
  noAutonomousReject
} from "./duplicate-claim-screen";

describe("buildBloomBits / bloomQuery", () => {
  it("never yields a false negative for an inserted id", () => {
    const bits = buildBloomBits(DEMO_DUPLICATE_SCREEN_REQUEST);
    for (const id of DEMO_DUPLICATE_SCREEN_REQUEST.processedIds) {
      expect(bloomQuery(id, bits, DEMO_DUPLICATE_SCREEN_REQUEST.hashCount)).toBe("possibly-duplicate");
    }
  });

  it("is deterministic (same ids + config → same bits)", () => {
    expect(buildBloomBits(DEMO_DUPLICATE_SCREEN_REQUEST)).toEqual(
      buildBloomBits(DEMO_DUPLICATE_SCREEN_REQUEST)
    );
  });
});

describe("estimateFalsePositiveRate", () => {
  it("matches the standard (1 - e^(-k*n/m))^k formula", () => {
    expect(estimateFalsePositiveRate(64, 3, 6)).toBe(0.014735);
    expect(estimateFalsePositiveRate(16, 3, 8)).toBe(0.468862);
  });
});

describe("evaluateDuplicateScreen", () => {
  it("flags re-submitted ids as possible duplicates and new ids as definitely-new", () => {
    const d = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST);
    expect(d.disposition).toBe("possible-duplicates");
    expect(d.possibleDuplicateCount).toBe(3);
    expect(d.definitelyNewCount).toBe(2);
    expect(d.setBitCount).toBe(16);
    expect(d.estimatedFalsePositiveRate).toBe(0.014735);
    expect(d.requiresAdjudicatorReview).toBe(true);
    expect(d.autoRejected).toBe(false);
    // The three re-submissions are exactly the processed ids that reappear.
    const dups = d.results.filter((r) => r.verdict === "possibly-duplicate").map((r) => r.id);
    expect(dups).toEqual(["CLM-88002", "CLM-88005", "CLM-88001"]);
  });

  it("classifies an all-clear batch", () => {
    const d = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_CLEAR_REQUEST);
    expect(d.disposition).toBe("all-clear");
    expect(d.possibleDuplicateCount).toBe(0);
  });

  it("shows the space/accuracy trade-off on a saturated filter", () => {
    const d = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_SATURATED_REQUEST);
    expect(d.estimatedFalsePositiveRate).toBeGreaterThan(0.4);
    // Z9 was never inserted but collides — an honest false positive routed to the exact check.
    const z9 = d.results.find((r) => r.id === "Z9");
    expect(z9?.verdict).toBe("possibly-duplicate");
  });

  it("is deterministic", () => {
    expect(evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST)).toEqual(
      evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST)
    );
  });
});

describe("filterSourced", () => {
  it("is true for each demo screen", () => {
    expect(filterSourced(evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST))).toBe(true);
    expect(filterSourced(evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_CLEAR_REQUEST))).toBe(true);
    expect(filterSourced(evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_SATURATED_REQUEST))).toBe(true);
  });

  it("is false for a fabricated bit array", () => {
    const d = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST);
    const bits = d.bits.slice();
    bits[0] = bits[0] === 1 ? 0 : 1;
    expect(filterSourced({ ...d, bits, setBitCount: bits.reduce((s, b) => s + b, 0) })).toBe(false);
  });

  it("is false for a verdict that contradicts the reported array", () => {
    const d = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST);
    const results = d.results.map((r, i) =>
      i === 1 ? { ...r, verdict: "possibly-duplicate" as const } : r
    );
    expect(filterSourced({ ...d, results, possibleDuplicateCount: 4, definitelyNewCount: 1 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(filterSourced(null)).toBe(false);
  });
});

describe("membershipExact", () => {
  it("is true for each demo screen", () => {
    expect(membershipExact(evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST))).toBe(true);
    expect(membershipExact(evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_SATURATED_REQUEST))).toBe(true);
  });

  it("is false for a false negative (a known duplicate reported as definitely-new), while filter-sourced can differ", () => {
    const d = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST);
    // Flip a true-duplicate verdict to definitely-new — the one failure a Bloom filter must never make.
    const results = d.results.map((r) =>
      r.id === "CLM-88002" ? { ...r, verdict: "definitely-new" as const } : r
    );
    const tampered = { ...d, results, possibleDuplicateCount: 2, definitelyNewCount: 3 };
    expect(membershipExact(tampered)).toBe(false);
  });

  it("is false for a wrong false-positive-rate estimate", () => {
    const d = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST);
    expect(membershipExact({ ...d, estimatedFalsePositiveRate: 0.5 })).toBe(false);
  });

  it("is isolable from filter-sourced (fabricated array, honest verdicts)", () => {
    const d = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST);
    // Corrupt the reported array but keep the verdicts matching the TRUE membership: filter-sourced fails
    // (array not consistent with those verdicts / not the real insert), membership-exact still passes (it
    // re-derives from the ids, ignoring the reported array).
    const bits = new Array(d.bits.length).fill(1);
    expect(membershipExact({ ...d, bits })).toBe(true);
    expect(filterSourced({ ...d, bits, setBitCount: bits.length })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(membershipExact(undefined)).toBe(false);
  });
});

describe("noAutonomousReject", () => {
  it("is true for a produced screen", () => {
    expect(noAutonomousReject(evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST))).toBe(true);
  });

  it("is false when auto-rejected", () => {
    const d = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST);
    expect(noAutonomousReject({ ...d, autoRejected: true as unknown as false })).toBe(false);
  });

  it("is false when adjudicator review is skipped", () => {
    const d = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST);
    expect(noAutonomousReject({ ...d, requiresAdjudicatorReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousReject(null)).toBe(false);
  });
});

describe("duplicateScreenSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST);
    expect(duplicateScreenSummary(d)).toEqual({
      batchRef: "claims-batch-2026-09-1180",
      disposition: "possible-duplicates",
      processedCount: 6,
      incomingCount: 5,
      possibleDuplicateCount: 3,
      definitelyNewCount: 2,
      setBitCount: 16,
      estimatedFalsePositiveRate: 0.014735,
      requiresAdjudicatorReview: true,
      synthetic: true
    });
  });
});
