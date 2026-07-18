/**
 * Consent & Preferences Management — the authoritative, cross-cutting consent &
 * communication-preferences service the rest of the fabric's consent gates defer
 * to, with a deterministic, transparent consent-decision function.
 *
 * Deterministic, dependency-free domain core the Consent & Preferences
 * Management Agent (app/api/agents/consent-management) wraps — the MuleSoft
 * control-plane / data-substrate analog on Pause's Agent Fabric. Unlike every
 * other agent (which CONSUMES consent — the SDOH, Patient Education, Remote
 * Monitoring, Care Gap, and Engagement agents each check a "consent-before-*"
 * gate), this one is the SOURCE OF TRUTH FOR consent: it holds, per patient, a
 * consent LEDGER (a set of consent scopes, each with a status + recorded basis +
 * optional expiry) and communication PREFERENCES (allowed channels, quiet hours,
 * preferred language, frequency cap), and answers one deterministic question:
 * "may this patient be contacted / have data used for this SCOPE over this
 * CHANNEL at this TIME?"
 *
 *   Inbound:  a ConsentLedger (per-patient consent events + comms preferences),
 *             plus a query { scope, channel?, atTime, priorTouches? }
 *   Outbound: a ConsentDecision { allowed, reason, matchedConsentEventId, ... }
 *             citing the consent record it relied on
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every consent state traces to a record.
 * ─────────────────────────────────────────────────────────────────────
 *  A consent state is only admissible if it traces to a recorded consent
 *  event/basis (a recognized scope + status, a timestamp, and a non-empty
 *  recorded source) — there is no asserted-but-unrecorded consent.
 *  consentTracesToRecord() reports the honest signal the Agent Fabric enforces
 *  via policy.consent.recorded-source.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: a revocation (or expiry) is honored at once.
 * ─────────────────────────────────────────────────────────────────────
 *  A revoked — or expired — consent must be honored immediately: a decision may
 *  NEVER ALLOW outreach/data-use against a scope whose relied-on consent is
 *  revoked or expired. honorsRevocation() reports the honest signal the Agent
 *  Fabric enforces via policy.consent.honor-revocation.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a decision never overrides a scope.
 * ─────────────────────────────────────────────────────────────────────
 *  A decision may NEVER ALLOW against a scope the patient withheld, or a scope
 *  the patient never granted (no record) — it may not override or borrow consent
 *  across scopes. respectsConsentScope() reports the honest signal the Agent
 *  Fabric enforces via policy.consent.no-scope-override.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified consent-management system.
 * ─────────────────────────────────────────────────────────────────────
 *  The consent scopes, the recorded sources/bases, the comms preferences, and
 *  the ledger fixtures below are ILLUSTRATIVE synthetic/demo values chosen to
 *  model the SHAPE of an authoritative consent ledger — they are NOT a certified
 *  consent-management / preference-center product (real systems reconcile HIPAA
 *  authorizations, TCPA/CAN-SPAM/CASL contact consent, GDPR bases, and a signed
 *  audit trail). There is NO randomness and NO clock anywhere here: the decision
 *  is a pure function of the ledger + the query's own `atTime` and priorTouches
 *  (the caller passes time as data), so the same inputs always yield the same
 *  decision — which is what lets the demo, the seeded trace, and the tests agree.
 */

/** A consent scope in the (illustrative) catalog. */
export type ConsentScope =
  | "contact-outreach"
  | "data-sharing"
  | "remote-monitoring"
  | "research"
  | "marketing";

/** The state a consent scope can be in. */
export type ConsentStatus = "granted" | "withheld" | "revoked";

/** A communication channel a patient can be reached on. */
export type CommsChannel = "sms" | "email" | "voice";

/** A single documented consent scope in the catalog. Illustrative — not certified. */
export type ConsentScopeSpec = {
  /** Stable catalog id every ConsentEvent references. */
  id: ConsentScope;
  /** Human-readable scope label. */
  label: string;
  /**
   * The (illustrative) description of what this scope governs. NOT a certified
   * legal basis — a demo-honest description.
   */
  description: string;
};

