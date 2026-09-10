import { describe, expect, it } from "vitest";

import {
  DEMO_CARE_PATHWAY_CYCLE_REQUEST,
  DEMO_CARE_PATHWAY_MISSING_REQUEST,
  DEMO_CARE_PATHWAY_REQUEST,
  carePathwaySummary,
  evaluateCarePathway,
  pathwayNoAutonomousExecution,
  pathwaySequenceValid,
  pathwayStepsSourced
} from "./care-pathway";

describe("evaluateCarePathway", () => {
  it("topologically sequences a clean pathway, respecting prerequisites", () => {
    const d = evaluateCarePathway(DEMO_CARE_PATHWAY_REQUEST);
    expect(d.disposition).toBe("sequenced");
    expect(d.orderedSteps).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(d.stageByStep).toEqual({ s1: 0, s2: 1, s3: 1, s4: 2, s5: 3, s6: 4 });
    expect(d.cycleMembers).toEqual([]);
    expect(d.unmetPrerequisites).toEqual([]);
    expect(d.requiresClinicianReview).toBe(true);
    expect(d.autoExecuted).toBe(false);
  });

  it("places every step after all its prerequisites", () => {
    const d = evaluateCarePathway(DEMO_CARE_PATHWAY_REQUEST);
    const pos = new Map(d.orderedSteps.map((id, i) => [id, i]));
    for (const s of d.steps) {
      for (const pre of s.prerequisites) {
        expect(pos.get(pre)!).toBeLessThan(pos.get(s.stepId)!);
      }
    }
  });

  it("detects a dependency cycle", () => {
    const d = evaluateCarePathway(DEMO_CARE_PATHWAY_CYCLE_REQUEST);
    expect(d.disposition).toBe("cannot-sequence-cycle-detected");
    expect(d.orderedSteps).toEqual([]);
    expect(d.cycleMembers).toEqual(["a", "b", "c"]);
  });

  it("detects a missing prerequisite", () => {
    const d = evaluateCarePathway(DEMO_CARE_PATHWAY_MISSING_REQUEST);
    expect(d.disposition).toBe("cannot-sequence-missing-prerequisite");
    expect(d.orderedSteps).toEqual([]);
    expect(d.unmetPrerequisites).toEqual([{ stepId: "s2", missing: ["s9"] }]);
  });

  it("is deterministic", () => {
    expect(evaluateCarePathway(DEMO_CARE_PATHWAY_REQUEST)).toEqual(
      evaluateCarePathway(DEMO_CARE_PATHWAY_REQUEST)
    );
  });

  it("breaks ready-set ties by step id (parallel steps ordered by id)", () => {
    const d = evaluateCarePathway({
      requestRef: "r",
      pathwayRef: "p",
      patientRef: "pt",
      steps: [
        { stepId: "z", name: "Z", prerequisites: [] },
        { stepId: "a", name: "A", prerequisites: [] },
        { stepId: "m", name: "M", prerequisites: [] }
      ]
    });
    expect(d.orderedSteps).toEqual(["a", "m", "z"]);
  });
});

describe("pathwayStepsSourced", () => {
  it("passes a produced determination", () => {
    expect(pathwayStepsSourced(evaluateCarePathway(DEMO_CARE_PATHWAY_REQUEST))).toBe(true);
  });
  it("fails a fabricated step id in the order", () => {
    expect(
      pathwayStepsSourced({
        steps: [{ stepId: "s1" }],
        orderedSteps: ["s1", "sX"],
        stageByStep: { s1: 0, sX: 1 },
        cycleMembers: [],
        unmetPrerequisites: []
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(pathwayStepsSourced(null)).toBe(false);
  });
});

describe("pathwaySequenceValid", () => {
  it("passes produced determinations (sequenced, cycle, missing)", () => {
    expect(pathwaySequenceValid(evaluateCarePathway(DEMO_CARE_PATHWAY_REQUEST))).toBe(true);
    expect(pathwaySequenceValid(evaluateCarePathway(DEMO_CARE_PATHWAY_CYCLE_REQUEST))).toBe(true);
    expect(pathwaySequenceValid(evaluateCarePathway(DEMO_CARE_PATHWAY_MISSING_REQUEST))).toBe(true);
  });
  it("fails a sequence that violates a prerequisite", () => {
    expect(
      pathwaySequenceValid({
        disposition: "sequenced",
        orderedSteps: ["s2", "s1"],
        steps: [
          { stepId: "s1", prerequisites: [] },
          { stepId: "s2", prerequisites: ["s1"] }
        ]
      })
    ).toBe(false);
  });
  it("fails a sequence that drops a step", () => {
    expect(
      pathwaySequenceValid({
        disposition: "sequenced",
        orderedSteps: ["s1"],
        steps: [
          { stepId: "s1", prerequisites: [] },
          { stepId: "s2", prerequisites: ["s1"] }
        ]
      })
    ).toBe(false);
  });
  it("fails a sequence that duplicates a step", () => {
    expect(
      pathwaySequenceValid({
        disposition: "sequenced",
        orderedSteps: ["s1", "s1"],
        steps: [
          { stepId: "s1", prerequisites: [] },
          { stepId: "s2", prerequisites: [] }
        ]
      })
    ).toBe(false);
  });
  it("fails a non-sequenced disposition that asserts an order", () => {
    expect(
      pathwaySequenceValid({
        disposition: "cannot-sequence-cycle-detected",
        orderedSteps: ["a", "b"],
        steps: [{ stepId: "a", prerequisites: [] }]
      })
    ).toBe(false);
  });
});

describe("pathwayNoAutonomousExecution", () => {
  it("passes a produced determination", () => {
    expect(pathwayNoAutonomousExecution(evaluateCarePathway(DEMO_CARE_PATHWAY_REQUEST))).toBe(true);
  });
  it("fails an autonomously-executed determination", () => {
    expect(
      pathwayNoAutonomousExecution({ autoExecuted: true, requiresClinicianReview: true })
    ).toBe(false);
  });
  it("fails an un-reviewed determination", () => {
    expect(
      pathwayNoAutonomousExecution({ autoExecuted: false, requiresClinicianReview: false })
    ).toBe(false);
  });
});

describe("carePathwaySummary", () => {
  it("projects a compact, trace-safe summary for a sequenced pathway", () => {
    const s = carePathwaySummary(evaluateCarePathway(DEMO_CARE_PATHWAY_REQUEST));
    expect(s.disposition).toBe("sequenced");
    expect(s.stepCount).toBe(6);
    expect(s.stageCount).toBe(5);
    expect(s.cycleCount).toBe(0);
    expect(s.missingCount).toBe(0);
    expect(s.requiresClinicianReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
  it("counts cycle members and missing prerequisites", () => {
    expect(carePathwaySummary(evaluateCarePathway(DEMO_CARE_PATHWAY_CYCLE_REQUEST)).cycleCount).toBe(3);
    expect(carePathwaySummary(evaluateCarePathway(DEMO_CARE_PATHWAY_MISSING_REQUEST)).missingCount).toBe(1);
  });
});
