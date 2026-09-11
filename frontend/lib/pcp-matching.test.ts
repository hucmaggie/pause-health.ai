import { describe, expect, it } from "vitest";

import {
  type PcpMatchingDetermination,
  DEMO_PCP_MATCHING_CAPACITY_REQUEST,
  DEMO_PCP_MATCHING_PARTIAL_REQUEST,
  DEMO_PCP_MATCHING_REQUEST,
  deferredAcceptance,
  evaluatePcpMatching,
  hasBlockingPair,
  matchingSourced,
  matchingStable,
  noAutonomousAssignment,
  pcpMatchingSummary
} from "./pcp-matching";

describe("deferredAcceptance", () => {
  it("produces the member-optimal stable matching for the interlocking demo", () => {
    const m = deferredAcceptance(
      DEMO_PCP_MATCHING_REQUEST.members,
      DEMO_PCP_MATCHING_REQUEST.providers
    );
    expect(m.get("m1")).toBe("p2");
    expect(m.get("m2")).toBe("p1");
    expect(m.get("m3")).toBe("p3");
  });

  it("leaves a member unmatched when capacity is exhausted", () => {
    const m = deferredAcceptance(
      DEMO_PCP_MATCHING_PARTIAL_REQUEST.members,
      DEMO_PCP_MATCHING_PARTIAL_REQUEST.providers
    );
    expect(m.get("m1")).toBe("p1");
    expect(m.get("m2")).toBe("p2");
    expect(m.get("m3")).toBeNull();
  });

  it("absorbs two members into a capacity-2 provider", () => {
    const m = deferredAcceptance(
      DEMO_PCP_MATCHING_CAPACITY_REQUEST.members,
      DEMO_PCP_MATCHING_CAPACITY_REQUEST.providers
    );
    expect(m.get("m1")).toBe("p1");
    expect(m.get("m2")).toBe("p1");
    expect(m.get("m3")).toBe("p2");
  });
});

describe("evaluatePcpMatching", () => {
  it("reports all-matched with per-member ranks for the demo", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST);
    expect(d.disposition).toBe("all-matched");
    expect(d.matchedCount).toBe(3);
    expect(d.unmatchedCount).toBe(0);
    expect(d.assignments.map((a) => [a.memberId, a.providerId, a.memberRank])).toEqual([
      ["m1", "p2", 2],
      ["m2", "p1", 1],
      ["m3", "p3", 3]
    ]);
    expect(d.requiresCoordinatorReview).toBe(true);
    expect(d.autoAssigned).toBe(false);
  });

  it("reports partial-match and a null-provider assignment when a member is unmatched", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_PARTIAL_REQUEST);
    expect(d.disposition).toBe("partial-match");
    expect(d.unmatchedCount).toBe(1);
    const m3 = d.assignments.find((a) => a.memberId === "m3");
    expect(m3?.providerId).toBeNull();
    expect(m3?.memberRank).toBeNull();
  });

  it("tallies provider loads honoring capacity", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_CAPACITY_REQUEST);
    const p1 = d.providerLoads.find((l) => l.providerId === "p1");
    expect(p1).toEqual({ providerId: "p1", capacity: 2, assignedCount: 2 });
  });

  it("echoes members + providers so the guards can recompute", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST);
    expect(d.members).toHaveLength(3);
    expect(d.providers).toHaveLength(3);
  });

  it("is deterministic — identical inputs yield identical matchings", () => {
    expect(evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST)).toEqual(
      evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST)
    );
  });
});

describe("hasBlockingPair", () => {
  it("is false for the stable demo matching", () => {
    const assign = deferredAcceptance(
      DEMO_PCP_MATCHING_REQUEST.members,
      DEMO_PCP_MATCHING_REQUEST.providers
    );
    expect(hasBlockingPair(DEMO_PCP_MATCHING_REQUEST.members, DEMO_PCP_MATCHING_REQUEST.providers, assign)).toBe(
      false
    );
  });

  it("is true when a member and provider both prefer each other (a blocking pair)", () => {
    // Swap m1↔m3: m1→p3, m3→p2 — m1 and p2 both prefer each other over their lot.
    const assign = new Map<string, string | null>([
      ["m1", "p3"],
      ["m2", "p1"],
      ["m3", "p2"]
    ]);
    expect(hasBlockingPair(DEMO_PCP_MATCHING_REQUEST.members, DEMO_PCP_MATCHING_REQUEST.providers, assign)).toBe(
      true
    );
  });

  it("is true when a provider is over capacity", () => {
    const assign = new Map<string, string | null>([
      ["m1", "p1"],
      ["m2", "p1"],
      ["m3", "p3"]
    ]);
    expect(hasBlockingPair(DEMO_PCP_MATCHING_REQUEST.members, DEMO_PCP_MATCHING_REQUEST.providers, assign)).toBe(
      true
    );
  });
});