/**
 * The consent-scope catalog: the ONLY scopes a consent event may reference.
 * Illustrative/synthetic; NOT a certified consent taxonomy (see the header).
 */
export const CONSENT_SCOPES: ConsentScopeSpec[] = [
  {
    id: "contact-outreach",
    label: "Contact & outreach",
    description:
      "Permission to contact the patient with care-related outreach (reminders, check-ins, nudges). The scope the engagement / care-gap / medication-adherence agents' consent gates defer to. (Illustrative — not a certified consent basis.)"
  },
  {
    id: "data-sharing",
    label: "Data sharing",
    description:
      "Permission to share the patient's data with care partners / referral targets. The scope the referral / SDOH agents' consent gates defer to. (Illustrative — not a certified consent basis.)"
  },
  {
    id: "remote-monitoring",
    label: "Remote monitoring",
    description:
      "Permission to ingest longitudinal device/self-report readings and monitor trends. The scope the remote-patient-monitoring agent's consent-to-monitor gate defers to. (Illustrative — not a certified consent basis.)"
  },
  {
    id: "research",
    label: "Research participation",
    description:
      "Permission to use de-identified data for research. Withheld by default in the demo fixtures. (Illustrative — not a certified consent basis.)"
  },
  {
    id: "marketing",
    label: "Marketing communications",
    description:
      "Permission to send commercial / marketing communications. Distinct from care-related contact-outreach. (Illustrative — not a certified consent basis.)"
  }
];

const SCOPE_BY_ID = new Map(CONSENT_SCOPES.map((s) => [s.id, s]));

/** Is `id` a defined consent-scope catalog id? */
export function isConsentScope(id: unknown): id is ConsentScope {
  return typeof id === "string" && SCOPE_BY_ID.has(id as ConsentScope);
}

/** Look up a consent scope by id (undefined for an off-catalog id). */
export function getConsentScope(id: string): ConsentScopeSpec | undefined {
  return SCOPE_BY_ID.get(id as ConsentScope);
}

/** The recognized consent statuses. */
export const CONSENT_STATUSES: ConsentStatus[] = ["granted", "withheld", "revoked"];
const CONSENT_STATUS_SET = new Set<string>(CONSENT_STATUSES);

/** Is `status` a recognized consent status? */
export function isConsentStatus(status: unknown): status is ConsentStatus {
  return typeof status === "string" && CONSENT_STATUS_SET.has(status);
}

/** The recognized communication channels. */
export const COMMS_CHANNELS: CommsChannel[] = ["sms", "email", "voice"];
const COMMS_CHANNEL_SET = new Set<string>(COMMS_CHANNELS);

/** Is `channel` a recognized communication channel? */
export function isCommsChannel(channel: unknown): channel is CommsChannel {
  return typeof channel === "string" && COMMS_CHANNEL_SET.has(channel);
}

/**
 * A single recorded consent event — the authoritative basis for a scope's state.
 * Deterministic: the caller supplies an EXPLICIT timestamp `at` (ISO-8601), so
 * there is no clock dependency. `source` is the recorded basis the consent
 * traces to; a state without a recorded source is treated as unrecorded.
 */
export type ConsentEvent = {
  /** Stable event id a ConsentDecision cites as the record it relied on. */
  id: string;
  /** The consent-scope catalog id this event is about. */
  scope: ConsentScope;
  /** granted / withheld / revoked. */
  status: ConsentStatus;
  /** When the consent state was recorded (ISO-8601 date or datetime). */
  at: string;
  /** The recorded basis/source (e.g. "patient-portal", "signed-hipaa-authorization"). */
  source: string;
  /** Optional expiry (ISO-8601); a granted consent past its expiry is honored as expired. */
  expiresAt?: string;
};

/**
 * A patient's communication preferences. Quiet hours are UTC hours [0..24) taken
 * from the query's `atTime`; the frequency cap is compared against the caller-
 * supplied priorTouches (both taken as data — no clock).
 */
