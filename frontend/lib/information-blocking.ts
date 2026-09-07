/**
 * Information Blocking (21st Century Cures Act / ONC, 45 CFR Part 171) — the deterministic,
 * transparent layer that adjudicates whether an actor's PRACTICE that interfered with the access,
 * exchange, or use of electronic health information (EHI) is INFORMATION BLOCKING, or fits one of the
 * eight recorded regulatory EXCEPTIONS. Where the HIPAA patient-rights trilogy (Right of Access
 * §164.524, Amendment §164.526, Accounting of Disclosures §164.528) gives a patient the RIGHT to get /
 * fix / audit their record, the Cures Act's information-blocking rule is the ENFORCEMENT FLIP-SIDE: it
 * prohibits a provider, health-IT developer, or HIE/HIN from INTERFERING with EHI access — unless the
 * practice satisfies ALL the required CONDITIONS of a recorded exception. This agent never
 * autonomously WITHHOLDS EHI (which could itself be information blocking, or harm the patient) or
 * force-RELEASES it (which could breach privacy); a compliance officer confirms every determination.
 *
 * Deterministic, dependency-free domain core the Information Blocking Agent
 * (app/api/agents/information-blocking) wraps — a control-plane / data-substrate compliance service on
 * the platform plane of Pause's Agent Fabric. UNLIKE the recent agents, there is NO date math and NO
 * dollar waterfall here: the heart of the service is a CONDITIONS-SATISFACTION classifier. Given a
 * practice review (an actor reference + type, the EHI request type, whether the practice actually
 * interfered with access / exchange / use, an optional claimed exception, and the set of exception
 * CONDITIONS the actor asserts are satisfied), it DETERMINISTICALLY checks the claimed exception
 * against the recorded catalog and verifies that EVERY required condition is met, then decides the
 * disposition.
 *
 *   Inbound:  an InformationBlockingRequest { requestRef, actorRef, actorType, ehiRequestType,
 *             practiceDescription, interferedWithAccess, claimedExceptionId?, conditionsMet }
 *   Outbound: an InformationBlockingDetermination { actorRef, ehiRequestType, interferedWithAccess,
 *             claimedExceptionId, claimedExceptionName, exceptionCategory, requiredConditions,
 *             missingConditions, exceptionSatisfied, disposition, requiresComplianceReview:true,
 *             autoBlockedEhi:false, autoReleasedEhi:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every claimed exception traces to the recorded catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  A practice escapes the information-blocking rule only on a recorded 45 CFR Part 171 exception — a
 *  claimed exception must resolve in the recorded catalog; an ad-hoc / off-catalog exception is not a
 *  lawful basis to interfere with EHI. blockingExceptionSourced() reports the honest signal the Agent
 *  Fabric enforces via policy.information-blocking.exception-sourced. (Mirrors the Right of Access
 *  Agent's ground-sourced and the Amendment Agent's ground-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: an exception is never reported as met unless every condition is.
 * ─────────────────────────────────────────────────────────────────────
 *  Each 45 CFR Part 171 exception has REQUIRED CONDITIONS that must ALL be satisfied — reporting an
 *  exception as "met" when a condition is missing is how an actor dresses up unlawful interference as a
 *  compliant practice. blockingDeterminationNotOverstated() recomputes, from the claimed exception +
 *  the asserted conditions, whether every required condition is satisfied and verifies the reported
 *  exceptionSatisfied / missingConditions match; it reports the honest signal the Agent Fabric enforces
 *  via policy.information-blocking.determination-not-overstated. (The load-bearing correctness gate —
 *  mirrors the OIG Exclusion Agent's match-not-overstated and the Member Cost-Share Agent's
 *  math-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: EHI is never autonomously withheld or released.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent ADJUDICATES — it never WITHHOLDS EHI (autoBlockedEhi — which could itself be information
 *  blocking, or delay urgent care) or force-RELEASES EHI (autoReleasedEhi — which could breach
 *  privacy) on its own; every determination is a RECOMMENDATION requiring a compliance officer to
 *  confirm and act. blockingNoAutonomousBlockOrRelease() reports the honest signal the Agent Fabric
 *  enforces via policy.information-blocking.no-autonomous-block-or-release. (Mirrors the OIG Exclusion
 *  Agent's no-autonomous-block-or-clear and the Right of Access Agent's no-autonomous-denial-or-release
 *  posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — exception-met, no-interference, OR potential-blocking-needs-review — is a SAFE,
 *  honest OUTPUT: the task COMPLETES (it carries requiresComplianceReview:true, autoBlockedEhi:false,
 *  autoReleasedEhi:false). A GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (an
 *  off-catalog claimed exception, an overstated exception that skipped a required condition, or an
 *  autonomously-blocked / -released / unreviewed determination) — which the Agent Fabric rejects
 *  before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT certified information-blocking compliance counsel.
 * ─────────────────────────────────────────────────────────────────────
 *  The exception catalog + the condition sets below are clearly-labeled ILLUSTRATIVE synthetics chosen
 *  to model the SHAPE of a 45 CFR Part 171 exception analysis deterministically in the demo — they are
 *  NOT a complete implementation. Real information-blocking analysis is governed by the 21st Century
 *  Cures Act and 45 CFR Part 171 (the full text of the eight exceptions and every sub-condition), the
 *  ONC / ASTP rules, and OIG enforcement (§171 penalties / disincentives). There is NO randomness and
 *  NO clock anywhere here: the determination is a pure function of the request's own fields, so the
 *  same practice review always yields the same exception analysis / disposition — which is what lets
 *  the demo, the seeded trace, and the tests agree.
 */

