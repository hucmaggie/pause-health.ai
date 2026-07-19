/**
 * Grievance & Appeals — deterministic case classification, human-queue
 * routing, and regulatory-deadline enforcement for member complaints and
 * coverage denials.
 *
 * Deterministic, dependency-free domain core the Grievance & Appeals Agent
 * (app/api/agents/grievance-appeals) wraps — the Salesforce "Agentforce for
 * Health" / Health Cloud grievance-and-appeals analog on Pause's Agent
 * Fabric. Payers and provider organizations owe a governed grievance-and-
 * appeals process by regulation (Medicare Advantage Chapter 13, state
 * insurance codes, ERISA/ACA appeal requirements): a member complaint or
 * coverage-denial appeal must be classified, routed to the right human
 * queue (member services / clinical review / compliance), and CLOSED within
 * a regulatory deadline. This agent runs the intake half of that process —
 * classification + routing + deadline stamping — and NEVER resolves a case
 * on its own.
 *
 *   Inbound:  MemberCaseIntake (a synthetic memberRef — clearly labeled
 *             illustrative — the case text, whether it involves a coverage
 *             denial, whether the member has requested expedited handling
 *             for an urgent clinical need, and a receivedDate accepted as
 *             data)
 *   Outbound: GrievanceAppealCase { caseId, caseType, urgency, queue,
 *             deadlineDate, phiSafeRoutingSummary, synthetic:true, note }
 *             and a routing-only proposeCaseResolution() gated on human
 *             sign-off (never applied autonomously)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: no autonomous resolution.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent may only DRAFT a case and route it to a human queue — it may
 *  NEVER resolve, approve, or deny a case on its own. Every
 *  proposeCaseResolution() output is requiresHumanQueueAction:true /
 *  applied:false; a caller-asserted plan that claims already-resolved or
 *  bypasses the queue is a violation. Denial-appeals in particular need a
 *  clinician-plus-compliance human review, so the agent's role is intake-
 *  only. Mirrors the Prior Authorization Agent's no-autonomous-submission,
 *  the ACP Agent's no-autonomous-directive-change, the Care Team Agent's
 *  no-autonomous-assignment, and the HEDIS Agent's no-autonomous-submission
 *  posture. caseResolutionRequiresHumanQueue() reports the honest signal
 *  the Agent Fabric enforces via policy.grievance.no-autonomous-resolution.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: deadline integrity.
 * ─────────────────────────────────────────────────────────────────────
 *  Every case must have a regulatory deadline that traces to the CASE-TYPE
 *  catalog + the received date — a caller-asserted deadline exceeding the
 *  regulatory maximum (or missing a case-type) is a violation. This is the
 *  load-bearing regulatory-compliance property: silently extending a
 *  regulatory deadline past the maximum is a common ways cases quietly
 *  breach Chapter 13 / state-insurance-code timelines.
 *  deadlineTracesToCatalog() reports the honest signal the Agent Fabric
 *  enforces via policy.grievance.deadline-integrity.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no PHI in the routing summary.
 * ─────────────────────────────────────────────────────────────────────
 *  The PHI-safe routing summary passed to the receiving human queue must
 *  NOT include free-text PHI (patient full name, DOB, address, MRN, ICD-10
 *  codes, medication names, symptom detail) — only the structured case-
 *  type + urgency + queue + deadline + memberRef. A caller-asserted
 *  routing summary containing free-text PHI is a violation.
 *  routingSummaryIsPhiSafe() reports the honest signal the Agent Fabric
 *  enforces via policy.grievance.no-phi-in-routing-summary. This lets
 *  compliance / member-services queues be reached via lower-trust
 *  channels (Slack, email, ticketing) without leaking PHI.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified grievance-and-appeals system.
 * ─────────────────────────────────────────────────────────────────────
 *  The case-type catalog, deadline windows, queue mapping, and expedited-
 *  eligibility rule below are ILLUSTRATIVE synthetic/demo values chosen to
 *  model the SHAPE of a governed grievance-and-appeals intake — they are
 *  NOT Medicare Advantage Chapter 13, a certified state-insurance-code
 *  process, or a real appeal-adjudication engine. The memberRefs and
 *  caseIds are synthetic / de-identified. There is NO randomness and NO
 *  clock anywhere here: the classification is a pure function of the
 *  intake text + received date (accepted as data), so the same context
 *  always yields the same case type / urgency / queue / deadline / summary
 *  — which is what lets the demo, the seeded trace, and the tests agree.
 */

