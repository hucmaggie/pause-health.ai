import { describe, expect, it } from "vitest";

import {
  DEMO_INTERPRETER_ASSIGNMENT_GREEDY_TRAP_REQUEST,
  DEMO_INTERPRETER_ASSIGNMENT_INFEASIBLE_REQUEST,
  DEMO_INTERPRETER_ASSIGNMENT_REQUEST,
  UNAVAILABLE,
  assignmentOptimal,
  assignmentSourced,
  evaluateInterpreterAssignment,
  interpreterAssignmentSummary,
  noAutonomousDispatch,
  solveAssignment
} from "./interpreter-assignment";

describe("solveAssignment", () => {
  it("finds the min-total-cost perfect matching (not the greedy per-row min)", () => {
    const { assignments, totalCost, unmatched } = solveAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST);
    expect(totalCost).toBe(12);
    expect(unmatched).toEqual([]);
    expect(assignments).toHaveLength(3);
    // ES→B(2), ZH→A(4), AR→C(6)
    const byInterp = Object.fromEntries(assignments.map((a) => [a.interpreter, a.appointment]));
    expect(byInterp["interp-ES"]).toBe("appt-B-mandarin");
    expect(byInterp["interp-ZH"]).toBe("appt-A-spanish");
    expect(byInterp["interp-AR"]).toBe("appt-C-arabic");
  });

  it("leaves an uncoverable appointment unmatched", () => {
    const { totalCost, unmatched } = solveAssignment(DEMO_INTERPRETER_ASSIGNMENT_INFEASIBLE_REQUEST);
    expect(unmatched).toEqual(["appt-C-somali"]);
    expect(totalCost).toBe(4);
  });

  it("beats the greedy trap by spreading interpreters", () => {
    const { totalCost } = solveAssignment(DEMO_INTERPRETER_ASSIGNMENT_GREEDY_TRAP_REQUEST);
    expect(totalCost).toBe(3);
  });
});

describe("evaluateInterpreterAssignment", () => {
  it("classifies an assignable roster", () => {
    const d = evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST);
    expect(d.disposition).toBe("assignable");
    expect(d.feasible).toBe(true);
    expect(d.totalCost).toBe(12);
    expect(d.unmatched).toEqual([]);
    expect(d.requiresCoordinatorReview).toBe(true);
    expect(d.autoDispatched).toBe(false);
  });

  it("classifies an infeasible roster", () => {
    const d = evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_INFEASIBLE_REQUEST);
    expect(d.disposition).toBe("infeasible");
    expect(d.feasible).toBe(false);
    expect(d.unmatched).toEqual(["appt-C-somali"]);
  });

  it("is deterministic", () => {
    expect(evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST)).toEqual(
      evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST)
    );
  });
});

describe("assignmentSourced", () => {
  it("is true for each demo determination", () => {
    expect(assignmentSourced(evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST))).toBe(true);
    expect(
      assignmentSourced(evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_INFEASIBLE_REQUEST))
    ).toBe(true);
    expect(
      assignmentSourced(evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_GREEDY_TRAP_REQUEST))
    ).toBe(true);
  });

  it("is false for a reused interpreter", () => {
    const d = evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST);
    const assignments = [
      { interpreter: "interp-ES", appointment: "appt-A-spanish", cost: 4 },
      { interpreter: "interp-ES", appointment: "appt-B-mandarin", cost: 2 },
      { interpreter: "interp-AR", appointment: "appt-C-arabic", cost: 6 }
    ];
    expect(assignmentSourced({ ...d, assignments, totalCost: 12 })).toBe(false);
  });

  it("is false for a pairing that uses an UNAVAILABLE cell", () => {
    const d = evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_INFEASIBLE_REQUEST);
    const assignments = [
      { interpreter: "interp-ES", appointment: "appt-C-somali", cost: UNAVAILABLE },
      { interpreter: "interp-ZH", appointment: "appt-B-mandarin", cost: 2 }
    ];
    expect(assignmentSourced({ ...d, assignments })).toBe(false);
  });

  it("is false for an overstated total cost", () => {
    const d = evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST);
    expect(assignmentSourced({ ...d, totalCost: d.totalCost + 5 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(assignmentSourced(null)).toBe(false);
  });
});

describe("assignmentOptimal", () => {
  it("is true for each demo determination", () => {
    expect(assignmentOptimal(evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST))).toBe(true);
    expect(
      assignmentOptimal(evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_GREEDY_TRAP_REQUEST))
    ).toBe(true);
  });

  it("is false for a sub-optimal assignment (while assignment-sourced stays true)", () => {
    const d = evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST);
    // A valid one-to-one matching that is NOT optimal: ES→A(4), ZH→B(3), AR→C(6) = 13 (optimum is 12).
    const assignments = [
      { interpreter: "interp-ES", appointment: "appt-A-spanish", cost: 4 },
      { interpreter: "interp-ZH", appointment: "appt-B-mandarin", cost: 3 },
      { interpreter: "interp-AR", appointment: "appt-C-arabic", cost: 6 }
    ];
    const tampered = { ...d, assignments, totalCost: 13 };
    expect(assignmentSourced(tampered)).toBe(true);
    expect(assignmentOptimal(tampered)).toBe(false);
  });

  it("is false for an understated total cost", () => {
    const d = evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST);
    expect(assignmentOptimal({ ...d, totalCost: 11 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(assignmentOptimal(undefined)).toBe(false);
  });
});

describe("noAutonomousDispatch", () => {
  it("is true for a produced assignment", () => {
    expect(noAutonomousDispatch(evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST))).toBe(true);
  });

  it("is false when auto-dispatched", () => {
    const d = evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST);
    expect(noAutonomousDispatch({ ...d, autoDispatched: true as unknown as false })).toBe(false);
  });

  it("is false when coordinator review is skipped", () => {
    const d = evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST);
    expect(noAutonomousDispatch({ ...d, requiresCoordinatorReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousDispatch(null)).toBe(false);
  });
});

describe("interpreterAssignmentSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST);
    expect(interpreterAssignmentSummary(d)).toEqual({
      rosterRef: "lang-access-roster-2026-3310",
      disposition: "assignable",
      interpreterCount: 3,
      appointmentCount: 3,
      assignedCount: 3,
      totalCost: 12,
      unmatchedCount: 0,
      requiresCoordinatorReview: true,
      synthetic: true
    });
  });
});
