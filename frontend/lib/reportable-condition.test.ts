import { describe, expect, it } from "vitest";

import {
  type ReportableCaseDetermination,
  DEMO_CASE_DEFINITION,
  DEMO_REPORTABLE_CASE_NEGATIVE_REQUEST,
  DEMO_REPORTABLE_CASE_PROBABLE_REQUEST,
  DEMO_REPORTABLE_CASE_REQUEST,
  NOT_A_CASE,
  classificationConsistent,
  evaluateNode,
  evaluateReportableCase,
  factsSourced,
  noAutonomousReport,
  reportableCaseSummary,
  referencedFactsOf
} from "./reportable-condition";

const factMap = (entries: Record<string, boolean>) => new Map(Object.entries(entries));

describe("evaluateNode", () => {
  it("evaluates leaf / not / all-of / any-of", () => {
    const f = factMap({ a: true, b: false });
    expect(evaluateNode({ type: "leaf", fact: "a" }, f)).toBe(true);
    expect(evaluateNode({ type: "leaf", fact: "missing" }, f)).toBe(false);
    expect(evaluateNode({ type: "not", child: { type: "leaf", fact: "b" } }, f)).toBe(true);
    expect(
      evaluateNode(
        { type: "all-of", children: [{ type: "leaf", fact: "a" }, { type: "leaf", fact: "b" }] },
        f
      )
    ).toBe(false);
    expect(
      evaluateNode(
        { type: "any-of", children: [{ type: "leaf", fact: "a" }, { type: "leaf", fact: "b" }] },
        f
      )
    ).toBe(true);
  });

  it("treats empty all-of as true and empty any-of as false", () => {
    const f = factMap({});
    expect(evaluateNode({ type: "all-of", children: [] }, f)).toBe(true);
    expect(evaluateNode({ type: "any-of", children: [] }, f)).toBe(false);
  });

  it("recurses through nested trees", () => {
    const f = factMap({ x: true, y: false, z: true });
    // x AND (y OR NOT z) => true AND (false OR false) => false
    expect(
      evaluateNode(
        {
          type: "all-of",
          children: [
            { type: "leaf", fact: "x" },
            {
              type: "any-of",
              children: [{ type: "leaf", fact: "y" }, { type: "not", child: { type: "leaf", fact: "z" } }]
            }
          ]
        },
        f
      )
    ).toBe(false);
  });
});

describe("referencedFactsOf", () => {
  it("collects every leaf fact, sorted + de-duped", () => {
    expect(referencedFactsOf(DEMO_CASE_DEFINITION)).toEqual([
      "chronic-history",
      "clinically-compatible",
      "elevated-alt",
      "epi-linked",
      "jaundice",
      "lab-positive-antigen",
      "lab-positive-nat"
    ]);
  });
});

describe("evaluateReportableCase", () => {
  it("classifies confirmed when lab-positive and not chronic", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_REQUEST);
    expect(d.classification).toBe("confirmed");
    expect(d.reportable).toBe(true);
    expect(d.classificationResults).toEqual([
      { classification: "confirmed", met: true },
      { classification: "probable", met: true },
      { classification: "suspect", met: true }
    ]);
    expect(d.requiresEpiReview).toBe(true);
    expect(d.autoReported).toBe(false);
  });

  it("classifies probable when clinical + epi-linked but no lab", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_PROBABLE_REQUEST);
    expect(d.classification).toBe("probable");
    expect(d.reportable).toBe(true);
    expect(d.classificationResults).toEqual([
      { classification: "confirmed", met: false },
      { classification: "probable", met: true },
      { classification: "suspect", met: true }
    ]);
  });

  it("classifies not-a-case when nothing holds", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_NEGATIVE_REQUEST);
    expect(d.classification).toBe(NOT_A_CASE);
    expect(d.reportable).toBe(false);
  });

  it("echoes facts + definition and reports the referenced fact set", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_REQUEST);
    expect(d.facts).toHaveLength(7);
    expect(d.definition.classifications).toHaveLength(3);
    expect(d.referencedFacts).toHaveLength(7);
  });

  it("is deterministic — identical inputs yield identical classifications", () => {
    expect(evaluateReportableCase(DEMO_REPORTABLE_CASE_REQUEST)).toEqual(
      evaluateReportableCase(DEMO_REPORTABLE_CASE_REQUEST)
    );
  });
});

