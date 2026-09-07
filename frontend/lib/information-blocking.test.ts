import { describe, expect, it } from "vitest";

import {
  BLOCKING_EXCEPTIONS,
  DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST,
  DEMO_INFORMATION_BLOCKING_NO_EXCEPTION_REQUEST,
  DEMO_INFORMATION_BLOCKING_NO_INTERFERENCE_REQUEST,
  DEMO_INFORMATION_BLOCKING_REQUEST,
  blockingDeterminationNotOverstated,
  blockingExceptionSourced,
  blockingNoAutonomousBlockOrRelease,
  evaluateInformationBlocking,
  getBlockingException,
  informationBlockingSummary,
  missingConditionsFor
} from "./information-blocking";

describe("BLOCKING_EXCEPTIONS catalog", () => {
  it("has all eight exceptions across the two categories", () => {
    expect(BLOCKING_EXCEPTIONS).toHaveLength(8);
    expect(BLOCKING_EXCEPTIONS.filter((e) => e.category === "not-fulfilling")).toHaveLength(5);
    expect(BLOCKING_EXCEPTIONS.filter((e) => e.category === "procedures")).toHaveLength(3);
  });
  it("every exception has a citation and required conditions", () => {
    for (const e of BLOCKING_EXCEPTIONS) {
      expect(e.citation).toMatch(/45 CFR 171/);
      expect(e.requiredConditions.length).toBeGreaterThan(0);
    }
  });
});

describe("missingConditionsFor", () => {
  it("returns [] when every required condition is met", () => {
    expect(missingConditionsFor("exception.privacy", ["privacy-precondition-unmet", "no-improper-intent"])).toEqual(
      []
    );
  });
  it("returns the unmet conditions", () => {
    expect(missingConditionsFor("exception.infeasibility", ["infeasible-under-circumstances"])).toEqual([
      "responded-within-10-business-days"
    ]);
  });
  it("returns [] off-catalog (nothing to require)", () => {
    expect(missingConditionsFor("exception.nope", [])).toEqual([]);
  });
});

describe("evaluateInformationBlocking", () => {
  it("not blocking when a claimed exception is fully satisfied", () => {
    const d = evaluateInformationBlocking(DEMO_INFORMATION_BLOCKING_REQUEST);
    expect(d.disposition).toBe("not-information-blocking-exception-met");
    expect(d.exceptionSatisfied).toBe(true);
    expect(d.missingConditions).toEqual([]);
    expect(d.autoBlockedEhi).toBe(false);
    expect(d.autoReleasedEhi).toBe(false);
    expect(d.requiresComplianceReview).toBe(true);
  });

  it("not blocking when there was no interference", () => {
    const d = evaluateInformationBlocking(DEMO_INFORMATION_BLOCKING_NO_INTERFERENCE_REQUEST);
    expect(d.disposition).toBe("not-information-blocking-no-interference");
    expect(d.exceptionSatisfied).toBe(false);
  });

  it("needs review when a required condition is missing", () => {
    const d = evaluateInformationBlocking(DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST);
    expect(d.disposition).toBe("potential-information-blocking-needs-review");
    expect(d.exceptionSatisfied).toBe(false);
    expect(d.missingConditions).toContain("responded-within-10-business-days");
  });

  it("needs review when interference has no claimed exception", () => {
    const d = evaluateInformationBlocking(DEMO_INFORMATION_BLOCKING_NO_EXCEPTION_REQUEST);
    expect(d.disposition).toBe("potential-information-blocking-needs-review");
    expect(d.claimedExceptionId).toBe("");
    expect(d.exceptionCategory).toBe("none");
  });

  it("classifies an off-catalog exception as unknown, needs review", () => {
    const d = evaluateInformationBlocking({
      ...DEMO_INFORMATION_BLOCKING_REQUEST,
      claimedExceptionId: "exception.nope"
    });
    expect(d.exceptionCategory).toBe("unknown");
    expect(d.exceptionSatisfied).toBe(false);
    expect(d.disposition).toBe("potential-information-blocking-needs-review");
  });

  it("is deterministic — same request yields the same determination", () => {
    expect(evaluateInformationBlocking(DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST)).toEqual(
      evaluateInformationBlocking(DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST)
    );
  });
});

