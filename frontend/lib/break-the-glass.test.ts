import { describe, expect, it } from "vitest";
import {
  ACCESS_DURATIONS,
  BTG_REASON,
  DEMO_EMERGENCY_ACCESS_REQUEST,
  DEMO_NON_EMERGENCY_REQUEST,
  EMERGENCY_PHI_FIELDS,
  MAX_GRANT_DURATION_MINUTES,
  MINIMUM_NECESSARY_MAX_FIELDS,
  MINIMUM_NECESSARY_SCOPES,
  accessHasJustification,
  accessIsMinimumNecessaryTimeBoxed,
  accessLoggedForReview,
  addMinutesIso,
  emergencyAccessSummary,
  emergencyAuditEventId,
  evaluateEmergencyAccess,
  getPurposeSpec,
  isEmergencyPhiField,
  isEmergencyPurpose
} from "./break-the-glass";

/**
 * Tests for lib/break-the-glass.ts — the deterministic, transparent
 * emergency-access-governance core behind the Break-the-Glass / Emergency Access
 * Governance Agent. The decision is a pure function of the request + its own
 * atTime (no randomness, no clock), so the same request always yields the same
 * grant/deny + scope + expiry + audit id. These pin determinism, the
 * minimum-necessary scope catalog, the per-purpose time-box, the legit-deny vs
 * grant posture, and the three honest governance signals (justification-required
 * + minimum-necessary-time-boxed + mandatory-audit-review).
 */

