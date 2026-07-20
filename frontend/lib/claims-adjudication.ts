/**
 * Claims Adjudication Assistant — deterministic first-pass claim adjudication.
 *
 * Deterministic, dependency-free domain core the Claims Adjudication Agent
 * (app/api/agents/claims-adjudication) wraps — the Salesforce "Agentforce
 * for Health" / Health Cloud claims-adjudication analog on Pause's Agent
 * Fabric. For each submitted claim it applies payer-specific claim edits
 * from a defined edit catalog (NCCI/PTP unbundling, LCD/NCD coverage,
 * member benefits, prior-auth linkage), classifies the claim as clean-pay
 * / pend / deny with a specific reason code from the catalog, and routes
 * anything non-clean to a human adjudicator. It NEVER autonomously denies
 * a claim: every denial is drafted for adjudicator cosign.
 *
 *   Inbound:  ClaimAdjudicationRequest (a synthetic claimRef + memberRef —
 *             clearly labeled illustrative — the claim lines, the member's
 *             benefit + prior-auth flags, an asOfDate accepted as data)
 *   Outbound: ClaimAdjudicationDecision { claimRef, decision: 'clean-pay'
 *             / 'pend-clinical-review' / 'deny-drafted', appliedEdits[],
 *             reasonCode, routedTo, requiresAdjudicatorCosign,
 *             cosigned:false, synthetic:true, note } and per-claim spans.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: edits trace to the edit catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every applied claim edit must trace to the defined CLAIM_EDIT_CATALOG
 *  (NCCI-PTP unbundling, LCD coverage, NCD coverage, benefit-limit
 *  exhaustion, prior-auth missing, duplicate submission, out-of-network,
 *  timely-filing-window). A fabricated "you owe us more because we said
 *  so" edit fails. editsTraceToCatalog() reports the honest signal the
 *  Agent Fabric enforces via policy.claims.edit-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no autonomous denial.
 * ─────────────────────────────────────────────────────────────────────
 *  A denial decision is DRAFTED for adjudicator cosign — the agent NEVER
 *  autonomously finalizes a denial. Every decision the agent produces
 *  with decision:'deny-drafted' is requiresAdjudicatorCosign:true /
 *  cosigned:false; a caller-asserted plan that claims cosigned:true or
 *  bypasses the cosign gate is a violation. Denial letters are legally
 *  consequential — under CMS / ERISA / state insurance code, a denied
 *  claim gets a written notice with appeal rights (which then goes to the
 *  Grievance & Appeals agent — the intake side). Mirrors the PA Agent's
 *  no-autonomous-submission, the HEDIS Agent's no-autonomous-submission,
 *  and the ACP Agent's no-autonomous-directive-change posture.
 *  denialRequiresAdjudicatorCosign() reports the honest signal the Agent
 *  Fabric enforces via policy.claims.no-autonomous-denial.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: reason-code integrity.
 * ─────────────────────────────────────────────────────────────────────
 *  Every non-clean-pay decision must cite a specific catalog reason code
 *  with a documented rationale. A denial or pend without a stated reason
 *  code is illegal (Section 1557 / state insurance code + CMS require the
 *  member notice to state the specific reason), so this is enforced at
 *  the fabric level. decisionsCiteReasonCodes() reports the honest signal
 *  the Agent Fabric enforces via policy.claims.reason-code-integrity.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified claims adjudication engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The edit catalog, reason-code catalog, benefit rules, and CPT / DX
 *  code samples below are ILLUSTRATIVE synthetic/demo values that model
 *  the SHAPE of first-pass claims adjudication — they are NOT CMS X12 837
 *  claim spec, an NCCI PTP edit table, an LCD/NCD medical-necessity
 *  registry, or a real payer's benefit configuration. The claimRefs,
 *  memberRefs, and monetary amounts are synthetic / de-identified. There
 *  is NO randomness and NO clock anywhere here: adjudication is a pure
 *  function of the claim + benefits + edit-catalog + caller-provided
 *  asOfDate (accepted as data), so the same context always yields the
 *  same decision — which is what lets the demo, the seeded trace, and the
 *  tests agree.
 */

