/**
 * Right of Access (HIPAA §164.524) — the deterministic, transparent privacy layer that adjudicates a
 * patient's RIGHT-OF-ACCESS request: given a request for a copy of their PHI, it deterministically
 * confirms the record is in a designated record set, computes the §164.524 response deadline (30
 * calendar days, plus one 30-day extension when invoked), classifies any cited denial ground against
 * the recorded exception catalog, and decides the disposition — never autonomously RELEASING the
 * record or DENYING the request; a records / privacy officer fulfills or reviews every determination.
 *
 * Deterministic, dependency-free domain core the Right of Access Agent (app/api/agents/right-of-access)
 * wraps — a control-plane / data-substrate privacy service on the platform plane of Pause's Agent
 * Fabric. Given an access request (a patient reference, the request type, the request date, an as-of
 * date, whether the requested PHI is in a designated record set, an optional cited denial-ground /
 * exception, and whether the one 30-day extension was invoked), it DETERMINISTICALLY computes the
 * response deadline (request date + 30 days, or + 60 when the extension is invoked, via pure UTC date
 * math — dates taken as data, NO Date.now()), classifies any cited exception against the §164.524
 * grounds (unreviewable grounds — psychotherapy notes, information compiled for a legal proceeding,
 * a CLIA-exempt lab; reviewable grounds — access reasonably likely to endanger, a reference to
 * another person), and decides the disposition.
 *
 *   Inbound:  an AccessRequest { requestRef, patientRef, requestType, requestDate, asOfDate,
 *             inDesignatedRecordSet, exceptionId?, extensionInvoked? }
 *   Outbound: an AccessDetermination { requestType, inDesignatedRecordSet, exceptionId,
 *             exceptionType, responseDeadline, daysUntilDeadline, disposition, accessGranted,
 *             autoReleased:false, requiresHumanReview:true, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other platform / privacy agents: distinct from the
 * Accounting of Disclosures agent (WHO the PHI was disclosed to, §164.528), the Consent & Preferences
 * Management agent (WHETHER a patient may be contacted / data used), the Minimum Necessary agent (HOW
 * MUCH PHI a purpose may see), the De-Identification agent (whether a dataset is still PHI), the Data
 * Retention agent (records disposition), and the Audit Log Integrity agent (whether the audit TRAIL is
 * tamper-evident): this answers the patient's §164.524 RIGHT to GET a copy of their own record, and
 * BY WHEN.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every cited denial ground traces to a recorded exception catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  A partial or full denial is permitted only on a recorded §164.524 ground — a cited exception must
 *  resolve in the recorded exception catalog; an ad-hoc / off-catalog ground is not a lawful basis to
 *  withhold a patient's own record. accessGroundSourced() reports the honest signal the Agent Fabric
 *  enforces via policy.access.ground-sourced. (Mirrors the Accounting of Disclosures Agent's
 *  purpose-category-sourced and the Minimum Necessary Agent's purpose-of-use-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the response deadline is computed, not guessed.
 * ─────────────────────────────────────────────────────────────────────
 *  The §164.524 response deadline must equal the request date + 30 days (+ 30 more when the single
 *  extension is invoked) — a guessed / mis-stated deadline is how an access request quietly runs past
 *  its legal clock. accessDeadlineComputed() recomputes the deadline from the determination's own
 *  fields (pure UTC date math) and verifies it matches; it reports the honest signal the Agent Fabric
 *  enforces via policy.access.deadline-computed. (The load-bearing correctness gate — mirrors the
 *  Timely Filing Agent's deadline-computed and the Good Faith Estimate Agent's math-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the record is never autonomously released or denied.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent ADJUDICATES — it never RELEASES the record (a privacy risk) or DENIES the request (a
 *  legal act with appeal rights) on its own; every determination is a RECOMMENDATION requiring a
 *  records / privacy officer to fulfill or review. accessNoAutonomousDenialOrRelease() reports the
 *  honest signal the Agent Fabric enforces via policy.access.no-autonomous-denial-or-release.
 *  (Mirrors the Accounting of Disclosures Agent's no-autonomous-suppression and the Minimum Necessary
 *  Agent's no-autonomous-over-disclosure posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — grant OR deny — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresHumanReview:true, autoReleased:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (an off-catalog denial ground, a mis-computed deadline, or an
 *  autonomously-released / unreviewed determination) — which the Agent Fabric rejects before it can
 *  leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified HIM / release-of-information system.
 * ─────────────────────────────────────────────────────────────────────
 *  The exception catalog and the 30/60-day math below are clearly-labeled ILLUSTRATIVE synthetics
 *  chosen to model the SHAPE of a §164.524 access adjudication deterministically in the demo — they
 *  are NOT a complete implementation. Real access requests are governed by HIPAA §164.524 (the full
 *  set of grounds for denial, the reviewable-denial review process, the fee limits, and the
 *  designated-record-set definition), the HITECH electronic-copy rules, and the covered entity's
 *  Notice of Privacy Practices. There is NO randomness and NO clock anywhere here: the determination
 *  is a pure function of the request's own fields (dates taken as data — no Date.now()), so the same
 *  request always yields the same deadline / classification / disposition — which is what lets the
 *  demo, the seeded trace, and the tests agree.
 */

