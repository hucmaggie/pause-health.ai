import { describe, expect, it } from "vitest";
import {
  DEFAULT_FWA_FACTORS,
  DEMO_CLEAR_REQUEST,
  DEMO_IMPOSSIBLE_DAY_REQUEST,
  DEMO_MULTI_FLAG_REQUEST,
  DEMO_PHANTOM_SERVICE_REQUEST,
  DEMO_UPCODING_REQUEST,
  FWA_PATTERNS,
  PROTECTED_CLASS_ATTRIBUTES,
  evaluateFwaPatterns,
  getFwaPattern,
  isFwaPattern,
  isProtectedClassAttribute,
  noProtectedClassFactors,
  patternsTraceToCatalog,
  reportRequiresSiuReview,
  screenClaim,
  summarizeFwaScreening
} from "./fwa-detection";

/**
 * Tests for lib/fwa-detection.ts — the deterministic FWA screener behind
 * the FWA Detection Agent. Screening is a pure function of the claim +
 * baseline + pattern catalog (no randomness, no clock), so the same request
 * always yields the same flags + decision + severity. These pin
 * determinism, the catalog-sourced patterns, the severity precedence, and
 * the three honest governance signals.
 */

describe("catalogs", () => {
  it("exposes a stable pattern catalog + protected-class list", () => {
    expect(FWA_PATTERNS.length).toBe(6);
    for (const p of FWA_PATTERNS) {
      expect(p.id).toMatch(/^pattern\./);
      expect(p.synthetic).toBe(true);
      expect(["low", "medium", "high"]).toContain(p.defaultSeverity);
    }
    expect(PROTECTED_CLASS_ATTRIBUTES.length).toBeGreaterThan(0);
    for (const a of PROTECTED_CLASS_ATTRIBUTES) {
      expect(a).toMatch(/^attr\./);
    }
    expect(DEFAULT_FWA_FACTORS.length).toBeGreaterThan(0);
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const p of FWA_PATTERNS) {
      expect(isFwaPattern(p.id)).toBe(true);
      expect(getFwaPattern(p.id)?.label).toBe(p.label);
    }
    expect(isFwaPattern("pattern.made-up")).toBe(false);
    expect(isProtectedClassAttribute("attr.race")).toBe(true);
    expect(isProtectedClassAttribute("attr.provider-ethnicity")).toBe(true);
    expect(isProtectedClassAttribute("pattern.unbundling")).toBe(false);
    expect(isProtectedClassAttribute(42)).toBe(false);
  });

  it("no default FWA factor is a protected-class attribute", () => {
    for (const f of DEFAULT_FWA_FACTORS) {
      expect(isProtectedClassAttribute(f)).toBe(false);
    }
  });
});

describe("evaluateFwaPatterns", () => {
  it("returns an empty array for a clean claim", () => {
    expect(evaluateFwaPatterns(DEMO_CLEAR_REQUEST)).toEqual([]);
  });

  it("fires upcoding when E/M > median+1", () => {
    const flags = evaluateFwaPatterns(DEMO_UPCODING_REQUEST);
    expect(flags.map((f) => f.patternId)).toEqual(["pattern.upcoding"]);
    expect(flags[0].severity).toBe("medium");
  });

  it("fires impossible-day when total service minutes > 1440", () => {
    const flags = evaluateFwaPatterns(DEMO_IMPOSSIBLE_DAY_REQUEST);
    expect(flags.map((f) => f.patternId)).toEqual(["pattern.impossible-day-billing"]);
    expect(flags[0].severity).toBe("high");
  });

  it("fires phantom-service when no matching EHR encounter", () => {
    const flags = evaluateFwaPatterns(DEMO_PHANTOM_SERVICE_REQUEST);
    expect(flags.map((f) => f.patternId)).toEqual(["pattern.phantom-service"]);
  });

  it("fires multiple patterns and sorts by pattern-id ascending", () => {
    const flags = evaluateFwaPatterns(DEMO_MULTI_FLAG_REQUEST);
    // Repeated-unbundling history + duplicate submission + quantity outlier.
    // 20 units / 5 members = 4 units-per-member, > 3× peer median 1 → fires.
    const ids = flags.map((f) => f.patternId);
    expect(ids).toContain("pattern.unbundling");
    expect(ids).toContain("pattern.duplicate-billing");
    expect(ids).toContain("pattern.quantity-outlier");
    // Sorted ascending.
    expect(ids).toEqual([...ids].sort());
  });
});