describe("factsSourced", () => {
  it("is true for each demo classification", () => {
    expect(factsSourced(evaluateReportableCase(DEMO_REPORTABLE_CASE_REQUEST))).toBe(true);
    expect(factsSourced(evaluateReportableCase(DEMO_REPORTABLE_CASE_PROBABLE_REQUEST))).toBe(true);
    expect(factsSourced(evaluateReportableCase(DEMO_REPORTABLE_CASE_NEGATIVE_REQUEST))).toBe(true);
  });

  it("is false when a phantom classification result is appended", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_PROBABLE_REQUEST);
    const tampered = {
      ...d,
      classificationResults: [
        ...d.classificationResults,
        { classification: "phantom-tier", met: true }
      ]
    };
    expect(factsSourced(tampered)).toBe(false);
    // Isolated: the consistency check ignores the phantom and still recomputes the real classifications.
    expect(classificationConsistent(tampered)).toBe(true);
  });

  it("is false when a criterion references a fact not in the submitted facts", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_REQUEST);
    const tampered = {
      ...d,
      definition: {
        ...d.definition,
        classifications: [
          {
            classification: "confirmed",
            criteria: { type: "leaf" as const, fact: "fabricated-criterion" }
          },
          ...d.definition.classifications.slice(1)
        ]
      }
    };
    expect(factsSourced(tampered)).toBe(false);
  });

  it("is false when the reported referencedFacts don't match the definition", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_REQUEST);
    expect(factsSourced({ ...d, referencedFacts: ["jaundice"] })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(factsSourced(null)).toBe(false);
  });
});

describe("classificationConsistent", () => {
  it("is true for each demo classification", () => {
    expect(classificationConsistent(evaluateReportableCase(DEMO_REPORTABLE_CASE_REQUEST))).toBe(true);
    expect(
      classificationConsistent(evaluateReportableCase(DEMO_REPORTABLE_CASE_PROBABLE_REQUEST))
    ).toBe(true);
    expect(
      classificationConsistent(evaluateReportableCase(DEMO_REPORTABLE_CASE_NEGATIVE_REQUEST))
    ).toBe(true);
  });

  it("is false when a classification's met flag is mis-evaluated (and flips the selection) while sourced stays true", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_PROBABLE_REQUEST);
    const tampered = {
      ...d,
      classificationResults: d.classificationResults.map((r) =>
        r.classification === "confirmed" ? { ...r, met: true } : r
      ),
      classification: "confirmed",
      reportable: true
    };
    expect(factsSourced(tampered)).toBe(true);
    expect(classificationConsistent(tampered)).toBe(false);
  });

  it("is false when the selected classification doesn't follow precedence", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_REQUEST);
    expect(classificationConsistent({ ...d, classification: "suspect" })).toBe(false);
  });

  it("is false when the reportable flag is wrong", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_NEGATIVE_REQUEST);
    expect(classificationConsistent({ ...d, reportable: true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(classificationConsistent(null)).toBe(false);
  });
});

describe("noAutonomousReport", () => {
  it("is true for a produced classification", () => {
    expect(noAutonomousReport(evaluateReportableCase(DEMO_REPORTABLE_CASE_REQUEST))).toBe(true);
  });

  it("is false when auto-reported", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_REQUEST);
    expect(
      noAutonomousReport({ ...(d as ReportableCaseDetermination), autoReported: true as unknown as false })
    ).toBe(false);
  });

  it("is false when epi review is skipped", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_REQUEST);
    expect(
      noAutonomousReport({
        ...(d as ReportableCaseDetermination),
        requiresEpiReview: false as unknown as true
      })
    ).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousReport(null)).toBe(false);
  });
});

describe("reportableCaseSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateReportableCase(DEMO_REPORTABLE_CASE_PROBABLE_REQUEST);
    expect(reportableCaseSummary(d)).toEqual({
      caseRef: "rc-case-002",
      condition: "acute-viral-hepatitis (illustrative)",
      classification: "probable",
      reportable: true,
      classificationCount: 3,
      requiresEpiReview: true,
      synthetic: true
    });
  });
});