/**
 * A single claim edit in the illustrative catalog. Every applied edit must
 * cite one of these — the guard against fabricated edits.
 */
export type ClaimEdit = {
  /** Stable catalog id every applied edit references. */
  id: string;
  /** Human-readable label. */
  label: string;
  /**
   * The default decision tier when this edit hits: whether it's a hard-
   * denial edit, a pend-for-clinical-review edit, or a claim-line reduce
   * edit. Illustrative — real edits have per-line + per-claim variants.
   */
  defaultDecision:
    | "deny-drafted"
    | "pend-clinical-review"
    | "pend-adjudicator-review";
  /** Illustrative rationale for including this edit in the catalog. */
  rationale: string;
  /** Always true — the catalog is an illustrative synthetic. */
  synthetic: true;
};

/**
 * The illustrative claim-edit catalog. Eight edits that model the SHAPE of
 * a first-pass claims-adjudication pipeline. NOT NCCI-PTP or a real payer's
 * benefit configuration.
 */
export const CLAIM_EDIT_CATALOG: ClaimEdit[] = [
  {
    id: "edit.ncci-ptp-unbundling",
    label: "NCCI Procedure-to-Procedure unbundling",
    defaultDecision: "deny-drafted",
    rationale:
      "Two CPTs on the same claim that are mutually exclusive under NCCI Procedure-to-Procedure edits — bill the comprehensive code, not both.",
    synthetic: true
  },
  {
    id: "edit.lcd-coverage",
    label: "LCD coverage — service not covered under Local Coverage Determination",
    defaultDecision: "pend-clinical-review",
    rationale:
      "Service falls under a Local Coverage Determination requiring documented medical necessity — pend for clinical-reviewer sign-off.",
    synthetic: true
  },
  {
    id: "edit.ncd-coverage",
    label: "NCD coverage — service excluded under National Coverage Determination",
    defaultDecision: "deny-drafted",
    rationale:
      "Service is explicitly excluded under a National Coverage Determination for this patient population.",
    synthetic: true
  },
  {
    id: "edit.benefit-limit-exhausted",
    label: "Benefit limit exhausted for the year",
    defaultDecision: "deny-drafted",
    rationale:
      "The member has already used their annual/lifetime benefit limit for this service category.",
    synthetic: true
  },
  {
    id: "edit.prior-auth-missing",
    label: "Prior authorization missing",
    defaultDecision: "pend-adjudicator-review",
    rationale:
      "Service requires a prior authorization the claim did not reference — pend for adjudicator lookup or retro-authorization.",
    synthetic: true
  },
  {
    id: "edit.duplicate-submission",
    label: "Duplicate submission",
    defaultDecision: "deny-drafted",
    rationale:
      "The same claim (same member, same date-of-service, same CPT) was already submitted and paid.",
    synthetic: true
  },
  {
    id: "edit.out-of-network",
    label: "Provider out-of-network",
    defaultDecision: "pend-adjudicator-review",
    rationale:
      "Servicing provider is out-of-network; pend for benefit-check against the OON policy and any single-case agreement.",
    synthetic: true
  },
  {
    id: "edit.timely-filing-window",
    label: "Claim filed outside the timely-filing window",
    defaultDecision: "deny-drafted",
    rationale:
      "Claim was filed after the payer's timely-filing window (illustrative: 90 days from date-of-service).",
    synthetic: true
  }
];

const CLAIM_EDIT_BY_ID = new Map<string, ClaimEdit>(
  CLAIM_EDIT_CATALOG.map((e) => [e.id, e])
);

/** Is `id` a defined claim-edit catalog id? */
export function isClaimEdit(id: unknown): boolean {
  return typeof id === "string" && CLAIM_EDIT_BY_ID.has(id);
}

/** Look up a claim edit by id (undefined for an off-catalog id). */
export function getClaimEdit(id: string): ClaimEdit | undefined {
  return CLAIM_EDIT_BY_ID.get(id);
}

/**
 * The illustrative reason-code catalog. Every non-clean-pay decision must
 * cite one of these. Reason codes are the load-bearing regulatory artifact
 * (Section 1557 + CMS require member notices to state the specific reason).
 */
