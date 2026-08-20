/**
 * Break-the-Glass / Emergency Access Governance — the deterministic, transparent
 * emergency-override access layer of Pause's data substrate.
 *
 * Deterministic, dependency-free domain core the Break-the-Glass / Emergency
 * Access Governance Agent (app/api/agents/break-the-glass) wraps — the MuleSoft
 * control-plane / data-substrate security service on Pause's Agent Fabric. It
 * governs emergency "break-the-glass" override access to PHI: given an ACCESS
 * REQUEST — requester role, target patient, stated purpose, an emergency flag,
 * and a free-text clinical justification — it DETERMINISTICALLY decides whether
 * to grant emergency access, and if so returns a TIME-BOXED, MINIMUM-NECESSARY
 * grant (a scoped set of fields + an expiry derived from the request's own time),
 * ALWAYS emitting a mandatory audit event and flagging the grant for mandatory
 * post-access review. It NEVER grants standing / broad / full-record access and
 * never grants without a recorded justification.
 *
 *   Inbound:  an EmergencyAccessRequest { requesterRole, requesterId, patientRef,
 *             purpose, emergency, justification, atTime }
 *   Outbound: an EmergencyAccessDecision { granted, grantedScope, expiresAt,
 *             justificationRecorded, auditEventId, requiresPostAccessReview,
 *             reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other platform-plane agents. It is
 * distinct from the Consent & Preferences Management agent (which manages patient
 * consent scopes for outreach / data-sharing) and the Master Patient Index
 * (identity / dedup): this one governs EMERGENCY clinician access to PHI under the
 * HIPAA minimum-necessary + audit requirements.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: no emergency access without a justification.
 * ─────────────────────────────────────────────────────────────────────
 *  Emergency access is only admissible if it carries a recorded, non-empty
 *  clinical justification — there is no asserted-but-unjustified break-the-glass
 *  grant. accessHasJustification() reports the honest signal the Agent Fabric
 *  enforces via policy.btg.justification-required.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: every grant is minimum-necessary + time-boxed.
 * ─────────────────────────────────────────────────────────────────────
 *  A grant must be scoped to a minimum-necessary field set AND time-limited (a
 *  derived expiry) — never a standing / full-record / non-expiring grant.
 *  accessIsMinimumNecessaryTimeBoxed() reports the honest signal the Agent Fabric
 *  enforces via policy.btg.minimum-necessary-time-boxed.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: every access is logged + post-access reviewed.
 * ─────────────────────────────────────────────────────────────────────
 *  Every emergency access must emit a mandatory audit event AND flag the grant
 *  for post-access review — there is no un-audited break-the-glass access.
 *  accessLoggedForReview() reports the honest signal the Agent Fabric enforces
 *  via policy.btg.mandatory-audit-review.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DENY vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A DENY (no emergency declared, no recorded justification, or an off-catalog
 *  purpose with no derivable scope) is a SAFE, honest OUTPUT: the agent returns
 *  granted:false with a reason and the task COMPLETES — it is NOT a block. A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending GRANT (a granted access
 *  with no recorded justification, a standing / full-record / non-expiring grant,
 *  or an un-audited / un-reviewed grant) — which the Agent Fabric rejects before
 *  it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified break-the-glass system.
 * ─────────────────────────────────────────────────────────────────────
 *  The purpose catalog, the minimum-necessary field sets, the access durations,
 *  and the audit-event ids below are ILLUSTRATIVE synthetic/demo values chosen to
 *  model the SHAPE of a governed emergency-access control — they are NOT a
 *  certified break-the-glass / emergency-access product (real systems reconcile
 *  HIPAA §164.502 minimum-necessary, §164.312 audit controls, an identity /
 *  role provider, and a signed, tamper-evident audit trail). The patient / requester
 *  references are synthetic / de-identified. There is NO randomness and NO clock
 *  anywhere here: the decision is a pure function of the request's own `atTime`
 *  (the caller passes time as data — no Date.now()), so the same request always
 *  yields the same decision + scope + expiry + audit id — which is what lets the
 *  demo, the seeded trace, and the tests agree.
 */

/** An emergency-access purpose in the (illustrative) catalog. */
export type EmergencyPurpose =
  | "emergency-treatment"
  | "medication-reconciliation"
  | "care-coordination-transfer"
  | "behavioral-health-crisis";

