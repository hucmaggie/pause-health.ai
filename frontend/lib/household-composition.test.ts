import { describe, expect, it } from "vitest";

import {
  type HouseholdCompositionDetermination,
  DEMO_HOUSEHOLD_COMPOSITION_CHAIN_REQUEST,
  DEMO_HOUSEHOLD_COMPOSITION_REQUEST,
  DEMO_HOUSEHOLD_COMPOSITION_SINGLETONS_REQUEST,
  evaluateHouseholdComposition,
  householdCompositionSummary,
  householdLinksSourced,
  householdNoAutonomousMerge,
  householdPartitionConsistent
} from "./household-composition";

describe("evaluateHouseholdComposition", () => {
  it("groups six members into three households (transitive chain + pair + singleton)", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    expect(d.disposition).toBe("households-formed");
    expect(d.householdCount).toBe(3);
    expect(d.largestHouseholdSize).toBe(3);
    expect(d.memberCount).toBe(6);
    expect(d.households).toEqual([
      { householdId: "hh-1", members: ["m1", "m2", "m3"], size: 3 },
      { householdId: "hh-2", members: ["m4", "m5"], size: 2 },
      { householdId: "hh-3", members: ["m6"], size: 1 }
    ]);
    expect(d.requiresStewardReview).toBe(true);
    expect(d.autoMerged).toBe(false);
  });

  it("groups a five-member chain into one household (transitivity — m1 and m5 land together)", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_CHAIN_REQUEST);
    expect(d.householdCount).toBe(1);
    expect(d.largestHouseholdSize).toBe(5);
    expect(d.households[0].members).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(d.disposition).toBe("households-formed");
  });

  it("reports all-singletons when there are no links", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_SINGLETONS_REQUEST);
    expect(d.disposition).toBe("all-singletons");
    expect(d.householdCount).toBe(3);
    expect(d.largestHouseholdSize).toBe(1);
    expect(d.households.map((h) => h.members)).toEqual([["m1"], ["m2"], ["m3"]]);
  });

  it("ignores a link to a non-member (it can't join the graph)", () => {
    const d = evaluateHouseholdComposition({
      batchRef: "b",
      members: ["m1", "m2"],
      links: [{ a: "m1", b: "ghost", basis: "shared-address" }]
    });
    // ghost is dropped from links; m1 and m2 stay singletons.
    expect(d.links).toEqual([]);
    expect(d.disposition).toBe("all-singletons");
    expect(d.householdCount).toBe(2);
    expect(householdLinksSourced(d)).toBe(true);
    expect(householdPartitionConsistent(d)).toBe(true);
  });

  it("de-dupes repeated members", () => {
    const d = evaluateHouseholdComposition({
      batchRef: "b",
      members: ["m1", "m1", "m2"],
      links: [{ a: "m1", b: "m2", basis: "shared-subscriber" }]
    });
    expect(d.memberCount).toBe(2);
    expect(d.households).toEqual([{ householdId: "hh-1", members: ["m1", "m2"], size: 2 }]);
  });

  it("is deterministic — identical inputs yield identical findings", () => {
    const a = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    const b = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    expect(a).toEqual(b);
  });

  it("echoes the members + applied links so the guards can recompute", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    expect(d.members).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    expect(d.links).toHaveLength(3);
  });

  it("assigns household ids by the component's minimum member", () => {
    const d = evaluateHouseholdComposition({
      batchRef: "b",
      members: ["z1", "a1", "a2"],
      links: [{ a: "a1", b: "a2", basis: "shared-address" }]
    });
    // {a1,a2} has the smaller min → hh-1; {z1} → hh-2.
    expect(d.households).toEqual([
      { householdId: "hh-1", members: ["a1", "a2"], size: 2 },
      { householdId: "hh-2", members: ["z1"], size: 1 }
    ]);
  });
});