export type ClaimReasonCode = {
  /** Stable code id (illustrative — not a real X12 CARC / RARC). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Illustrative rationale. */
  rationale: string;
  /** Always true — the catalog is an illustrative synthetic. */
  synthetic: true;
};

export const CLAIM_REASON_CODE_CATALOG: ClaimReasonCode[] = [
  {
    id: "reason.CO-97",
    label: "CO-97 — Payment adjusted because the benefit for this service is bundled into another",
    rationale: "NCCI-PTP unbundling denial — bill the comprehensive code, not both.",
    synthetic: true
  },
  {
    id: "reason.CO-50",
    label: "CO-50 — Non-covered services because they are not deemed a medical necessity",
    rationale: "LCD coverage — pend for clinical-reviewer medical-necessity determination.",
    synthetic: true
  },
  {
    id: "reason.CO-96",
    label: "CO-96 — Non-covered charge(s) under an NCD",
    rationale: "NCD coverage — service excluded under a National Coverage Determination.",
    synthetic: true
  },
  {
    id: "reason.CO-119",
    label: "CO-119 — Benefit maximum for this time period has been reached",
    rationale: "Annual / lifetime benefit limit exhausted.",
    synthetic: true
  },
  {
    id: "reason.CO-197",
    label: "CO-197 — Precertification / authorization absent",
    rationale: "Prior authorization was required but not on the claim — pend for retro-auth or lookup.",
    synthetic: true
  },
  {
    id: "reason.CO-18",
    label: "CO-18 — Exact duplicate claim / service",
    rationale: "Duplicate submission of a previously paid claim.",
    synthetic: true
  },
  {
    id: "reason.CO-242",
    label: "CO-242 — Services not provided by network / primary care providers",
    rationale: "Out-of-network provider — pend for OON benefit check or single-case agreement.",
    synthetic: true
  },
  {
    id: "reason.CO-29",
    label: "CO-29 — The time limit for filing has expired",
    rationale: "Claim submitted after the payer's timely-filing window.",
    synthetic: true
  }
];

const REASON_CODE_BY_ID = new Map<string, ClaimReasonCode>(
  CLAIM_REASON_CODE_CATALOG.map((c) => [c.id, c])
);

/** Is `id` a defined reason-code catalog id? */
export function isClaimReasonCode(id: unknown): boolean {
  return typeof id === "string" && REASON_CODE_BY_ID.has(id);
}

/** Look up a reason code by id (undefined for an off-catalog id). */
export function getClaimReasonCode(id: string): ClaimReasonCode | undefined {
  return REASON_CODE_BY_ID.get(id);
}

/**
 * Deterministic mapping from an edit id → its default reason code. Every
 * edit in the catalog has exactly one default reason code (illustrative).
 */
const EDIT_TO_REASON_CODE: Record<string, string> = {
  "edit.ncci-ptp-unbundling": "reason.CO-97",
  "edit.lcd-coverage": "reason.CO-50",
  "edit.ncd-coverage": "reason.CO-96",
  "edit.benefit-limit-exhausted": "reason.CO-119",
  "edit.prior-auth-missing": "reason.CO-197",
  "edit.duplicate-submission": "reason.CO-18",
  "edit.out-of-network": "reason.CO-242",
  "edit.timely-filing-window": "reason.CO-29"
};

/** A single claim line — one CPT (or HCPCS) code with a billed amount. */
export type ClaimLine = {
  /** Line index / synthetic id. */
  lineId: string;
  /** Illustrative CPT/HCPCS code. */
  cptCode: string;
  /** Billed amount in cents (integer). */
  billedAmountCents: number;
};