/** The two 45 CFR Part 171 exception categories. */
export type BlockingExceptionCategory = "not-fulfilling" | "procedures";

/** A recorded 45 CFR Part 171 information-blocking exception (a catalog entry). */
export type BlockingException = {
  /** Stable exception id. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Which of the two categories the exception falls under. */
  category: BlockingExceptionCategory;
  /** The CFR citation. */
  citation: string;
  /** Short description of the exception. */
  description: string;
  /** The condition ids that must ALL be satisfied for the exception to apply. */
  requiredConditions: string[];
};

/**
 * ILLUSTRATIVE, synthetic 45 CFR Part 171 exception catalog — clearly labeled, NOT the full statutory
 * set. The eight exceptions split into two categories; each carries an illustrative set of required
 * conditions that must all be satisfied for the exception to apply. A claimed exception must resolve
 * here, and an exception is "met" only when every required condition is satisfied.
 */
export const BLOCKING_EXCEPTIONS: BlockingException[] = [
  {
    id: "exception.preventing-harm",
    name: "Preventing Harm",
    category: "not-fulfilling",
    citation: "45 CFR 171.201",
    description:
      "A practice reasonably necessary to prevent harm to a patient or another person, where the actor holds a reasonable belief the practice will substantially reduce a risk of harm.",
    requiredConditions: ["reasonable-belief-of-harm", "practice-tailored-to-harm", "risk-is-substantial"]
  },
  {
    id: "exception.privacy",
    name: "Privacy",
    category: "not-fulfilling",
    citation: "45 CFR 171.202",
    description:
      "A practice that protects an individual's privacy — e.g. a precondition required by law was not satisfied, honoring an individual's request not to share EHI — with no improper intent.",
    requiredConditions: ["privacy-precondition-unmet", "no-improper-intent"]
  },
  {
    id: "exception.security",
    name: "Security",
    category: "not-fulfilling",
    citation: "45 CFR 171.203",
    description:
      "A practice directly related to safeguarding the confidentiality, integrity, and availability of EHI, that is tailored to the security risk and implemented in a consistent, non-discriminatory manner.",
    requiredConditions: ["directly-related-to-security", "practice-tailored-to-risk", "non-discriminatory"]
  },
  {
    id: "exception.infeasibility",
    name: "Infeasibility",
    category: "not-fulfilling",
    citation: "45 CFR 171.204",
    description:
      "A practice where fulfilling the request is infeasible (an uncontrollable event, segmentation infeasibility, or a documented infeasibility), with a timely written response to the requestor.",
    requiredConditions: ["infeasible-under-circumstances", "responded-within-10-business-days"]
  },
  {
    id: "exception.health-it-performance",
    name: "Health IT Performance",
    category: "not-fulfilling",
    citation: "45 CFR 171.205",
    description:
      "A practice that makes health IT temporarily unavailable to maintain or improve its performance, that is necessary and no longer than necessary.",
    requiredConditions: ["necessary-to-maintain-performance", "no-longer-than-necessary"]
  },
  {
    id: "exception.content-and-manner",
    name: "Content and Manner",
    category: "procedures",
    citation: "45 CFR 171.301",
    description:
      "A practice that fulfills a request in an alternative content or manner permitted by the exception, without an improper restriction on the EHI provided.",
    requiredConditions: ["fulfilled-in-permitted-manner", "no-improper-restriction"]
  },
  {
    id: "exception.fees",
    name: "Fees",
    category: "procedures",
    citation: "45 CFR 171.302",
    description:
      "A practice of charging fees for accessing / exchanging / using EHI, where the fees are based on objective, uniformly-applied criteria and not anti-competitive.",
    requiredConditions: ["fee-uniformly-applied", "not-anti-competitive"]
  },
  {
    id: "exception.licensing",
    name: "Licensing",
    category: "procedures",
    citation: "45 CFR 171.303",
    description:
      "A practice of licensing interoperability elements on reasonable and non-discriminatory terms, negotiated in good faith within the required timeframe.",
    requiredConditions: ["negotiated-in-good-faith", "terms-non-discriminatory"]
  }
];