describe("householdLinksSourced", () => {
  it("is true for a produced determination", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    expect(householdLinksSourced(d)).toBe(true);
  });

  it("is false when a link references a member not in the batch", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    expect(
      householdLinksSourced({
        ...d,
        links: [...d.links, { a: "m1", b: "ghost-x", basis: "shared-address" }]
      })
    ).toBe(false);
  });

  it("is false when a household names a member not in the batch", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    const tampered = {
      ...d,
      households: [
        { householdId: "hh-1", members: ["m1", "m2", "m3", "ghost"], size: 4 },
        { householdId: "hh-2", members: ["m4", "m5"], size: 2 },
        { householdId: "hh-3", members: ["m6"], size: 1 }
      ]
    };
    expect(householdLinksSourced(tampered)).toBe(false);
  });

  it("is false when a member appears in two households", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    const tampered = {
      ...d,
      households: [
        { householdId: "hh-1", members: ["m1", "m2", "m3"], size: 3 },
        { householdId: "hh-2", members: ["m3", "m4", "m5"], size: 3 },
        { householdId: "hh-3", members: ["m6"], size: 1 }
      ]
    };
    expect(householdLinksSourced(tampered)).toBe(false);
  });

  it("is false when not every submitted member is covered", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    const tampered = {
      ...d,
      households: [
        { householdId: "hh-1", members: ["m1", "m2", "m3"], size: 3 },
        { householdId: "hh-2", members: ["m4", "m5"], size: 2 }
      ]
    };
    expect(householdLinksSourced(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(householdLinksSourced(null)).toBe(false);
  });
});

describe("householdPartitionConsistent", () => {
  it("is true for each demo finding", () => {
    expect(
      householdPartitionConsistent(evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST))
    ).toBe(true);
    expect(
      householdPartitionConsistent(
        evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_CHAIN_REQUEST)
      )
    ).toBe(true);
    expect(
      householdPartitionConsistent(
        evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_SINGLETONS_REQUEST)
      )
    ).toBe(true);
  });

  it("is false when an unlinked member is merged into a household", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    expect(
      householdPartitionConsistent({
        ...d,
        households: [
          { householdId: "hh-1", members: ["m1", "m2", "m3", "m4"], size: 4 },
          { householdId: "hh-2", members: ["m5", "m6"], size: 2 }
        ],
        householdCount: 2,
        largestHouseholdSize: 4
      })
    ).toBe(false);
  });

  it("is false when the household count is wrong", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    expect(householdPartitionConsistent({ ...d, householdCount: 99 })).toBe(false);
  });

  it("is false when the disposition doesn't follow", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_SINGLETONS_REQUEST);
    expect(householdPartitionConsistent({ ...d, disposition: "households-formed" })).toBe(false);
  });

  it("ignores a phantom link endpoint — isolated from the sourced check", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    const tampered = {
      ...d,
      links: [...d.links, { a: "m1", b: "ghost-x", basis: "shared-address" }]
    };
    // The recompute ignores the ghost link, so the partition still matches → consistent true …
    expect(householdPartitionConsistent(tampered)).toBe(true);
    // … while the sourced check flags the phantom endpoint.
    expect(householdLinksSourced(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(householdPartitionConsistent(null)).toBe(false);
  });
});

describe("householdNoAutonomousMerge", () => {
  it("is true for a produced determination", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    expect(householdNoAutonomousMerge(d)).toBe(true);
  });

  it("is false when records were merged autonomously", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    expect(
      householdNoAutonomousMerge({
        ...(d as HouseholdCompositionDetermination),
        autoMerged: true as unknown as false
      })
    ).toBe(false);
  });

  it("is false when steward review is skipped", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    expect(
      householdNoAutonomousMerge({
        ...(d as HouseholdCompositionDetermination),
        requiresStewardReview: false as unknown as true
      })
    ).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(householdNoAutonomousMerge(null)).toBe(false);
  });
});

describe("householdCompositionSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateHouseholdComposition(DEMO_HOUSEHOLD_COMPOSITION_REQUEST);
    const s = householdCompositionSummary(d);
    expect(s).toEqual({
      batchRef: "hh-batch-001",
      disposition: "households-formed",
      householdCount: 3,
      largestHouseholdSize: 3,
      memberCount: 6,
      linkCount: 3,
      requiresStewardReview: true,
      synthetic: true
    });
  });
});