/** A member's benefit-side context — flags the adjudicator reads. */
export type ClaimBenefitContext = {
  /** Whether the servicing provider is in-network for this member's plan. */
  inNetwork?: boolean;
  /** Whether the required prior authorization is on file. */
  priorAuthOnFile?: boolean;
  /** True when the annual/lifetime benefit limit is exhausted. */
  benefitLimitExhausted?: boolean;
  /**
   * A stable illustrative claim-fingerprint the payer's dedup table hits on;
   * when this is on `duplicateOfPaidClaims`, the duplicate-submission edit
   * fires. Illustrative — real deduplication is much fuzzier.
   */
  claimFingerprint?: string;
  /** Fingerprints of previously-paid claims for the same member. */
  duplicateOfPaidClaims?: readonly string[];
  /** Days from date-of-service to submission (for timely-filing check). */
  daysFromDateOfService?: number;
  /** Timely-filing window (days). Defaults to 90 illustrative. */
  timelyFilingWindowDays?: number;
  /** Whether the claim is under an LCD requiring medical-necessity review. */
  underLcdReview?: boolean;
  /** Whether the claim's service is explicitly excluded under an NCD. */
  excludedUnderNcd?: boolean;
  /**
   * Illustrative "mutually-exclusive CPT pairs" for NCCI-PTP unbundling —
   * a set of `[cptA, cptB]` where lines containing both trigger the edit.
   */
  ncciPtpPairs?: ReadonlyArray<readonly [string, string]>;
};

/** The structured input the adjudicator reads. */
export type ClaimAdjudicationRequest = {
  claimRef: string;
  memberRef: string;
  /** ISO asOfDate accepted as data (no clock). */
  asOfDate: string;
  /** ISO date-of-service. */
  dateOfService: string;
  /** The claim lines. */
  lines: readonly ClaimLine[];
  /** The member's benefit-side context. */
  benefits: ClaimBenefitContext;
};

/** An edit hit — the edit id + the reason code it maps to. */
export type AppliedEdit = {
  editId: string;
  editLabel: string;
  reasonCode: string;
  reasonLabel: string;
  detail: string;
};

/** The adjudication decision tier. */
export type ClaimDecision =
  | "clean-pay"
  | "pend-clinical-review"
  | "pend-adjudicator-review"
  | "deny-drafted";

/** The routing target when the decision is not clean-pay. */
export type ClaimRoute =
  | "clean-pay-auto-post"
  | "clinical-reviewer"
  | "adjudicator"
  | null;

/** The full adjudication decision. */
export type ClaimAdjudicationDecision = {
  claimRef: string;
  memberRef: string;
  asOfDate: string;
  decision: ClaimDecision;
  /** Every applied edit in a stable, documented order (edit-id ascending). */
  appliedEdits: readonly AppliedEdit[];
  /**
   * The primary reason code driving the decision, or null for clean-pay.
   * When multiple edits hit, the highest-severity edit (deny > pend-
   * clinical > pend-adjudicator) drives the primary reason.
   */
  primaryReasonCode: string | null;
  routedTo: ClaimRoute;
  /** Total billed amount across all claim lines (cents). */
  totalBilledCents: number;
  /** Denial drafts always require adjudicator cosign. */
  requiresAdjudicatorCosign: boolean;
  /** Always false — the agent NEVER autonomously cosigns a denial. */
  cosigned: false;
  /** Always true — the catalog + refs are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note. */
  note: string;
};

/** The decision precedence — deny beats pend, pend-clinical beats pend-adjudicator. */
const DECISION_SEVERITY: Record<ClaimDecision, number> = {
  "clean-pay": 0,
  "pend-adjudicator-review": 1,
  "pend-clinical-review": 2,
  "deny-drafted": 3
};

/**
 * Deterministically evaluate all edits against the claim. Returns the sorted
 * (by edit id ascending) list of applied edits.
 */
