/**
 * Balance Billing Protection (No Surprises Act) — the deterministic, transparent
 * payer-side layer that decides whether the No Surprises Act PROHIBITS balance-billing an
 * out-of-network claim, and ensures a protected patient's cost-share is computed on the
 * in-network (Qualifying Payment Amount) basis rather than the billed charge.
 *
 * Deterministic, dependency-free domain core the Balance Billing Protection Agent
 * (app/api/agents/balance-billing) wraps — a payer & plan operations service on the
 * payer plane of Pause's Agent Fabric. Given a claim (its protection basis — the service
 * setting / provider network status — plus the service type, whether it is an ancillary
 * service, the billed charge, the in-network allowed amount / QPA, and whether a valid
 * notice-and-consent waiver was obtained), it DETERMINISTICALLY decides whether the NSA
 * protects the patient from balance billing, computes the patient's cost-sharing BASIS
 * (in-network QPA for a protected claim, never the out-of-network billed charge), and
 * computes the balance-bill amount (zero + prohibited for a protected claim).
 *
 *   Inbound:  a BalanceBillingRequest { claimRef, patientRef, basisId, serviceType,
 *             isAncillary?, billedCharge, inNetworkAllowed, waiverObtained? }
 *   Outbound: a BalanceBillingDetermination { protected, waiverEffective,
 *             balanceBillProhibited, costShareBasis, patientCostShareBasisAmount,
 *             balanceBillAmount, balanceBillAllowed, requiresHumanReview, reason,
 *             synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other payer agents (Claims Adjudication,
 * Coordination of Benefits, Overpayment & Recovery, Utilization Review, FWA) and the
 * patient-access Good Faith Estimate agent: the GFE agent produces the PRE-service
 * self-pay estimate; this decides, at CLAIM time, whether the NSA prohibits balance
 * billing an out-of-network claim and on what basis the patient's cost-share is computed.
 * Together they are the two sides of the No Surprises Act (the provider-estimate side and
 * the payer/claims side).
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every determination cites a recorded protection basis.
 * ─────────────────────────────────────────────────────────────────────
 *  Every protection decision must cite a recorded NSA protection basis from the catalog
 *  (emergency, out-of-network at an in-network facility, air ambulance, ground ambulance,
 *  in-network) — there is no ad-hoc, un-sourced protection call. balanceBillBasisCited()
 *  reports the honest signal the Agent Fabric enforces via policy.balancebill.protection-basis-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: a protected patient's cost-share is on the in-network basis.
 * ─────────────────────────────────────────────────────────────────────
 *  For a PROTECTED claim the patient's cost-sharing MUST be computed on the in-network
 *  (Qualifying Payment Amount) basis, NEVER the out-of-network billed charge — basing a
 *  protected patient's cost-share on the billed charge over-charges them. The No Surprises
 *  Act (45 CFR 149.110–149.130) requires cost-sharing to be based on the recognized amount
 *  (the QPA). balanceBillCostShareInNetwork() reports the honest signal the Agent Fabric
 *  enforces via policy.balancebill.cost-share-in-network-basis. (This is the load-bearing
 *  gate — mirrors the Overpayment & Recovery Agent's within-lookback-window: a legal basis
 *  bounds the dollar figure.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a protected claim is never balance-billed.
 * ─────────────────────────────────────────────────────────────────────
 *  A protected claim can NEVER be balance-billed — the difference between the billed
 *  charge and the allowed amount may not be billed to the patient, and a balance bill is
 *  never issued autonomously against a protected patient. balanceBillProhibitionHonored()
 *  reports the honest signal the Agent Fabric enforces via policy.balancebill.no-autonomous-balance-bill.
 *  (Mirrors the Overpayment & Recovery Agent's no-autonomous-clawback and the Lab Result
 *  Agent's no-autonomous-clinical-action posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — protected or not — is a SAFE, honest OUTPUT: the task COMPLETES (a
 *  permitted balance bill on a NON-protected claim carries requiresHumanReview:true). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (no cited
 *  protection basis, a protected patient's cost-share based on the billed charge, or a
 *  balance bill allowed on a protected claim) — which the Agent Fabric rejects before it
 *  can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified No Surprises Act engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The protection bases, waiver rules, ancillary-service handling, and in-network / QPA
 *  amounts below are ILLUSTRATIVE synthetic/demo values chosen to model the SHAPE of a
 *  governed balance-billing control — they are NOT a certified No Surprises Act engine, and
 *  a REAL determination uses the actual Qualifying Payment Amount, the federal Independent
 *  Dispute Resolution process, the notice-and-consent requirements, and the provider's
 *  network contracts under 45 CFR 149. The patient / claim references are synthetic /
 *  de-identified. There is NO randomness and NO clock anywhere here: the determination is a
 *  pure function of the request + the basis catalog (no Date.now()), so the same claim
 *  always yields the same protection + cost-share basis + balance-bill flags — which is what
 *  lets the demo, the seeded trace, and the tests agree.
 */