/**
 * The recognized PHI field ids an emergency grant may scope to. A grant may only
 * reference these — a "full-chart" / "full-record" / "*" token is deliberately
 * NOT recognized, so a standing / full-record grant fails the minimum-necessary
 * guard. Illustrative — not a certified data dictionary.
 */
export const EMERGENCY_PHI_FIELDS: string[] = [
  "allergies",
  "medications",
  "problems",
  "vitals",
  "recent-encounters",
  "safety-plan",
  "immunizations",
  "lab-results"
];

const EMERGENCY_PHI_FIELD_SET = new Set<string>(EMERGENCY_PHI_FIELDS);

/** Is `field` a recognized, non-full-record PHI field id? */
export function isEmergencyPhiField(field: unknown): boolean {
  return typeof field === "string" && EMERGENCY_PHI_FIELD_SET.has(field);
}

/**
 * The maximum number of fields a minimum-necessary grant may carry. A grant that
 * asks for MORE than this (e.g. every field) is over-broad and fails the
 * minimum-necessary guard — a defense against a "full record via listing every
 * field" grant. Illustrative — not a certified threshold.
 */
export const MINIMUM_NECESSARY_MAX_FIELDS = 6;

/**
 * The maximum time-box (in minutes) an emergency grant may carry. A grant with no
 * expiry, or one longer than this, is a standing grant and fails the
 * minimum-necessary + time-boxed guard. Illustrative — not a certified maximum.
 */
export const MAX_GRANT_DURATION_MINUTES = 240;

/**
 * A single documented emergency-access purpose in the catalog — its
 * minimum-necessary field set (which PHI fields an emergency grant for this
 * purpose scopes to — deliberately NOT the full chart) and its time-box (the
 * access duration in minutes). Illustrative — not a certified break-the-glass
 * catalog.
 */
export type EmergencyPurposeSpec = {
  /** Stable catalog id every request references. */
  id: EmergencyPurpose;
  /** Human-readable purpose label. */
  label: string;
  /**
   * The minimum-necessary field set a grant for this purpose scopes to — a
   * subset of EMERGENCY_PHI_FIELDS, never the full chart.
   */
  scope: string[];
  /** The time-box (access duration) in minutes the grant is limited to. */
  durationMinutes: number;
  /**
   * The (illustrative) description of what this purpose governs. NOT a certified
   * rationale — a demo-honest description.
   */
  description: string;
};

/**
 * The minimum-necessary scope catalog: the ONLY purposes an emergency grant may
 * be derived for, each mapping to a minimum-necessary field set (NOT the full
 * chart) and a time-box. Illustrative/synthetic; NOT a certified break-the-glass
 * catalog (see the header).
 */
export const MINIMUM_NECESSARY_SCOPES: EmergencyPurposeSpec[] = [
  {
    id: "emergency-treatment",
    label: "Emergency treatment",
    scope: ["allergies", "medications", "problems", "vitals"],
    durationMinutes: 60,
    description:
      "An unconscious / unstable patient presenting for emergency treatment: the minimum-necessary set is allergies, active medications, active problems, and vitals — NOT the full chart. (Illustrative — not a certified minimum-necessary determination.)"
  },
  {
    id: "medication-reconciliation",
    label: "Emergency medication reconciliation",
    scope: ["medications", "allergies"],
    durationMinutes: 30,
    description:
      "An emergency medication reconciliation: the minimum-necessary set is active medications and allergies only. (Illustrative — not a certified minimum-necessary determination.)"
  },
  {
    id: "care-coordination-transfer",
    label: "Emergency care-coordination transfer",
    scope: ["problems", "medications", "recent-encounters"],
    durationMinutes: 120,
    description:
      "An emergency transfer of care to a receiving setting: the minimum-necessary set is active problems, active medications, and recent encounters. (Illustrative — not a certified minimum-necessary determination.)"
  },
  {
    id: "behavioral-health-crisis",
    label: "Behavioral-health crisis",
    scope: ["problems", "medications", "safety-plan"],
    durationMinutes: 60,
    description:
      "A behavioral-health crisis: the minimum-necessary set is active problems, active medications, and the safety plan. (Illustrative — not a certified minimum-necessary determination.)"
  }
];

const PURPOSE_BY_ID = new Map(MINIMUM_NECESSARY_SCOPES.map((p) => [p.id, p]));

/** Is `id` a defined emergency-purpose catalog id? */
export function isEmergencyPurpose(id: unknown): id is EmergencyPurpose {
  return typeof id === "string" && PURPOSE_BY_ID.has(id as EmergencyPurpose);
}

