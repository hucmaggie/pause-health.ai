import { describe, expect, it } from "vitest";
import {
  CASE_TYPES,
  DEMO_BILLING_INTAKE,
  DEMO_GRIEVANCE_INTAKE,
  addDays,
  assembleGrievanceCase,
  caseResolutionRequiresHumanQueue,
  classifyCase,
  deadlineTracesToCatalog,
  getCaseType,
  isCaseType,
  proposeCaseResolution,
  routingSummaryIsPhiSafe
} from "./grievance-appeals";

/**
 * Tests for lib/grievance-appeals.ts — the deterministic grievance-and-
 * appeals intake behind the Grievance & Appeals Agent. Assembly is a pure
 * function of the intake + received date (no randomness, no clock), so the
 * same context always yields the same case type / urgency / queue /
 * deadline / summary. These pin determinism, the catalog-sourced
 * classifications, the deadline math, and the three honest governance
 * signals.
 */

describe("catalog", () => {
  it("exposes a stable, illustrative case-type catalog", () => {
    expect(CASE_TYPES.length).toBeGreaterThan(0);
    for (const c of CASE_TYPES) {
      expect(c.id).toMatch(/^case\./);
      expect(c.synthetic).toBe(true);
      expect(c.deadlineDays).toBeGreaterThan(0);
      expect(c.maxDeadlineDays).toBeGreaterThanOrEqual(c.deadlineDays);
    }
    // The expedited appeal is the tightest deadline (3 days).
    const expedited = CASE_TYPES.find(
      (c) => c.id === "case.appeal-expedited-coverage-denial"
    );
    expect(expedited?.deadlineDays).toBe(3);
    expect(expedited?.queue).toBe("clinical-review");
  });

  it("catalog lookups agree with the catalog", () => {
    for (const c of CASE_TYPES) {
      expect(isCaseType(c.id)).toBe(true);
      expect(getCaseType(c.id)?.label).toBe(c.label);
    }
    expect(isCaseType("case.made-up")).toBe(false);
    expect(isCaseType(42)).toBe(false);
  });
});

describe("classifyCase", () => {
  it("is deterministic — same intake always yields the same class", () => {
    expect(classifyCase(DEMO_GRIEVANCE_INTAKE)).toBe(classifyCase(DEMO_GRIEVANCE_INTAKE));
  });

  it("coverage denial + expedited request → expedited coverage-denial appeal", () => {
    expect(classifyCase(DEMO_GRIEVANCE_INTAKE)).toBe(
      "case.appeal-expedited-coverage-denial"
    );
  });

  it("coverage denial by keyword (no explicit flag) → standard coverage-denial appeal", () => {
    expect(
      classifyCase({
        memberRef: "member-x",
        complaintText: "The service was denied even though it was medically necessary.",
        receivedDate: "2026-07-01"
      })
    ).toBe("case.appeal-coverage-denial");
  });

  it("billing keywords → billing-dispute grievance", () => {
    expect(classifyCase(DEMO_BILLING_INTAKE)).toBe("case.grievance-billing-dispute");
  });

  it("everything else → quality-of-service grievance", () => {
    expect(
      classifyCase({
        memberRef: "member-y",
        complaintText: "The office staff was rude and did not return my call.",
        receivedDate: "2026-07-01"
      })
    ).toBe("case.grievance-quality-of-service");
  });
});

describe("addDays", () => {
  it("adds days deterministically without a clock", () => {
    expect(addDays("2026-07-01", 3)).toBe("2026-07-04");
    expect(addDays("2026-07-01", 30)).toBe("2026-07-31");
  });

  it("returns the input for an invalid date rather than emitting NaN", () => {
    expect(addDays("not-a-date", 3)).toBe("not-a-date");
  });
});

describe("assembleGrievanceCase", () => {
  it("assembles an expedited coverage-denial case with the 3-day deadline + clinical-review queue", () => {
    const c = assembleGrievanceCase(DEMO_GRIEVANCE_INTAKE);
    expect(c.caseType).toBe("case.appeal-expedited-coverage-denial");
    expect(c.urgency).toBe("expedited");
    expect(c.queue).toBe("clinical-review");
    expect(c.deadlineDays).toBe(3);
    expect(c.deadlineDate).toBe("2026-07-04");
    expect(c.state).toBe("queued-for-human-review");
    expect(c.phiSafeRoutingSummary.phiSafe).toBe(true);
  });

  it("assembles a standard billing-dispute grievance with the 30-day deadline + member-services queue", () => {
    const c = assembleGrievanceCase(DEMO_BILLING_INTAKE);
    expect(c.caseType).toBe("case.grievance-billing-dispute");
    expect(c.urgency).toBe("standard");
    expect(c.queue).toBe("member-services");
    expect(c.deadlineDays).toBe(30);
    expect(c.deadlineDate).toBe("2026-07-31");
  });

  it("is deterministic — same intake always yields the same case", () => {
    expect(assembleGrievanceCase(DEMO_GRIEVANCE_INTAKE)).toEqual(
      assembleGrievanceCase(DEMO_GRIEVANCE_INTAKE)
    );
  });

  it("produces a PHI-safe routing summary (structured only, no free-text PHI)", () => {
    const c = assembleGrievanceCase(DEMO_GRIEVANCE_INTAKE);
    expect(routingSummaryIsPhiSafe(c.phiSafeRoutingSummary)).toBe(true);
    // The routing summary should NOT include the complaint text.
    expect(Object.values(c.phiSafeRoutingSummary).join(" ").toLowerCase()).not.toContain(
      "estradiol"
    );
    expect(Object.values(c.phiSafeRoutingSummary).join(" ").toLowerCase()).not.toContain(
      "menopause"
    );
  });
});

