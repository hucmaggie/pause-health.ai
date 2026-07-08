import { describe, it, expect } from "vitest";

import {
  DEMO_DATA360_PATIENT_ID,
  getFederatedRecord,
  listSegments,
  resolveIdentity
} from "./data-360";

/**
 * Unit tests for the deterministic Data 360 mock — the zero-credential
 * grounding path every dev / preview / CI run uses. getGroundingContext is
 * already exercised indirectly via care-router.test; this pins the three
 * exported helpers that back the /api/data-360 routes and had no direct
 * coverage: getFederatedRecord, resolveIdentity, and listSegments.
 */

describe("listSegments", () => {
  it("returns the segment catalog", () => {
    const segs = listSegments();
    expect(segs.length).toBeGreaterThanOrEqual(4);
    for (const s of segs) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.name).toBe("string");
      expect(typeof s.patientCount).toBe("number");
      expect(Array.isArray(s.activatedTo)).toBe(true);
    }
  });

  it("returns a defensive copy (mutating the result can't corrupt the catalog)", () => {
    const first = listSegments();
    const originalLength = first.length;
    first.pop();
    first.push({
      id: "junk",
      name: "junk",
      description: "junk",
      patientCount: 0,
      updatedAt: "",
      criteria: "",
      activatedTo: []
    });
    expect(listSegments()).toHaveLength(originalLength);
    expect(listSegments().some((s) => s.id === "junk")).toBe(false);
  });
});

describe("resolveIdentity", () => {
  it("echoes the demo id with the high-confidence mock provenance", () => {
    const input = { preferredName: "Jane", ageBand: "46-50" };
    const out = resolveIdentity(input);
    expect(out.unifiedPatientId).toBe(DEMO_DATA360_PATIENT_ID);
    expect(out.confidence).toBe(0.97);
    expect(out.resolutionRuleset).toBe("pause-menopause-cohort-IR-v3");
    expect(out.matchedSources).toContain("agentforce-intake-history");
    // The input is echoed back verbatim for provenance/debugging.
    expect(out.echo).toEqual(input);
  });
});

describe("getFederatedRecord", () => {
  it("returns a unified record keyed to the requested patient id", () => {
    const rec = getFederatedRecord("patient-xyz");
    expect(rec.unifiedPatientId).toBe("patient-xyz");
    expect(rec.profile.menopauseStage).toBe("late-perimenopause");
    // Insights / longitudinal / cohort are sourced from getGroundingContext.
    expect(Array.isArray(rec.insights)).toBe(true);
    expect(rec.insights.length).toBeGreaterThan(0);
    expect(Array.isArray(rec.longitudinal)).toBe(true);
    expect(rec.cohortComparison).toBeDefined();
    expect(rec.identityResolution).toBeDefined();
  });

  it("carries granted consents and a bounded active-segment subset", () => {
    const rec = getFederatedRecord(DEMO_DATA360_PATIENT_ID);
    expect(rec.consents.every((c) => c.granted)).toBe(true);
    expect(rec.consents.map((c) => c.scope)).toEqual([
      "wearable-ingest",
      "ai-decision-support"
    ]);
    // Only the two advertised segments are attached, and each names a real
    // catalog entry.
    expect(rec.activeSegments).toHaveLength(2);
    const catalogIds = new Set(listSegments().map((s) => s.id));
    for (const seg of rec.activeSegments) {
      expect(catalogIds.has(seg.id)).toBe(true);
    }
  });
});