/** Look up an exception by id (undefined when off-catalog). */
export function getBlockingException(id: string): BlockingException | undefined {
  return BLOCKING_EXCEPTIONS.find((e) => e.id === id);
}

/** The kind of actor whose practice is under review. */
export type BlockingActorType = "provider" | "health-it-developer" | "hie-hin";

/** How the EHI was requested. */
export type EhiRequestType = "access" | "exchange" | "use";

/** A practice review submitted to the agent. */
export type InformationBlockingRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic actor reference (the entity whose practice is reviewed). */
  actorRef: string;
  /** The kind of actor. */
  actorType: BlockingActorType;
  /** How the EHI was requested. */
  ehiRequestType: EhiRequestType;
  /** A short, synthetic description of the practice. */
  practiceDescription: string;
  /** Whether the practice actually interfered with EHI access / exchange / use. */
  interferedWithAccess: boolean;
  /** Optional claimed exception id (must resolve in the catalog to apply). */
  claimedExceptionId?: string;
  /** The condition ids the actor asserts are satisfied. */
  conditionsMet: string[];
};

/** How the practice review is dispositioned. */
export type BlockingDisposition =
  | "not-information-blocking-no-interference"
  | "not-information-blocking-exception-met"
  | "potential-information-blocking-needs-review";