/** The (illustrative) case-type catalog id. */
export type CaseTypeId =
  | "case.grievance-quality-of-service"
  | "case.grievance-billing-dispute"
  | "case.appeal-coverage-denial"
  | "case.appeal-expedited-coverage-denial";

/** The (illustrative) case-urgency levels. */
export type CaseUrgency = "expedited" | "standard";

/** The (illustrative) human queue a case routes to. */
export type CaseQueue = "member-services" | "clinical-review" | "compliance";

/**
 * A single case-type in the (illustrative) grievance-and-appeals catalog.
 * Every case exposes its default urgency, its target human queue, and its
 * regulatory deadline window in DAYS (illustrative, not certified).
 */
export type CaseTypeSpec = {
  id: CaseTypeId;
  label: string;
  /** Whether the case is a grievance (quality complaint) or a coverage appeal. */
  kind: "grievance" | "appeal";
  /** Default urgency (expedited when the case is expedited-eligible). */
  defaultUrgency: CaseUrgency;
  /** Target human queue. */
  queue: CaseQueue;
  /**
   * Illustrative regulatory deadline in days from receivedDate. NOT a
   * certified deadline — 72h for expedited coverage-denial appeals, 30d for
   * standard coverage-denial appeals, 30d for grievances is the SHAPE of
   * regulation.
   */
  deadlineDays: number;
  /**
   * Regulatory MAXIMUM deadline in days — a caller may not extend the
   * deadline past this without violating deadline integrity.
   */
  maxDeadlineDays: number;
  /** Always true — the catalog + windows are illustrative synthetics. */
  synthetic: true;
};

/** The illustrative case-type catalog. NOT a certified regulatory schema. */
export const CASE_TYPES: CaseTypeSpec[] = [
  {
    id: "case.grievance-quality-of-service",
    label: "Grievance — quality of service",
    kind: "grievance",
    defaultUrgency: "standard",
    queue: "member-services",
    deadlineDays: 30,
    maxDeadlineDays: 30,
    synthetic: true
  },
  {
    id: "case.grievance-billing-dispute",
    label: "Grievance — billing dispute",
    kind: "grievance",
    defaultUrgency: "standard",
    queue: "member-services",
    deadlineDays: 30,
    maxDeadlineDays: 30,
    synthetic: true
  },
  {
    id: "case.appeal-coverage-denial",
    label: "Appeal — coverage denial (standard)",
    kind: "appeal",
    defaultUrgency: "standard",
    queue: "clinical-review",
    deadlineDays: 30,
    maxDeadlineDays: 30,
    synthetic: true
  },
  {
    id: "case.appeal-expedited-coverage-denial",
    label: "Appeal — coverage denial (expedited)",
    kind: "appeal",
    defaultUrgency: "expedited",
    queue: "clinical-review",
    deadlineDays: 3,
    maxDeadlineDays: 3,
    synthetic: true
  }
];

const CASE_TYPE_BY_ID = new Map<string, CaseTypeSpec>(
  CASE_TYPES.map((c) => [c.id, c])
);

/** Is `id` a defined case-type catalog id? */
export function isCaseType(id: unknown): boolean {
  return typeof id === "string" && CASE_TYPE_BY_ID.has(id);
}

/** Look up a case-type by id (undefined for an off-catalog id). */
export function getCaseType(id: string): CaseTypeSpec | undefined {
  return CASE_TYPE_BY_ID.get(id);
}

/**
 * Illustrative keyword sets used to classify a case from the free-text
 * complaint. Deliberately small and rule-based — NOT a certified taxonomy.
 */
const BILLING_KEYWORDS = [
  "billing",
  "bill",
  "invoice",
  "charge",
  "copay",
  "co-pay",
  "cost",
  "claim",
  "eob"
];
const DENIAL_KEYWORDS = [
  "denied",
  "denial",
  "not covered",
  "coverage",
  "authorized",
  "authorization"
];
const EXPEDITED_CLINICAL_KEYWORDS = [
  "urgent",
  "emergency",
  "cannot wait",
  "life-threatening",
  "worsening",
  "harm"
];