/** Normalize an ISO date (date-only or full) to a UTC midnight epoch-ms. */
function toUtcDateMs(iso: string): number {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Add `days` to an ISO date, returning a date-only "YYYY-MM-DD" string. Deterministic (UTC). */
export function addDays(iso: string, days: number): string {
  const ms = toUtcDateMs(iso) + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days between two ISO dates (to − from); negative when `to` is before `from`. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtcDateMs(toIso) - toUtcDateMs(fromIso)) / (24 * 60 * 60 * 1000));
}

/** The statutory base window and the single allowed extension (in days). */
export const ACCESS_BASE_DAYS = 30;
export const ACCESS_EXTENSION_DAYS = 30;

/** How a patient's access request is framed. */
export type AccessRequestType = "copy" | "inspect" | "direct-to-third-party";

/** Whether a cited denial ground is reviewable by the patient, or an unreviewable statutory ground. */
export type AccessExceptionType = "unreviewable" | "reviewable";

/** A recorded §164.524 denial ground (a catalog entry that grounds a partial / full denial). */
export type AccessException = {
  /** Stable exception id. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Whether the denial is reviewable (patient may request review) or unreviewable. */
  type: AccessExceptionType;
  /** Short description of the ground. */
  description: string;
};

/**
 * ILLUSTRATIVE, synthetic §164.524 denial-ground catalog — clearly labeled, NOT the full statutory
 * set. A cited exception must resolve here; unreviewable grounds are denied outright, reviewable
 * grounds require a licensed professional's review before the denial stands.
 */
export const ACCESS_EXCEPTIONS: AccessException[] = [
  {
    id: "exception.psychotherapy-notes",
    name: "Psychotherapy notes",
    type: "unreviewable",
    description:
      "Psychotherapy notes are excluded from the right of access under §164.524(a)(1)(i)."
  },
  {
    id: "exception.legal-proceeding-compilation",
    name: "Information compiled for a legal proceeding",
    type: "unreviewable",
    description:
      "Information compiled in reasonable anticipation of, or for use in, a civil / criminal / administrative proceeding under §164.524(a)(1)(ii)."
  },
  {
    id: "exception.clia-exempt-lab",
    name: "CLIA / CLIA-exempt laboratory",
    type: "unreviewable",
    description:
      "PHI held by a lab that is exempt from CLIA where access would be prohibited under §164.524(a)(1)(iii)."
  },
  {
    id: "exception.endangerment-to-self-or-others",
    name: "Access reasonably likely to endanger",
    type: "reviewable",
    description:
      "A licensed health-care professional has determined access is reasonably likely to endanger the life or physical safety of the individual or another person (§164.524(a)(3)(i)) — a REVIEWABLE denial."
  },
  {
    id: "exception.reference-to-another-person",
    name: "Reference to another person",
    type: "reviewable",
    description:
      "The PHI makes reference to another person and access is reasonably likely to cause substantial harm to that person (§164.524(a)(3)(ii)) — a REVIEWABLE denial."
  }
];