describe("minimum-necessary scope catalog + durations", () => {
  it("exposes a non-empty catalog with stable ids, labels, scopes, durations", () => {
    expect(MINIMUM_NECESSARY_SCOPES.length).toBeGreaterThan(0);
    for (const p of MINIMUM_NECESSARY_SCOPES) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.scope.length).toBeGreaterThan(0);
      // Every catalog scope is minimum-necessary: recognized fields, never full-chart.
      expect(p.scope.length).toBeLessThanOrEqual(MINIMUM_NECESSARY_MAX_FIELDS);
      for (const f of p.scope) expect(isEmergencyPhiField(f)).toBe(true);
      expect(p.durationMinutes).toBeGreaterThan(0);
      expect(p.durationMinutes).toBeLessThanOrEqual(MAX_GRANT_DURATION_MINUTES);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it("no catalog scope is the full field set (minimum-necessary, not the full chart)", () => {
    for (const p of MINIMUM_NECESSARY_SCOPES) {
      expect(p.scope.length).toBeLessThan(EMERGENCY_PHI_FIELDS.length);
    }
  });

  it("ACCESS_DURATIONS derives from the catalog and never drifts", () => {
    for (const p of MINIMUM_NECESSARY_SCOPES) {
      expect(ACCESS_DURATIONS[p.id]).toBe(p.durationMinutes);
    }
  });

  it("isEmergencyPurpose / getPurposeSpec agree with the catalog", () => {
    for (const p of MINIMUM_NECESSARY_SCOPES) {
      expect(isEmergencyPurpose(p.id)).toBe(true);
      expect(getPurposeSpec(p.id)?.durationMinutes).toBe(p.durationMinutes);
    }
    expect(isEmergencyPurpose("standing-full-access")).toBe(false);
    expect(getPurposeSpec("standing-full-access")).toBeUndefined();
  });

  it("isEmergencyPhiField rejects a full-record token", () => {
    expect(isEmergencyPhiField("allergies")).toBe(true);
    expect(isEmergencyPhiField("full-chart")).toBe(false);
    expect(isEmergencyPhiField("*")).toBe(false);
  });
});

describe("addMinutesIso / emergencyAuditEventId · deterministic derivations", () => {
  it("derives an expiry from atTime + minutes (no clock)", () => {
    expect(addMinutesIso("2026-03-01T02:30:00Z", 60)).toBe("2026-03-01T03:30:00.000Z");
    expect(addMinutesIso("2026-03-01T02:30:00Z", 30)).toBe("2026-03-01T03:00:00.000Z");
  });

  it("derives a stable audit id from the request (deterministic)", () => {
    const id = emergencyAuditEventId(DEMO_EMERGENCY_ACCESS_REQUEST);
    expect(id).toBe(emergencyAuditEventId(DEMO_EMERGENCY_ACCESS_REQUEST));
    expect(id).toContain("btg-patient-001");
    expect(id).toContain("emergency-treatment");
  });
});

describe("evaluateEmergencyAccess · deterministic grant / deny", () => {
  it("is deterministic — the same request yields the same decision", () => {
    expect(evaluateEmergencyAccess(DEMO_EMERGENCY_ACCESS_REQUEST)).toEqual(
      evaluateEmergencyAccess(DEMO_EMERGENCY_ACCESS_REQUEST)
    );
  });

  it("grants a time-boxed, minimum-necessary, logged, review-flagged access on a valid emergency", () => {
    const d = evaluateEmergencyAccess(DEMO_EMERGENCY_ACCESS_REQUEST);
    expect(d.granted).toBe(true);
    expect(d.grantedScope).toEqual(["allergies", "medications", "problems", "vitals"]);
    expect(d.durationMinutes).toBe(60);
    expect(d.expiresAt).toBe("2026-03-01T03:30:00.000Z");
    expect(d.justificationRecorded).toBe(true);
    expect(d.auditEventId.length).toBeGreaterThan(0);
    expect(d.requiresPostAccessReview).toBe(true);
    expect(d.reason).toBe(BTG_REASON.granted);
    expect(d.synthetic).toBe(true);
    // The grant is never the full chart.
    expect(d.grantedScope.length).toBeLessThan(EMERGENCY_PHI_FIELDS.length);
  });

  it("DENIES (safe, not a block) when no emergency is declared — every attempt still logged", () => {
    const d = evaluateEmergencyAccess(DEMO_NON_EMERGENCY_REQUEST);
    expect(d.granted).toBe(false);
    expect(d.grantedScope).toEqual([]);
    expect(d.expiresAt).toBeUndefined();
    expect(d.requiresPostAccessReview).toBe(false);
    expect(d.reason).toBe(BTG_REASON.notEmergency);
    // Even a denied attempt emits a mandatory audit event.
    expect(d.auditEventId.length).toBeGreaterThan(0);
  });

  it("DENIES when no justification is recorded", () => {
    const d = evaluateEmergencyAccess({
      ...DEMO_EMERGENCY_ACCESS_REQUEST,
      justification: "   "
    });
    expect(d.granted).toBe(false);
    expect(d.justificationRecorded).toBe(false);
    expect(d.reason).toBe(BTG_REASON.noJustification);
  });

  it("DENIES an off-catalog purpose (no derivable minimum-necessary scope)", () => {
    const d = evaluateEmergencyAccess({
      ...DEMO_EMERGENCY_ACCESS_REQUEST,
      purpose: "standing-full-access"
    });
    expect(d.granted).toBe(false);
    expect(d.reason).toBe(BTG_REASON.offCatalogPurpose);
  });

  it("every produced decision (grant OR deny) satisfies all three honest signals", () => {
    for (const req of [DEMO_EMERGENCY_ACCESS_REQUEST, DEMO_NON_EMERGENCY_REQUEST]) {
      const d = evaluateEmergencyAccess(req);
      expect(accessHasJustification(d)).toBe(true);
      expect(accessIsMinimumNecessaryTimeBoxed(d)).toBe(true);
      expect(accessLoggedForReview(d)).toBe(true);
    }
  });
});

describe("accessHasJustification · justification-required signal", () => {
  it("is true for anything evaluateEmergencyAccess produces", () => {
    expect(accessHasJustification(evaluateEmergencyAccess(DEMO_EMERGENCY_ACCESS_REQUEST))).toBe(
      true
    );
  });

  it("is false for a granted access with no recorded justification", () => {
    expect(accessHasJustification({ granted: true, justificationRecorded: false })).toBe(false);
    // A deny with no justification trivially passes (nothing granted).
    expect(accessHasJustification({ granted: false, justificationRecorded: false })).toBe(true);
    expect(accessHasJustification(null)).toBe(false);
  });
});

describe("accessIsMinimumNecessaryTimeBoxed · minimum-necessary + time-boxed signal", () => {
  it("is true for anything evaluateEmergencyAccess produces", () => {
    expect(
      accessIsMinimumNecessaryTimeBoxed(evaluateEmergencyAccess(DEMO_EMERGENCY_ACCESS_REQUEST))
    ).toBe(true);
  });

  it("is false for a standing / full-record / non-expiring grant", () => {
    // A full-record scope token is not a recognized minimum-necessary field.
    expect(
      accessIsMinimumNecessaryTimeBoxed({
        granted: true,
        grantedScope: ["full-chart"],
        expiresAt: "2026-03-01T03:30:00.000Z",
        durationMinutes: 60
      })
    ).toBe(false);
    // A non-expiring grant is a standing grant.
    expect(
      accessIsMinimumNecessaryTimeBoxed({
        granted: true,
        grantedScope: ["allergies", "medications"],
        expiresAt: undefined,
        durationMinutes: undefined
      })
    ).toBe(false);
    // An over-broad scope (every field) exceeds the minimum-necessary cap.
    expect(
      accessIsMinimumNecessaryTimeBoxed({
        granted: true,
        grantedScope: [...EMERGENCY_PHI_FIELDS],
        expiresAt: "2026-03-01T03:30:00.000Z",
        durationMinutes: 60
      })
    ).toBe(false);
    // A duration beyond the maximum is not properly time-boxed.
    expect(
      accessIsMinimumNecessaryTimeBoxed({
        granted: true,
        grantedScope: ["allergies", "medications"],
        expiresAt: "2026-03-02T02:30:00.000Z",
        durationMinutes: MAX_GRANT_DURATION_MINUTES + 60
      })
    ).toBe(false);
    // A deny trivially passes, and a non-object is a violation.
    expect(accessIsMinimumNecessaryTimeBoxed({ granted: false, grantedScope: [] })).toBe(true);
    expect(accessIsMinimumNecessaryTimeBoxed(null)).toBe(false);
  });
});

describe("accessLoggedForReview · mandatory-audit + post-access-review signal", () => {
  it("is true for anything evaluateEmergencyAccess produces", () => {
    expect(accessLoggedForReview(evaluateEmergencyAccess(DEMO_EMERGENCY_ACCESS_REQUEST))).toBe(
      true
    );
  });

  it("is false for a granted access with no audit event or no post-access review", () => {
    expect(
      accessLoggedForReview({
        granted: true,
        auditEventId: "",
        requiresPostAccessReview: true
      })
    ).toBe(false);
    expect(
      accessLoggedForReview({
        granted: true,
        auditEventId: "btg-audit-x",
        requiresPostAccessReview: false
      })
    ).toBe(false);
    expect(
      accessLoggedForReview({
        granted: true,
        auditEventId: "btg-audit-x",
        requiresPostAccessReview: true
      })
    ).toBe(true);
    expect(accessLoggedForReview(null)).toBe(false);
  });
});

describe("emergencyAccessSummary · trace-safe summary", () => {
  it("summarizes the decision with refs, scope size, and the flags only", () => {
    const d = evaluateEmergencyAccess(DEMO_EMERGENCY_ACCESS_REQUEST);
    const summary = emergencyAccessSummary(d);
    expect(summary.patientRef).toBe("btg-patient-001");
    expect(summary.requesterRole).toBe("emergency-physician");
    expect(summary.purpose).toBe("emergency-treatment");
    expect(summary.granted).toBe(true);
    expect(summary.grantedFieldCount).toBe(4);
    expect(summary.durationMinutes).toBe(60);
    expect(summary.requiresPostAccessReview).toBe(true);
    expect(summary.synthetic).toBe(true);
  });
});
