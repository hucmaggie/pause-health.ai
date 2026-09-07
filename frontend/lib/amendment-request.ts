/**
 * Amendment / Correction of PHI (HIPAA §164.526) — the deterministic, transparent privacy layer that
 * adjudicates a patient's RIGHT-TO-AMEND request: given a request to amend PHI in a designated record
 * set, it deterministically computes the §164.526 response deadline (60 calendar days, plus one
 * 30-day extension when invoked), derives whether a statutory ground to DENY applies (the covered
 * entity is not the originator, the PHI is outside the designated record set, the PHI is not available
 * for access under §164.524, or the PHI is already accurate and complete), and decides the disposition
 * — never autonomously AMENDING the record (a data write to the medical record) or DENYING the request
 * (a legal act carrying statement-of-disagreement rights); a records / privacy officer acts on or
 * reviews every determination.
 *
 * Deterministic, dependency-free domain core the Amendment Request Agent
 * (app/api/agents/amendment-request) wraps — a control-plane / data-substrate privacy service on the
 * platform plane of Pause's Agent Fabric. It CAPSTONES the HIPAA PATIENT-RIGHTS TRILOGY: it is the
 * third sibling to the Right of Access agent (§164.524 — the right to GET a copy of your record) and
 * the Accounting of Disclosures agent (§164.528 — the right to know WHO your PHI was disclosed to);
 * this answers the §164.526 right to FIX your record. Given an amendment request (a patient reference,
 * the record and request type, the request date, an as-of date, whether the PHI is in a designated
 * record set, whether the covered entity created the PHI and whether the originator is still
 * available, whether the PHI is available for access under §164.524, whether the PHI is already
 * accurate and complete, and whether the single 30-day extension was invoked), it DETERMINISTICALLY
 * computes the response deadline (request date + 60 days, or + 90 when the extension is invoked, via
 * pure UTC date math — dates taken as data, NO Date.now()), derives which §164.526 denial ground (if
 * any) applies against the recorded ground catalog, and decides the disposition.
 *
 *   Inbound:  an AmendmentRequest { requestRef, patientRef, recordRef, requestType, requestDate,
 *             asOfDate, inDesignatedRecordSet, coveredEntityIsOriginator, originatorAvailable,
 *             availableForAccess, recordAccurateAndComplete, extensionInvoked? }
 *   Outbound: an AmendmentDetermination { requestType, responseDeadline, daysUntilDeadline,
 *             disposition, deniedOnGround, deniedOnGroundLabel, patientMayStatementOfDisagreement,
 *             requiresHumanReview:true, autoAmended:false, autoDenied:false, reason, synthetic:true,
 *             note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other platform / privacy agents: distinct from the
 * Right of Access agent (§164.524 — GET a copy), the Accounting of Disclosures agent (§164.528 — WHO
 * it was disclosed to), the Consent & Preferences agent (WHETHER a patient may be contacted / data
 * used), the Minimum Necessary agent (HOW MUCH PHI a purpose may see), and the Data Retention agent
 * (records disposition): this answers the §164.526 right to request an AMENDMENT / CORRECTION of the
 * record, and BY WHEN.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every denial ground traces to a recorded catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  A denial is permitted only on a recorded §164.526 ground — a denied determination must cite a
 *  ground that resolves in the recorded catalog; an ad-hoc / off-catalog ground is not a lawful basis
 *  to refuse a patient's amendment. amendmentGroundSourced() reports the honest signal the Agent
 *  Fabric enforces via policy.amendment.ground-sourced. (Mirrors the Right of Access Agent's
 *  ground-sourced and the Accounting of Disclosures Agent's purpose-category-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the response deadline is computed, not guessed.
 * ─────────────────────────────────────────────────────────────────────
 *  The §164.526 response deadline must equal the request date + 60 days (+ 30 more when the single
 *  extension is invoked) — a guessed / mis-stated deadline is how an amendment request quietly runs
 *  past its legal clock. amendmentDeadlineComputed() recomputes the deadline from the determination's
 *  own fields (pure UTC date math) and verifies it matches; it reports the honest signal the Agent
 *  Fabric enforces via policy.amendment.deadline-computed. (The load-bearing correctness gate —
 *  mirrors the Right of Access Agent's deadline-computed and the Timely Filing Agent's
 *  deadline-computed.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the record is never autonomously amended or denied.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent ADJUDICATES — it never AMENDS the record (a data write to the medical record, which
 *  ripples to everyone the CE has shared the PHI with) or DENIES the request (a legal act carrying the
 *  patient's right to submit a statement of disagreement) on its own; every determination is a
 *  RECOMMENDATION requiring a records / privacy officer to act or review. amendmentNoAutonomousWrite()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.amendment.no-autonomous-write-or-denial. (Mirrors the Right of Access Agent's
 *  no-autonomous-denial-or-release and the Minimum Necessary Agent's no-autonomous-over-disclosure
 *  posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — accept OR deny — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresHumanReview:true, autoAmended:false, autoDenied:false). A GOVERNANCE BLOCK is when a caller
 *  PRESENTS an offending DETERMINATION (an off-catalog denial ground, a mis-computed deadline, or an
 *  autonomously-amended / -denied / unreviewed determination) — which the Agent Fabric rejects before
 *  it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified HIM / release-of-information system.
 * ─────────────────────────────────────────────────────────────────────
 *  The denial-ground catalog and the 60/90-day math below are clearly-labeled ILLUSTRATIVE synthetics
 *  chosen to model the SHAPE of a §164.526 amendment adjudication deterministically in the demo — they
 *  are NOT a complete implementation. Real amendment requests are governed by HIPAA §164.526 (the full
 *  denial grounds, the required written denial with statement-of-disagreement and rebuttal process, the
 *  duty to notify other holders of an accepted amendment, and the designated-record-set definition) and
 *  the covered entity's Notice of Privacy Practices. There is NO randomness and NO clock anywhere here:
 *  the determination is a pure function of the request's own fields (dates taken as data — no
 *  Date.now()), so the same request always yields the same deadline / ground / disposition — which is
 *  what lets the demo, the seeded trace, and the tests agree.
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
export const AMENDMENT_BASE_DAYS = 60;
export const AMENDMENT_EXTENSION_DAYS = 30;

/** How a patient's amendment request is framed. */
export type AmendmentRequestType =
  | "correct-demographic"
  | "correct-clinical"
  | "add-addendum";