describe("proposeCaseResolution", () => {
  it("always requires human queue action; never applied autonomously", () => {
    const p = proposeCaseResolution({
      caseId: "case-x",
      queue: "clinical-review",
      rationale: "expedited coverage-denial appeal"
    });
    expect(p.requiresHumanQueueAction).toBe(true);
    expect(p.applied).toBe(false);
    expect(p.state).toBe("ready-for-human-queue");
  });
});

describe("governance signals", () => {
  const c = assembleGrievanceCase(DEMO_GRIEVANCE_INTAKE);
  const proposal = proposeCaseResolution({
    caseId: c.caseId,
    queue: c.queue,
    rationale: "expedited coverage-denial"
  });

  it("caseResolutionRequiresHumanQueue: true for produced proposals, false when applied or unapproved", () => {
    expect(caseResolutionRequiresHumanQueue([proposal])).toBe(true);
    expect(caseResolutionRequiresHumanQueue([])).toBe(true);
    expect(
      caseResolutionRequiresHumanQueue([
        {
          ...proposal,
          applied: true
        } as unknown as typeof proposal
      ])
    ).toBe(false);
    expect(
      caseResolutionRequiresHumanQueue([
        { requiresHumanQueueAction: false, applied: false }
      ])
    ).toBe(false);
    expect(caseResolutionRequiresHumanQueue(null)).toBe(false);
  });

  it("deadlineTracesToCatalog: true for the produced case, false when case-type is off-catalog or deadline exceeds max", () => {
    expect(
      deadlineTracesToCatalog({
        caseType: c.caseType,
        receivedDate: DEMO_GRIEVANCE_INTAKE.receivedDate,
        deadlineDate: c.deadlineDate
      })
    ).toBe(true);
    // Deadline pushed past regulatory max (3 → 30 days for expedited).
    expect(
      deadlineTracesToCatalog({
        caseType: c.caseType,
        receivedDate: DEMO_GRIEVANCE_INTAKE.receivedDate,
        deadlineDate: "2026-07-31"
      })
    ).toBe(false);
    expect(
      deadlineTracesToCatalog({
        caseType: "case.made-up",
        receivedDate: DEMO_GRIEVANCE_INTAKE.receivedDate,
        deadlineDate: c.deadlineDate
      })
    ).toBe(false);
    expect(deadlineTracesToCatalog(null)).toBe(false);
  });

  it("routingSummaryIsPhiSafe: true for the structured summary, false when PHI leaks in", () => {
    expect(routingSummaryIsPhiSafe(c.phiSafeRoutingSummary)).toBe(true);
    // Extra free-text key is a violation.
    expect(
      routingSummaryIsPhiSafe({
        ...c.phiSafeRoutingSummary,
        clinicalDetail: "denial for estradiol patch"
      } as unknown as Record<string, unknown>)
    ).toBe(false);
    // PHI keyword injected into an allowed key's string value fails.
    expect(
      routingSummaryIsPhiSafe({
        ...c.phiSafeRoutingSummary,
        queue: "member-services · estradiol"
      } as unknown as Record<string, unknown>)
    ).toBe(false);
    // phiSafe:false on the payload fails.
    expect(
      routingSummaryIsPhiSafe({
        ...c.phiSafeRoutingSummary,
        phiSafe: false
      } as unknown as Record<string, unknown>)
    ).toBe(false);
    expect(routingSummaryIsPhiSafe(null)).toBe(false);
  });

  it("the produced case satisfies all three signals", () => {
    expect(
      deadlineTracesToCatalog({
        caseType: c.caseType,
        receivedDate: DEMO_GRIEVANCE_INTAKE.receivedDate,
        deadlineDate: c.deadlineDate
      })
    ).toBe(true);
    expect(routingSummaryIsPhiSafe(c.phiSafeRoutingSummary)).toBe(true);
    expect(caseResolutionRequiresHumanQueue([proposal])).toBe(true);
  });
});