export type CommsPreferences = {
  /** The channels the patient permits (a channel not listed is denied). */
  allowedChannels: CommsChannel[];
  /**
   * Quiet-hours window in UTC hours [0..24). `start`..`end`; supports an
   * overnight window when start > end (e.g. 21→7 spans 9pm–7am). A touch whose
   * hour falls inside the window is denied.
   */
  quietHours: { start: number; end: number };
  /** BCP-47-ish preferred language tag (illustrative, e.g. "en", "es"). */
  preferredLanguage: string;
  /** Frequency cap: at most `maxPerWindow` touches per `windowDays`. */
  frequencyCap: { maxPerWindow: number; windowDays: number };
};

/**
 * A patient's consent ledger: the authoritative set of consent events plus the
 * communication preferences. `patientRef` is a synthetic, de-identified id.
 */
export type ConsentLedger = {
  /** Synthetic, de-identified patient reference (e.g. "consent-patient-001"). */
  patientRef: string;
  /** The recorded consent events (each the basis for a scope's state). */
  events: ConsentEvent[];
  /** The patient's communication preferences. */
  preferences: CommsPreferences;
  /** Always true — the scopes, sources, and preferences are illustrative synthetics. */
  synthetic: true;
};

/** The deterministic consent decision the agent returns. */
export type ConsentDecision = {
  /** The scope the decision is about. */
  scope: ConsentScope;
  /** The channel the decision is about (undefined for a data-use, non-comms decision). */
  channel?: CommsChannel;
  /** Whether the outreach / data-use is permitted. */
  allowed: boolean;
  /** Human-readable reason (cites the deciding factor). */
  reason: string;
  /** The consent event id the decision relied on (undefined when no record exists). */
  matchedConsentEventId?: string;
  /**
   * The effective consent status the decision relied on, or "none" when the
   * patient never recorded consent for the scope. Surfaced for auditability and
   * for the honesty guards (honorsRevocation / respectsConsentScope).
   */
  effectiveStatus: ConsentStatus | "none";
  /** True when the relied-on consent was granted but past its expiry at atTime. */
  expired: boolean;
};

/**
 * Resolve the effective consent event for a scope from the ledger: the
 * most-recently-recorded event for that scope (by `at`, ISO sorts lexically;
 * tie-break on event id for stability). Deterministic — a pure function of the
 * ledger. Returns undefined when the scope has no recorded event.
 */
export function resolveConsent(
  ledger: Pick<ConsentLedger, "events">,
  scope: ConsentScope
): ConsentEvent | undefined {
  const forScope = (ledger.events ?? []).filter((e) => e.scope === scope);
  if (forScope.length === 0) return undefined;
  return [...forScope].sort(
    (a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)
  )[0];
}

/** Is the granted consent past its expiry at `atTime`? (No expiry → never expired.) */
export function isExpired(event: ConsentEvent, atTime: string): boolean {
  if (!event.expiresAt) return false;
  return event.expiresAt.localeCompare(atTime) <= 0;
}

/** The UTC hour [0..23] of an ISO timestamp; deterministic (no local clock). */
export function hourOf(atTime: string): number {
  const d = new Date(atTime);
  const h = d.getUTCHours();
  return Number.isNaN(h) ? 0 : h;
}

/**
 * Does `hour` fall inside the quiet-hours window? Supports an overnight window
 * (start > end). A window with start === end is treated as "no quiet hours".
 */
export function isWithinQuietHours(
  hour: number,
  quietHours: { start: number; end: number }
): boolean {
  const { start, end } = quietHours;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  // Overnight window (e.g. 21→7): quiet when at/after start OR before end.
  return hour >= start || hour < end;
}

/** The query the consent decision function answers. */
export type ConsentQuery = {
  /** The consent scope being evaluated. */
  scope: ConsentScope;
  /** The channel the outreach would use (omit for a non-comms data-use decision). */
  channel?: CommsChannel;
  /** The explicit decision time (ISO-8601) — taken as data, not a clock read. */
  atTime: string;
  /** How many touches already happened in the current frequency window (data). */
  priorTouches?: number;
};