describe("summarizeFwaScreening", () => {
  it("clear when no flags", () => {
    const s = summarizeFwaScreening([]);
    expect(s.decision).toBe("clear");
    expect(s.primaryPatternId).toBeNull();
    expect(s.routedTo).toBe("clear-no-action");
  });

  it("picks the highest-severity flag as primary; routes accordingly", () => {
    const flags = evaluateFwaPatterns(DEMO_MULTI_FLAG_REQUEST);
    const s = summarizeFwaScreening(flags);
    // Duplicate-billing is severity:high, wins over medium.
    expect(s.decision).toBe("flag-for-siu-review");
    expect(s.primaryPatternId).toBe("pattern.duplicate-billing");
    expect(s.primarySeverity).toBe("high");
    expect(s.routedTo).toBe("siu-priority-queue");
  });

  it("medium-only flags route to standard SIU queue", () => {
    const flags = evaluateFwaPatterns(DEMO_UPCODING_REQUEST);
    const s = summarizeFwaScreening(flags);
    expect(s.routedTo).toBe("siu-standard-queue");
  });
});

describe("screenClaim", () => {
  it("is deterministic — same request yields the same report", () => {
    expect(screenClaim(DEMO_CLEAR_REQUEST)).toEqual(screenClaim(DEMO_CLEAR_REQUEST));
  });

  it("produces a clear report on a clean claim, no SIU review needed", () => {
    const r = screenClaim(DEMO_CLEAR_REQUEST);
    expect(r.decision).toBe("clear");
    expect(r.requiresSiuReview).toBe(false);
    expect(r.investigationOpened).toBe(false);
    expect(r.paymentFrozen).toBe(false);
  });

  it("flags-for-SIU on high-severity patterns; investigation + freeze still false", () => {
    const r = screenClaim(DEMO_IMPOSSIBLE_DAY_REQUEST);
    expect(r.decision).toBe("flag-for-siu-review");
    expect(r.requiresSiuReview).toBe(true);
    // Load-bearing: the agent NEVER opens an investigation or freezes payment.
    expect(r.investigationOpened).toBe(false);
    expect(r.paymentFrozen).toBe(false);
  });
});

describe("governance signals", () => {
  const clear = screenClaim(DEMO_CLEAR_REQUEST);
  const flagged = screenClaim(DEMO_IMPOSSIBLE_DAY_REQUEST);

  it("patternsTraceToCatalog: true for produced flags, false for off-catalog", () => {
    expect(patternsTraceToCatalog(clear.flags)).toBe(true);
    expect(patternsTraceToCatalog(flagged.flags)).toBe(true);
    expect(patternsTraceToCatalog([{ patternId: "pattern.made-up" }])).toBe(false);
    expect(patternsTraceToCatalog(null)).toBe(false);
  });

  it("reportRequiresSiuReview: true for produced reports (both clear and flagged)", () => {
    expect(reportRequiresSiuReview(clear)).toBe(true);
    expect(reportRequiresSiuReview(flagged)).toBe(true);
    // Investigation opened → violation.
    expect(
      reportRequiresSiuReview({
        ...flagged,
        investigationOpened: true
      } as unknown as typeof flagged)
    ).toBe(false);
    // Payment frozen → violation.
    expect(
      reportRequiresSiuReview({
        ...flagged,
        paymentFrozen: true
      } as unknown as typeof flagged)
    ).toBe(false);
    // Flagged but requiresSiuReview:false → violation.
    expect(
      reportRequiresSiuReview({
        ...flagged,
        requiresSiuReview: false
      })
    ).toBe(false);
    // Clear but requiresSiuReview:true → violation.
    expect(
      reportRequiresSiuReview({
        ...clear,
        requiresSiuReview: true
      })
    ).toBe(false);
    expect(reportRequiresSiuReview(null)).toBe(false);
  });

  it("noProtectedClassFactors: true for the default factors, false when any protected attr is claimed", () => {
    expect(noProtectedClassFactors(DEFAULT_FWA_FACTORS)).toBe(true);
    expect(
      noProtectedClassFactors([...DEFAULT_FWA_FACTORS, "attr.race"])
    ).toBe(false);
    expect(
      noProtectedClassFactors([...DEFAULT_FWA_FACTORS, "attr.provider-ethnicity"])
    ).toBe(false);
    expect(
      noProtectedClassFactors([
        "attr.clinic-neighborhood-race-composition"
      ])
    ).toBe(false);
    expect(noProtectedClassFactors(null)).toBe(false);
  });
});
