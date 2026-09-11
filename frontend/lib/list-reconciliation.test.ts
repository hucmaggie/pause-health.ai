import { describe, expect, it } from "vitest";

import {
  DEMO_LIST_RECONCILIATION_CHANGED_REQUEST,
  DEMO_LIST_RECONCILIATION_MATCH_REQUEST,
  DEMO_LIST_RECONCILIATION_REQUEST,
  diffOptimal,
  diffSourced,
  evaluateListReconciliation,
  lcsLength,
  listReconciliationSummary,
  longestCommonSubsequence,
  noAutonomousUpdate
} from "./list-reconciliation";

describe("longestCommonSubsequence", () => {
  it("finds the preserved items in shared order", () => {
    expect(
      longestCommonSubsequence(
        DEMO_LIST_RECONCILIATION_REQUEST.prior,
        DEMO_LIST_RECONCILIATION_REQUEST.current
      )
    ).toEqual(["metformin", "atorvastatin", "aspirin"]);
  });

  it("returns the whole list when the two are identical", () => {
    const a = ["estradiol", "progesterone", "calcium-vitamin-d"];
    expect(longestCommonSubsequence(a, a)).toEqual(a);
  });

  it("returns empty when there is no common item or a list is empty", () => {
    expect(longestCommonSubsequence(["a", "b"], ["c", "d"])).toEqual([]);
    expect(longestCommonSubsequence([], ["a"])).toEqual([]);
  });
});

describe("lcsLength", () => {
  it("is the length of the longest common subsequence", () => {
    expect(
      lcsLength(
        DEMO_LIST_RECONCILIATION_CHANGED_REQUEST.prior,
        DEMO_LIST_RECONCILIATION_CHANGED_REQUEST.current
      )
    ).toBe(2);
  });
});

describe("evaluateListReconciliation", () => {
  it("reconciles a changed medication list", () => {
    const d = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST);
    expect(d.retained).toEqual(["metformin", "atorvastatin", "aspirin"]);
    expect(d.removed).toEqual(["lisinopril"]);
    expect(d.added).toEqual(["estradiol"]);
    expect(d.lcsLength).toBe(3);
    expect(d.disposition).toBe("changes-present");
    expect(d.requiresClinicianReview).toBe(true);
    expect(d.autoApplied).toBe(false);
  });

  it("reports lists-match when the two lists are identical", () => {
    const d = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_MATCH_REQUEST);
    expect(d.disposition).toBe("lists-match");
    expect(d.removed).toEqual([]);
    expect(d.added).toEqual([]);
    expect(d.lcsLength).toBe(3);
  });

  it("reconciles a problem list with several changes", () => {
    const d = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_CHANGED_REQUEST);
    expect(d.retained).toEqual(["insomnia", "hypertension"]);
    expect(d.removed).toEqual(["hot-flashes", "osteopenia"]);
    expect(d.added).toEqual(["osteoporosis", "anxiety"]);
    expect(d.disposition).toBe("changes-present");
  });

  it("is deterministic", () => {
    expect(evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST)).toEqual(
      evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST)
    );
  });
});

describe("diffSourced", () => {
  it("is true for each demo diff", () => {
    expect(diffSourced(evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST))).toBe(true);
    expect(diffSourced(evaluateListReconciliation(DEMO_LIST_RECONCILIATION_MATCH_REQUEST))).toBe(true);
    expect(diffSourced(evaluateListReconciliation(DEMO_LIST_RECONCILIATION_CHANGED_REQUEST))).toBe(true);
  });

  it("is false for a fabricated / reordered retained list (isolated from lcs-optimal)", () => {
    const d = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST);
    // Reorder the retained items so it is no longer a subsequence of prior, keeping length == true LCS (3).
    const tampered = { ...d, retained: ["metformin", "aspirin", "atorvastatin"] };
    expect(diffSourced(tampered)).toBe(false);
    expect(diffOptimal(tampered)).toBe(true);
  });

  it("is false when removed/added are mis-stated", () => {
    const d = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST);
    expect(diffSourced({ ...d, removed: [] })).toBe(false);
    expect(diffSourced({ ...d, added: ["estradiol", "phantom"] })).toBe(false);
  });

  it("is false when lcsLength disagrees with retained", () => {
    const d = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST);
    expect(diffSourced({ ...d, lcsLength: 2 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(diffSourced(null)).toBe(false);
  });
});

describe("diffOptimal", () => {
  it("is true for each demo diff", () => {
    expect(diffOptimal(evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST))).toBe(true);
    expect(diffOptimal(evaluateListReconciliation(DEMO_LIST_RECONCILIATION_MATCH_REQUEST))).toBe(true);
  });

  it("is false for a sub-optimal common subsequence (while diff-sourced stays true)", () => {
    const d = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST);
    // A real but shorter common subsequence, with self-consistent complements — sourced passes, optimal fails.
    const tampered = {
      ...d,
      retained: ["metformin", "aspirin"],
      removed: ["lisinopril", "atorvastatin"],
      added: ["atorvastatin", "estradiol"],
      lcsLength: 2
    };
    expect(diffSourced(tampered)).toBe(true);
    expect(diffOptimal(tampered)).toBe(false);
  });

  it("is false when the disposition disagrees with the recompute", () => {
    const d = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_MATCH_REQUEST);
    expect(diffOptimal({ ...d, disposition: "changes-present" })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(diffOptimal(undefined)).toBe(false);
  });
});

describe("noAutonomousUpdate", () => {
  it("is true for a produced diff", () => {
    expect(noAutonomousUpdate(evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST))).toBe(true);
  });

  it("is false when auto-applied", () => {
    const d = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST);
    expect(noAutonomousUpdate({ ...d, autoApplied: true as unknown as false })).toBe(false);
  });

  it("is false when clinician review is skipped", () => {
    const d = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST);
    expect(noAutonomousUpdate({ ...d, requiresClinicianReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousUpdate(null)).toBe(false);
  });
});

describe("listReconciliationSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST);
    expect(listReconciliationSummary(d)).toEqual({
      recordRef: "med-list-mrn-4821",
      disposition: "changes-present",
      priorCount: 4,
      currentCount: 4,
      retainedCount: 3,
      addedCount: 1,
      removedCount: 1,
      lcsLength: 3,
      requiresClinicianReview: true,
      synthetic: true
    });
  });
});