/** Stable reason phrases the decision cites (kept as constants for testability). */
export const CONSENT_REASON = {
  noRecord: "no recorded consent for this scope — the patient never granted it",
  withheld: "consent for this scope is withheld",
  revoked: "consent for this scope was revoked",
  expired: "consent for this scope has expired",
  channelNotAllowed: "the channel is not among the patient's permitted channels",
  quietHours: "the requested time falls within the patient's quiet hours",
  frequencyCap: "the patient's frequency cap for this window has been reached",
  allowed: "consent is granted, current, and the channel + timing are permitted"
} as const;

/**
 * The deterministic consent-decision function — the heart of the service.
 * DETERMINISTIC: a pure function of the ledger + the query's own `atTime` and
 * priorTouches (no randomness, no clock). Denies when the scope's consent is
 * withheld / revoked / expired / unrecorded, when the channel isn't permitted,
 * when the time is within quiet hours, or when the frequency cap is reached;
 * otherwise ALLOWS — always citing the consent record it relied on
 * (matchedConsentEventId). The order of checks is fixed and documented so the
 * reason is stable: consent state first (the load-bearing gate), then channel,
 * then timing, then frequency.
 */
export function evaluateConsent(
  ledger: Pick<ConsentLedger, "events" | "preferences">,
  query: ConsentQuery
): ConsentDecision {
  const event = resolveConsent(ledger, query.scope);

  // No recorded consent for the scope → deny (and no scope override elsewhere).
  if (!event) {
    return {
      scope: query.scope,
      channel: query.channel,
      allowed: false,
      reason: CONSENT_REASON.noRecord,
      matchedConsentEventId: undefined,
      effectiveStatus: "none",
      expired: false
    };
  }

  const expired = event.status === "granted" && isExpired(event, query.atTime);
  const base = {
    scope: query.scope,
    channel: query.channel,
    matchedConsentEventId: event.id,
    effectiveStatus: event.status,
    expired
  } as const;

  // Consent-state gates — a withheld / revoked / expired scope is honored.
  if (event.status === "withheld") {
    return { ...base, allowed: false, reason: CONSENT_REASON.withheld };
  }
  if (event.status === "revoked") {
    return { ...base, allowed: false, reason: CONSENT_REASON.revoked };
  }
  if (expired) {
    return { ...base, allowed: false, reason: CONSENT_REASON.expired };
  }

  // Comms-preference gates — only when a channel is being evaluated.
  const prefs = ledger.preferences;
  if (query.channel !== undefined) {
    if (!prefs.allowedChannels.includes(query.channel)) {
      return { ...base, allowed: false, reason: CONSENT_REASON.channelNotAllowed };
    }
    if (isWithinQuietHours(hourOf(query.atTime), prefs.quietHours)) {
      return { ...base, allowed: false, reason: CONSENT_REASON.quietHours };
    }
  }

  const priorTouches = typeof query.priorTouches === "number" ? query.priorTouches : 0;
  if (priorTouches >= prefs.frequencyCap.maxPerWindow) {
    return { ...base, allowed: false, reason: CONSENT_REASON.frequencyCap };
  }

  return { ...base, allowed: true, reason: CONSENT_REASON.allowed };
}

/**
 * Recorded-source integrity check: does EVERY consent event trace to a recorded
 * basis? True when every event references a defined scope + recognized status,
 * carries a timestamp, AND carries a non-empty recorded source; the guard that
 * catches a caller-asserted, unrecorded consent (an off-catalog scope, an
 * unrecognized status, a missing timestamp, or — the load-bearing case — an
 * asserted consent with no recorded source). This is the honest signal the route
 * reports to policy.consent.recorded-source. A non-array input is a violation.
 */
export function consentTracesToRecord(
  events:
    | Array<Pick<ConsentEvent, "scope" | "status" | "at" | "source">>
    | null
    | undefined
): boolean {
  if (!Array.isArray(events)) return false;
  return events.every(
    (e) =>
      isConsentScope(e.scope) &&
      isConsentStatus(e.status) &&
      typeof e.at === "string" &&
      e.at.length > 0 &&
      typeof e.source === "string" &&
      e.source.trim().length > 0
  );
}

