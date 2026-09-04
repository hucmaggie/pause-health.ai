/**
 * Good Faith Estimate (No Surprises Act) — the deterministic, transparent patient-access
 * layer that assembles an itemized Good Faith Estimate (GFE) of expected charges for a
 * self-pay / uninsured patient BEFORE care, from a charge master (fee schedule).
 *
 * Deterministic, dependency-free domain core the Good Faith Estimate Agent
 * (app/api/agents/good-faith-estimate) wraps — a patient-access service on the
 * patient/clinical plane of Pause's Agent Fabric, a sibling to the Benefits & Coverage
 * Verification (EBV) and Patient Financial Assistance & Charity Care agents. Given a
 * scheduled primary service + the expected line items (each a charge-master service id +
 * quantity), it DETERMINISTICALLY prices each line item from the charge master, verifies
 * that every reasonably-expected co-item for the primary service is included, sums the
 * total expected charge, and returns a GFE that is an ESTIMATE (never a binding bill) the
 * patient must confirm — with the No Surprises Act's $400 dispute threshold recorded.
 *
 *   Inbound:  a GoodFaithEstimateRequest { patientRef, providerRef, primaryServiceId,
 *             lineItems: { serviceId, quantity }[] }
 *   Outbound: a GoodFaithEstimateDetermination { lineItems, expectedCoItems,
 *             missingExpectedItems, totalEstimate, allLineItemsSourced,
 *             expectedItemsComplete, binding:false, requiresPatientConfirmation:true,
 *             disputeThreshold, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the patient-access siblings: the EBV agent
 * verifies what the PLAN covers (eligibility + the estimated COVERED visit cost), and the
 * Financial Assistance agent screens the patient-responsibility remainder for CHARITY
 * CARE; this assembles the itemized SELF-PAY / uninsured estimate of expected charges
 * required BEFORE care under the No Surprises Act. Together they are the patient-access
 * triad: plan eligibility → itemized self-pay estimate → charity screening.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every line item is charge-master-sourced.
 * ─────────────────────────────────────────────────────────────────────
 *  Every priced line item must trace to a charge-master entry, at the charge-master
 *  amount — there are no ad-hoc, fabricated, or off-schedule charges. gfeChargeMasterSourced()
 *  reports the honest signal the Agent Fabric enforces via policy.gfe.charge-master-sourced.
 *  (Mirrors the Overpayment & Recovery Agent's reason-catalog-sourced and the Lab Result
 *  Agent's reference-range-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the estimate is complete — all expected items included.
 * ─────────────────────────────────────────────────────────────────────
 *  The GFE must include the primary service AND every reasonably-expected co-item for it —
 *  an incomplete estimate that omits an expected item UNDERSTATES the total and misleads
 *  the patient. The No Surprises Act (45 CFR 149.610) requires the convening provider to
 *  include items/services reasonably expected to be furnished. gfeExpectedItemsComplete()
 *  reports the honest signal the Agent Fabric enforces via policy.gfe.expected-items-complete.
 *  (This is the load-bearing gate — it mirrors the Care Coordination Handoff Agent's
 *  SBAR-completeness and the Lab Result Agent's critical-value-notified: a completeness
 *  obligation that cannot be skipped.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a GFE is an estimate — never a binding bill.
 * ─────────────────────────────────────────────────────────────────────
 *  A GFE is an ESTIMATE requiring patient confirmation, NEVER a final / binding charge —
 *  and if the actual bill exceeds the GFE by $400 or more the patient has NSA dispute
 *  rights. gfeEstimateNotBinding() reports the honest signal the Agent Fabric enforces via
 *  policy.gfe.estimate-not-binding. (Mirrors the Lab Result Agent's no-autonomous-clinical-action
 *  and the Financial Assistance Agent's no-autonomous-denial posture — the agent recommends,
 *  a human confirms.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE ESTIMATE vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A GFE is a SAFE, honest OUTPUT: the task COMPLETES (binding:false,
 *  requiresPatientConfirmation:true). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (a line item that isn't charge-master-sourced, an estimate
 *  missing an expected co-item, or a determination asserted as a binding bill) — which the
 *  Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified chargemaster or price-transparency file.
 * ─────────────────────────────────────────────────────────────────────
 *  The charge master, service categories, amounts, and expected-co-item rules below are
 *  ILLUSTRATIVE synthetic/demo values chosen to model the SHAPE of a governed GFE control —
 *  they are NOT a certified hospital chargemaster, machine-readable price-transparency file,
 *  or a real provider's charges, and a REAL GFE is governed by the No Surprises Act (45 CFR
 *  149.610), the provider's actual charges, and HHS guidance. The patient / provider
 *  references are synthetic / de-identified. There is NO randomness and NO clock anywhere
 *  here: the estimate is a pure function of the request's line items + the charge master
 *  (no Date.now()), so the same request always yields the same total + completeness +
 *  sourcing flags — which is what lets the demo, the seeded trace, and the tests agree.
 */