/** A No Surprises Act protection basis — the setting / provider status that governs protection. */
export type ProtectionBasis = {
  /** Stable catalog id (cited on every determination). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Whether the NSA protects the patient from balance billing in this scenario. */
  protected: boolean;
  /** Whether protection can be waived via valid notice-and-consent (never for ancillary services). */
  waivable: boolean;
  /** Illustrative description. Demo-honest. */
  description: string;
};

/**
 * The protection-basis catalog — every determination cites one of these. Illustrative/synthetic
 * (see the header). Models the core NSA scenarios.
 */
export const PROTECTION_BASES: ProtectionBasis[] = [
  {
    id: "basis.emergency",
    label: "Emergency services (out-of-network)",
    protected: true,
    waivable: false,
    description:
      "Emergency services, including out-of-network. Protected; balance billing prohibited and cannot be waived. (Illustrative.)"
  },
  {
    id: "basis.oon-at-innetwork-facility",
    label: "Out-of-network provider at an in-network facility",
    protected: true,
    waivable: true,
    description:
      "A non-emergency out-of-network provider at an in-network facility. Protected; waivable via notice-and-consent EXCEPT for ancillary services (anesthesiology, radiology, pathology, neonatology, assistant surgeon). (Illustrative.)"
  },
  {
    id: "basis.air-ambulance",
    label: "Air ambulance (out-of-network)",
    protected: true,
    waivable: false,
    description:
      "Out-of-network air ambulance services. Protected; balance billing prohibited and cannot be waived. (Illustrative.)"
  },
  {
    id: "basis.ground-ambulance",
    label: "Ground ambulance (out-of-network)",
    protected: false,
    waivable: false,
    description:
      "Out-of-network ground ambulance. NOT protected by the No Surprises Act — a known coverage gap; balance billing is permitted. (Illustrative.)"
  },
  {
    id: "basis.in-network",
    label: "In-network provider",
    protected: false,
    waivable: false,
    description:
      "An in-network provider billing at the contracted rate — no out-of-network balance-billing scenario arises. (Illustrative.)"
  }
];

const BASIS_BY_ID = new Map(PROTECTION_BASES.map((b) => [b.id, b]));
const BASIS_IDS = new Set<string>(PROTECTION_BASES.map((b) => b.id));

/** Is `id` a recognized protection-basis id? */
export function isProtectionBasis(id: unknown): boolean {
  return typeof id === "string" && BASIS_IDS.has(id);
}

/** Look up a protection basis by id (undefined for an off-catalog id). */
export function getProtectionBasis(id: string): ProtectionBasis | undefined {
  return BASIS_BY_ID.get(id);
}

/** The cost-sharing basis for the patient's responsibility. */
export type CostShareBasis = "in-network-qpa" | "billed-charge";

