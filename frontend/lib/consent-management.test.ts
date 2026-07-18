import { describe, expect, it } from "vitest";
import {
  CONSENT_REASON,
  CONSENT_SCOPES,
  COMMS_CHANNELS,
  DEMO_CONSENT_LEDGER,
  consentTracesToRecord,
  evaluateConsent,
  getConsentScope,
  honorsRevocation,
  hourOf,
  isCommsChannel,
  isConsentScope,
  isConsentStatus,
  isExpired,
  isWithinQuietHours,
  resolveConsent,
  respectsConsentScope,
  type ConsentDecision,
  type ConsentEvent
} from "./consent-management";

/**
 * Tests for lib/consent-management.ts — the deterministic, authoritative consent
 * ledger + decision function behind the Consent & Preferences Management Agent.
 * The decision is a pure function of the ledger + the query's own atTime and
 * priorTouches (no randomness, no clock), so the same inputs always yield the
 * same decision. These pin determinism, the fixed order of consent-state /
 * channel / timing / frequency gates, and the three honest governance signals
 * (recorded-source + honor-revocation + no-scope-override).
 */

describe("consent-scope + status + channel catalogs", () => {
  it("exposes a non-empty scope catalog with stable ids, labels, descriptions", () => {
    expect(CONSENT_SCOPES.length).toBeGreaterThan(0);
    for (const s of CONSENT_SCOPES) {
      expect(s.id.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("covers the five consent scopes", () => {
    const ids = CONSENT_SCOPES.map((s) => s.id);
    expect(ids).toContain("contact-outreach");
    expect(ids).toContain("data-sharing");
    expect(ids).toContain("remote-monitoring");
    expect(ids).toContain("research");
    expect(ids).toContain("marketing");
  });

  it("isConsentScope / getConsentScope agree with the catalog", () => {
    for (const s of CONSENT_SCOPES) {
      expect(isConsentScope(s.id)).toBe(true);
      expect(getConsentScope(s.id)?.label).toBe(s.label);
    }
    expect(isConsentScope("scope.totally-made-up")).toBe(false);
    expect(getConsentScope("scope.totally-made-up")).toBeUndefined();
  });

  it("recognizes statuses + channels and rejects unknowns", () => {
    for (const st of ["granted", "withheld", "revoked"]) {
      expect(isConsentStatus(st)).toBe(true);
    }
    expect(isConsentStatus("maybe")).toBe(false);
    for (const ch of COMMS_CHANNELS) expect(isCommsChannel(ch)).toBe(true);
    expect(isCommsChannel("fax")).toBe(false);
  });
});

describe("time helpers · deterministic (no clock)", () => {
  it("hourOf reads the UTC hour from an ISO timestamp", () => {
    expect(hourOf("2026-01-05T09:00:00Z")).toBe(9);
    expect(hourOf("2026-01-05T23:30:00Z")).toBe(23);
  });

  it("isWithinQuietHours handles same-day and overnight windows", () => {
    // Overnight 21→7: quiet at 22 and 3, awake at 12.
    expect(isWithinQuietHours(22, { start: 21, end: 7 })).toBe(true);
    expect(isWithinQuietHours(3, { start: 21, end: 7 })).toBe(true);
    expect(isWithinQuietHours(12, { start: 21, end: 7 })).toBe(false);
    // Same-day 9→17: quiet at 12, awake at 20.
    expect(isWithinQuietHours(12, { start: 9, end: 17 })).toBe(true);
    expect(isWithinQuietHours(20, { start: 9, end: 17 })).toBe(false);
    // Degenerate window → never quiet.
    expect(isWithinQuietHours(5, { start: 8, end: 8 })).toBe(false);
  });

  it("isExpired compares the expiry against atTime", () => {
    const ev: ConsentEvent = {
      id: "e",
      scope: "data-sharing",
      status: "granted",
      at: "2026-01-05T09:00:00Z",
      source: "portal",
      expiresAt: "2026-07-05T09:00:00Z"
    };
    expect(isExpired(ev, "2026-06-01T09:00:00Z")).toBe(false);
    expect(isExpired(ev, "2026-08-01T09:00:00Z")).toBe(true);
    expect(isExpired({ ...ev, expiresAt: undefined }, "2030-01-01T00:00:00Z")).toBe(false);
  });
});

describe("resolveConsent · latest-record-wins", () => {
  it("picks the most-recently-recorded event for a scope", () => {
    const ev = resolveConsent(DEMO_CONSENT_LEDGER, "marketing");
    expect(ev?.id).toBe("consent-evt-marketing-001");
    expect(ev?.status).toBe("revoked");
  });

  it("returns undefined for a scope with no recorded event", () => {
    expect(
      resolveConsent({ events: [] }, "contact-outreach")
    ).toBeUndefined();
  });

  it("prefers the newer of two events for the same scope (deterministic)", () => {
    const events: ConsentEvent[] = [
      { id: "old", scope: "contact-outreach", status: "granted", at: "2026-01-01T00:00:00Z", source: "portal" },
      { id: "new", scope: "contact-outreach", status: "revoked", at: "2026-03-01T00:00:00Z", source: "portal" }
    ];
    expect(resolveConsent({ events }, "contact-outreach")?.id).toBe("new");
  });
});

describe("evaluateConsent · deterministic decision", () => {
  it("is deterministic — the same inputs yield the same decision", () => {
    const q = { scope: "contact-outreach", channel: "sms", atTime: "2026-03-01T15:00:00Z" } as const;
    expect(evaluateConsent(DEMO_CONSENT_LEDGER, q)).toEqual(
      evaluateConsent(DEMO_CONSENT_LEDGER, q)
    );
  });

  it("ALLOWS a granted, current scope on a permitted channel outside quiet hours", () => {
    const d = evaluateConsent(DEMO_CONSENT_LEDGER, {
      scope: "contact-outreach",
      channel: "sms",
      atTime: "2026-03-01T15:00:00Z"
    });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe(CONSENT_REASON.allowed);
    expect(d.matchedConsentEventId).toBe("consent-evt-contact-001");
    expect(d.effectiveStatus).toBe("granted");
  });

  it("DENIES a withheld scope (no scope override)", () => {
    const d = evaluateConsent(DEMO_CONSENT_LEDGER, {
      scope: "research",
      atTime: "2026-03-01T15:00:00Z"
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe(CONSENT_REASON.withheld);
    expect(d.effectiveStatus).toBe("withheld");
    expect(d.matchedConsentEventId).toBe("consent-evt-research-001");
  });

  it("DENIES a revoked scope (honor revocation)", () => {
    const d = evaluateConsent(DEMO_CONSENT_LEDGER, {
      scope: "marketing",
      channel: "email",
      atTime: "2026-03-01T15:00:00Z"
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe(CONSENT_REASON.revoked);
    expect(d.effectiveStatus).toBe("revoked");
  });

  it("DENIES an expired grant and ALLOWS the same grant before expiry", () => {
    const before = evaluateConsent(DEMO_CONSENT_LEDGER, {
      scope: "data-sharing",
      atTime: "2026-06-01T09:00:00Z"
    });
    expect(before.allowed).toBe(true);
    const after = evaluateConsent(DEMO_CONSENT_LEDGER, {
      scope: "data-sharing",
      atTime: "2026-08-01T09:00:00Z"
    });
    expect(after.allowed).toBe(false);
    expect(after.reason).toBe(CONSENT_REASON.expired);
    expect(after.expired).toBe(true);
  });

  it("DENIES an unpermitted channel, then quiet hours, then a frequency cap", () => {
    const voice = evaluateConsent(DEMO_CONSENT_LEDGER, {
      scope: "contact-outreach",
      channel: "voice",
      atTime: "2026-03-01T15:00:00Z"
    });
    expect(voice.reason).toBe(CONSENT_REASON.channelNotAllowed);

    const quiet = evaluateConsent(DEMO_CONSENT_LEDGER, {
      scope: "contact-outreach",
      channel: "sms",
      atTime: "2026-03-01T23:00:00Z"
    });
    expect(quiet.reason).toBe(CONSENT_REASON.quietHours);

    const capped = evaluateConsent(DEMO_CONSENT_LEDGER, {
      scope: "contact-outreach",
      channel: "sms",
      atTime: "2026-03-01T15:00:00Z",
      priorTouches: 3
    });
    expect(capped.allowed).toBe(false);
    expect(capped.reason).toBe(CONSENT_REASON.frequencyCap);
  });

  it("DENIES an unrecorded scope with no matched record", () => {
    const d = evaluateConsent({ events: [], preferences: DEMO_CONSENT_LEDGER.preferences }, {
      scope: "contact-outreach",
      channel: "sms",
      atTime: "2026-03-01T15:00:00Z"
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe(CONSENT_REASON.noRecord);
    expect(d.effectiveStatus).toBe("none");
    expect(d.matchedConsentEventId).toBeUndefined();
  });
});

describe("consentTracesToRecord · recorded-source signal", () => {
  it("is true for the demo ledger's events", () => {
    expect(consentTracesToRecord(DEMO_CONSENT_LEDGER.events)).toBe(true);
  });

  it("is false for an asserted consent with no recorded source", () => {
    expect(
      consentTracesToRecord([
        { scope: "contact-outreach", status: "granted", at: "2026-01-01T00:00:00Z", source: "" }
      ])
    ).toBe(false);
  });

  it("is false for an off-catalog scope or unrecognized status, and for non-array input", () => {
    expect(
      consentTracesToRecord([
        { scope: "scope.made-up" as never, status: "granted", at: "2026-01-01T00:00:00Z", source: "portal" }
      ])
    ).toBe(false);
    expect(
      consentTracesToRecord([
        { scope: "marketing", status: "maybe" as never, at: "2026-01-01T00:00:00Z", source: "portal" }
      ])
    ).toBe(false);
    expect(consentTracesToRecord(null)).toBe(false);
    expect(consentTracesToRecord(undefined)).toBe(false);
  });
});

describe("honorsRevocation · honor-revocation signal", () => {
  it("is true for anything evaluateConsent produces (it denies on revoked/expired)", () => {
    const revoked = evaluateConsent(DEMO_CONSENT_LEDGER, {
      scope: "marketing",
      channel: "email",
      atTime: "2026-03-01T15:00:00Z"
    });
    expect(honorsRevocation([revoked])).toBe(true);
  });

  it("is false for a decision that ALLOWS against a revoked or expired scope", () => {
    const allowRevoked: ConsentDecision = {
      scope: "marketing",
      channel: "email",
      allowed: true,
      reason: "override",
      matchedConsentEventId: "consent-evt-marketing-001",
      effectiveStatus: "revoked",
      expired: false
    };
    expect(honorsRevocation([allowRevoked])).toBe(false);
    expect(
      honorsRevocation([{ ...allowRevoked, effectiveStatus: "granted", expired: true }])
    ).toBe(false);
    expect(honorsRevocation(null)).toBe(false);
  });
});

describe("respectsConsentScope · no-scope-override signal", () => {
  it("is true for anything evaluateConsent produces (an allow requires granted)", () => {
    const allowed = evaluateConsent(DEMO_CONSENT_LEDGER, {
      scope: "contact-outreach",
      channel: "sms",
      atTime: "2026-03-01T15:00:00Z"
    });
    expect(respectsConsentScope([allowed])).toBe(true);
  });

  it("is false for a decision that ALLOWS against a withheld or ungranted scope", () => {
    const overrideWithheld: ConsentDecision = {
      scope: "research",
      allowed: true,
      reason: "override",
      matchedConsentEventId: "consent-evt-research-001",
      effectiveStatus: "withheld",
      expired: false
    };
    expect(respectsConsentScope([overrideWithheld])).toBe(false);
    expect(
      respectsConsentScope([{ ...overrideWithheld, effectiveStatus: "none", matchedConsentEventId: undefined }])
    ).toBe(false);
    expect(respectsConsentScope(null)).toBe(false);
  });
});