/**
 * Honor-revocation check: does EVERY decision honor a revocation / expiry? True
 * when no decision ALLOWS against a scope whose relied-on consent is revoked or
 * expired; the guard that catches a caller-asserted decision that would allow
 * outreach against a revoked / expired scope. This is the honest signal the
 * route reports to policy.consent.honor-revocation. Anything evaluateConsent()
 * produces satisfies it (it denies on revoked / expired). A non-array input is a
 * violation.
 */
export function honorsRevocation(
  decisions:
    | Array<Pick<ConsentDecision, "allowed" | "effectiveStatus" | "expired">>
    | null
    | undefined
): boolean {
  if (!Array.isArray(decisions)) return false;
  return decisions.every(
    (d) => !(d.allowed && (d.effectiveStatus === "revoked" || d.expired === true))
  );
}

/**
 * No-scope-override check: does EVERY decision respect the scope's consent? True
 * when no decision ALLOWS against a scope the patient withheld or never granted
 * (no record); the guard that catches a caller-asserted decision that overrides
 * a withheld scope or borrows consent for a scope the patient didn't grant. This
 * is the honest signal the route reports to policy.consent.no-scope-override.
 * Anything evaluateConsent() produces satisfies it (an allow requires a granted,
 * current record). A non-array input is a violation.
 */
export function respectsConsentScope(
  decisions:
    | Array<Pick<ConsentDecision, "allowed" | "effectiveStatus">>
    | null
    | undefined
): boolean {
  if (!Array.isArray(decisions)) return false;
  return decisions.every(
    (d) => !(d.allowed && (d.effectiveStatus === "withheld" || d.effectiveStatus === "none"))
  );
}

/**
 * A representative, deterministic demo consent ledger (illustrative). One
 * synthetic patient with a spread of scope states so happy-path allows and every
 * consent-state denial are demonstrable:
 *
 *   contact-outreach → granted (current)     → allows on sms/email outside quiet hours
 *   data-sharing     → granted (with expiry) → allows before expiry, denies after
 *   remote-monitoring→ granted (current)     → allows
 *   research         → withheld              → denies (no scope override)
 *   marketing        → revoked               → denies (honor revocation)
 *
 * Channels: sms + email permitted (voice denied). Quiet hours 21:00–07:00 UTC.
 * Frequency cap: 3 touches / 7 days. Patient ref is synthetic / de-identified.
 */
export const DEMO_CONSENT_LEDGER: ConsentLedger = {
  patientRef: "consent-patient-001",
  events: [
    {
      id: "consent-evt-contact-001",
      scope: "contact-outreach",
      status: "granted",
      at: "2026-01-05T09:00:00Z",
      source: "patient-portal"
    },
    {
      id: "consent-evt-data-001",
      scope: "data-sharing",
      status: "granted",
      at: "2026-01-05T09:00:00Z",
      source: "signed-hipaa-authorization",
      expiresAt: "2026-07-05T09:00:00Z"
    },
    {
      id: "consent-evt-rpm-001",
      scope: "remote-monitoring",
      status: "granted",
      at: "2026-01-06T10:00:00Z",
      source: "care-plan-enrollment"
    },
    {
      id: "consent-evt-research-001",
      scope: "research",
      status: "withheld",
      at: "2026-01-05T09:00:00Z",
      source: "patient-portal"
    },
    {
      id: "consent-evt-marketing-001",
      scope: "marketing",
      status: "revoked",
      at: "2026-02-01T12:00:00Z",
      source: "unsubscribe-link"
    }
  ],
  preferences: {
    allowedChannels: ["sms", "email"],
    quietHours: { start: 21, end: 7 },
    preferredLanguage: "en",
    frequencyCap: { maxPerWindow: 3, windowDays: 7 }
  },
  synthetic: true
};