/** A balance-billing determination request. */
export type BalanceBillingRequest = {
  /** Synthetic claim reference. */
  claimRef: string;
  /** Synthetic, de-identified patient reference. */
  patientRef: string;
  /** The protection basis (a catalog id, or an off-catalog string). */
  basisId: string;
  /** The service type (illustrative — e.g. "emergency", "anesthesiology", "surgery-elective"). */
  serviceType: string;
  /** Whether the service is an ancillary type (never waivable at an in-network facility). */
  isAncillary?: boolean;
  /** The provider's billed charge (USD). */
  billedCharge: number;
  /** The in-network allowed amount / Qualifying Payment Amount (USD). */
  inNetworkAllowed: number;
  /** Whether a valid notice-and-consent waiver was obtained (only effective for waivable, non-ancillary). */
  waiverObtained?: boolean;
};

/** The deterministic balance-billing determination the agent returns. */
export type BalanceBillingDetermination = {
  /** Synthetic claim reference. */
  claimRef: string;
  /** Synthetic, de-identified patient reference. */
  patientRef: string;
  /** The cited protection-basis id. */
  basisId: string;
  /** The protection-basis label. */
  basisLabel: string;
  /** The service type evaluated. */
  serviceType: string;
  /** Whether the NSA protects the patient from balance billing (after any effective waiver). */
  protected: boolean;
  /** Whether a valid waiver removed protection (only for waivable, non-ancillary). */
  waiverEffective: boolean;
  /** Whether balance billing is prohibited (=== protected). */
  balanceBillProhibited: boolean;
  /** The basis the patient's cost-share is computed against. */
  costShareBasis: CostShareBasis;
  /** The dollar amount the patient's cost-share is computed against. */
  patientCostShareBasisAmount: number;
  /** The billed charge. */
  billedCharge: number;
  /** The in-network allowed amount / QPA. */
  inNetworkAllowed: number;
  /** The balance-bill amount (0 when prohibited; billedCharge − allowed when permitted). */
  balanceBillAmount: number;
  /** Whether a balance bill may be issued (only for a non-protected claim with a positive amount). */
  balanceBillAllowed: boolean;
  /** Whether the determination requires human review (any permitted balance bill / effective waiver). */
  requiresHumanReview: boolean;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the bases + amounts are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * The deterministic balance-billing function — the heart of the service. DETERMINISTIC: a
 * pure function of the request + the basis catalog (no randomness, no clock). It resolves
 * the protection basis, applies any effective notice-and-consent waiver (valid only for a
 * waivable, non-ancillary service), decides protection, computes the patient's cost-share
 * BASIS (in-network QPA for a protected claim, billed charge otherwise), and computes the
 * balance-bill amount (0 + prohibited for a protected claim; billedCharge − allowed for a
 * permitted one). An off-catalog basis yields a not-protected placeholder that the
 * balanceBillBasisCited() guard catches. Nothing is billed here — this produces a
 * determination, not a charge.
 */
export function evaluateBalanceBilling(
  request: BalanceBillingRequest
): BalanceBillingDetermination {
  const basis = getProtectionBasis(request.basisId);
  const billedCharge = typeof request.billedCharge === "number" ? request.billedCharge : 0;
  const inNetworkAllowed =
    typeof request.inNetworkAllowed === "number" ? request.inNetworkAllowed : 0;
  const isAncillary = request.isAncillary === true;

  const synthNote =
    "Synthetic/illustrative protection bases, waiver rules, ancillary handling, and QPA amounts — NOT a certified No Surprises Act engine; a real determination uses the actual Qualifying Payment Amount, the federal IDR process, the notice-and-consent requirements, and the provider's network contracts under 45 CFR 149.";

  if (!basis) {
    // Off-catalog basis: well-formed but un-sourced. The balanceBillBasisCited() guard
    // catches it. We treat it as not protected (the conservative, review-required default).
    const balanceBillAmount = Math.max(billedCharge - inNetworkAllowed, 0);
    return {
      claimRef: request.claimRef,
      patientRef: request.patientRef,
      basisId: request.basisId,
      basisLabel: request.basisId,
      serviceType: request.serviceType,
      protected: false,
      waiverEffective: false,
      balanceBillProhibited: false,
      costShareBasis: "billed-charge",
      patientCostShareBasisAmount: billedCharge,
      billedCharge,
      inNetworkAllowed,
      balanceBillAmount,
      balanceBillAllowed: balanceBillAmount > 0,
      requiresHumanReview: true,
      reason:
        "no recorded protection basis for this claim — a determination must cite a recorded NSA protection basis",
      synthetic: true,
      note: `Balance-billing determination for ${request.claimRef}: basis ${request.basisId} is not in the protection-basis catalog. ` + synthNote
    };
  }

  // A valid waiver is effective only for a waivable, non-ancillary, protected service.
  const waiverEffective =
    basis.protected && basis.waivable && request.waiverObtained === true && !isAncillary;
  const isProtected = basis.protected && !waiverEffective;

  const balanceBillAmount = isProtected ? 0 : Math.max(billedCharge - inNetworkAllowed, 0);
  const balanceBillAllowed = !isProtected && balanceBillAmount > 0;
  const costShareBasis: CostShareBasis = isProtected ? "in-network-qpa" : "billed-charge";
  const patientCostShareBasisAmount = isProtected ? inNetworkAllowed : billedCharge;

  const reason = isProtected
    ? `${basis.label} — the No Surprises Act PROHIBITS balance billing; the patient's cost-share is computed on the in-network (QPA) basis of $${inNetworkAllowed}, and the $${Math.max(billedCharge - inNetworkAllowed, 0)} difference may not be billed to the patient`
    : waiverEffective
      ? `${basis.label} — a valid notice-and-consent waiver was obtained for this non-ancillary service, so balance billing is permitted; a permitted balance bill of $${balanceBillAmount} requires human review`
      : basis.protected
        ? `${basis.label} — protection could not be waived for this ancillary service; balance billing is PROHIBITED`
        : `${basis.label} — not protected by the No Surprises Act; a balance bill of $${balanceBillAmount} is permitted and requires human review`;

  // An ancillary service at an in-network facility can never be waived — re-assert protection.
  const finalProtected = basis.protected && !(basis.waivable && request.waiverObtained === true && !isAncillary);
  // finalProtected equals isProtected by construction; kept explicit for clarity.
  void finalProtected;

  return {
    claimRef: request.claimRef,
    patientRef: request.patientRef,
    basisId: basis.id,
    basisLabel: basis.label,
    serviceType: request.serviceType,
    protected: isProtected,
    waiverEffective,
    balanceBillProhibited: isProtected,
    costShareBasis,
    patientCostShareBasisAmount,
    billedCharge,
    inNetworkAllowed,
    balanceBillAmount,
    balanceBillAllowed,
    requiresHumanReview: balanceBillAllowed,
    reason,
    synthetic: true,
    note:
      `Balance-billing determination for ${request.claimRef}: ${basis.label}, service ${request.serviceType}${isAncillary ? " (ancillary)" : ""} → ${isProtected ? "PROTECTED (balance billing prohibited)" : "not protected"}. ` +
      `Cost-share basis ${costShareBasis} ($${patientCostShareBasisAmount}); balance-bill amount $${balanceBillAmount}${balanceBillAllowed ? " (permitted, requires human review)" : " (prohibited)"}. ` +
      synthNote
  };
}

/**
 * Protection-basis-sourced check: does the determination cite a recorded protection basis?
 * True when the basisId is a recognized catalog basis; the guard that catches a
 * caller-asserted ad-hoc protection call with no cited basis (a missing / off-catalog
 * basis id). Anything evaluateBalanceBilling() produces from a catalog basis satisfies it.
 * This is the honest signal the route reports to policy.balancebill.protection-basis-sourced.
 * A non-object input is a violation.
 */
export function balanceBillBasisCited(
  determination: Pick<BalanceBillingDetermination, "basisId"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return isProtectionBasis(determination.basisId);
}

/**
 * Cost-share-in-network-basis check: is a protected patient's cost-share on the in-network
 * (QPA) basis? True unless a determination asserts a protected claim whose cost-share is
 * based on the billed charge; the guard that catches over-charging a protected patient by
 * basing cost-share on the out-of-network billed charge. Anything evaluateBalanceBilling()
 * produces satisfies it (a protected claim always uses the in-network basis). This is the
 * honest signal the route reports to policy.balancebill.cost-share-in-network-basis. A
 * non-object input is a violation.
 */
export function balanceBillCostShareInNetwork(
  determination:
    | Pick<BalanceBillingDetermination, "protected" | "costShareBasis">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return !(determination.protected === true && determination.costShareBasis === "billed-charge");
}

/**
 * Balance-bill-prohibition-honored check: is a protected claim kept free of a balance bill?
 * True unless a determination asserts a protected claim that nonetheless allows a balance
 * bill; the guard that catches an (autonomous) balance bill against a protected patient.
 * Anything evaluateBalanceBilling() produces satisfies it (a protected claim never allows a
 * balance bill). This is the honest signal the route reports to
 * policy.balancebill.no-autonomous-balance-bill. A non-object input is a violation.
 */
export function balanceBillProhibitionHonored(
  determination:
    | Pick<BalanceBillingDetermination, "protected" | "balanceBillAllowed">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return !(determination.protected === true && determination.balanceBillAllowed === true);
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent
 * Fabric trace + the response `meta`. Carries no free-text PHI (refs, the basis, the
 * amounts, and the flags only).
 */
export function balanceBillingSummary(determination: BalanceBillingDetermination): {
  claimRef: string;
  patientRef: string;
  basisId: string;
  protected: boolean;
  balanceBillProhibited: boolean;
  costShareBasis: CostShareBasis;
  balanceBillAmount: number;
  balanceBillAllowed: boolean;
  synthetic: boolean;
} {
  return {
    claimRef: determination.claimRef,
    patientRef: determination.patientRef,
    basisId: determination.basisId,
    protected: determination.protected,
    balanceBillProhibited: determination.balanceBillProhibited,
    costShareBasis: determination.costShareBasis,
    balanceBillAmount: determination.balanceBillAmount,
    balanceBillAllowed: determination.balanceBillAllowed,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request (illustrative). An out-of-network emergency → protected,
 * cost-share on the in-network basis, no balance bill. Synthetic / de-identified.
 */
export const DEMO_BALANCE_BILLING_REQUEST: BalanceBillingRequest = {
  claimRef: "bb-claim-001",
  patientRef: "bb-patient-001",
  basisId: "basis.emergency",
  serviceType: "emergency",
  isAncillary: false,
  billedCharge: 5000,
  inNetworkAllowed: 1200,
  waiverObtained: false
};

/**
 * A representative demo request for an ancillary service (illustrative). An out-of-network
 * anesthesiologist at an in-network facility → protected (cannot be waived). Synthetic.
 */
export const DEMO_BALANCE_BILLING_ANCILLARY_REQUEST: BalanceBillingRequest = {
  claimRef: "bb-claim-002",
  patientRef: "bb-patient-002",
  basisId: "basis.oon-at-innetwork-facility",
  serviceType: "anesthesiology",
  isAncillary: true,
  billedCharge: 2400,
  inNetworkAllowed: 900,
  waiverObtained: true
};

/**
 * A representative demo request with an effective waiver (illustrative). An out-of-network
 * elective surgeon at an in-network facility with a valid notice-and-consent waiver →
 * not protected, a permitted balance bill requiring human review. Synthetic.
 */
export const DEMO_BALANCE_BILLING_WAIVER_REQUEST: BalanceBillingRequest = {
  claimRef: "bb-claim-003",
  patientRef: "bb-patient-003",
  basisId: "basis.oon-at-innetwork-facility",
  serviceType: "surgery-elective",
  isAncillary: false,
  billedCharge: 3000,
  inNetworkAllowed: 1800,
  waiverObtained: true
};

/**
 * A representative demo request for ground ambulance (illustrative). An out-of-network
 * ground ambulance → NOT protected (an NSA gap), a permitted balance bill. Synthetic.
 */
export const DEMO_BALANCE_BILLING_GROUND_AMBULANCE_REQUEST: BalanceBillingRequest = {
  claimRef: "bb-claim-004",
  patientRef: "bb-patient-004",
  basisId: "basis.ground-ambulance",
  serviceType: "ground-ambulance",
  isAncillary: false,
  billedCharge: 1800,
  inNetworkAllowed: 700,
  waiverObtained: false
};
