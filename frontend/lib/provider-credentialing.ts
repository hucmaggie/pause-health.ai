/**
 * Provider Credentialing & Directory — deterministic verification of a
 * provider's credentialing status + a No-Surprises-Act-aware directory
 * lookup + a referral / scheduling gate at the network boundary.
 *
 * Deterministic, dependency-free domain core the Provider Credentialing &
 * Directory Agent (app/api/agents/provider-credentialing) wraps — the
 * Salesforce "Agentforce for Health" / Health Cloud provider-credentialing /
 * provider-directory analog on Pause's Agent Fabric. It is a NETWORK-
 * INTEGRITY agent that sits ALONGSIDE the data substrate: every referral
 * (Referral Management agent), every scheduled follow-up (Appointment
 * Scheduling agent), and every transition-of-care handoff (TOC agent) can
 * ask this agent "is this provider actually credentialed and directory-
 * accurate right now?" and get a deterministic, catalog-sourced yes/no with
 * the specific policy violation on a no.
 *
 *   Inbound:  ProviderVerificationRequest (a synthetic providerRef — clearly
 *             labeled illustrative — an asOfDate accepted as data, and an
 *             optional intent flag distinguishing a directory-lookup from a
 *             referral or scheduling attempt so the gate can enforce the
 *             referral/scheduling-specific blocks)
 *   Outbound: ProviderCredentialingRecord { providerRef, credentials[],
 *             directoryProfile, status: verified/incomplete/expired/
 *             sanctioned, gates: { canReferPatient, canBookAppointment,
 *             canReturnInDirectoryResponse }, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: credentials trace to a defined source.
 * ─────────────────────────────────────────────────────────────────────
 *  Every credential (state license, DEA, board cert, sanctions clearance,
 *  NPI) on a provider's record must cite one of the APPROVED_VERIFICATION_
 *  SOURCES with a verifiedOn date — an unverified / self-reported /
 *  undocumented source fails source-integrity. Fabricating a "verified"
 *  status is a load-bearing safety failure this guard closes.
 *  credentialsTraceToVerifiedSource() reports the honest signal the Agent
 *  Fabric enforces via policy.credentialing.source-integrity.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no referral to an expired / sanctioned provider.
 * ─────────────────────────────────────────────────────────────────────
 *  The fabric may NEVER hand a referral or a scheduled appointment to a
 *  provider whose credentialing status is EXPIRED, INCOMPLETE, or
 *  SANCTIONED. verifyProvider() computes the status as a pure function of
 *  the credential records + asOfDate; noReferralToExpiredOrSanctioned()
 *  turns that status into the honest signal the Agent Fabric enforces via
 *  policy.credentialing.no-referral-to-expired-or-sanctioned. This is where
 *  the "ghost network" problem gets fixed at the fabric level.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: No Surprises Act directory accuracy.
 * ─────────────────────────────────────────────────────────────────────
 *  A directory-lookup response returned as AUTHORITATIVE must have its
 *  verifiedAsOf date within the No-Surprises-Act 90-day accuracy window.
 *  Stale directory data returned as authoritative is a violation. When
 *  outside the window the agent returns a "stale" response gated to a
 *  directory-refresh workflow (the safe interim answer), not the same
 *  authoritative record. directoryIsFresh() reports the honest signal the
 *  Agent Fabric enforces via policy.credentialing.no-surprises-act-
 *  directory-accuracy.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified credentialing / directory system.
 * ─────────────────────────────────────────────────────────────────────
 *  The credential-kind catalog, verification-source list, directory-schema,
 *  90-day freshness window, and providerRefs below are ILLUSTRATIVE
 *  synthetic/demo values chosen to model the SHAPE of network-integrity
 *  enforcement — they are NOT NCQA / CAQH credentialing, a real state
 *  medical-board API, an OIG-LEIE sanction feed, or a live directory. The
 *  providerRefs and credential ids are synthetic / de-identified. There is
 *  NO randomness and NO clock anywhere here: verification is a pure
 *  function of the credential records + the caller-provided asOfDate
 *  (accepted as data), so the same context always yields the same status
 *  and gate outcomes — which is what lets the demo, the seeded trace, and
 *  the tests agree.
 */

