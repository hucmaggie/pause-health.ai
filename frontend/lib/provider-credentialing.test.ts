import { describe, expect, it } from "vitest";
import {
  APPROVED_VERIFICATION_SOURCES,
  CREDENTIAL_KINDS,
  DEMO_EXPIRED_PROVIDER,
  DEMO_SANCTIONED_PROVIDER,
  DEMO_STALE_DIRECTORY_PROVIDER,
  DEMO_VERIFIED_PROVIDER,
  NO_SURPRISES_ACT_MAX_STALE_DAYS,
  credentialsTraceToVerifiedSource,
  directoryIsFresh,
  isApprovedVerificationSource,
  noReferralToExpiredOrSanctioned,
  verifyProvider
} from "./provider-credentialing";

/**
 * Tests for lib/provider-credentialing.ts — the deterministic provider-
 * credentialing / directory core behind the Provider Credentialing &
 * Directory Agent. Verification is a pure function of the credentials +
 * directory profile + asOfDate (no randomness, no clock), so the same
 * context always yields the same status + gates. These pin determinism,
 * catalog-sourced verification sources, sanctioned > incomplete > expired
 * > verified precedence, NSA freshness, and the three honest governance
 * signals.
 */

describe("catalogs", () => {
  it("exposes the credential kinds + approved verification sources + NSA window", () => {
    expect(CREDENTIAL_KINDS.length).toBeGreaterThan(0);
    for (const k of CREDENTIAL_KINDS) {
      expect(typeof k).toBe("string");
    }
    for (const s of APPROVED_VERIFICATION_SOURCES) {
      expect(isApprovedVerificationSource(s)).toBe(true);
    }
    expect(isApprovedVerificationSource("self-reported")).toBe(false);
    expect(isApprovedVerificationSource(42)).toBe(false);
    expect(NO_SURPRISES_ACT_MAX_STALE_DAYS).toBe(90);
  });
});

describe("verifyProvider", () => {
  it("is deterministic — same request always yields the same record", () => {
    expect(verifyProvider(DEMO_VERIFIED_PROVIDER)).toEqual(
      verifyProvider(DEMO_VERIFIED_PROVIDER)
    );
  });

  it("marks a fully-credentialed provider verified + all gates open", () => {
    const r = verifyProvider(DEMO_VERIFIED_PROVIDER);
    expect(r.status).toBe("verified");
    expect(r.sanctioned).toBe(false);
    expect(r.gates.canReferPatient).toBe(true);
    expect(r.gates.canBookAppointment).toBe(true);
    expect(r.gates.canReturnInDirectoryResponse).toBe(true);
    expect(r.directoryProfile.isFresh).toBe(true);
    for (const c of r.credentials) {
      expect(c.sourceIsApproved).toBe(true);
      expect(c.isExpired).toBe(false);
      expect(c.daysUntilExpiry).toBeGreaterThan(0);
    }
  });

  it("marks an expired state-license 'expired' and closes referral / booking gates", () => {
    const r = verifyProvider(DEMO_EXPIRED_PROVIDER);
    expect(r.status).toBe("expired");
    expect(r.gates.canReferPatient).toBe(false);
    expect(r.gates.canBookAppointment).toBe(false);
    expect(r.gates.canReturnInDirectoryResponse).toBe(false);
    const stateLicense = r.credentials.find((c) => c.kind === "state-license");
    expect(stateLicense?.isExpired).toBe(true);
  });

  it("marks a sanctioned provider 'sanctioned' (highest precedence — beats verified)", () => {
    const r = verifyProvider(DEMO_SANCTIONED_PROVIDER);
    expect(r.status).toBe("sanctioned");
    expect(r.sanctioned).toBe(true);
    expect(r.gates.canReferPatient).toBe(false);
    expect(r.gates.canBookAppointment).toBe(false);
    expect(r.gates.canReturnInDirectoryResponse).toBe(false);
  });

  it("marks a missing-credential provider 'incomplete'", () => {
    const r = verifyProvider({
      ...DEMO_VERIFIED_PROVIDER,
      credentials: DEMO_VERIFIED_PROVIDER.credentials!.filter(
        (c) => c.kind !== "dea"
      )
    });
    expect(r.status).toBe("incomplete");
    expect(r.gates.canReferPatient).toBe(false);
  });

  it("keeps verified status but closes the directory gate for a stale directory record", () => {
    const r = verifyProvider(DEMO_STALE_DIRECTORY_PROVIDER);
    expect(r.status).toBe("verified");
    expect(r.directoryProfile.isFresh).toBe(false);
    expect(r.directoryProfile.daysSinceVerified).toBeGreaterThan(
      NO_SURPRISES_ACT_MAX_STALE_DAYS
    );
    // Referral / booking gates remain open (the provider IS verified), but
    // the directory-response gate closes on NSA freshness.
    expect(r.gates.canReferPatient).toBe(true);
    expect(r.gates.canReturnInDirectoryResponse).toBe(false);
  });

  it("treats an off-source credential as not counting toward completeness", () => {
    // Replace the DEA cred with an unapproved 'self-reported' source — the
    // legit set no longer covers all kinds, so the status falls to
    // incomplete rather than verified.
    const r = verifyProvider({
      ...DEMO_VERIFIED_PROVIDER,
      credentials: DEMO_VERIFIED_PROVIDER.credentials!.map((c) =>
        c.kind === "dea" ? { ...c, source: "self-reported" } : c
      )
    });
    expect(r.status).toBe("incomplete");
  });
});