export function evaluateClaimEdits(
  req: ClaimAdjudicationRequest
): readonly AppliedEdit[] {
  const hits: AppliedEdit[] = [];

  // NCCI-PTP unbundling: any pair from ncciPtpPairs where both CPTs appear
  // on the claim.
  const cptSet = new Set(req.lines.map((l) => l.cptCode));
  const ncci = req.benefits.ncciPtpPairs ?? [];
  for (const [a, b] of ncci) {
    if (cptSet.has(a) && cptSet.has(b)) {
      hits.push({
        editId: "edit.ncci-ptp-unbundling",
        editLabel: getClaimEdit("edit.ncci-ptp-unbundling")!.label,
        reasonCode: "reason.CO-97",
        reasonLabel: getClaimReasonCode("reason.CO-97")!.label,
        detail: `CPT pair ${a} + ${b} triggers NCCI-PTP unbundling`
      });
      break; // one NCCI hit is enough to fire the edit.
    }
  }

  // LCD coverage: pend for clinical review when flagged.
  if (req.benefits.underLcdReview === true) {
    hits.push({
      editId: "edit.lcd-coverage",
      editLabel: getClaimEdit("edit.lcd-coverage")!.label,
      reasonCode: "reason.CO-50",
      reasonLabel: getClaimReasonCode("reason.CO-50")!.label,
      detail: "service falls under an LCD requiring medical-necessity review"
    });
  }

  // NCD coverage: hard deny when explicitly excluded.
  if (req.benefits.excludedUnderNcd === true) {
    hits.push({
      editId: "edit.ncd-coverage",
      editLabel: getClaimEdit("edit.ncd-coverage")!.label,
      reasonCode: "reason.CO-96",
      reasonLabel: getClaimReasonCode("reason.CO-96")!.label,
      detail: "service explicitly excluded under an NCD"
    });
  }

  // Benefit limit exhausted.
  if (req.benefits.benefitLimitExhausted === true) {
    hits.push({
      editId: "edit.benefit-limit-exhausted",
      editLabel: getClaimEdit("edit.benefit-limit-exhausted")!.label,
      reasonCode: "reason.CO-119",
      reasonLabel: getClaimReasonCode("reason.CO-119")!.label,
      detail: "annual/lifetime benefit limit exhausted"
    });
  }

  // Prior-auth missing.
  if (req.benefits.priorAuthOnFile === false) {
    hits.push({
      editId: "edit.prior-auth-missing",
      editLabel: getClaimEdit("edit.prior-auth-missing")!.label,
      reasonCode: "reason.CO-197",
      reasonLabel: getClaimReasonCode("reason.CO-197")!.label,
      detail: "required prior authorization not on file"
    });
  }

  // Duplicate submission.
  const fp = req.benefits.claimFingerprint;
  const paid = req.benefits.duplicateOfPaidClaims ?? [];
  if (typeof fp === "string" && paid.includes(fp)) {
    hits.push({
      editId: "edit.duplicate-submission",
      editLabel: getClaimEdit("edit.duplicate-submission")!.label,
      reasonCode: "reason.CO-18",
      reasonLabel: getClaimReasonCode("reason.CO-18")!.label,
      detail: `duplicate of previously-paid claim ${fp}`
    });
  }

  // Out-of-network.
  if (req.benefits.inNetwork === false) {
    hits.push({
      editId: "edit.out-of-network",
      editLabel: getClaimEdit("edit.out-of-network")!.label,
      reasonCode: "reason.CO-242",
      reasonLabel: getClaimReasonCode("reason.CO-242")!.label,
      detail: "servicing provider out-of-network"
    });
  }

  // Timely-filing window.
  const window = req.benefits.timelyFilingWindowDays ?? 90;
  const daysFromDos = req.benefits.daysFromDateOfService;
  if (typeof daysFromDos === "number" && daysFromDos > window) {
    hits.push({
      editId: "edit.timely-filing-window",
      editLabel: getClaimEdit("edit.timely-filing-window")!.label,
      reasonCode: "reason.CO-29",
      reasonLabel: getClaimReasonCode("reason.CO-29")!.label,
      detail: `claim filed ${daysFromDos}d after date-of-service (window ${window}d)`
    });
  }

  return [...hits].sort((a, b) => a.editId.localeCompare(b.editId));
}

/**
 * Combine applied edits into a single decision. The highest-severity edit
 * wins (deny > pend-clinical > pend-adjudicator). Empty hits → clean-pay.
 */