/** The illustrative credential kinds a provider must have on file. */
export type CredentialKind =
  | "state-license"
  | "dea"
  | "board-certification"
  | "sanctions-clearance"
  | "npi";

/** The credential kinds in a stable, documented display order. */
export const CREDENTIAL_KINDS: CredentialKind[] = [
  "state-license",
  "dea",
  "board-certification",
  "sanctions-clearance",
  "npi"
];

/**
 * The (illustrative) approved verification sources. A credential must cite
 * one of these — a "self-reported" / "verbal" source fails source-integrity.
 */
export const APPROVED_VERIFICATION_SOURCES: string[] = [
  "state-medical-board",
  "dea-registry",
  "abms-board",
  "oig-leie-sanctions",
  "npi-registry"
];

const APPROVED_SOURCE_SET = new Set<string>(APPROVED_VERIFICATION_SOURCES);

/** Is `source` on the approved verification-source list? */
export function isApprovedVerificationSource(source: unknown): boolean {
  return typeof source === "string" && APPROVED_SOURCE_SET.has(source);
}

/**
 * The No-Surprises-Act-shaped directory-accuracy window. Under the No
 * Surprises Act, provider directories must be verified for accuracy at
 * least every 90 days (with removal of stale entries) — this is the SHAPE
 * of the rule; the number here is illustrative, not certified.
 */
export const NO_SURPRISES_ACT_MAX_STALE_DAYS = 90;

/** A single credential on a provider's record. */
export type ProviderCredential = {
  /** The credential kind. */
  kind: CredentialKind;
  /** Illustrative synthetic credential identifier (never a real registry id). */
  credentialId: string;
  /** The verification source (must be on APPROVED_VERIFICATION_SOURCES). */
  source: string;
  /** ISO verifiedOn date accepted as data (no clock). */
  verifiedOn: string;
  /** ISO expiresOn date accepted as data (no clock). */
  expiresOn: string;
  /**
   * When true, the credential has an active SANCTION (e.g. OIG-LEIE exclusion,
   * a state-board suspension). Only meaningful on sanctions-clearance /
   * state-license credentials; false or absent otherwise.
   */
  sanctioned?: boolean;
};

/** The (illustrative) directory-side profile a provider is listed with. */
export type DirectoryProfile = {
  displayName: string;
  specialty: string;
  languages: string[];
  city: string;
  state: string;
  takingNewPatients: boolean;
  phone: string;
  /** ISO date the directory record was last verified. */
  verifiedAsOf: string;
  /** Always true — the profile is a clearly-labeled illustrative synthetic. */
  synthetic: true;
};

/** The overall verification status. */
export type CredentialingStatus =
  | "verified"
  | "incomplete"
  | "expired"
  | "sanctioned";

/**
 * The gate flags the referral / scheduling / directory agents can read.
 * canReferPatient / canBookAppointment reflect no-expired-or-sanctioned;
 * canReturnInDirectoryResponse reflects NSA freshness.
 */
export type ProviderCredentialingGates = {
  canReferPatient: boolean;
  canBookAppointment: boolean;
  canReturnInDirectoryResponse: boolean;
};