/** Look up an emergency-purpose spec by id (undefined for an off-catalog id). */
export function getPurposeSpec(id: string): EmergencyPurposeSpec | undefined {
  return PURPOSE_BY_ID.get(id as EmergencyPurpose);
}

/**
 * The access-duration (time-box, in minutes) per emergency purpose — derived from
 * the catalog so it can never drift from the scope catalog. Every grant is
 * time-limited by its purpose's duration. Illustrative — not certified.
 */
export const ACCESS_DURATIONS: Record<EmergencyPurpose, number> =
  MINIMUM_NECESSARY_SCOPES.reduce((acc, p) => {
    acc[p.id] = p.durationMinutes;
    return acc;
  }, {} as Record<EmergencyPurpose, number>);

/** An emergency break-the-glass access request. */
export type EmergencyAccessRequest = {
  /** The requester's role (e.g. "emergency-physician", "on-call-clinician"). */
  requesterRole: string;
  /** Synthetic, de-identified requester id (e.g. "btg-requester-001"). */
  requesterId: string;
  /** Synthetic, de-identified patient reference (e.g. "btg-patient-001"). */
  patientRef: string;
  /** The stated access purpose (a catalog id, or an off-catalog string). */
  purpose: string;
  /** Whether an emergency was declared — break-the-glass is emergency-only. */
  emergency: boolean;
  /** The free-text clinical justification (required, non-empty, for a grant). */
  justification: string;
  /**
   * The explicit request time (ISO-8601) — taken as data, not a clock read. The
   * grant's expiry is derived from this + the purpose's duration.
   */
  atTime: string;
};