/** A single service in the charge master — a service mapped to its category + amount. */
export type ServiceCode = {
  /** Stable charge-master id (cited on every priced line item). */
  id: string;
  /** Human-readable service label. */
  label: string;
  /** The billing category. */
  category: "professional" | "facility" | "laboratory" | "imaging" | "pharmacy";
  /** The charge-master amount (USD) for one unit of this service. */
  amount: number;
  /** Illustrative description. Demo-honest. */
  description: string;
};

/**
 * The charge master — every priced line item cites one of these at its amount.
 * Illustrative/synthetic; NOT a certified chargemaster (see the header). Menopause-relevant:
 * the comprehensive menopause consult + hormone panel + bone-density / imaging a self-pay
 * midlife patient is quoted before care.
 */
export const CHARGE_MASTER: ServiceCode[] = [
  {
    id: "svc.office-visit-established",
    label: "Established-patient office visit",
    category: "professional",
    amount: 220,
    description: "An established-patient evaluation & management office visit. (Illustrative.)"
  },
  {
    id: "svc.menopause-consult-comprehensive",
    label: "Comprehensive menopause consultation",
    category: "professional",
    amount: 400,
    description: "A comprehensive menopause / midlife-health consultation. (Illustrative.)"
  },
  {
    id: "svc.lab-panel-hormone",
    label: "Hormone lab panel (FSH / estradiol)",
    category: "laboratory",
    amount: 180,
    description: "A hormone panel (FSH, estradiol, TSH) drawn with a menopause consult. (Illustrative.)"
  },
  {
    id: "svc.bone-density-dexa",
    label: "Bone-density scan (DEXA)",
    category: "imaging",
    amount: 250,
    description: "A dual-energy X-ray absorptiometry (DEXA) bone-density scan. (Illustrative.)"
  },
  {
    id: "svc.pelvic-ultrasound",
    label: "Pelvic ultrasound",
    category: "imaging",
    amount: 450,
    description: "A transvaginal / pelvic ultrasound. (Illustrative.)"
  },
  {
    id: "svc.hrt-injection-admin",
    label: "HRT injection administration",
    category: "pharmacy",
    amount: 90,
    description: "Administration of a hormone-replacement-therapy injection. (Illustrative.)"
  }
];

const SERVICE_BY_ID = new Map(CHARGE_MASTER.map((s) => [s.id, s]));
const SERVICE_IDS = new Set<string>(CHARGE_MASTER.map((s) => s.id));

/**
 * Reasonably-expected co-items for a primary service — the items an honest GFE must
 * include alongside the primary. Illustrative/synthetic (see the header). A primary
 * service absent from this map has no required co-items (only the primary itself is
 * expected).
 */
export const EXPECTED_COITEMS: Record<string, string[]> = {
  // A comprehensive menopause consult reasonably expects a hormone panel drawn with it.
  "svc.menopause-consult-comprehensive": ["svc.lab-panel-hormone"],
  // A DEXA reasonably expects an office visit to order + interpret it.
  "svc.bone-density-dexa": ["svc.office-visit-established"],
  // A pelvic ultrasound reasonably expects an office visit to order + interpret it.
  "svc.pelvic-ultrasound": ["svc.office-visit-established"]
};