/** The deterministic information-blocking determination the agent returns. */
export type InformationBlockingDetermination = {
  requestRef: string;
  actorRef: string;
  actorType: BlockingActorType;
  ehiRequestType: EhiRequestType;
  /** Whether the practice interfered with access / exchange / use. */
  interferedWithAccess: boolean;
  /** The claimed exception id (empty string when none claimed). */
  claimedExceptionId: string;
  /** The claimed exception's name (null when none / off-catalog). */
  claimedExceptionName: string | null;
  /** The claimed exception's category (or "none" / "unknown"). */
  exceptionCategory: BlockingExceptionCategory | "none" | "unknown";
  /** The conditions the claimed exception requires (empty when none / off-catalog). */
  requiredConditions: string[];
  /** The required conditions the actor did NOT assert as satisfied. */
  missingConditions: string[];
  /** Whether the exception is satisfied (cataloged AND every required condition met). */
  exceptionSatisfied: boolean;
  /** The disposition. */
  disposition: BlockingDisposition;
  /** Always true — every determination is confirmed / reviewed by a compliance officer. */
  requiresComplianceReview: true;
  /** Always false — the agent never autonomously withholds EHI. */
  autoBlockedEhi: false;
  /** Always false — the agent never autonomously force-releases EHI. */
  autoReleasedEhi: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the catalog + conditions are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * Compute the required conditions an actor has NOT asserted as satisfied for a given exception.
 * Returns [] when the exception is off-catalog (nothing to require) — the off-catalog case is caught
 * by the exception-sourced guard. The single source of truth both evaluateInformationBlocking() and
 * the not-overstated guard rely on.
 */
export function missingConditionsFor(
  claimedExceptionId: string,
  conditionsMet: string[]
): string[] {
  const exception = getBlockingException(claimedExceptionId);
  if (!exception) return [];
  const met = new Set(conditionsMet);
  return exception.requiredConditions.filter((c) => !met.has(c));
}

/**
 * The deterministic information-blocking function — the heart of the service. DETERMINISTIC: a pure
 * function of the request's own fields (no randomness, no clock). It checks the claimed exception
 * against the catalog, verifies every required condition is satisfied, and decides the disposition.
 * Nothing is withheld or released here — every determination is handed to a compliance officer.
 */
export function evaluateInformationBlocking(
  request: InformationBlockingRequest
): InformationBlockingDetermination {
  const claimedExceptionId =
    typeof request.claimedExceptionId === "string" ? request.claimedExceptionId : "";
  const exception = claimedExceptionId ? getBlockingException(claimedExceptionId) : undefined;
  const exceptionCategory: BlockingExceptionCategory | "none" | "unknown" = !claimedExceptionId
    ? "none"
    : (exception?.category ?? "unknown");
  const requiredConditions = exception ? exception.requiredConditions : [];
  const missingConditions = exception
    ? missingConditionsFor(claimedExceptionId, request.conditionsMet)
    : [];

  let disposition: BlockingDisposition;
  let exceptionSatisfied: boolean;
  if (!request.interferedWithAccess) {
    // No interference → the information-blocking rule is not implicated at all.
    disposition = "not-information-blocking-no-interference";
    exceptionSatisfied = false;
  } else if (exception && missingConditions.length === 0) {
    // Interference, but a cataloged exception with every required condition satisfied.
    disposition = "not-information-blocking-exception-met";
    exceptionSatisfied = true;
  } else {
    // Interference with no exception, an off-catalog exception, or missing conditions → review.
    disposition = "potential-information-blocking-needs-review";
    exceptionSatisfied = false;
  }

  const dispositionPhrase =
    disposition === "not-information-blocking-no-interference"
      ? "no interference with EHI access / exchange / use — the information-blocking rule is not implicated"
      : disposition === "not-information-blocking-exception-met"
        ? `interference is covered by the ${exception?.name ?? claimedExceptionId} exception (${exception?.citation ?? ""}) — every required condition is satisfied; compliance officer to confirm`
        : claimedExceptionId
          ? `potential information blocking — the ${exception?.name ?? claimedExceptionId} exception is NOT fully satisfied (${missingConditions.length > 0 ? `missing: ${missingConditions.join(", ")}` : "off-catalog exception"}); compliance officer to review`
          : "potential information blocking — the practice interfered with EHI access and no exception was claimed; compliance officer to review";

  const reason = `Information-blocking review ${request.requestRef} (${request.actorType} · ${request.ehiRequestType}) for ${request.actorRef}: ${dispositionPhrase}.`;

  return {
    requestRef: request.requestRef,
    actorRef: request.actorRef,
    actorType: request.actorType,
    ehiRequestType: request.ehiRequestType,
    interferedWithAccess: request.interferedWithAccess,
    claimedExceptionId,
    claimedExceptionName: exception?.name ?? null,
    exceptionCategory,
    requiredConditions,
    missingConditions,
    exceptionSatisfied,
    disposition,
    requiresComplianceReview: true,
    autoBlockedEhi: false,
    autoReleasedEhi: false,
    reason,
    synthetic: true,
    note:
      `Information-blocking review ${request.requestRef}: ${dispositionPhrase}. ` +
      "EHI-bearing — the review references a request for the patient's electronic health information. Synthetic/illustrative exception catalog + condition sets — NOT certified information-blocking compliance counsel; real analysis is governed by the 21st Century Cures Act and 45 CFR Part 171 (the full text of the eight exceptions and every sub-condition), the ONC / ASTP rules, and OIG enforcement. The agent never withholds or releases EHI on its own — a compliance officer confirms and acts on every determination."
  };
}

/**
 * Exception-sourced check: if an exception is claimed, does it resolve in the recorded catalog? True
 * when no exception is claimed (or the interference is uninvolved) and the exception is cataloged; the
 * guard that catches an ad-hoc / off-catalog exception. Anything evaluateInformationBlocking() produces
 * from a cataloged (or absent) exception satisfies it. This is the honest signal the route reports to
 * policy.information-blocking.exception-sourced. A non-object input, or an "unknown" category, is a
 * violation.
 */
export function blockingExceptionSourced(
  decision:
    | {
        claimedExceptionId?: string;
        exceptionCategory?: BlockingExceptionCategory | "none" | "unknown";
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const id = typeof decision.claimedExceptionId === "string" ? decision.claimedExceptionId : "";
  if (!id) return true; // no exception claimed → nothing to source
  if (decision.exceptionCategory === "unknown") return false;
  return getBlockingException(id) !== undefined;
}

/**
 * Determination-not-overstated check: is the reported exceptionSatisfied / missingConditions consistent
 * with a fresh recomputation from the claimed exception + the asserted conditions? True unless the
 * determination reports an exception as met (or under-reports missing conditions) when a required
 * condition is missing; the guard that catches an OVERSTATED exception dressed up as compliant.
 * Anything evaluateInformationBlocking() produces satisfies it. This is the honest signal the route
 * reports to policy.information-blocking.determination-not-overstated — the load-bearing correctness
 * gate. A non-object / malformed input is a violation.
 */
export function blockingDeterminationNotOverstated(
  decision:
    | {
        claimedExceptionId?: string;
        interferedWithAccess?: boolean;
        missingConditions?: string[];
        exceptionSatisfied?: boolean;
      }
    | null
    | undefined,
  requestContext?: { conditionsMet?: string[] }
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const id = typeof decision.claimedExceptionId === "string" ? decision.claimedExceptionId : "";
  const exception = id ? getBlockingException(id) : undefined;

  // If no interference, or no cataloged exception, an exception can never be "satisfied".
  if (decision.interferedWithAccess === false || !exception) {
    return decision.exceptionSatisfied !== true;
  }

  // Recompute the missing conditions from the asserted set. Prefer the determination's own
  // missingConditions when present (self-contained); otherwise use the request context.
  const conditionsMet = requestContext?.conditionsMet;
  const recomputedMissing = Array.isArray(conditionsMet)
    ? missingConditionsFor(id, conditionsMet)
    : Array.isArray(decision.missingConditions)
      ? decision.missingConditions
      : undefined;
  if (recomputedMissing === undefined) return false;

  const expectedSatisfied = recomputedMissing.length === 0;
  if (decision.exceptionSatisfied !== expectedSatisfied) return false;

  // When we have the actual asserted conditions, the reported missing set must match exactly.
  if (Array.isArray(conditionsMet) && Array.isArray(decision.missingConditions)) {
    const reported = new Set(decision.missingConditions);
    if (reported.size !== recomputedMissing.length) return false;
    for (const c of recomputedMissing) {
      if (!reported.has(c)) return false;
    }
  }
  return true;
}

/**
 * No-autonomous-block-or-release check: did the agent avoid autonomously withholding or force-releasing
 * EHI? True unless the determination reports it autonomously withheld EHI (autoBlockedEhi:true),
 * force-released EHI (autoReleasedEhi:true), or does not require compliance review
 * (requiresComplianceReview:false); the guard that catches an autonomous block / release. Anything
 * evaluateInformationBlocking() produces satisfies it. This is the honest signal the route reports to
 * policy.information-blocking.no-autonomous-block-or-release. A non-object input is a violation.
 */
export function blockingNoAutonomousBlockOrRelease(
  decision:
    | { autoBlockedEhi?: boolean; autoReleasedEhi?: boolean; requiresComplianceReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoBlockedEhi === true) return false;
  if (decision.autoReleasedEhi === true) return false;
  if (decision.requiresComplianceReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric trace +
 * the response `meta`.
 */
export function informationBlockingSummary(decision: InformationBlockingDetermination): {
  requestRef: string;
  actorRef: string;
  ehiRequestType: EhiRequestType;
  claimedExceptionId: string;
  exceptionSatisfied: boolean;
  disposition: BlockingDisposition;
  requiresComplianceReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: decision.requestRef,
    actorRef: decision.actorRef,
    ehiRequestType: decision.ehiRequestType,
    claimedExceptionId: decision.claimedExceptionId,
    exceptionSatisfied: decision.exceptionSatisfied,
    disposition: decision.disposition,
    requiresComplianceReview: decision.requiresComplianceReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a provider declined to share EHI because a legally-required
 * precondition was not met, with no improper intent → the Privacy exception is fully satisfied →
 * not information blocking. Synthetic.
 */
export const DEMO_INFORMATION_BLOCKING_REQUEST: InformationBlockingRequest = {
  requestRef: "ib-001",
  actorRef: "provider-2201",
  actorType: "provider",
  ehiRequestType: "access",
  practiceDescription:
    "Declined to release EHI to a third party until a state-law consent precondition was satisfied.",
  interferedWithAccess: true,
  claimedExceptionId: "exception.privacy",
  conditionsMet: ["privacy-precondition-unmet", "no-improper-intent"]
};

/**
 * A representative demo request: the actor fulfilled the request normally → no interference → the
 * information-blocking rule is not implicated. Synthetic.
 */
export const DEMO_INFORMATION_BLOCKING_NO_INTERFERENCE_REQUEST: InformationBlockingRequest = {
  requestRef: "ib-002",
  actorRef: "provider-3390",
  actorType: "provider",
  ehiRequestType: "exchange",
  practiceDescription: "Fulfilled the EHI exchange request in the standard manner and timeframe.",
  interferedWithAccess: false,
  conditionsMet: []
};

/**
 * A representative demo request: a health-IT developer claims Infeasibility, but did not respond to the
 * requestor within the required window → a required condition is missing → potential information
 * blocking, needs review. Synthetic.
 */
export const DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST: InformationBlockingRequest = {
  requestRef: "ib-003",
  actorRef: "vendor-7788",
  actorType: "health-it-developer",
  ehiRequestType: "use",
  practiceDescription:
    "Declined an API export citing infeasibility, but did not issue a timely written response.",
  interferedWithAccess: true,
  claimedExceptionId: "exception.infeasibility",
  conditionsMet: ["infeasible-under-circumstances"]
};

/**
 * A representative demo request: interference with no exception claimed at all → potential information
 * blocking, needs review. Synthetic.
 */
export const DEMO_INFORMATION_BLOCKING_NO_EXCEPTION_REQUEST: InformationBlockingRequest = {
  requestRef: "ib-004",
  actorRef: "hie-5150",
  actorType: "hie-hin",
  ehiRequestType: "exchange",
  practiceDescription:
    "Delayed an inter-network EHI exchange with no documented reason or claimed exception.",
  interferedWithAccess: true,
  conditionsMet: []
};