/** The deterministic verification record the agent returns. */
export type ProviderCredentialingRecord = {
  /** The synthetic provider reference this record is about. */
  providerRef: string;
  /** The as-of date the verification was computed against. */
  asOfDate: string;
  /** The credentials on file (with per-credential status flags). */
  credentials: Array<
    ProviderCredential & {
      /** Expired when asOfDate > expiresOn (illustrative). */
      isExpired: boolean;
      /** Days remaining until expiry (negative when past). */
      daysUntilExpiry: number;
      /** True when source is on APPROVED_VERIFICATION_SOURCES. */
      sourceIsApproved: boolean;
    }
  >;
  /** The directory-side profile (with a freshness flag). */
  directoryProfile: DirectoryProfile & {
    /** Days since the profile was last verified. */
    daysSinceVerified: number;
    /** True when daysSinceVerified <= NSA window. */
    isFresh: boolean;
  };
  /** Overall status computed deterministically from the credentials. */
  status: CredentialingStatus;
  /** Whether the sanctions-clearance credential shows an active sanction. */
  sanctioned: boolean;
  /** The referral / scheduling / directory gate flags. */
  gates: ProviderCredentialingGates;
  /** Always true — the catalog + refs are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** The intent under which the verification is requested. */
export type VerificationIntent =
  | "directory-lookup"
  | "referral"
  | "scheduling";

/**
 * The structured request the verifier reads. `providerRef` is a synthetic,
 * de-identified id — clearly labeled illustrative. `asOfDate` is accepted
 * as data (no clock).
 */
export type ProviderVerificationRequest = {
  providerRef: string;
  asOfDate: string;
  intent?: VerificationIntent;
  /** The credential records on file (each must trace to an approved source). */
  credentials?: ProviderCredential[];
  /** The directory-side profile the caller has on file. */
  directoryProfile?: DirectoryProfile;
};

/** Deterministic days between two ISO dates (later - earlier), or Infinity. */
function daysBetween(later: string, earlier: string): number {
  const a = Date.parse(later);
  const e = Date.parse(earlier);
  if (Number.isNaN(a) || Number.isNaN(e)) return Number.POSITIVE_INFINITY;
  return Math.floor((a - e) / (1000 * 60 * 60 * 24));
}

/** Days until an expiry date from an as-of date (negative → past). */
function daysUntil(expiresOn: string, asOfDate: string): number {
  const t = Date.parse(expiresOn);
  const a = Date.parse(asOfDate);
  if (Number.isNaN(t) || Number.isNaN(a)) return Number.NEGATIVE_INFINITY;
  return Math.floor((t - a) / (1000 * 60 * 60 * 24));
}

/**
 * Compute a provider's credentialing status deterministically. Rules:
 *   1. sanctioned → "sanctioned" (highest priority — a sanctioned provider
 *      NEVER slips through, regardless of other credential state).
 *   2. any missing kind (state-license / dea / board-cert / sanctions /
 *      npi) → "incomplete".
 *   3. any credential expired (asOfDate > expiresOn) → "expired".
 *   4. otherwise → "verified".
 * Source-integrity is a SEPARATE guard (a credential with an unapproved
 * source doesn't count toward completeness or freshness — it's surfaced
 * via credentialsTraceToVerifiedSource).
 */
function computeStatus(
  credentials: ProviderCredential[],
  asOfDate: string
): { status: CredentialingStatus; sanctioned: boolean } {
  const sanctioned = credentials.some((c) => c.sanctioned === true);
  if (sanctioned) return { status: "sanctioned", sanctioned: true };
  const legit = credentials.filter((c) => isApprovedVerificationSource(c.source));
  const kinds = new Set(legit.map((c) => c.kind));
  if (!CREDENTIAL_KINDS.every((k) => kinds.has(k))) {
    return { status: "incomplete", sanctioned: false };
  }
  const anyExpired = legit.some(
    (c) => Date.parse(c.expiresOn) < Date.parse(asOfDate)
  );
  if (anyExpired) return { status: "expired", sanctioned: false };
  return { status: "verified", sanctioned: false };
}

/**
 * Verify a provider deterministically. A pure function of the credentials +
 * directory profile + asOfDate — no clock, no randomness. Computes status,
 * sanctioned, per-credential expiry, directory freshness, and the gate
 * flags the referral / scheduling / directory agents read.
 */
export function verifyProvider(
  req: ProviderVerificationRequest
): ProviderCredentialingRecord {
  const credentials = req.credentials ?? [];
  const directory = req.directoryProfile ?? DEMO_DIRECTORY_UNSET;

  const enrichedCredentials = credentials.map((c) => ({
    ...c,
    isExpired: Date.parse(c.expiresOn) < Date.parse(req.asOfDate),
    daysUntilExpiry: daysUntil(c.expiresOn, req.asOfDate),
    sourceIsApproved: isApprovedVerificationSource(c.source)
  }));

  const { status, sanctioned } = computeStatus(credentials, req.asOfDate);
  const daysSinceVerified = daysBetween(req.asOfDate, directory.verifiedAsOf);
  const isFresh = daysSinceVerified <= NO_SURPRISES_ACT_MAX_STALE_DAYS;

  const canReferOrBook = status === "verified";
  const gates: ProviderCredentialingGates = {
    canReferPatient: canReferOrBook,
    canBookAppointment: canReferOrBook,
    canReturnInDirectoryResponse: canReferOrBook && isFresh
  };

  const note =
    `Verified provider ${req.providerRef} as of ${req.asOfDate}: status ${status}${
      sanctioned ? " (SANCTIONED)" : ""
    }; directory record ${isFresh ? "fresh" : "stale"} (${daysSinceVerified}d since verifiedAsOf, NSA window ${NO_SURPRISES_ACT_MAX_STALE_DAYS}d). ` +
    "Every credential must trace to an approved verification source (state-medical-board, DEA-registry, ABMS-board, OIG-LEIE-sanctions, NPI-registry); the fabric never hands a referral or scheduled appointment to an expired / incomplete / sanctioned provider; and a directory-lookup response outside the NSA freshness window is not returned as authoritative. Synthetic/illustrative catalog + refs — not a certified credentialing or directory system.";

  return {
    providerRef: req.providerRef,
    asOfDate: req.asOfDate,
    credentials: enrichedCredentials,
    directoryProfile: {
      ...directory,
      daysSinceVerified,
      isFresh
    },
    status,
    sanctioned,
    gates,
    synthetic: true,
    note
  };
}

/**
 * Source-integrity check: does EVERY credential on the record cite an
 * approved verification source with a verifiedOn date? True when every
 * entry meets both; the guard that catches a caller-asserted verbal /
 * self-reported / undocumented source or a missing verifiedOn. This is the
 * honest signal the route reports to policy.credentialing.source-integrity.
 * A non-array input is a violation.
 */
export function credentialsTraceToVerifiedSource(
  credentials:
    | Array<{ source?: string; verifiedOn?: string }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(credentials)) return false;
  return credentials.every(
    (c) =>
      isApprovedVerificationSource(c.source) &&
      typeof c.verifiedOn === "string" &&
      c.verifiedOn.length > 0
  );
}