/** The No Surprises Act patient-dispute threshold: a bill exceeding the GFE by ≥ this is disputable. */
export const GFE_DISPUTE_THRESHOLD = 400;

/** Is `id` a recognized charge-master service id? */
export function isServiceCode(id: unknown): boolean {
  return typeof id === "string" && SERVICE_IDS.has(id);
}

/** Look up a service by id (undefined for an off-catalog id). */
export function getServiceCode(id: string): ServiceCode | undefined {
  return SERVICE_BY_ID.get(id);
}

/** The reasonably-expected item set for a primary service (the primary itself + its co-items). */
export function expectedItemsFor(primaryServiceId: string): string[] {
  const coItems = EXPECTED_COITEMS[primaryServiceId] ?? [];
  return [primaryServiceId, ...coItems];
}

/** A requested line item on a GFE. */
export type GfeLineItemRequest = {
  /** The charge-master service id (or an off-catalog string). */
  serviceId: string;
  /** The quantity (defaults to 1 when omitted / non-positive). */
  quantity?: number;
};

/** A GFE request. */
export type GoodFaithEstimateRequest = {
  /** Synthetic, de-identified patient reference. */
  patientRef: string;
  /** Synthetic, de-identified rendering-provider reference. */
  providerRef: string;
  /** The scheduled primary service (a charge-master id). */
  primaryServiceId: string;
  /** The expected line items (should include the primary + all expected co-items). */
  lineItems: GfeLineItemRequest[];
};

/** A priced line item on the produced GFE. */
export type GfePricedLineItem = {
  /** The cited charge-master service id. */
  serviceId: string;
  /** The service label (echoes the id when off-catalog). */
  label: string;
  /** The billing category ("unknown" when off-catalog). */
  category: string;
  /** The charge-master unit amount (0 when off-catalog). */
  unitAmount: number;
  /** The quantity priced. */
  quantity: number;
  /** unitAmount × quantity. */
  lineTotal: number;
  /** True when this item is charge-master-sourced (in-catalog, priced at the catalog amount). */
  sourced: boolean;
};

