import { describe, expect, it } from "vitest";

import {
  DEMO_AUDIT_SAMPLE_FULL_REQUEST,
  DEMO_AUDIT_SAMPLE_RESEED_REQUEST,
  DEMO_AUDIT_SAMPLE_REQUEST,
  auditSampleSummary,
  evaluateAuditSample,
  mulberry32,
  noAutonomousAudit,
  reservoirSample,
  sampleSourced,
  selectionReproducible
} from "./audit-sample";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("differs across seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("reservoirSample", () => {
  it("draws a reproducible k-sample that is a subset of the population", () => {
    const sample = reservoirSample(DEMO_AUDIT_SAMPLE_REQUEST.recordIds, 5, 20260913);
    expect(sample).toEqual(["CLM-44200", "CLM-44208", "CLM-44207", "CLM-44213", "CLM-44204"]);
    for (const id of sample) expect(DEMO_AUDIT_SAMPLE_REQUEST.recordIds).toContain(id);
  });

  it("returns the whole population when n <= k", () => {
    expect(reservoirSample(["a", "b", "c"], 10, 7)).toEqual(["a", "b", "c"]);
  });

  it("returns [] for k = 0", () => {
    expect(reservoirSample(["a", "b"], 0, 1)).toEqual([]);
  });

  it("yields a different sample under a different seed", () => {
    const a = reservoirSample(DEMO_AUDIT_SAMPLE_REQUEST.recordIds, 5, 20260913);
    const b = reservoirSample(DEMO_AUDIT_SAMPLE_REQUEST.recordIds, 5, 42);
    expect(a).not.toEqual(b);
  });
});

describe("evaluateAuditSample", () => {
  it("classifies a sampled population", () => {
    const d = evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST);
    expect(d.disposition).toBe("sampled");
    expect(d.populationSize).toBe(20);
    expect(d.effectiveSampleSize).toBe(5);
    expect(d.inclusionProbability).toBe(0.25);
    expect(d.sample).toHaveLength(5);
    expect(d.requiresAuditorReview).toBe(true);
    expect(d.autoAudited).toBe(false);
  });

  it("classifies a full-population request (n <= k)", () => {
    const d = evaluateAuditSample(DEMO_AUDIT_SAMPLE_FULL_REQUEST);
    expect(d.disposition).toBe("full-population");
    expect(d.effectiveSampleSize).toBe(4);
    expect(d.inclusionProbability).toBe(1);
  });

  it("is deterministic", () => {
    expect(evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST)).toEqual(
      evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST)
    );
  });
});

describe("sampleSourced", () => {
  it("is true for each demo determination", () => {
    expect(sampleSourced(evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST))).toBe(true);
    expect(sampleSourced(evaluateAuditSample(DEMO_AUDIT_SAMPLE_FULL_REQUEST))).toBe(true);
    expect(sampleSourced(evaluateAuditSample(DEMO_AUDIT_SAMPLE_RESEED_REQUEST))).toBe(true);
  });

  it("is false for a fabricated id not in the population", () => {
    const d = evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST);
    const sample = [...d.sample.slice(0, 4), "CLM-FAKE"];
    expect(sampleSourced({ ...d, sample })).toBe(false);
  });

  it("is false for a mis-sized sample", () => {
    const d = evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST);
    expect(sampleSourced({ ...d, sample: d.sample.slice(0, 4) })).toBe(false);
  });

  it("is false for a duplicate pick beyond the population's occurrences", () => {
    const d = evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST);
    const sample = [d.sample[0], d.sample[0], ...d.sample.slice(2)];
    expect(sampleSourced({ ...d, sample })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(sampleSourced(null)).toBe(false);
  });
});

describe("selectionReproducible", () => {
  it("is true for each demo determination", () => {
    expect(selectionReproducible(evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST))).toBe(true);
    expect(selectionReproducible(evaluateAuditSample(DEMO_AUDIT_SAMPLE_RESEED_REQUEST))).toBe(true);
  });

  it("is false for a cherry-picked in-population sample that the seed wouldn't produce", () => {
    const d = evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST);
    // Swap in five real population ids that aren't the seeded draw.
    const cherry = ["CLM-44201", "CLM-44202", "CLM-44203", "CLM-44205", "CLM-44206"];
    const tampered = { ...d, sample: cherry };
    expect(sampleSourced(tampered)).toBe(true); // all in-population, right size
    expect(selectionReproducible(tampered)).toBe(false); // but not the seeded draw
  });

  it("is false when the reported seed doesn't match the sample", () => {
    const d = evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST);
    expect(selectionReproducible({ ...d, seed: 999 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(selectionReproducible(undefined)).toBe(false);
  });
});

describe("noAutonomousAudit", () => {
  it("is true for a produced sample", () => {
    expect(noAutonomousAudit(evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST))).toBe(true);
  });

  it("is false when auto-audited", () => {
    const d = evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST);
    expect(noAutonomousAudit({ ...d, autoAudited: true as unknown as false })).toBe(false);
  });

  it("is false when auditor review is skipped", () => {
    const d = evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST);
    expect(noAutonomousAudit({ ...d, requiresAuditorReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousAudit(null)).toBe(false);
  });
});

describe("auditSampleSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST);
    expect(auditSampleSummary(d)).toEqual({
      auditRef: "siu-audit-2026-Q3-4402",
      disposition: "sampled",
      populationSize: 20,
      sampleSize: 5,
      effectiveSampleSize: 5,
      inclusionProbability: 0.25,
      seed: 20260913,
      requiresAuditorReview: true,
      synthetic: true
    });
  });
});