/** Look up a denial ground by id (undefined when off-catalog). */
export function getAccessException(id: string): AccessException | undefined {
  return ACCESS_EXCEPTIONS.find((e) => e.id === id);
}

/** A patient's right-of-access request. */
export type AccessRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic patient reference. */
  patientRef: string;
  /** How the request is framed. */
  requestType: AccessRequestType;
  /** The date the request was received (ISO, taken as data). */
  requestDate: string;
  /** The date the determination is evaluated as-of (ISO, taken as data). */
  asOfDate: string;
  /** Whether the requested PHI is in a designated record set (the right attaches only if so). */
  inDesignatedRecordSet: boolean;
  /** Optional cited denial ground (must resolve in the exception catalog). */
  exceptionId?: string;
  /** Whether the single 30-day extension was invoked (with written notice). */
  extensionInvoked?: boolean;
};

/** How the request is dispositioned. */
export type AccessDisposition =
  | "grant-in-full"
  | "deny-unreviewable"
  | "deny-reviewable-needs-review"
  | "not-accessible-outside-record-set";

/** The deterministic access determination the agent returns. */
export type AccessDetermination = {
  requestRef: string;
  patientRef: string;
  requestType: AccessRequestType;
  inDesignatedRecordSet: boolean;
  /** The cited exception id (empty string when none cited). */
  exceptionId: string;
  /** The classified exception type (or "none" / "unknown"). */
  exceptionType: AccessExceptionType | "none" | "unknown";
  /** Whether the single extension was invoked. */
  extensionInvoked: boolean;
  /** The computed response deadline (requestDate + 30, or + 60 with extension). */
  responseDeadline: string;
  /** Whole days from asOfDate to the deadline (negative when overdue). */
  daysUntilDeadline: number;
  /** The disposition. */
  disposition: AccessDisposition;
  /** Whether access is granted (true only for grant-in-full). */
  accessGranted: boolean;
  /** Always false — the agent never autonomously releases the record. */
  autoReleased: false;
  /** Always true — every determination is fulfilled / reviewed by a records / privacy officer. */
  requiresHumanReview: true;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the catalog + math are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * The deterministic right-of-access function — the heart of the service. DETERMINISTIC: a pure
 * function of the request's own fields + the cited ground (no randomness, no clock). It computes the
 * §164.524 response deadline, classifies any cited denial ground, and decides the disposition.
 * Nothing is released or denied here — every determination is handed to a records / privacy officer.
 */
export function evaluateAccess(request: AccessRequest): AccessDetermination {
  const extensionInvoked = request.extensionInvoked === true;
  const responseDeadline = addDays(
    request.requestDate,
    ACCESS_BASE_DAYS + (extensionInvoked ? ACCESS_EXTENSION_DAYS : 0)
  );
  const daysUntilDeadline = daysBetween(request.asOfDate, responseDeadline);

  const exceptionId = typeof request.exceptionId === "string" ? request.exceptionId : "";
  const exception = exceptionId ? getAccessException(exceptionId) : undefined;
  const exceptionType: AccessExceptionType | "none" | "unknown" = !exceptionId
    ? "none"
    : (exception?.type ?? "unknown");

  let disposition: AccessDisposition;
  if (!request.inDesignatedRecordSet) {
    disposition = "not-accessible-outside-record-set";
  } else if (exceptionType === "none") {
    disposition = "grant-in-full";
  } else if (exceptionType === "reviewable") {
    disposition = "deny-reviewable-needs-review";
  } else {
    // "unreviewable" (and, conservatively, "unknown") deny outright — the unknown case is caught by
    // the ground-sourced governance guard, but we never silently grant an unrecognized ground.
    disposition = "deny-unreviewable";
  }

  const accessGranted = disposition === "grant-in-full";

  const deadlinePhrase =
    daysUntilDeadline >= 0
      ? `due ${responseDeadline} (${daysUntilDeadline} day(s) remaining as of ${request.asOfDate})`
      : `OVERDUE — was due ${responseDeadline} (${Math.abs(daysUntilDeadline)} day(s) past as of ${request.asOfDate})`;

  const dispositionPhrase =
    disposition === "grant-in-full"
      ? "grant in full — records / privacy officer to fulfill the release"
      : disposition === "deny-reviewable-needs-review"
        ? `reviewable denial (${exception?.name ?? exceptionId}) — a licensed professional must review before the denial stands`
        : disposition === "deny-unreviewable"
          ? `unreviewable denial (${exception?.name ?? exceptionId}) — records / privacy officer to issue the denial notice`
          : "requested PHI is outside a designated record set — records staff to confirm and respond";

  const reason = `Access request ${request.requestRef} (${request.requestType}) for ${request.patientRef}: ${deadlinePhrase}; ${dispositionPhrase}.`;

  return {
    requestRef: request.requestRef,
    patientRef: request.patientRef,
    requestType: request.requestType,
    inDesignatedRecordSet: request.inDesignatedRecordSet,
    exceptionId,
    exceptionType,
    extensionInvoked,
    responseDeadline,
    daysUntilDeadline,
    disposition,
    accessGranted,
    autoReleased: false,
    requiresHumanReview: true,
    reason,
    synthetic: true,
    note:
      `Right-of-access request ${request.requestRef}: response ${deadlinePhrase}; disposition ${disposition}. ` +
      "PHI-bearing — the access decision references the patient's record. Synthetic/illustrative exception catalog + 30/60-day math — NOT a certified release-of-information system; real access is governed by HIPAA §164.524, the HITECH electronic-copy rules, and the covered entity's Notice of Privacy Practices. The agent never releases the record or issues a denial on its own — a records / privacy officer fulfills or reviews every determination."
  };
}

/**
 * Ground-sourced check: if a denial ground is cited, does it resolve in the recorded exception
 * catalog? True when no ground is cited (a full grant) or the cited ground is cataloged; the guard
 * that catches an ad-hoc / off-catalog denial ground. Anything evaluateAccess() produces from a
 * cataloged (or absent) ground satisfies it. This is the honest signal the route reports to
 * policy.access.ground-sourced. A non-object input, or an "unknown" exception type, is a violation.
 */
export function accessGroundSourced(
  decision:
    | { exceptionId?: string; exceptionType?: AccessExceptionType | "none" | "unknown" }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const id = typeof decision.exceptionId === "string" ? decision.exceptionId : "";
  if (!id) return true; // no ground cited → full grant, nothing to source
  if (decision.exceptionType === "unknown") return false;
  return getAccessException(id) !== undefined;
}

/**
 * Deadline-computed check: does the response deadline equal the request date + 30 (+ 30 when the
 * extension is invoked)? True unless the stated deadline or the days-until disagree with the
 * recomputation from the determination's own fields; the guard that catches a guessed / mis-stated
 * deadline. Anything evaluateAccess() produces satisfies it. This is the honest signal the route
 * reports to policy.access.deadline-computed. A non-object / malformed input is a violation.
 */
export function accessDeadlineComputed(
  decision:
    | {
        requestDate?: string;
        asOfDate?: string;
        extensionInvoked?: boolean;
        responseDeadline?: string;
        daysUntilDeadline?: number;
      }
    | null
    | undefined,
  requestContext?: { requestDate?: string; asOfDate?: string }
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const requestDate = decision.requestDate ?? requestContext?.requestDate;
  const asOfDate = decision.asOfDate ?? requestContext?.asOfDate;
  if (typeof requestDate !== "string" || typeof asOfDate !== "string") return false;
  if (typeof decision.responseDeadline !== "string") return false;
  const expectedDeadline = addDays(
    requestDate,
    ACCESS_BASE_DAYS + (decision.extensionInvoked === true ? ACCESS_EXTENSION_DAYS : 0)
  );
  if (decision.responseDeadline !== expectedDeadline) return false;
  if (typeof decision.daysUntilDeadline === "number") {
    if (decision.daysUntilDeadline !== daysBetween(asOfDate, expectedDeadline)) return false;
  }
  return true;
}

/**
 * No-autonomous-denial-or-release check: did the agent avoid autonomously releasing the record or
 * denying the request? True unless the determination reports it autonomously released the record
 * (autoReleased:true) or does not require human review (requiresHumanReview:false); the guard that
 * catches an autonomous release / denial. Anything evaluateAccess() produces satisfies it. This is
 * the honest signal the route reports to policy.access.no-autonomous-denial-or-release. A non-object
 * input is a violation.
 */
export function accessNoAutonomousDenialOrRelease(
  decision:
    | { autoReleased?: boolean; requiresHumanReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoReleased === true) return false;
  if (decision.requiresHumanReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric trace +
 * the response `meta`.
 */
export function accessSummary(decision: AccessDetermination): {
  requestRef: string;
  patientRef: string;
  requestType: AccessRequestType;
  responseDeadline: string;
  daysUntilDeadline: number;
  disposition: AccessDisposition;
  accessGranted: boolean;
  requiresHumanReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: decision.requestRef,
    patientRef: decision.patientRef,
    requestType: decision.requestType,
    responseDeadline: decision.responseDeadline,
    daysUntilDeadline: decision.daysUntilDeadline,
    disposition: decision.disposition,
    accessGranted: decision.accessGranted,
    requiresHumanReview: decision.requiresHumanReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a routine copy request, in the designated record set, no denial
 * ground → grant in full, due in 30 days. Synthetic.
 */
export const DEMO_ACCESS_REQUEST: AccessRequest = {
  requestRef: "access-001",
  patientRef: "patient-8842",
  requestType: "copy",
  requestDate: "2026-08-20",
  asOfDate: "2026-09-07",
  inDesignatedRecordSet: true
};

/**
 * A representative demo request: a request touching psychotherapy notes → an unreviewable denial of
 * that portion. Synthetic.
 */
export const DEMO_ACCESS_PSYCH_REQUEST: AccessRequest = {
  requestRef: "access-002",
  patientRef: "patient-7310",
  requestType: "copy",
  requestDate: "2026-08-25",
  asOfDate: "2026-09-07",
  inDesignatedRecordSet: true,
  exceptionId: "exception.psychotherapy-notes"
};

/**
 * A representative demo request: an endangerment concern → a reviewable denial requiring a licensed
 * professional's review. Synthetic.
 */
export const DEMO_ACCESS_ENDANGER_REQUEST: AccessRequest = {
  requestRef: "access-003",
  patientRef: "patient-5521",
  requestType: "copy",
  requestDate: "2026-07-15",
  asOfDate: "2026-09-07",
  inDesignatedRecordSet: true,
  exceptionId: "exception.endangerment-to-self-or-others"
};

/**
 * A representative demo request: a complex request with the single 30-day extension invoked → grant
 * in full, due in 60 days. Synthetic.
 */
export const DEMO_ACCESS_EXTENSION_REQUEST: AccessRequest = {
  requestRef: "access-004",
  patientRef: "patient-9017",
  requestType: "direct-to-third-party",
  requestDate: "2026-08-20",
  asOfDate: "2026-09-07",
  inDesignatedRecordSet: true,
  extensionInvoked: true
};
