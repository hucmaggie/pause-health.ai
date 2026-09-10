import { describe, expect, it } from "vitest";

import {
  DEMO_CASELOAD_BALANCING_BALANCED_REQUEST,
  DEMO_CASELOAD_BALANCING_REQUEST,
  DEMO_CASELOAD_BALANCING_WAITLIST_REQUEST,
  caseloadAssignmentComplete,
  caseloadBalancingSummary,
  caseloadCapacityRespected,
  caseloadNoAutonomousAssignment,
  evaluateCaseloadBalancing
} from "./caseload-balancing";

describe("evaluateCaseloadBalancing", () => {
  it("fully assigns a panel that fits within capacity", () => {
    const d = evaluateCaseloadBalancing(DEMO_CASELOAD_BALANCING_REQUEST);
    expect(d.disposition).toBe("fully-assigned");
    expect(d.assignedCount).toBe(6);
    expect(d.waitlistedCount).toBe(0);
    expect(d.totalAssignedAcuity).toBe(21);
    expect(d.totalCapacity).toBe(24);
    expect(d.requiresCareLeadReview).toBe(true);
    expect(d.autoAssigned).toBe(false);
    // No manager over capacity.
    for (const l of d.managerLoads) {
      expect(l.assignedAcuity).toBeLessThanOrEqual(l.capacity);
      expect(l.remainingCapacity).toBe(l.capacity - l.assignedAcuity);
    }
  });

  it("waitlists the overflow when the panel exceeds capacity", () => {
    const d = evaluateCaseloadBalancing(DEMO_CASELOAD_BALANCING_WAITLIST_REQUEST);
    expect(d.disposition).toBe("partially-assigned-waitlist");
    expect(d.assignedCount).toBe(2);
    expect(d.waitlistedCount).toBe(2);
    expect(d.waitlisted.map((w) => w.memberId)).toEqual(["m3", "m4"]);
  });

  it("balances equal members evenly (worst-fit spread)", () => {
    const d = evaluateCaseloadBalancing(DEMO_CASELOAD_BALANCING_BALANCED_REQUEST);
    expect(d.disposition).toBe("fully-assigned");
    const loads = d.managerLoads.map((l) => l.assignedAcuity).sort((a, b) => a - b);
    expect(loads).toEqual([10, 10]);
    for (const l of d.managerLoads) {
      expect(l.memberCount).toBe(2);
    }
  });

  it("accounts for every member exactly once", () => {
    const d = evaluateCaseloadBalancing(DEMO_CASELOAD_BALANCING_WAITLIST_REQUEST);
    const placed = new Set([
      ...d.assignments.map((a) => a.memberId),
      ...d.waitlisted.map((w) => w.memberId)
    ]);
    expect(placed.size).toBe(d.totalMembers);
    expect(d.assignedCount + d.waitlistedCount).toBe(d.totalMembers);
  });

  it("skips invalid members and managers", () => {
    const d = evaluateCaseloadBalancing({
      requestRef: "r",
      panelRef: "p",
      managers: [
        { managerId: "mgr-a", capacity: 10 },
        { managerId: "mgr-a", capacity: 5 }, // duplicate id
        { managerId: "mgr-bad", capacity: -1 } // negative capacity
      ],
      members: [
        { memberId: "m1", acuity: 3 },
        { memberId: "m-bad", acuity: 0 }, // non-positive acuity
        { memberId: "m-bad2", acuity: 2.5 } // non-integer
      ]
    });
    expect(d.invalidMembers).toEqual(["m-bad", "m-bad2"]);
    expect(d.invalidManagers).toEqual(["mgr-a", "mgr-bad"]);
    expect(d.members).toHaveLength(1);
    expect(d.managerLoads).toHaveLength(1);
  });

  it("waitlists everyone when there are no managers", () => {
    const d = evaluateCaseloadBalancing({
      requestRef: "r",
      panelRef: "p",
      managers: [],
      members: [{ memberId: "m1", acuity: 1 }]
    });
    expect(d.assignedCount).toBe(0);
    expect(d.waitlistedCount).toBe(1);
    expect(d.disposition).toBe("partially-assigned-waitlist");
  });

  it("is deterministic", () => {
    expect(evaluateCaseloadBalancing(DEMO_CASELOAD_BALANCING_REQUEST)).toEqual(
      evaluateCaseloadBalancing(DEMO_CASELOAD_BALANCING_REQUEST)
    );
  });
});