export function summarizeDecision(
  hits: readonly AppliedEdit[]
): { decision: ClaimDecision; primaryReasonCode: string | null; routedTo: ClaimRoute } {
  if (hits.length === 0) {
    return { decision: "clean-pay", primaryReasonCode: null, routedTo: "clean-pay-auto-post" };
  }
  let best: ClaimDecision = "pend-adjudicator-review";
  let bestReasonCode: string | null = null;
  for (const hit of hits) {
    const editDecision = getClaimEdit(hit.editId)!.defaultDecision;
    if (DECISION_SEVERITY[editDecision] > DECISION_SEVERITY[best]) {
      best = editDecision;
      bestReasonCode = hit.reasonCode;
    } else if (
      DECISION_SEVERITY[editDecision] === DECISION_SEVERITY[best] &&
      bestReasonCode === null
    ) {
      bestReasonCode = hit.reasonCode;
    }
  }
  const routedTo: ClaimRoute =
    best === "deny-drafted"
      ? "adjudicator"
      : best === "pend-clinical-review"
      ? "clinical-reviewer"
      : best === "pend-adjudicator-review"
      ? "adjudicator"
      : null;
  return { decision: best, primaryReasonCode: bestReasonCode, routedTo };
}

/**
 * Adjudicate a single claim deterministically. A pure function of the
 * request (no clock, no randomness).
 */
export function adjudicateClaim(
  req: ClaimAdjudicationRequest
): ClaimAdjudicationDecision {
  const appliedEdits = evaluateClaimEdits(req);
  const { decision, primaryReasonCode, routedTo } = summarizeDecision(appliedEdits);
  const totalBilledCents = req.lines.reduce((s, l) => s + l.billedAmountCents, 0);
  const requiresAdjudicatorCosign = decision === "deny-drafted";
  const note =
    decision === "clean-pay"
      ? `Clean-pay for ${req.claimRef} ($${(totalBilledCents / 100).toFixed(2)}): no edits hit.`
      : `${decision} for ${req.claimRef}: ${appliedEdits.length} edit${
          appliedEdits.length === 1 ? "" : "s"
        } hit, primary reason ${primaryReasonCode}. Routed to ${routedTo}. ` +
        (decision === "deny-drafted"
          ? "DENIAL is DRAFTED for adjudicator cosign — the agent NEVER autonomously finalizes a denial."
          : "Pended for human review — no autonomous action.");
  return {
    claimRef: req.claimRef,
    memberRef: req.memberRef,
    asOfDate: req.asOfDate,
    decision,
    appliedEdits,
    primaryReasonCode,
    routedTo,
    totalBilledCents,
    requiresAdjudicatorCosign,
    cosigned: false,
    synthetic: true,
    note
  };
}

/**
 * Edit-catalog check: does EVERY applied edit trace to CLAIM_EDIT_CATALOG?
 * True when every editId is on the catalog. The guard that catches a
 * fabricated / off-catalog edit. This is the honest signal the route
 * reports to policy.claims.edit-catalog-sourced. A non-array input is a
 * violation.
 */
export function editsTraceToCatalog(
  edits:
    | ReadonlyArray<{ editId?: string }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(edits)) return false;
  return edits.every((e) => isClaimEdit(e.editId));
}

/**
 * Cosign-gate check: does the decision require adjudicator cosign when it
 * is a denial, and is it explicitly NOT cosigned? True when either the
 * decision isn't a denial (no cosign needed) OR the denial is properly
 * gated. The guard that catches a caller-asserted cosigned:true or
 * requiresAdjudicatorCosign:false on a denial. This is the honest signal
 * the route reports to policy.claims.no-autonomous-denial. A non-object
 * input is a violation.
 */
export function denialRequiresAdjudicatorCosign(
  decision:
    | {
        decision?: string;
        requiresAdjudicatorCosign?: boolean;
        cosigned?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.decision !== "deny-drafted") return true;
  if (decision.requiresAdjudicatorCosign !== true) return false;
  if (decision.cosigned === true) return false;
  return true;
}

/**
 * Reason-code integrity check: does the decision cite a specific catalog
 * reason code (when non-clean-pay), and does every applied edit's
 * reasonCode trace to CLAIM_REASON_CODE_CATALOG? True when both hold.
 * The guard that catches a denial or pend without a stated reason code
 * (an illegal member notice under Section 1557 / state code + CMS) OR an
 * off-catalog reason code. This is the honest signal the route reports to
 * policy.claims.reason-code-integrity. A non-object input is a violation.
 */