/** A recorded §164.526 ground on which an amendment may be denied. */
export type AmendmentDenialGround = {
  /** Stable ground id. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Short description of the ground. */
  description: string;
};

/**
 * ILLUSTRATIVE, synthetic §164.526 denial-ground catalog — clearly labeled, NOT the full statutory
 * set. A denied determination must cite a ground that resolves here.
 */
export const AMENDMENT_DENIAL_GROUNDS: AmendmentDenialGround[] = [
  {
    id: "ground.not-originator",
    name: "Covered entity did not create the PHI",
    description:
      "The covered entity did not create the PHI, unless the originator is no longer available to act on the request (§164.526(a)(2)(i))."
  },
  {
    id: "ground.not-in-designated-record-set",
    name: "PHI is not part of the designated record set",
    description:
      "The PHI is not part of the designated record set held by the covered entity (§164.526(a)(2)(iii))."
  },
  {
    id: "ground.not-available-for-access",
    name: "PHI is not available for access",
    description:
      "The PHI would not be available for inspection under the right of access (§164.524) — e.g. psychotherapy notes (§164.526(a)(2)(iv))."
  },
  {
    id: "ground.accurate-and-complete",
    name: "PHI is accurate and complete",
    description:
      "The PHI that is the subject of the request is accurate and complete (§164.526(a)(2)(ii))."
  }
];

/** Look up a denial ground by id (undefined when off-catalog). */
export function getAmendmentDenialGround(id: string): AmendmentDenialGround | undefined {
  return AMENDMENT_DENIAL_GROUNDS.find((g) => g.id === id);
}