/** The deterministic emergency-access decision the agent returns. */
export type EmergencyAccessDecision = {
  /** Synthetic, de-identified patient reference this decision is about. */
  patientRef: string;
  /** The requester's role. */
  requesterRole: string;
  /** The access purpose the decision is about. */
  purpose: string;
  /** Whether emergency access is granted. */
  granted: boolean;
  /** The minimum-necessary field set granted (empty when not granted). */
  grantedScope: string[];
  /** The derived expiry (ISO-8601) — present only when granted, time-boxed. */
  expiresAt?: string;
  /** The grant's time-box in minutes — present only when granted. */
  durationMinutes?: number;
  /** True when a non-empty clinical justification was recorded on the request. */
  justificationRecorded: boolean;
  /**
   * The mandatory audit-event id emitted for the access attempt (grant OR deny) —
   * every break-the-glass attempt is logged. Illustrative — derived, not a real
   * tamper-evident audit id.
   */
  auditEventId: string;
  /** True when the grant is flagged for mandatory post-access review (grants only). */
  requiresPostAccessReview: boolean;
  /** Human-readable reason (cites the deciding factor). */
  reason: string;
  /** Always true — the catalog, scopes, durations, and audit ids are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Stable reason phrases the decision cites (kept as constants for testability). */
export const BTG_REASON = {
  granted:
    "emergency access granted — a time-boxed, minimum-necessary grant, logged and flagged for mandatory post-access review",
  notEmergency:
    "no emergency was declared — break-the-glass access is granted only for a declared emergency; access denied",
  noJustification:
    "no clinical justification was recorded — break-the-glass access requires a recorded, non-empty justification; access denied",
  offCatalogPurpose:
    "the access purpose is not in the minimum-necessary catalog — no scoped, minimum-necessary grant can be derived; access denied"
} as const;

/** Add `minutes` to an ISO timestamp, deterministically (no clock). */
export function addMinutesIso(atTime: string, minutes: number): string {
  const t = new Date(atTime).getTime();
  if (Number.isNaN(t)) return atTime;
  return new Date(t + minutes * 60_000).toISOString();
}

/**
 * A deterministic, illustrative audit-event id for an access attempt. Derived
 * from the patient ref + purpose + request time (no randomness, no clock), so the
 * same request always produces the same id. NOT a real tamper-evident audit id.
 */
export function emergencyAuditEventId(
  request: Pick<EmergencyAccessRequest, "patientRef" | "purpose" | "atTime">
): string {
  const stamp = (request.atTime ?? "").replace(/[^0-9]/g, "");
  return `btg-audit-${request.patientRef}-${request.purpose}-${stamp}`;
}

/**
 * The deterministic emergency-access decision function — the heart of the service.
 * DETERMINISTIC: a pure function of the request + its own `atTime` (no randomness,
 * no clock). It GRANTS only when an emergency is declared, a non-empty
 * justification is recorded, AND the purpose is in the minimum-necessary catalog —
 * and a grant is ALWAYS a time-boxed (expiry derived from atTime + the purpose's
 * duration), minimum-necessary (the purpose's scoped field set — NEVER the full
 * chart), logged (a mandatory audit event), and post-access-reviewed access.
 * Otherwise it DENIES with a stable reason — a DENY is a SAFE, completed answer,
 * NOT a block. Every attempt (grant OR deny) emits a mandatory audit event. There
 * is never a standing / broad / full-record grant.
 */
export function evaluateEmergencyAccess(
  request: EmergencyAccessRequest
): EmergencyAccessDecision {
  const justificationRecorded =
    typeof request.justification === "string" &&
    request.justification.trim().length > 0;
  const auditEventId = emergencyAuditEventId(request);
  const spec = getPurposeSpec(request.purpose);

  const base = {
    patientRef: request.patientRef,
    requesterRole: request.requesterRole,
    purpose: request.purpose,
    justificationRecorded,
    auditEventId,
    synthetic: true as const
  };

  const deniedNote = (reason: string) =>
    `Break-the-glass request for ${request.patientRef} by ${request.requesterRole} DENIED: ${reason}. The attempt is logged (audit ${auditEventId}). Break-the-glass access is emergency-only, requires a recorded clinical justification, and yields only a time-boxed, minimum-necessary grant — never standing / full-record access. ` +
    "Synthetic/illustrative purpose catalog, scopes, durations, and audit ids — NOT a certified break-the-glass system.";

  // Legit DENY (safe, completed answer — NOT a governance block).
  if (!spec) {
    return {
      ...base,
      granted: false,
      grantedScope: [],
      requiresPostAccessReview: false,
      reason: BTG_REASON.offCatalogPurpose,
      note: deniedNote(BTG_REASON.offCatalogPurpose)
    };
  }
  if (request.emergency !== true) {
    return {
      ...base,
      granted: false,
      grantedScope: [],
      requiresPostAccessReview: false,
      reason: BTG_REASON.notEmergency,
      note: deniedNote(BTG_REASON.notEmergency)
    };
  }
  if (!justificationRecorded) {
    return {
      ...base,
      granted: false,
      grantedScope: [],
      requiresPostAccessReview: false,
      reason: BTG_REASON.noJustification,
      note: deniedNote(BTG_REASON.noJustification)
    };
  }

  // GRANT: time-boxed + minimum-necessary + logged + post-access-reviewed.
  const grantedScope = [...spec.scope];
  const expiresAt = addMinutesIso(request.atTime, spec.durationMinutes);
  const note =
    `Break-the-glass emergency access for ${request.patientRef} by ${request.requesterRole} GRANTED for ${spec.label}: a MINIMUM-NECESSARY grant scoped to ${grantedScope.join(", ")} (not the full chart), TIME-BOXED to ${spec.durationMinutes} minutes (expires ${expiresAt}), LOGGED (audit ${auditEventId}), and flagged for mandatory post-access review. It is never a standing / broad / full-record grant, and never granted without a recorded justification. ` +
    "Synthetic/illustrative purpose catalog, scopes, durations, and audit ids — NOT a certified break-the-glass system.";

  return {
    ...base,
    granted: true,
    grantedScope,
    expiresAt,
    durationMinutes: spec.durationMinutes,
    requiresPostAccessReview: true,
    reason: BTG_REASON.granted,
    note
  };
}

/**
 * Justification-required check: does the decision carry a recorded justification
 * when it grants access? True unless a GRANTED access has no recorded
 * justification (justificationRecorded !== true) — the guard that catches a
 * caller-asserted emergency GRANT with no recorded clinical justification. A deny
 * trivially passes (nothing granted). This is the honest signal the route reports
 * to policy.btg.justification-required. A non-object input is a violation.
 */
export function accessHasJustification(
  decision:
    | Pick<EmergencyAccessDecision, "granted" | "justificationRecorded">
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  return !(decision.granted === true && decision.justificationRecorded !== true);
}

/**
 * Minimum-necessary + time-boxed check: is a granted access scoped to a
 * minimum-necessary field set AND time-limited? True for a deny (nothing granted)
 * and for a grant whose scope is non-empty, references ONLY recognized (non
 * full-record) fields, is no larger than MINIMUM_NECESSARY_MAX_FIELDS, AND carries
 * an expiry with a positive duration no larger than MAX_GRANT_DURATION_MINUTES.
 * The guard that catches a caller-asserted STANDING / FULL-RECORD / NON-EXPIRING
 * grant (an over-broad or full-chart scope, or a grant with no expiry). This is
 * the honest signal the route reports to policy.btg.minimum-necessary-time-boxed.
 * A non-object input is a violation.
 */
export function accessIsMinimumNecessaryTimeBoxed(
  decision:
    | Pick<
        EmergencyAccessDecision,
        "granted" | "grantedScope" | "expiresAt" | "durationMinutes"
      >
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.granted !== true) return true;
  const scope = Array.isArray(decision.grantedScope) ? decision.grantedScope : [];
  const minimumNecessary =
    scope.length > 0 &&
    scope.length <= MINIMUM_NECESSARY_MAX_FIELDS &&
    scope.every((f) => isEmergencyPhiField(f));
  const timeBoxed =
    typeof decision.expiresAt === "string" &&
    decision.expiresAt.length > 0 &&
    typeof decision.durationMinutes === "number" &&
    decision.durationMinutes > 0 &&
    decision.durationMinutes <= MAX_GRANT_DURATION_MINUTES;
  return minimumNecessary && timeBoxed;
}