describe("getBlockingException", () => {
  it("resolves a cataloged exception", () => {
    expect(getBlockingException("exception.security")?.category).toBe("not-fulfilling");
    expect(getBlockingException("exception.fees")?.category).toBe("procedures");
  });
  it("returns undefined off-catalog", () => {
    expect(getBlockingException("exception.nope")).toBeUndefined();
  });
});

describe("blockingExceptionSourced", () => {
  it("passes when no exception is claimed", () => {
    expect(blockingExceptionSourced(evaluateInformationBlocking(DEMO_INFORMATION_BLOCKING_NO_EXCEPTION_REQUEST))).toBe(
      true
    );
  });
  it("passes a cataloged claimed exception", () => {
    expect(blockingExceptionSourced(evaluateInformationBlocking(DEMO_INFORMATION_BLOCKING_REQUEST))).toBe(true);
  });
  it("fails an off-catalog (unknown) exception", () => {
    expect(
      blockingExceptionSourced({ claimedExceptionId: "exception.nope", exceptionCategory: "unknown" })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(blockingExceptionSourced(null)).toBe(false);
  });
});

describe("blockingDeterminationNotOverstated", () => {
  it("passes a produced exception-met determination", () => {
    expect(
      blockingDeterminationNotOverstated(evaluateInformationBlocking(DEMO_INFORMATION_BLOCKING_REQUEST), {
        conditionsMet: DEMO_INFORMATION_BLOCKING_REQUEST.conditionsMet
      })
    ).toBe(true);
  });
  it("passes a produced needs-review determination", () => {
    expect(
      blockingDeterminationNotOverstated(
        evaluateInformationBlocking(DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST),
        { conditionsMet: DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST.conditionsMet }
      )
    ).toBe(true);
  });
  it("fails an overstated 'exception met' that skipped a condition", () => {
    expect(
      blockingDeterminationNotOverstated(
        {
          claimedExceptionId: "exception.infeasibility",
          interferedWithAccess: true,
          missingConditions: [],
          exceptionSatisfied: true
        },
        { conditionsMet: ["infeasible-under-circumstances"] }
      )
    ).toBe(false);
  });
  it("fails an exception marked satisfied with no interference", () => {
    expect(
      blockingDeterminationNotOverstated({
        claimedExceptionId: "exception.privacy",
        interferedWithAccess: false,
        exceptionSatisfied: true
      })
    ).toBe(false);
  });
  it("uses the determination's own missingConditions when no context is given", () => {
    expect(
      blockingDeterminationNotOverstated({
        claimedExceptionId: "exception.infeasibility",
        interferedWithAccess: true,
        missingConditions: ["responded-within-10-business-days"],
        exceptionSatisfied: false
      })
    ).toBe(true);
  });
  it("fails a null input", () => {
    expect(blockingDeterminationNotOverstated(null)).toBe(false);
  });
});

describe("blockingNoAutonomousBlockOrRelease", () => {
  it("passes a produced determination", () => {
    expect(
      blockingNoAutonomousBlockOrRelease(evaluateInformationBlocking(DEMO_INFORMATION_BLOCKING_REQUEST))
    ).toBe(true);
  });
  it("fails autonomously-withheld EHI", () => {
    expect(
      blockingNoAutonomousBlockOrRelease({
        autoBlockedEhi: true,
        autoReleasedEhi: false,
        requiresComplianceReview: true
      })
    ).toBe(false);
  });
  it("fails autonomously-released EHI", () => {
    expect(
      blockingNoAutonomousBlockOrRelease({
        autoBlockedEhi: false,
        autoReleasedEhi: true,
        requiresComplianceReview: true
      })
    ).toBe(false);
  });
  it("fails an un-reviewed determination", () => {
    expect(
      blockingNoAutonomousBlockOrRelease({
        autoBlockedEhi: false,
        autoReleasedEhi: false,
        requiresComplianceReview: false
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(blockingNoAutonomousBlockOrRelease(null)).toBe(false);
  });
});

describe("informationBlockingSummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = informationBlockingSummary(evaluateInformationBlocking(DEMO_INFORMATION_BLOCKING_REQUEST));
    expect(s.disposition).toBe("not-information-blocking-exception-met");
    expect(s.exceptionSatisfied).toBe(true);
    expect(s.requiresComplianceReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