/** A patient's right-to-amend request. */
export type AmendmentRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic patient reference. */
  patientRef: string;
  /** Synthetic record reference (the record the amendment targets). */
  recordRef: string;
  /** How the request is framed. */
  requestType: AmendmentRequestType;
  /** The date the request was received (ISO, taken as data). */
  requestDate: string;
  /** The date the determination is evaluated as-of (ISO, taken as data). */
  asOfDate: string;
  /** Whether the targeted PHI is in a designated record set. */
  inDesignatedRecordSet: boolean;
  /** Whether the covered entity created (originated) the PHI. */
  coveredEntityIsOriginator: boolean;
  /** Whether the originator is still available to act (relevant only when the CE is not the originator). */
  originatorAvailable: boolean;
  /** Whether the PHI is available for access under §164.524. */
  availableForAccess: boolean;
  /** Whether the PHI is already accurate and complete (a ground to deny). */
  recordAccurateAndComplete: boolean;
  /** Whether the single 30-day extension was invoked (with written notice). */
  extensionInvoked?: boolean;
};

/** How the request is dispositioned. */
export type AmendmentDisposition = "recommend-accept" | "recommend-deny";

/** The deterministic amendment determination the agent returns. */
export type AmendmentDetermination = {
  requestRef: string;
  patientRef: string;
  recordRef: string;
  requestType: AmendmentRequestType;
  /** The date the request was received (echoed so the deadline guard is self-contained). */
  requestDate: string;
  /** The date the determination was evaluated as-of (echoed for the deadline guard). */
  asOfDate: string;
  /** Whether the single extension was invoked. */
  extensionInvoked: boolean;
  /** The computed response deadline (requestDate + 60, or + 90 with extension). */
  responseDeadline: string;
  /** Whole days from asOfDate to the deadline (negative when overdue). */
  daysUntilDeadline: number;
  /** The disposition. */
  disposition: AmendmentDisposition;
  /** The §164.526 ground the denial rests on (null on recommend-accept). */
  deniedOnGround: string | null;
  /** Human-readable label of the denial ground (null on recommend-accept). */
  deniedOnGroundLabel: string | null;
  /** Whether the patient may submit a statement of disagreement (true only on a denial). */
  patientMayStatementOfDisagreement: boolean;
  /** Always true — every determination is acted on / reviewed by a records / privacy officer. */
  requiresHumanReview: true;
  /** Always false — the agent never autonomously amends the record. */
  autoAmended: false;
  /** Always false — the agent never autonomously issues the denial. */
  autoDenied: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the catalog + math are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * Derive the §164.526 denial ground (if any) that applies to a request, in statutory precedence order.
 * Returns the ground id, or null when the amendment should be accepted. The single source of truth
 * both evaluateAmendment() and the tests rely on.
 */
export function deriveDenialGround(request: {
  inDesignatedRecordSet: boolean;
  coveredEntityIsOriginator: boolean;
  originatorAvailable: boolean;
  availableForAccess: boolean;
  recordAccurateAndComplete: boolean;
}): string | null {
  if (!request.inDesignatedRecordSet) return "ground.not-in-designated-record-set";
  if (!request.availableForAccess) return "ground.not-available-for-access";
  if (!request.coveredEntityIsOriginator && request.originatorAvailable) {
    return "ground.not-originator";
  }
  if (request.recordAccurateAndComplete) return "ground.accurate-and-complete";
  return null;
}

/**
 * The deterministic right-to-amend function — the heart of the service. DETERMINISTIC: a pure function
 * of the request's own fields (no randomness, no clock). It computes the §164.526 response deadline,
 * derives which denial ground (if any) applies, and decides the disposition. Nothing is amended or
 * denied here — every determination is handed to a records / privacy officer.
 */
export function evaluateAmendment(request: AmendmentRequest): AmendmentDetermination {
  const extensionInvoked = request.extensionInvoked === true;
  const responseDeadline = addDays(
    request.requestDate,
    AMENDMENT_BASE_DAYS + (extensionInvoked ? AMENDMENT_EXTENSION_DAYS : 0)
  );
  const daysUntilDeadline = daysBetween(request.asOfDate, responseDeadline);

  const groundId = deriveDenialGround(request);
  const ground = groundId ? getAmendmentDenialGround(groundId) : undefined;
  const disposition: AmendmentDisposition = groundId ? "recommend-deny" : "recommend-accept";

  const deadlinePhrase =
    daysUntilDeadline >= 0
      ? `due ${responseDeadline} (${daysUntilDeadline} day(s) remaining as of ${request.asOfDate})`
      : `OVERDUE — was due ${responseDeadline} (${Math.abs(daysUntilDeadline)} day(s) past as of ${request.asOfDate})`;

  const dispositionPhrase =
    disposition === "recommend-accept"
      ? "recommend ACCEPT the amendment — records / privacy officer to make the correction, flag the affected PHI, and notify other holders"
      : `recommend DENY on ${ground?.name ?? groundId} — records / privacy officer to issue the written denial; the patient may submit a statement of disagreement`;

  const reason = `Amendment request ${request.requestRef} (${request.requestType}) for ${request.patientRef} on ${request.recordRef}: ${deadlinePhrase}; ${dispositionPhrase}.`;

  return {
    requestRef: request.requestRef,
    patientRef: request.patientRef,
    recordRef: request.recordRef,
    requestType: request.requestType,
    requestDate: request.requestDate,
    asOfDate: request.asOfDate,
    extensionInvoked,
    responseDeadline,
    daysUntilDeadline,
    disposition,
    deniedOnGround: groundId,
    deniedOnGroundLabel: ground?.name ?? null,
    patientMayStatementOfDisagreement: disposition === "recommend-deny",
    requiresHumanReview: true,
    autoAmended: false,
    autoDenied: false,
    reason,
    synthetic: true,
    note:
      `Right-to-amend request ${request.requestRef}: response ${deadlinePhrase}; disposition ${disposition}${groundId ? ` (${groundId})` : ""}. ` +
      "PHI-bearing — the amendment decision references the patient's record. Synthetic/illustrative denial-ground catalog + 60/90-day math — NOT a certified HIM system; real amendment is governed by HIPAA §164.526 (the full denial grounds, the written-denial + statement-of-disagreement + rebuttal process, and the duty to notify other holders of an accepted amendment) and the covered entity's Notice of Privacy Practices. The agent never amends the record or issues a denial on its own — a records / privacy officer acts on or reviews every determination."
  };
}

/**
 * Ground-sourced check: does a denial cite a ground that resolves in the recorded catalog? True when
 * the disposition is recommend-accept (no ground, nothing to source) or the cited ground is cataloged;
 * the guard that catches an ad-hoc / off-catalog denial ground. Anything evaluateAmendment() produces
 * satisfies it. This is the honest signal the route reports to policy.amendment.ground-sourced. A
 * non-object input is a violation.
 */
export function amendmentGroundSourced(
  decision:
    | { disposition?: AmendmentDisposition; deniedOnGround?: string | null }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.disposition === "recommend-deny") {
    if (typeof decision.deniedOnGround !== "string") return false;
    return getAmendmentDenialGround(decision.deniedOnGround) !== undefined;
  }
  // recommend-accept (or unset): a denial ground must NOT be asserted.
  return decision.deniedOnGround === null || decision.deniedOnGround === undefined;
}