/**
 * The structured intake the classifier reads. `memberRef` is a synthetic,
 * de-identified id — clearly labeled illustrative. The complaint text is
 * free-form, but the classifier only reads its LOWERCASED keyword set — it
 * never emits the free-text back out (see routing-summary property 3).
 */
export type MemberCaseIntake = {
  memberRef: string;
  /** Free-text complaint (client-provided; classifier only reads keywords). */
  complaintText: string;
  /**
   * Whether the case involves a coverage denial (from a linked claim / auth).
   * When true, the case is an APPEAL (not a grievance); false / unset falls
   * to the keyword-classifier for the grievance / billing / denial split.
   */
  involvesCoverageDenial?: boolean;
  /**
   * Whether the member has requested EXPEDITED handling for an urgent
   * clinical need. Combined with a coverage-denial case, this triggers the
   * expedited-coverage-denial case type (72-hour window).
   */
  memberRequestedExpedited?: boolean;
  /** ISO received date accepted as data (no clock). */
  receivedDate: string;
};

/**
 * A deterministic keyword hit against a lowered complaint text. Pure /
 * documented — no regex, no locale.
 */
function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

/**
 * Classify a member's intake into a case-type id. DETERMINISTIC:
 *   1. Coverage denial + expedited request → expedited coverage-denial appeal.
 *   2. Coverage denial (no expedited) OR keyword denial → standard coverage-denial appeal.
 *   3. Billing keywords → billing-dispute grievance.
 *   4. Everything else → quality-of-service grievance.
 * A pure function of the intake (no clock, no regex, no randomness).
 */
export function classifyCase(intake: MemberCaseIntake): CaseTypeId {
  const denialByFlag = intake.involvesCoverageDenial === true;
  const denialByKeyword = containsAny(intake.complaintText, DENIAL_KEYWORDS);
  const isDenial = denialByFlag || denialByKeyword;

  const expedited =
    intake.memberRequestedExpedited === true ||
    containsAny(intake.complaintText, EXPEDITED_CLINICAL_KEYWORDS);

  if (isDenial && expedited) return "case.appeal-expedited-coverage-denial";
  if (isDenial) return "case.appeal-coverage-denial";
  if (containsAny(intake.complaintText, BILLING_KEYWORDS))
    return "case.grievance-billing-dispute";
  return "case.grievance-quality-of-service";
}

/**
 * Add days to an ISO date. Returns an ISO string. Pure — no clock. Invalid
 * inputs return the input string unchanged (safer than emitting NaN).
 */
