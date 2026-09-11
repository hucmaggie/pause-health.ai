import { describe, expect, it } from "vitest";

import {
  DEMO_CODE_TAXONOMY_ALL_REQUEST,
  DEMO_CODE_TAXONOMY_REQUEST,
  DEMO_CODE_TAXONOMY_SPECIFIC_REQUEST,
  buildTrie,
  classificationConsistent,
  classificationsSourced,
  codeTaxonomySummary,
  evaluateCodeTaxonomy,
  longestPrefixMatch,
  noAutonomousRecode
} from "./code-taxonomy";

describe("longestPrefixMatch", () => {
  const trie = buildTrie(DEMO_CODE_TAXONOMY_REQUEST.taxonomy);

  it("picks the most-specific (longest) matching prefix", () => {
    expect(longestPrefixMatch(trie, "E28.310")).toEqual({
      category: "Primary ovarian failure (menopause-related)",
      prefix: "E28.3"
    });
  });

  it("falls back to a shallower prefix when the specific one doesn't match", () => {
    expect(longestPrefixMatch(trie, "E28.9")).toEqual({
      category: "Ovarian dysfunction",
      prefix: "E28"
    });
  });

  it("returns null when no taxonomy prefix matches", () => {
    expect(longestPrefixMatch(trie, "Z00.00")).toBeNull();
  });
});

describe("evaluateCodeTaxonomy", () => {
  it("classifies a mixed batch (unclassified-present)", () => {
    const d = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST);
    expect(d.disposition).toBe("unclassified-present");
    expect(d.classifiedCount).toBe(4);
    expect(d.unclassifiedCount).toBe(1);
    expect(d.total).toBe(5);
    expect(d.classifications[0]).toEqual({
      code: "E28.310",
      category: "Primary ovarian failure (menopause-related)",
      matchedPrefix: "E28.3"
    });
    expect(d.classifications[4]).toEqual({ code: "Z00.00", category: null, matchedPrefix: null });
    expect(d.requiresCoderReview).toBe(true);
    expect(d.autoApplied).toBe(false);
  });

  it("classifies an all-classified batch", () => {
    const d = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_ALL_REQUEST);
    expect(d.disposition).toBe("all-classified");
    expect(d.unclassifiedCount).toBe(0);
  });

  it("demonstrates longest-prefix specificity", () => {
    const d = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_SPECIFIC_REQUEST);
    expect(d.classifications[0].matchedPrefix).toBe("E28.3");
    expect(d.classifications[1].matchedPrefix).toBe("E28");
  });

  it("is deterministic", () => {
    expect(evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST)).toEqual(
      evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST)
    );
  });
});

describe("classificationsSourced", () => {
  it("is true for each demo batch", () => {
    expect(classificationsSourced(evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST))).toBe(true);
    expect(classificationsSourced(evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_ALL_REQUEST))).toBe(true);
    expect(classificationsSourced(evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_SPECIFIC_REQUEST))).toBe(
      true
    );
  });

  it("is false for a fabricated code (isolated from classification-consistent)", () => {
    const d = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST);
    // Swap the first classification's code for one not in the batch; keep its correct match.
    const classifications = d.classifications.map((c, i) =>
      i === 0 ? { ...c, code: "PHANTOM.CODE" } : c
    );
    const tampered = { ...d, classifications };
    expect(classificationsSourced(tampered)).toBe(false);
    expect(classificationConsistent(tampered)).toBe(true);
  });

  it("is false for an invented category (prefix not in the taxonomy)", () => {
    const d = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST);
    const classifications = d.classifications.map((c, i) =>
      i === 0 ? { ...c, category: "Invented", matchedPrefix: "Q99" } : c
    );
    expect(classificationsSourced({ ...d, classifications })).toBe(false);
  });

  it("is false when the counts don't add up", () => {
    const d = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST);
    expect(classificationsSourced({ ...d, classifiedCount: 99 })).toBe(false);
  });

  it("is false when a classification is self-inconsistent (category without a prefix)", () => {
    const d = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST);
    const classifications = d.classifications.map((c, i) =>
      i === 4 ? { ...c, category: "Something", matchedPrefix: null } : c
    );
    expect(classificationsSourced({ ...d, classifications })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(classificationsSourced(null)).toBe(false);
  });
});

describe("classificationConsistent", () => {
  it("is true for each demo batch", () => {
    expect(classificationConsistent(evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST))).toBe(true);
    expect(classificationConsistent(evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_ALL_REQUEST))).toBe(
      true
    );
  });

  it("is false for a wrong bucket (while classifications-sourced stays true)", () => {
    const d = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST);
    // Re-bucket E28.310 to the diabetes group — a real taxonomy prefix, but the wrong one.
    const classifications = d.classifications.map((c, i) =>
      i === 0 ? { ...c, category: "Type 2 diabetes mellitus", matchedPrefix: "E11" } : c
    );
    const tampered = { ...d, classifications };
    expect(classificationsSourced(tampered)).toBe(true);
    expect(classificationConsistent(tampered)).toBe(false);
  });

  it("is false for a missed match (a classifiable code left unclassified)", () => {
    const d = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST);
    const classifications = d.classifications.map((c, i) =>
      i === 1 ? { ...c, category: null, matchedPrefix: null } : c
    );
    expect(classificationConsistent({ ...d, classifications })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(classificationConsistent(undefined)).toBe(false);
  });
});

describe("noAutonomousRecode", () => {
  it("is true for a produced batch", () => {
    expect(noAutonomousRecode(evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST))).toBe(true);
  });

  it("is false when auto-applied", () => {
    const d = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST);
    expect(noAutonomousRecode({ ...d, autoApplied: true as unknown as false })).toBe(false);
  });

  it("is false when coder review is skipped", () => {
    const d = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST);
    expect(noAutonomousRecode({ ...d, requiresCoderReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousRecode(null)).toBe(false);
  });
});

describe("codeTaxonomySummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST);
    expect(codeTaxonomySummary(d)).toEqual({
      catalogRef: "code-catalog-001",
      disposition: "unclassified-present",
      codeCount: 5,
      prefixCount: 4,
      classifiedCount: 4,
      unclassifiedCount: 1,
      total: 5,
      requiresCoderReview: true,
      synthetic: true
    });
  });
});