/**
 * Deadline-computed check: does the response deadline equal the request date + 60 (+ 30 when the
 * extension is invoked)? True unless the stated deadline or the days-until disagree with the
 * recomputation from the determination's own fields; the guard that catches a guessed / mis-stated
 * deadline. Anything evaluateAmendment() produces satisfies it. This is the honest signal the route
 * reports to policy.amendment.deadline-computed. A non-object / malformed input is a violation.
 */
export function amendmentDeadlineComputed(
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
    AMENDMENT_BASE_DAYS + (decision.extensionInvoked === true ? AMENDMENT_EXTENSION_DAYS : 0)
  );
  if (decision.responseDeadline !== expectedDeadline) return false;
  if (typeof decision.daysUntilDeadline === "number") {
    if (decision.daysUntilDeadline !== daysBetween(asOfDate, expectedDeadline)) return false;
  }
  return true;
}

/**
 * No-autonomous-write-or-denial check: did the agent avoid autonomously amending the record or denying
 * the request? True unless the determination reports it autonomously amended the record
 * (autoAmended:true), denied the request (autoDenied:true), or does not require human review
 * (requiresHumanReview:false); the guard that catches an autonomous amendment / denial. Anything
 * evaluateAmendment() produces satisfies it. This is the honest signal the route reports to
 * policy.amendment.no-autonomous-write-or-denial. A non-object input is a violation.
 */