/** The deterministic GFE the agent returns. */
export type GoodFaithEstimateDetermination = {
  /** Synthetic, de-identified patient reference. */
  patientRef: string;
  /** Synthetic, de-identified rendering-provider reference. */
  providerRef: string;
  /** The scheduled primary service id. */
  primaryServiceId: string;
  /** The primary service label. */
  primaryServiceLabel: string;
  /** The priced line items. */
  lineItems: GfePricedLineItem[];
  /** The reasonably-expected item ids for the primary (primary + co-items). */
  expectedCoItems: string[];
  /** Expected items not present in the line items. */
  missingExpectedItems: string[];
  /** The summed expected total (USD). */
  totalEstimate: number;
  /** True when every line item is charge-master-sourced. */
  allLineItemsSourced: boolean;
  /** True when no expected item is missing. */
  expectedItemsComplete: boolean;
  /** Always false — a GFE is an estimate, never a binding bill. */
  binding: boolean;
  /** Always true — a GFE requires patient confirmation. */
  requiresPatientConfirmation: boolean;
  /** The NSA dispute threshold recorded on the estimate. */
  disputeThreshold: number;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the charge master + rules are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Is a requested / asserted line item charge-master-sourced? (in-catalog, at the catalog amount). */
function lineItemSourced(item: { serviceId?: unknown; unitAmount?: unknown }): boolean {
  if (typeof item.serviceId !== "string" || !isServiceCode(item.serviceId)) return false;
  const svc = getServiceCode(item.serviceId)!;
  // If an explicit unitAmount is asserted, it must match the charge master.
  if (typeof item.unitAmount === "number" && item.unitAmount !== svc.amount) return false;
  return true;
}

function normalizeQuantity(q: unknown): number {
  return typeof q === "number" && q > 0 ? q : 1;
}

/**
 * The deterministic GFE function — the heart of the service. DETERMINISTIC: a pure
 * function of the request's line items + the charge master (no randomness, no clock). It
 * prices each line item from the charge master, computes which reasonably-expected items
 * are missing, sums the total, and returns a GFE marked as an estimate (binding:false)
 * requiring patient confirmation, with the NSA dispute threshold recorded. Off-catalog
 * line items price to 0 and are flagged un-sourced (the gfeChargeMasterSourced() guard
 * catches them); a missing expected co-item is flagged (the gfeExpectedItemsComplete()
 * guard catches it). Nothing is billed here — this produces an estimate, not a charge.
 */
export function evaluateGoodFaithEstimate(
  request: GoodFaithEstimateRequest
): GoodFaithEstimateDetermination {
  const primary = getServiceCode(request.primaryServiceId);
  const requestedItems = Array.isArray(request.lineItems) ? request.lineItems : [];

  const lineItems: GfePricedLineItem[] = requestedItems.map((item) => {
    const svc = getServiceCode(item.serviceId);
    const quantity = normalizeQuantity(item.quantity);
    const sourced = lineItemSourced(item);
    const unitAmount = svc ? svc.amount : 0;
    return {
      serviceId: item.serviceId,
      label: svc ? svc.label : item.serviceId,
      category: svc ? svc.category : "unknown",
      unitAmount,
      quantity,
      lineTotal: unitAmount * quantity,
      sourced
    };
  });

  const expectedCoItems = expectedItemsFor(request.primaryServiceId);
  const presentIds = new Set(lineItems.map((li) => li.serviceId));
  const missingExpectedItems = expectedCoItems.filter((id) => !presentIds.has(id));

  const totalEstimate = lineItems.reduce((sum, li) => sum + li.lineTotal, 0);
  const allLineItemsSourced = lineItems.length > 0 && lineItems.every((li) => li.sourced);
  const expectedItemsComplete = missingExpectedItems.length === 0;

  const synthNote =
    "Synthetic/illustrative charge master, categories, amounts, and expected-co-item rules — NOT a certified hospital chargemaster, machine-readable price-transparency file, or a real provider's charges; a real GFE is governed by the No Surprises Act (45 CFR 149.610), the provider's actual charges, and HHS guidance.";

  const reason = !allLineItemsSourced
    ? "one or more line items are not charge-master-sourced — every charge must trace to a recorded charge-master entry at the catalog amount"
    : !expectedItemsComplete
      ? `the estimate is missing a reasonably-expected item (${missingExpectedItems.join(", ")}) — a GFE must include the primary service and every reasonably-expected co-item`
      : `a complete, charge-master-sourced Good Faith Estimate of $${totalEstimate} — an ESTIMATE requiring patient confirmation, never a binding bill (NSA $${GFE_DISPUTE_THRESHOLD} dispute threshold applies)`;

  return {
    patientRef: request.patientRef,
    providerRef: request.providerRef,
    primaryServiceId: request.primaryServiceId,
    primaryServiceLabel: primary ? primary.label : request.primaryServiceId,
    lineItems,
    expectedCoItems,
    missingExpectedItems,
    totalEstimate,
    allLineItemsSourced,
    expectedItemsComplete,
    binding: false,
    requiresPatientConfirmation: true,
    disputeThreshold: GFE_DISPUTE_THRESHOLD,
    reason,
    synthetic: true,
    note:
      `Good Faith Estimate for ${request.patientRef}: ${lineItems.length} line item(s), primary ${primary ? primary.label : request.primaryServiceId}, total $${totalEstimate}. ` +
      (expectedItemsComplete ? "" : `Missing expected item(s): ${missingExpectedItems.join(", ")}. `) +
      "An ESTIMATE requiring patient confirmation — never a binding bill. " +
      synthNote
  };
}

/**
 * Charge-master-sourced check: is every line item priced from the charge master?
 * True when the determination has at least one line item and every one is charge-master-sourced
 * (in-catalog, at the catalog amount); the guard that catches a caller-asserted off-schedule /
 * fabricated charge (an off-catalog service id or a mismatched amount). Anything
 * evaluateGoodFaithEstimate() produces from catalog line items satisfies it. This is the
 * honest signal the route reports to policy.gfe.charge-master-sourced. A non-object /
 * empty-line-item input is a violation.
 */
export function gfeChargeMasterSourced(
  determination:
    | { lineItems?: Array<{ serviceId?: unknown; unitAmount?: unknown }> }
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  const items = determination.lineItems;
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every((li) => lineItemSourced(li));
}

/**
 * Expected-items-complete check: does the estimate include the primary + every expected
 * co-item? True when no reasonably-expected item for the primary service is missing from
 * the line items; the guard that catches a caller-asserted INCOMPLETE estimate that omits
 * an expected item (understating the total). Anything evaluateGoodFaithEstimate() produces
 * with the expected items present satisfies it. This is the honest signal the route reports
 * to policy.gfe.expected-items-complete. A non-object input is a violation.
 */
export function gfeExpectedItemsComplete(
  determination:
    | {
        primaryServiceId?: unknown;
        lineItems?: Array<{ serviceId?: unknown }>;
      }
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (typeof determination.primaryServiceId !== "string") return false;
  const items = Array.isArray(determination.lineItems) ? determination.lineItems : [];
  const presentIds = new Set(items.map((li) => (typeof li.serviceId === "string" ? li.serviceId : "")));
  const expected = expectedItemsFor(determination.primaryServiceId);
  return expected.every((id) => presentIds.has(id));
}

/**
 * Estimate-not-binding check: is the GFE presented as an estimate, not a binding bill?
 * True unless a determination asserts binding === true; the guard that catches a
 * caller-asserted GFE presented as a final / binding charge. Anything
 * evaluateGoodFaithEstimate() produces satisfies it (binding is always false). This is the
 * honest signal the route reports to policy.gfe.estimate-not-binding. A non-object input is
 * a violation.
 */
export function gfeEstimateNotBinding(
  determination: { binding?: unknown } | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return determination.binding !== true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent
 * Fabric trace + the response `meta`. Carries no free-text PHI (refs, the primary, the
 * total, and the flags only).
 */
export function goodFaithEstimateSummary(determination: GoodFaithEstimateDetermination): {
  patientRef: string;
  providerRef: string;
  primaryServiceId: string;
  lineItemCount: number;
  totalEstimate: number;
  allLineItemsSourced: boolean;
  expectedItemsComplete: boolean;
  binding: boolean;
  synthetic: boolean;
} {
  return {
    patientRef: determination.patientRef,
    providerRef: determination.providerRef,
    primaryServiceId: determination.primaryServiceId,
    lineItemCount: determination.lineItems.length,
    totalEstimate: determination.totalEstimate,
    allLineItemsSourced: determination.allLineItemsSourced,
    expectedItemsComplete: determination.expectedItemsComplete,
    binding: determination.binding,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request (illustrative). A comprehensive menopause consult with its
 * expected hormone panel → a complete, sourced $580 estimate. Synthetic / de-identified.
 */
export const DEMO_GFE_REQUEST: GoodFaithEstimateRequest = {
  patientRef: "gfe-patient-001",
  providerRef: "gfe-provider-001",
  primaryServiceId: "svc.menopause-consult-comprehensive",
  lineItems: [
    { serviceId: "svc.menopause-consult-comprehensive", quantity: 1 },
    { serviceId: "svc.lab-panel-hormone", quantity: 1 }
  ]
};

/**
 * A representative demo request with imaging (illustrative). A DEXA with its expected office
 * visit → a complete, sourced $470 estimate. Synthetic / de-identified.
 */
export const DEMO_GFE_IMAGING_REQUEST: GoodFaithEstimateRequest = {
  patientRef: "gfe-patient-002",
  providerRef: "gfe-provider-002",
  primaryServiceId: "svc.bone-density-dexa",
  lineItems: [
    { serviceId: "svc.bone-density-dexa", quantity: 1 },
    { serviceId: "svc.office-visit-established", quantity: 1 }
  ]
};