export function decisionsCiteReasonCodes(
  input:
    | {
        decision?: string;
        primaryReasonCode?: string | null;
        appliedEdits?: ReadonlyArray<{ reasonCode?: string }>;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  if (input.decision === "clean-pay") return true;
  if (!isClaimReasonCode(input.primaryReasonCode)) return false;
  const edits = input.appliedEdits ?? [];
  if (!Array.isArray(edits)) return false;
  return edits.every((e) => isClaimReasonCode(e.reasonCode));
}

/**
 * A representative clean-pay demo (illustrative). Two menopause-relevant
 * CPTs (an office visit + a DEXA screen), in-network, prior-auth on file,
 * benefit-limit not exhausted, no LCD/NCD flags, no duplicate, in the
 * timely-filing window — so the clean-pay happy path is demonstrable.
 */
export const DEMO_CLEAN_CLAIM: ClaimAdjudicationRequest = {
  claimRef: "claim-2026-07-001",
  memberRef: "member-001",
  asOfDate: "2026-07-05",
  dateOfService: "2026-07-01",
  lines: [
    { lineId: "line-1", cptCode: "99213", billedAmountCents: 18500 },
    { lineId: "line-2", cptCode: "77080", billedAmountCents: 12500 }
  ],
  benefits: {
    inNetwork: true,
    priorAuthOnFile: true,
    benefitLimitExhausted: false,
    daysFromDateOfService: 4,
    timelyFilingWindowDays: 90,
    underLcdReview: false,
    excludedUnderNcd: false,
    ncciPtpPairs: []
  }
};

/**
 * A representative deny-drafted demo (illustrative). Same claim submitted
 * twice → duplicate submission hits → deny-drafted with CO-18.
 */
export const DEMO_DUPLICATE_CLAIM: ClaimAdjudicationRequest = {
  claimRef: "claim-2026-07-002",
  memberRef: "member-001",
  asOfDate: "2026-07-05",
  dateOfService: "2026-07-01",
  lines: [{ lineId: "line-1", cptCode: "99213", billedAmountCents: 18500 }],
  benefits: {
    inNetwork: true,
    priorAuthOnFile: true,
    benefitLimitExhausted: false,
    claimFingerprint: "fp-99213-2026-07-01",
    duplicateOfPaidClaims: ["fp-99213-2026-07-01"],
    daysFromDateOfService: 4,
    timelyFilingWindowDays: 90,
    underLcdReview: false,
    excludedUnderNcd: false,
    ncciPtpPairs: []
  }
};

/**
 * A representative pend-for-clinical-review demo (illustrative). A menopause
 * DEXA claim under LCD review → pend-clinical-review with CO-50.
 */
export const DEMO_LCD_PEND_CLAIM: ClaimAdjudicationRequest = {
  claimRef: "claim-2026-07-003",
  memberRef: "member-002",
  asOfDate: "2026-07-05",
  dateOfService: "2026-07-01",
  lines: [{ lineId: "line-1", cptCode: "77080", billedAmountCents: 12500 }],
  benefits: {
    inNetwork: true,
    priorAuthOnFile: true,
    benefitLimitExhausted: false,
    daysFromDateOfService: 4,
    timelyFilingWindowDays: 90,
    underLcdReview: true,
    excludedUnderNcd: false,
    ncciPtpPairs: []
  }
};

/**
 * A representative multi-edit demo (illustrative). Prior-auth missing +
 * out-of-network + timely-filing hit — highest-severity edit (timely-filing
 * → deny-drafted) wins.
 */
export const DEMO_MULTI_EDIT_CLAIM: ClaimAdjudicationRequest = {
  claimRef: "claim-2026-07-004",
  memberRef: "member-003",
  asOfDate: "2026-07-05",
  dateOfService: "2026-01-01",
  lines: [{ lineId: "line-1", cptCode: "77080", billedAmountCents: 12500 }],
  benefits: {
    inNetwork: false,
    priorAuthOnFile: false,
    benefitLimitExhausted: false,
    daysFromDateOfService: 185,
    timelyFilingWindowDays: 90,
    underLcdReview: false,
    excludedUnderNcd: false,
    ncciPtpPairs: []
  }
};