describe("matchingSourced", () => {
  it("is true for each demo matching", () => {
    expect(matchingSourced(evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST))).toBe(true);
    expect(matchingSourced(evaluatePcpMatching(DEMO_PCP_MATCHING_PARTIAL_REQUEST))).toBe(true);
    expect(matchingSourced(evaluatePcpMatching(DEMO_PCP_MATCHING_CAPACITY_REQUEST))).toBe(true);
  });

  it("is false when a phantom member assignment is appended", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST);
    const tampered = {
      ...d,
      assignments: [...d.assignments, { memberId: "m9", providerId: "p1", memberRank: 1 }]
    };
    expect(matchingSourced(tampered)).toBe(false);
    // Isolated: the stability check ignores the phantom and still recomputes the real members.
    expect(matchingStable(tampered)).toBe(true);
  });

  it("is false when a provider load miscounts", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST);
    const tampered = {
      ...d,
      providerLoads: d.providerLoads.map((l) =>
        l.providerId === "p1" ? { ...l, assignedCount: 0 } : l
      )
    };
    expect(matchingSourced(tampered)).toBe(false);
  });

  it("is false when a member is assigned to a provider not in the network", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST);
    const tampered = {
      ...d,
      assignments: d.assignments.map((a) =>
        a.memberId === "m1" ? { ...a, providerId: "pX", memberRank: null } : a
      )
    };
    expect(matchingSourced(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(matchingSourced(null)).toBe(false);
  });
});

describe("matchingStable", () => {
  it("is true for each demo matching", () => {
    expect(matchingStable(evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST))).toBe(true);
    expect(matchingStable(evaluatePcpMatching(DEMO_PCP_MATCHING_PARTIAL_REQUEST))).toBe(true);
    expect(matchingStable(evaluatePcpMatching(DEMO_PCP_MATCHING_CAPACITY_REQUEST))).toBe(true);
  });

  it("is false for an unstable matching (a blocking pair) while sourced stays true", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST);
    const tampered = {
      ...d,
      assignments: d.assignments.map((a) => {
        if (a.memberId === "m1") return { ...a, providerId: "p3", memberRank: 3 };
        if (a.memberId === "m3") return { ...a, providerId: "p2", memberRank: 1 };
        return a;
      }),
      providerLoads: [
        { providerId: "p1", capacity: 1, assignedCount: 1 },
        { providerId: "p2", capacity: 1, assignedCount: 1 },
        { providerId: "p3", capacity: 1, assignedCount: 1 }
      ]
    };
    expect(matchingSourced(tampered)).toBe(true);
    expect(matchingStable(tampered)).toBe(false);
  });

  it("is false when a reported rank is wrong", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST);
    const tampered = {
      ...d,
      assignments: d.assignments.map((a) =>
        a.memberId === "m1" ? { ...a, memberRank: 1 } : a
      )
    };
    expect(matchingStable(tampered)).toBe(false);
  });

  it("is false when the disposition doesn't follow", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST);
    expect(matchingStable({ ...d, disposition: "partial-match" })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(matchingStable(null)).toBe(false);
  });
});

describe("noAutonomousAssignment", () => {
  it("is true for a produced matching", () => {
    expect(noAutonomousAssignment(evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST))).toBe(true);
  });

  it("is false when auto-assigned", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST);
    expect(
      noAutonomousAssignment({
        ...(d as PcpMatchingDetermination),
        autoAssigned: true as unknown as false
      })
    ).toBe(false);
  });

  it("is false when coordinator review is skipped", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_REQUEST);
    expect(
      noAutonomousAssignment({
        ...(d as PcpMatchingDetermination),
        requiresCoordinatorReview: false as unknown as true
      })
    ).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousAssignment(null)).toBe(false);
  });
});

describe("pcpMatchingSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluatePcpMatching(DEMO_PCP_MATCHING_PARTIAL_REQUEST);
    expect(pcpMatchingSummary(d)).toEqual({
      panelRef: "pcp-panel-002",
      disposition: "partial-match",
      matchedCount: 2,
      unmatchedCount: 1,
      total: 3,
      requiresCoordinatorReview: true,
      synthetic: true
    });
  });
});