export function amendmentNoAutonomousWrite(
  decision:
    | { autoAmended?: boolean; autoDenied?: boolean; requiresHumanReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoAmended === true) return false;
  if (decision.autoDenied === true) return false;
  if (decision.requiresHumanReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric trace +
 * the response `meta`.
 */
export function amendmentSummary(decision: AmendmentDetermination): {
  requestRef: string;
  patientRef: string;
  requestType: AmendmentRequestType;
  responseDeadline: string;
  daysUntilDeadline: number;
  disposition: AmendmentDisposition;
  deniedOnGround: string | null;
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
    deniedOnGround: decision.deniedOnGround,
    requiresHumanReview: decision.requiresHumanReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a patient asks to correct a clinical note the CE authored, in the
 * designated record set, that is not accurate/complete → recommend accept, due in 60 days. Synthetic.
 */
export const DEMO_AMENDMENT_REQUEST: AmendmentRequest = {
  requestRef: "amend-001",
  patientRef: "patient-8842",
  recordRef: "note-55210",
  requestType: "correct-clinical",
  requestDate: "2026-08-15",
  asOfDate: "2026-09-07",
  inDesignatedRecordSet: true,
  coveredEntityIsOriginator: true,
  originatorAvailable: true,
  availableForAccess: true,
  recordAccurateAndComplete: false
};

/**
 * A representative demo request: the record the CE holds is already accurate and complete → recommend
 * deny (accurate-and-complete), patient may submit a statement of disagreement. Synthetic.
 */
export const DEMO_AMENDMENT_ACCURATE_REQUEST: AmendmentRequest = {
  requestRef: "amend-002",
  patientRef: "patient-7310",
  recordRef: "note-61120",
  requestType: "correct-clinical",
  requestDate: "2026-08-20",
  asOfDate: "2026-09-07",
  inDesignatedRecordSet: true,
  coveredEntityIsOriginator: true,
  originatorAvailable: true,
  availableForAccess: true,
  recordAccurateAndComplete: true
};

/**
 * A representative demo request: the PHI was authored by another provider who is still available →
 * recommend deny (not-originator) with a referral. Synthetic.
 */
export const DEMO_AMENDMENT_NOT_ORIGINATOR_REQUEST: AmendmentRequest = {
  requestRef: "amend-003",
  patientRef: "patient-5521",
  recordRef: "note-70440",
  requestType: "correct-clinical",
  requestDate: "2026-07-25",
  asOfDate: "2026-09-07",
  inDesignatedRecordSet: true,
  coveredEntityIsOriginator: false,
  originatorAvailable: true,
  availableForAccess: true,
  recordAccurateAndComplete: false
};

/**
 * A representative demo request: a complex request with the single 30-day extension invoked → recommend
 * accept, due in 90 days. Synthetic.
 */
export const DEMO_AMENDMENT_EXTENSION_REQUEST: AmendmentRequest = {
  requestRef: "amend-004",
  patientRef: "patient-9017",
  recordRef: "note-88990",
  requestType: "correct-demographic",
  requestDate: "2026-08-15",
  asOfDate: "2026-09-07",
  inDesignatedRecordSet: true,
  coveredEntityIsOriginator: true,
  originatorAvailable: true,
  availableForAccess: true,
  recordAccurateAndComplete: false,
  extensionInvoked: true
};