export function addDays(iso: string, days: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * A PHI-safe routing summary. Every field is STRUCTURED (case-type id,
 * urgency, queue, deadline, member ref) — never free text drawn from the
 * complaint. This is the payload safe to hand to a downstream ticketing /
 * Slack channel; the free-text complaint stays on the case record.
 */
export type PhiSafeRoutingSummary = {
  memberRef: string;
  caseType: CaseTypeId;
  urgency: CaseUrgency;
  queue: CaseQueue;
  deadlineDate: string;
  /** Always true — this payload contains no free-text PHI. */
  phiSafe: true;
};

/** The overall grievance-and-appeal case state. */
export type CaseState = "queued-for-human-review";

/** The deterministic grievance-and-appeal case the agent returns. */
export type GrievanceAppealCase = {
  /** Illustrative synthetic case id (never a real registry id). */
  caseId: string;
  /** The synthetic member reference this case is about. */
  memberRef: string;
  /** The classified case-type id (never invented). */
  caseType: CaseTypeId;
  /** Copied from the catalog for display convenience. */
  caseTypeLabel: string;
  /** grievance / appeal. */
  kind: "grievance" | "appeal";
  /** Deterministic urgency (expedited when coverage-denial + expedited-eligible). */
  urgency: CaseUrgency;
  /** Deterministic target human queue. */
  queue: CaseQueue;
  /** ISO deadline date, receivedDate + case-type deadlineDays. */
  deadlineDate: string;
  /** The days the deadline stands from receivedDate. */
  deadlineDays: number;
  /** Overall state — ALWAYS queued for a human. */
  state: CaseState;
  /** The PHI-safe routing summary passed to the receiving queue. */
  phiSafeRoutingSummary: PhiSafeRoutingSummary;
  /** Always true — the catalog + case ids are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** A stable, illustrative case id derived from the member ref + received date. */
function stableCaseId(memberRef: string, receivedDate: string): string {
  return `case-${memberRef}-${receivedDate}`;
}

/**
 * Assemble a grievance-and-appeal case from a member intake. DETERMINISTIC:
 * classification + urgency + queue + deadline are pure functions of the
 * intake (no clock, no randomness). The routing summary emitted alongside
 * the case is PHI-safe — no free-text PHI.
 */
export function assembleGrievanceCase(
  intake: MemberCaseIntake
): GrievanceAppealCase {
  const caseTypeId = classifyCase(intake);
  const spec = getCaseType(caseTypeId)!;

  const urgency: CaseUrgency = spec.defaultUrgency;
  const queue = spec.queue;
  const deadlineDate = addDays(intake.receivedDate, spec.deadlineDays);

  const phiSafeRoutingSummary: PhiSafeRoutingSummary = {
    memberRef: intake.memberRef,
    caseType: caseTypeId,
    urgency,
    queue,
    deadlineDate,
    phiSafe: true
  };

  const note =
    `Classified member intake for ${intake.memberRef} received ${intake.receivedDate} as ${spec.label} (${urgency}); routed to ${queue}; regulatory deadline ${deadlineDate} (${spec.deadlineDays}d). ` +
    "Every case is queued for human review; the agent NEVER autonomously resolves, approves, or denies a case; the deadline traces to the case-type catalog + received date; and the routing summary handed to the queue is PHI-safe (structured only). Synthetic/illustrative catalog, windows, and queues — not a certified grievance-and-appeals system.";

  return {
    caseId: stableCaseId(intake.memberRef, intake.receivedDate),
    memberRef: intake.memberRef,
    caseType: caseTypeId,
    caseTypeLabel: spec.label,
    kind: spec.kind,
    urgency,
    queue,
    deadlineDate,
    deadlineDays: spec.deadlineDays,
    state: "queued-for-human-review",
    phiSafeRoutingSummary,
    synthetic: true,
    note
  };
}

/** The state of a resolution proposal. NEVER autonomously applied. */
export type ResolutionState = "draft" | "ready-for-human-queue";

/**
 * A resolution proposal. It is ALWAYS requiresHumanQueueAction:true /
 * applied:false — the agent never resolves a case on its own. Mirrors the
 * ACP directive-change and Care Team team-change proposal shapes.
 */
export type ResolutionProposal = {
  /** draft / ready-for-human-queue. */
  state: ResolutionState;
  /** The case this proposal is about. */
  caseId: string;
  /** The human queue that must act. */
  queue: CaseQueue;
  /** Illustrative rationale (no free-text PHI). */
  rationale: string;
  /** Always true — every resolution requires the human queue to act. */
  requiresHumanQueueAction: true;
  /** Always false — the agent NEVER autonomously resolves a case. */
  applied: false;
  /** Human-readable proposal body (no free-text PHI). */
  body: string;
};

/**
 * Propose a case resolution for the assigned human queue to action.
 * Deterministic on its input. NEVER autonomously applied.
 */
export function proposeCaseResolution(input: {
  caseId: string;
  queue: CaseQueue;
  rationale: string;
}): ResolutionProposal {
  return {
    state: "ready-for-human-queue",
    caseId: input.caseId,
    queue: input.queue,
    rationale: input.rationale,
    requiresHumanQueueAction: true,
    applied: false,
    body:
      `Resolution proposal · case ${input.caseId} · queue ${input.queue} · ${input.rationale}. ` +
      "Ready for the assigned human queue to action — the agent NEVER resolves, approves, or denies a case on its own."
  };
}

/**
 * Human-queue check: does EVERY resolution proposal require human queue
 * action and is it explicitly NOT applied? True for anything
 * proposeCaseResolution() produces (and the trivial empty-set default);
 * the guard that catches a caller-asserted plan that would autonomously
 * resolve a case. This is the honest signal the route reports to
 * policy.grievance.no-autonomous-resolution. A non-array input is a
 * violation.
 */
export function caseResolutionRequiresHumanQueue(
  proposals:
    | Array<{
        requiresHumanQueueAction?: boolean;
        applied?: boolean;
      }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(proposals)) return false;
  return proposals.every((p) => {
    if (p.requiresHumanQueueAction !== true) return false;
    if (p.applied === true) return false;
    return true;
  });
}

/**
 * Deadline-integrity check: does the case's caseType trace to the catalog,
 * and does the (deadlineDate - receivedDate) NOT exceed the catalog's
 * maxDeadlineDays? True for anything assembleGrievanceCase() produces;
 * the guard that catches a caller-asserted plan that would extend the
 * regulatory deadline past the maximum, or that names an off-catalog
 * case-type. This is the honest signal the route reports to
 * policy.grievance.deadline-integrity. A non-object input is a violation.
 */
export function deadlineTracesToCatalog(
  input:
    | {
        caseType?: string;
        receivedDate?: string;
        deadlineDate?: string;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  const spec = typeof input.caseType === "string" ? getCaseType(input.caseType) : undefined;
  if (!spec) return false;
  const r = typeof input.receivedDate === "string" ? Date.parse(input.receivedDate) : NaN;
  const d = typeof input.deadlineDate === "string" ? Date.parse(input.deadlineDate) : NaN;
  if (Number.isNaN(r) || Number.isNaN(d)) return false;
  const days = Math.floor((d - r) / (1000 * 60 * 60 * 24));
  return days >= 0 && days <= spec.maxDeadlineDays;
}

/** PHI-flag keywords the routing summary must NOT contain (illustrative). */
const PHI_FLAG_KEYWORDS = [
  "name",
  "dob",
  "date of birth",
  "address",
  "mrn",
  "diagnosis",
  "icd",
  "prescription",
  "medication",
  "hrt",
  "estradiol",
  "sertraline",
  "menopause",
  "symptom",
  "complaint"
];

/**
 * PHI-safety check: does the routing summary avoid FREE-TEXT PHI? True when
 * only the structured keys are present (memberRef, caseType, urgency,
 * queue, deadlineDate, phiSafe) and no string value contains a PHI-flag
 * keyword. This is a heuristic that models the SHAPE of a PHI-safety check
 * — it deliberately errs on the side of over-flagging (a real production
 * check would be a DLP / entity-scanner). A non-object input, or an extra
 * free-text key on the summary, is a violation. This is the honest signal
 * the route reports to policy.grievance.no-phi-in-routing-summary.
 */
export function routingSummaryIsPhiSafe(
  summary:
    | Record<string, unknown>
    | null
    | undefined
): boolean {
  if (!summary || typeof summary !== "object") return false;
  const allowed = new Set([
    "memberRef",
    "caseType",
    "urgency",
    "queue",
    "deadlineDate",
    "phiSafe"
  ]);
  for (const key of Object.keys(summary)) {
    if (!allowed.has(key)) return false;
  }
  for (const [key, value] of Object.entries(summary)) {
    if (key === "memberRef") continue; // memberRef is a synthetic id, not PHI text.
    if (typeof value !== "string") continue;
    const lower = value.toLowerCase();
    if (PHI_FLAG_KEYWORDS.some((k) => lower.includes(k))) return false;
  }
  return summary.phiSafe === true;
}

/**
 * A representative, deterministic demo intake (illustrative). A member
 * complaint about a coverage denial for a hormone-therapy prior auth, with
 * expedited handling requested — so the expedited coverage-denial happy
 * path (3-day deadline, clinical-review queue, PHI-safe routing summary) is
 * demonstrable. The complaintText intentionally contains PHI keywords the
 * agent DOES NOT pass to the routing summary — the load-bearing PHI-safety
 * property is that the case record retains the free text but the routing
 * payload does not. Synthetic / de-identified.
 */
export const DEMO_GRIEVANCE_INTAKE: MemberCaseIntake = {
  memberRef: "member-001",
  complaintText:
    "The prior auth for my HRT (estradiol patch) was denied and my menopause symptoms are worsening — I cannot wait 30 days for a resolution.",
  involvesCoverageDenial: true,
  memberRequestedExpedited: true,
  receivedDate: "2026-07-01"
};

/**
 * A representative billing-grievance demo intake (illustrative). A member
 * disputing a billing charge — so the standard grievance path (30-day
 * deadline, member-services queue) is demonstrable.
 */
export const DEMO_BILLING_INTAKE: MemberCaseIntake = {
  memberRef: "member-002",
  complaintText:
    "I received a bill for a copay I do not believe I owe on my last visit.",
  involvesCoverageDenial: false,
  memberRequestedExpedited: false,
  receivedDate: "2026-07-01"
};
