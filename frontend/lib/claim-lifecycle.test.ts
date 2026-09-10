import { describe, expect, it } from "vitest";

import {
  type ClaimLifecycleDetermination,
  DEFAULT_CLAIM_STATE_MACHINE,
  DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST,
  DEMO_CLAIM_LIFECYCLE_REQUEST,
  DEMO_CLAIM_LIFECYCLE_UNREACHABLE_REQUEST,
  claimLifecycleSummary,
  claimNoAutonomousAdvance,
  claimStatesSourced,
  claimTransitionConsistent,
  evaluateClaimLifecycle,
  shortestTransitionPath
} from "./claim-lifecycle";

const T = DEFAULT_CLAIM_STATE_MACHINE.transitions;

describe("shortestTransitionPath", () => {
  it("returns [start] for start === goal", () => {
    expect(shortestTransitionPath(T, "paid", "paid")).toEqual(["paid"]);
  });

  it("finds a direct edge as a length-1 path", () => {
    expect(shortestTransitionPath(T, "adjudicated", "paid")).toEqual(["adjudicated", "paid"]);
  });

  it("finds the shortest multi-step path", () => {
    expect(shortestTransitionPath(T, "draft", "paid")).toEqual([
      "draft",
      "submitted",
      "acknowledged",
      "adjudicated",
      "paid"
    ]);
  });

  it("returns null when the goal is unreachable (terminal start)", () => {
    expect(shortestTransitionPath(T, "void", "paid")).toBeNull();
  });
});

describe("evaluateClaimLifecycle", () => {
  it("allows a legal single-step transition", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_REQUEST);
    expect(d.disposition).toBe("transition-allowed");
    expect(d.directEdge).toBe(true);
    expect(d.reachable).toBe(true);
    expect(d.pathLength).toBe(1);
    expect(d.shortestPath).toEqual(["adjudicated", "paid"]);
    expect(d.allowedNextStates).toEqual(["denied", "paid"]);
    expect(d.requiresAdjusterReview).toBe(true);
    expect(d.autoAdvanced).toBe(false);
  });

  it("flags an illegal single step that is reachable, with the path", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST);
    expect(d.disposition).toBe("transition-illegal-but-reachable");
    expect(d.directEdge).toBe(false);
    expect(d.reachable).toBe(true);
    expect(d.pathLength).toBe(4);
    expect(d.shortestPath).toEqual([
      "draft",
      "submitted",
      "acknowledged",
      "adjudicated",
      "paid"
    ]);
  });

  it("reports an unreachable transition from a terminal state", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_UNREACHABLE_REQUEST);
    expect(d.disposition).toBe("transition-unreachable");
    expect(d.directEdge).toBe(false);
    expect(d.reachable).toBe(false);
    expect(d.pathLength).toBe(-1);
    expect(d.shortestPath).toEqual([]);
    expect(d.allowedNextStates).toEqual([]);
  });

  it("handles an unknown status as unreachable with empty outputs", () => {
    const d = evaluateClaimLifecycle({
      claimRef: "c",
      patientRef: "p",
      currentStatus: "nonsense",
      requestedStatus: "paid"
    });
    expect(d.disposition).toBe("transition-unreachable");
    expect(d.allowedNextStates).toEqual([]);
    expect(d.shortestPath).toEqual([]);
    // Still honest — nothing fabricated.
    expect(claimStatesSourced(d)).toBe(true);
    expect(claimTransitionConsistent(d)).toBe(true);
  });

  it("is deterministic — identical inputs yield identical findings", () => {
    const a = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST);
    const b = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST);
    expect(a).toEqual(b);
  });

  it("echoes the state machine so the guards can recompute end-to-end", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_REQUEST);
    expect(d.stateMachine.states).toEqual(DEFAULT_CLAIM_STATE_MACHINE.states);
  });
});

describe("claimStatesSourced", () => {
  it("is true for a produced determination", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST);
    expect(claimStatesSourced(d)).toBe(true);
  });

  it("is false when the path names an undefined state", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST);
    const tampered = {
      ...d,
      shortestPath: ["draft", "submitted", "teleport", "adjudicated", "paid"]
    };
    expect(claimStatesSourced(tampered)).toBe(false);
  });

  it("is false when allowedNextStates names an undefined state", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_REQUEST);
    expect(claimStatesSourced({ ...d, allowedNextStates: ["paid", "ghost"] })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(claimStatesSourced(null)).toBe(false);
  });
});

describe("claimTransitionConsistent", () => {
  it("is true for each demo disposition", () => {
    expect(claimTransitionConsistent(evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_REQUEST))).toBe(true);
    expect(
      claimTransitionConsistent(evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST))
    ).toBe(true);
    expect(
      claimTransitionConsistent(evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_UNREACHABLE_REQUEST))
    ).toBe(true);
  });

  it("is false when the direct-edge flag is wrong", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST);
    expect(
      claimTransitionConsistent({ ...d, directEdge: true, disposition: "transition-allowed" })
    ).toBe(false);
  });

  it("is false when the path length is wrong", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST);
    expect(claimTransitionConsistent({ ...d, pathLength: 2 })).toBe(false);
  });

  it("is false when the disposition doesn't follow", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST);
    expect(claimTransitionConsistent({ ...d, disposition: "transition-unreachable" })).toBe(false);
  });

  it("ignores an interior path state's identity (recomputes endpoints only) — isolated from sourced", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST);
    // Fabricate an interior state but keep length + endpoints correct.
    const tampered = {
      ...d,
      shortestPath: ["draft", "submitted", "teleport", "adjudicated", "paid"]
    };
    expect(claimTransitionConsistent(tampered)).toBe(true);
    expect(claimStatesSourced(tampered)).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(claimTransitionConsistent(null)).toBe(false);
  });
});

describe("claimNoAutonomousAdvance", () => {
  it("is true for a produced determination", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_REQUEST);
    expect(claimNoAutonomousAdvance(d)).toBe(true);
  });

  it("is false when the claim was advanced autonomously", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_REQUEST);
    expect(
      claimNoAutonomousAdvance({
        ...(d as ClaimLifecycleDetermination),
        autoAdvanced: true as unknown as false
      })
    ).toBe(false);
  });

  it("is false when adjuster review is skipped", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_REQUEST);
    expect(
      claimNoAutonomousAdvance({
        ...(d as ClaimLifecycleDetermination),
        requiresAdjusterReview: false as unknown as true
      })
    ).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(claimNoAutonomousAdvance(null)).toBe(false);
  });
});

describe("claimLifecycleSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateClaimLifecycle(DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST);
    const s = claimLifecycleSummary(d);
    expect(s).toEqual({
      claimRef: "clm-002",
      patientRef: "patient-5528",
      currentStatus: "draft",
      requestedStatus: "paid",
      disposition: "transition-illegal-but-reachable",
      directEdge: false,
      reachable: true,
      pathLength: 4,
      allowedCount: 2,
      requiresAdjusterReview: true,
      synthetic: true
    });
  });
});
