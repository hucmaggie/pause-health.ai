import { describe, expect, it } from "vitest";

import {
  DEMO_CONSENSUS_NO_MAJORITY_REQUEST,
  DEMO_CONSENSUS_REQUEST,
  DEMO_CONSENSUS_UNANIMOUS_REQUEST,
  boyerMooreMajority,
  consensusConsistent,
  consensusSummary,
  evaluateConsensus,
  noAutonomousWrite,
  votesSourced
} from "./source-consensus";

describe("boyerMooreMajority", () => {
  it("finds a strict-majority element", () => {
    expect(boyerMooreMajority(["a", "a", "a", "b", "c"])).toEqual({ candidate: "a", count: 3 });
  });

  it("returns null when no value has a strict majority (plurality)", () => {
    expect(boyerMooreMajority(["a", "a", "b", "b", "c"])).toEqual({ candidate: null, count: 0 });
  });

  it("handles unanimity and the empty list", () => {
    expect(boyerMooreMajority(["x", "x", "x"])).toEqual({ candidate: "x", count: 3 });
    expect(boyerMooreMajority([])).toEqual({ candidate: null, count: 0 });
  });

  it("finds the majority regardless of ordering", () => {
    expect(boyerMooreMajority(["b", "a", "b", "a", "a"])).toEqual({ candidate: "a", count: 3 });
  });
});

describe("evaluateConsensus", () => {
  it("reaches a strict-majority consensus (4 of 5)", () => {
    const d = evaluateConsensus(DEMO_CONSENSUS_REQUEST);
    expect(d.disposition).toBe("consensus");
    expect(d.candidate).toBe("Endocrinology");
    expect(d.candidateCount).toBe(4);
    expect(d.total).toBe(5);
    expect(d.hasConsensus).toBe(true);
    expect(d.agreements.filter((a) => a.agreesWithConsensus)).toHaveLength(4);
    expect(d.requiresStewardReview).toBe(true);
    expect(d.autoWritten).toBe(false);
  });

  it("reports no-consensus on a split plurality", () => {
    const d = evaluateConsensus(DEMO_CONSENSUS_NO_MAJORITY_REQUEST);
    expect(d.disposition).toBe("no-consensus");
    expect(d.candidate).toBeNull();
    expect(d.candidateCount).toBe(0);
    expect(d.hasConsensus).toBe(false);
    expect(d.agreements.every((a) => a.agreesWithConsensus === false)).toBe(true);
  });

  it("reaches consensus on a unanimous field", () => {
    const d = evaluateConsensus(DEMO_CONSENSUS_UNANIMOUS_REQUEST);
    expect(d.candidate).toBe("82-1147739");
    expect(d.candidateCount).toBe(3);
    expect(d.hasConsensus).toBe(true);
  });

  it("is deterministic", () => {
    expect(evaluateConsensus(DEMO_CONSENSUS_REQUEST)).toEqual(
      evaluateConsensus(DEMO_CONSENSUS_REQUEST)
    );
  });
});

describe("votesSourced", () => {
  it("is true for each demo reconciliation", () => {
    expect(votesSourced(evaluateConsensus(DEMO_CONSENSUS_REQUEST))).toBe(true);
    expect(votesSourced(evaluateConsensus(DEMO_CONSENSUS_NO_MAJORITY_REQUEST))).toBe(true);
    expect(votesSourced(evaluateConsensus(DEMO_CONSENSUS_UNANIMOUS_REQUEST))).toBe(true);
  });

  it("is false for a fabricated source (isolated from consensus-consistent)", () => {
    const d = evaluateConsensus(DEMO_CONSENSUS_REQUEST);
    // Swap one real source for a fabricated one; winner + counts stay the true optimum.
    const agreements = d.agreements.map((a, i) =>
      i === 4 ? { ...a, sourceId: "phantom-feed" } : a
    );
    const tampered = { ...d, agreements };
    expect(votesSourced(tampered)).toBe(false);
    expect(consensusConsistent(tampered)).toBe(true);
  });

  it("is false when a source is dropped (count mismatch)", () => {
    const d = evaluateConsensus(DEMO_CONSENSUS_REQUEST);
    expect(votesSourced({ ...d, agreements: d.agreements.slice(0, 4) })).toBe(false);
  });

  it("is false when total doesn't match the votes", () => {
    const d = evaluateConsensus(DEMO_CONSENSUS_REQUEST);
    expect(votesSourced({ ...d, total: 99 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(votesSourced(null)).toBe(false);
  });
});

describe("consensusConsistent", () => {
  it("is true for each demo reconciliation", () => {
    expect(consensusConsistent(evaluateConsensus(DEMO_CONSENSUS_REQUEST))).toBe(true);
    expect(consensusConsistent(evaluateConsensus(DEMO_CONSENSUS_NO_MAJORITY_REQUEST))).toBe(true);
    expect(consensusConsistent(evaluateConsensus(DEMO_CONSENSUS_UNANIMOUS_REQUEST))).toBe(true);
  });

  it("is false for a wrong winner (while votes-sourced stays true)", () => {
    const d = evaluateConsensus(DEMO_CONSENSUS_REQUEST);
    // Claim the minority value as the consensus; the per-source attributions still correspond.
    const tampered = { ...d, candidate: "Internal Medicine", candidateCount: 1 };
    expect(votesSourced(tampered)).toBe(true);
    expect(consensusConsistent(tampered)).toBe(false);
  });

  it("is false for a false consensus over a plurality", () => {
    const d = evaluateConsensus(DEMO_CONSENSUS_NO_MAJORITY_REQUEST);
    const tampered = {
      ...d,
      candidate: "In-Network",
      candidateCount: 2,
      hasConsensus: true,
      disposition: "consensus" as const
    };
    expect(consensusConsistent(tampered)).toBe(false);
  });

  it("is false for a mis-flagged real source", () => {
    const d = evaluateConsensus(DEMO_CONSENSUS_REQUEST);
    const agreements = d.agreements.map((a, i) =>
      i === 0 ? { ...a, agreesWithConsensus: false } : a
    );
    expect(votesSourced({ ...d, agreements })).toBe(true);
    expect(consensusConsistent({ ...d, agreements })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(consensusConsistent(undefined)).toBe(false);
  });
});

describe("noAutonomousWrite", () => {
  it("is true for a produced reconciliation", () => {
    expect(noAutonomousWrite(evaluateConsensus(DEMO_CONSENSUS_REQUEST))).toBe(true);
  });

  it("is false when auto-written", () => {
    const d = evaluateConsensus(DEMO_CONSENSUS_REQUEST);
    expect(noAutonomousWrite({ ...d, autoWritten: true as unknown as false })).toBe(false);
  });

  it("is false when steward review is skipped", () => {
    const d = evaluateConsensus(DEMO_CONSENSUS_REQUEST);
    expect(noAutonomousWrite({ ...d, requiresStewardReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousWrite(null)).toBe(false);
  });
});

describe("consensusSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateConsensus(DEMO_CONSENSUS_REQUEST);
    expect(consensusSummary(d)).toEqual({
      fieldRef: "provider-4417.specialty",
      disposition: "consensus",
      voteCount: 5,
      candidate: "Endocrinology",
      candidateCount: 4,
      total: 5,
      hasConsensus: true,
      requiresStewardReview: true,
      synthetic: true
    });
  });
});