describe("caseloadAssignmentComplete", () => {
  it("passes produced determinations", () => {
    expect(caseloadAssignmentComplete(evaluateCaseloadBalancing(DEMO_CASELOAD_BALANCING_REQUEST))).toBe(true);
    expect(caseloadAssignmentComplete(evaluateCaseloadBalancing(DEMO_CASELOAD_BALANCING_WAITLIST_REQUEST))).toBe(true);
  });
  it("fails a dropped member", () => {
    expect(
      caseloadAssignmentComplete({
        members: [{ memberId: "m1" }, { memberId: "m2" }],
        assignments: [{ memberId: "m1" }],
        waitlisted: []
      })
    ).toBe(false);
  });
  it("fails a double-assigned member", () => {
    expect(
      caseloadAssignmentComplete({
        members: [{ memberId: "m1" }],
        assignments: [{ memberId: "m1" }, { memberId: "m1" }],
        waitlisted: []
      })
    ).toBe(false);
  });
  it("fails a member both assigned and waitlisted", () => {
    expect(
      caseloadAssignmentComplete({
        members: [{ memberId: "m1" }],
        assignments: [{ memberId: "m1" }],
        waitlisted: [{ memberId: "m1" }]
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(caseloadAssignmentComplete(null)).toBe(false);
  });
});

describe("caseloadCapacityRespected", () => {
  it("passes produced determinations", () => {
    expect(caseloadCapacityRespected(evaluateCaseloadBalancing(DEMO_CASELOAD_BALANCING_REQUEST))).toBe(true);
    expect(caseloadCapacityRespected(evaluateCaseloadBalancing(DEMO_CASELOAD_BALANCING_WAITLIST_REQUEST))).toBe(true);
  });
  it("fails an over-loaded manager", () => {
    expect(
      caseloadCapacityRespected({
        members: [{ memberId: "m1", acuity: 5 }],
        assignments: [{ memberId: "m1", managerId: "mgr-a", acuity: 5 }],
        managerLoads: [
          { managerId: "mgr-a", capacity: 3, assignedAcuity: 5, remainingCapacity: -2, memberCount: 1, memberIds: ["m1"] }
        ],
        waitlisted: []
      })
    ).toBe(false);
  });
  it("fails a miscounted load", () => {
    expect(
      caseloadCapacityRespected({
        members: [{ memberId: "m1", acuity: 5 }],
        assignments: [{ memberId: "m1", managerId: "mgr-a", acuity: 5 }],
        managerLoads: [
          { managerId: "mgr-a", capacity: 10, assignedAcuity: 9, remainingCapacity: 1, memberCount: 1, memberIds: ["m1"] }
        ],
        waitlisted: []
      })
    ).toBe(false);
  });
  it("fails an unjust waitlist (member fit but was waitlisted)", () => {
    expect(
      caseloadCapacityRespected({
        members: [
          { memberId: "m1", acuity: 5 },
          { memberId: "m2", acuity: 2 }
        ],
        assignments: [{ memberId: "m1", managerId: "mgr-a", acuity: 5 }],
        managerLoads: [
          { managerId: "mgr-a", capacity: 10, assignedAcuity: 5, remainingCapacity: 5, memberCount: 1, memberIds: ["m1"] }
        ],
        // m2 (acuity 2) fit in mgr-a's remaining 5 → waitlist is unjust.
        waitlisted: [{ acuity: 2 }]
      })
    ).toBe(false);
  });
  it("fails an assignment acuity that doesn't match the member", () => {
    expect(
      caseloadCapacityRespected({
        members: [{ memberId: "m1", acuity: 5 }],
        assignments: [{ memberId: "m1", managerId: "mgr-a", acuity: 3 }],
        managerLoads: [
          { managerId: "mgr-a", capacity: 10, assignedAcuity: 3, remainingCapacity: 7, memberCount: 1, memberIds: ["m1"] }
        ],
        waitlisted: []
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(caseloadCapacityRespected(null)).toBe(false);
  });
});

describe("caseloadNoAutonomousAssignment", () => {
  it("passes a produced determination", () => {
    expect(caseloadNoAutonomousAssignment(evaluateCaseloadBalancing(DEMO_CASELOAD_BALANCING_REQUEST))).toBe(true);
  });
  it("fails an auto-committed assignment", () => {
    expect(
      caseloadNoAutonomousAssignment({ autoAssigned: true, requiresCareLeadReview: true })
    ).toBe(false);
  });
  it("fails an un-reviewed allocation", () => {
    expect(
      caseloadNoAutonomousAssignment({ autoAssigned: false, requiresCareLeadReview: false })
    ).toBe(false);
  });
});

describe("caseloadBalancingSummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = caseloadBalancingSummary(evaluateCaseloadBalancing(DEMO_CASELOAD_BALANCING_REQUEST));
    expect(s.disposition).toBe("fully-assigned");
    expect(s.managerCount).toBe(3);
    expect(s.assignedCount).toBe(6);
    expect(s.waitlistedCount).toBe(0);
    expect(s.totalAssignedAcuity).toBe(21);
    expect(s.totalCapacity).toBe(24);
    expect(s.requiresCareLeadReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