/**
 * Mandatory-audit + post-access-review check: is a granted access logged AND
 * flagged for post-access review? True for a deny (nothing granted) and for a
 * grant that carries a non-empty audit-event id AND requiresPostAccessReview:true.
 * The guard that catches a caller-asserted UN-AUDITED / UN-REVIEWED grant (a grant
 * with no audit event or one not flagged for post-access review). This is the
 * honest signal the route reports to policy.btg.mandatory-audit-review. A
 * non-object input is a violation.
 */
export function accessLoggedForReview(
  decision:
    | Pick<
        EmergencyAccessDecision,
        "granted" | "auditEventId" | "requiresPostAccessReview"
      >
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.granted !== true) return true;
  return (
    typeof decision.auditEventId === "string" &&
    decision.auditEventId.trim().length > 0 &&
    decision.requiresPostAccessReview === true
  );
}

/**
 * A compact, trace-safe summary of a decision — the shape stamped onto the Agent
 * Fabric trace + the response `meta`. Carries no free-text PHI (refs, the purpose,
 * scope size, and the flags only).
 */
export function emergencyAccessSummary(decision: EmergencyAccessDecision): {
  patientRef: string;
  requesterRole: string;
  purpose: string;
  granted: boolean;
  grantedFieldCount: number;
  expiresAt?: string;
  durationMinutes?: number;
  auditEventId: string;
  requiresPostAccessReview: boolean;
  synthetic: boolean;
} {
  return {
    patientRef: decision.patientRef,
    requesterRole: decision.requesterRole,
    purpose: decision.purpose,
    granted: decision.granted,
    grantedFieldCount: decision.grantedScope.length,
    expiresAt: decision.expiresAt,
    durationMinutes: decision.durationMinutes,
    auditEventId: decision.auditEventId,
    requiresPostAccessReview: decision.requiresPostAccessReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative, deterministic demo emergency-access request (illustrative). An
 * emergency physician breaking the glass for an unstable patient presenting for
 * emergency treatment, with a recorded clinical justification — resolves to a
 * time-boxed, minimum-necessary GRANT. Synthetic / de-identified.
 */
export const DEMO_EMERGENCY_ACCESS_REQUEST: EmergencyAccessRequest = {
  requesterRole: "emergency-physician",
  requesterId: "btg-requester-001",
  patientRef: "btg-patient-001",
  purpose: "emergency-treatment",
  emergency: true,
  justification:
    "Unresponsive patient in the ED; need active allergies, medications, problems, and vitals to treat safely.",
  atTime: "2026-03-01T02:30:00Z"
};

/**
 * A representative, deterministic demo NON-emergency request (illustrative). The
 * same requester without a declared emergency — resolves to a legitimate DENY (a
 * safe, completed answer, NOT a governance block). Synthetic / de-identified.
 */
export const DEMO_NON_EMERGENCY_REQUEST: EmergencyAccessRequest = {
  requesterRole: "on-call-clinician",
  requesterId: "btg-requester-002",
  patientRef: "btg-patient-002",
  purpose: "emergency-treatment",
  emergency: false,
  justification: "Routine chart review ahead of a scheduled visit.",
  atTime: "2026-03-01T14:00:00Z"
};