/**
 * No-referral / no-scheduling check: does the record's status permit a
 * referral or a scheduled booking? True when status is "verified" (which
 * requires complete + unexpired + unsanctioned credentials). The guard
 * that catches a caller-asserted plan to refer to an expired / incomplete
 * / sanctioned provider. This is the honest signal the route reports to
 * policy.credentialing.no-referral-to-expired-or-sanctioned. A non-object
 * input is a violation.
 */
export function noReferralToExpiredOrSanctioned(
  record: { status?: string; sanctioned?: boolean } | null | undefined
): boolean {
  if (!record || typeof record !== "object") return false;
  if (record.sanctioned === true) return false;
  return record.status === "verified";
}

/**
 * No-Surprises-Act freshness check: is the directory record's verifiedAsOf
 * within the NSA freshness window from asOfDate? True when
 * daysSinceVerified <= NO_SURPRISES_ACT_MAX_STALE_DAYS. The guard that
 * catches a caller-asserted stale directory record returned as
 * authoritative. This is the honest signal the route reports to
 * policy.credentialing.no-surprises-act-directory-accuracy. A non-object
 * input is a violation.
 */
export function directoryIsFresh(
  input: { verifiedAsOf?: string; asOfDate?: string } | null | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  if (typeof input.verifiedAsOf !== "string" || typeof input.asOfDate !== "string") {
    return false;
  }
  const days = daysBetween(input.asOfDate, input.verifiedAsOf);
  return days >= 0 && days <= NO_SURPRISES_ACT_MAX_STALE_DAYS;
}

/** A placeholder directory profile used when the caller doesn't provide one. */
const DEMO_DIRECTORY_UNSET: DirectoryProfile = {
  displayName: "(directory profile not on file)",
  specialty: "unknown",
  languages: [],
  city: "unknown",
  state: "unknown",
  takingNewPatients: false,
  phone: "unknown",
  verifiedAsOf: "1970-01-01",
  synthetic: true
};