describe("governance signals", () => {
  const verified = verifyProvider(DEMO_VERIFIED_PROVIDER);
  const expired = verifyProvider(DEMO_EXPIRED_PROVIDER);
  const sanctioned = verifyProvider(DEMO_SANCTIONED_PROVIDER);
  const stale = verifyProvider(DEMO_STALE_DIRECTORY_PROVIDER);

  it("credentialsTraceToVerifiedSource: true for the produced credentials, false for verbal / off-source", () => {
    expect(credentialsTraceToVerifiedSource(verified.credentials)).toBe(true);
    expect(credentialsTraceToVerifiedSource([])).toBe(true);
    expect(
      credentialsTraceToVerifiedSource([
        {
          source: "self-reported",
          verifiedOn: "2026-04-01"
        }
      ])
    ).toBe(false);
    expect(
      credentialsTraceToVerifiedSource([
        {
          source: "state-medical-board"
          // missing verifiedOn
        }
      ])
    ).toBe(false);
    expect(credentialsTraceToVerifiedSource(null)).toBe(false);
  });

  it("noReferralToExpiredOrSanctioned: true for verified, false for expired / incomplete / sanctioned", () => {
    expect(
      noReferralToExpiredOrSanctioned({
        status: verified.status,
        sanctioned: verified.sanctioned
      })
    ).toBe(true);
    expect(
      noReferralToExpiredOrSanctioned({
        status: expired.status,
        sanctioned: expired.sanctioned
      })
    ).toBe(false);
    expect(
      noReferralToExpiredOrSanctioned({
        status: sanctioned.status,
        sanctioned: sanctioned.sanctioned
      })
    ).toBe(false);
    expect(
      noReferralToExpiredOrSanctioned({
        status: "incomplete",
        sanctioned: false
      })
    ).toBe(false);
    // Sanctioned overrides even a "verified" status claim.
    expect(
      noReferralToExpiredOrSanctioned({ status: "verified", sanctioned: true })
    ).toBe(false);
    expect(noReferralToExpiredOrSanctioned(null)).toBe(false);
  });

  it("directoryIsFresh: true within the NSA window, false when past it", () => {
    expect(
      directoryIsFresh({
        verifiedAsOf: DEMO_VERIFIED_PROVIDER.directoryProfile!.verifiedAsOf,
        asOfDate: DEMO_VERIFIED_PROVIDER.asOfDate
      })
    ).toBe(true);
    expect(
      directoryIsFresh({
        verifiedAsOf: DEMO_STALE_DIRECTORY_PROVIDER.directoryProfile!.verifiedAsOf,
        asOfDate: DEMO_STALE_DIRECTORY_PROVIDER.asOfDate
      })
    ).toBe(false);
    expect(directoryIsFresh(null)).toBe(false);
  });

  it("the produced record satisfies the signals for the verified demo", () => {
    expect(credentialsTraceToVerifiedSource(verified.credentials)).toBe(true);
    expect(
      noReferralToExpiredOrSanctioned({
        status: verified.status,
        sanctioned: verified.sanctioned
      })
    ).toBe(true);
    expect(
      directoryIsFresh({
        verifiedAsOf: verified.directoryProfile.verifiedAsOf,
        asOfDate: verified.asOfDate
      })
    ).toBe(true);
    // And the stale demo fails NSA freshness while still verified overall.
    expect(
      directoryIsFresh({
        verifiedAsOf: stale.directoryProfile.verifiedAsOf,
        asOfDate: stale.asOfDate
      })
    ).toBe(false);
  });
});