/**
 * A representative, deterministic verified-provider demo. A menopause-focused
 * MSCP with every credential complete, unexpired, unsanctioned, and a fresh
 * directory profile — so the happy path (canRefer/canBook/canReturn all true)
 * is demonstrable. Synthetic / de-identified.
 */
export const DEMO_VERIFIED_PROVIDER: ProviderVerificationRequest = {
  providerRef: "provider-mscp-001",
  asOfDate: "2026-07-01",
  intent: "referral",
  credentials: [
    {
      kind: "state-license",
      credentialId: "IL-MD-000001",
      source: "state-medical-board",
      verifiedOn: "2026-04-01",
      expiresOn: "2027-04-01"
    },
    {
      kind: "dea",
      credentialId: "DEA-000001",
      source: "dea-registry",
      verifiedOn: "2026-04-01",
      expiresOn: "2027-04-01"
    },
    {
      kind: "board-certification",
      credentialId: "ABMS-000001",
      source: "abms-board",
      verifiedOn: "2026-04-01",
      expiresOn: "2028-04-01"
    },
    {
      kind: "sanctions-clearance",
      credentialId: "OIG-000001",
      source: "oig-leie-sanctions",
      verifiedOn: "2026-06-01",
      expiresOn: "2026-09-01",
      sanctioned: false
    },
    {
      kind: "npi",
      credentialId: "NPI-000001",
      source: "npi-registry",
      verifiedOn: "2026-04-01",
      expiresOn: "2099-12-31"
    }
  ],
  directoryProfile: {
    displayName: "Dr. J. Okafor · MSCP",
    specialty: "Menopause Society Certified Practitioner",
    languages: ["English", "Yoruba"],
    city: "Chicago",
    state: "IL",
    takingNewPatients: true,
    phone: "312-555-0100",
    verifiedAsOf: "2026-05-01",
    synthetic: true
  }
};

/**
 * A representative expired-credential demo (illustrative). Same provider
 * but the state license is 6 months past expiry — so the "expired"
 * status and canRefer:false / canBook:false gates are demonstrable.
 */
export const DEMO_EXPIRED_PROVIDER: ProviderVerificationRequest = {
  providerRef: "provider-mscp-002",
  asOfDate: "2026-07-01",
  intent: "referral",
  credentials: DEMO_VERIFIED_PROVIDER.credentials!.map((c) =>
    c.kind === "state-license"
      ? { ...c, expiresOn: "2025-12-31" }
      : { ...c }
  ),
  directoryProfile: DEMO_VERIFIED_PROVIDER.directoryProfile
};

/**
 * A representative sanctioned-provider demo (illustrative). All credentials
 * present + unexpired, but the sanctions-clearance flags an active sanction
 * — so the "sanctioned" status (highest priority, never a referral) is
 * demonstrable.
 */
export const DEMO_SANCTIONED_PROVIDER: ProviderVerificationRequest = {
  providerRef: "provider-mscp-003",
  asOfDate: "2026-07-01",
  intent: "referral",
  credentials: DEMO_VERIFIED_PROVIDER.credentials!.map((c) =>
    c.kind === "sanctions-clearance"
      ? { ...c, sanctioned: true }
      : { ...c }
  ),
  directoryProfile: DEMO_VERIFIED_PROVIDER.directoryProfile
};

/**
 * A representative stale-directory demo (illustrative). Fully verified
 * credentials + a directory record last verified 200 days ago (well past
 * the NSA 90-day window) — so canReturnInDirectoryResponse:false is
 * demonstrable (a "stale" directory response returned as authoritative
 * would be a violation).
 */
export const DEMO_STALE_DIRECTORY_PROVIDER: ProviderVerificationRequest = {
  providerRef: "provider-mscp-004",
  asOfDate: "2026-07-01",
  intent: "directory-lookup",
  credentials: DEMO_VERIFIED_PROVIDER.credentials,
  directoryProfile: {
    ...DEMO_VERIFIED_PROVIDER.directoryProfile!,
    verifiedAsOf: "2025-12-01"
  }
};
