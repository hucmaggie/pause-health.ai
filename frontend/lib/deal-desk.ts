/**
 * Deal Desk / Quote Approval (CPQ) — the deterministic, transparent guardrail layer that validates a
 * proposed B2B quote for a Pause-Health enterprise deal against a recorded pricing / discount-
 * guardrail catalog, computes the quote totals + the effective blended discount, and decides whether
 * the quote can be AUTO-APPROVED (every line within its product's guardrail) or must ESCALATE to a
 * human deal-desk owner (any line's discount exceeds its guardrail) — NEVER autonomously approving an
 * out-of-guardrail discount.
 *
 * Deterministic, dependency-free domain core the Deal Desk Agent (app/api/agents/deal-desk) wraps — a
 * COMMERCIAL-OPERATIONS agent on the strictly PHI-separated commercial plane of Pause's Agent Fabric.
 * This is Pause's OWN go-to-market tooling (selling the platform to health systems / payers /
 * employers), NOT a patient-facing agent: it runs on Sales Cloud commercial data only and never
 * reads, joins, or derives patient PHI. Given a proposed quote (an account reference and a set of
 * line items, each a product, its list price, a quantity, and a proposed discount %), it
 * DETERMINISTICALLY prices each line, sums the list / net / discount totals, computes the effective
 * blended discount, checks each line's discount against its product's max auto-approve guardrail, and
 * decides the disposition.
 *
 *   Inbound:  a QuoteRequest { quoteRef, accountRef, lineItems[] }
 *   Outbound: a QuoteDecision { lines[], listTotal, netTotal, discountTotal, effectiveDiscountPct,
 *             withinGuardrail, breachingLines[], disposition, autoApproved,
 *             requiresDealDeskApproval, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other commercial-operations agents: distinct from the
 * Pipeline Management agent (the B2B opportunity pipeline / forecast roll-up), the Account Management
 * agent (post-close renewals / expansion / health), and the Provider Contracting agent (the payer↔
 * provider network CONTRACT, a different plane relationship): this validates a proposed SALES QUOTE's
 * pricing and discounting against the deal-desk guardrails.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every line prices from the recorded pricing catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Each line's product and its discount guardrail must resolve in the recorded pricing catalog — an
 *  ad-hoc / off-catalog product cannot be correctly priced or guardrailed. dealDeskCatalogSourced()
 *  reports the honest signal the Agent Fabric enforces via policy.dealdesk.pricing-catalog-sourced.
 *  (Mirrors the Provider Contracting Agent's contract-type-catalog-sourced and the Good Faith
 *  Estimate Agent's charge-master-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the quote totals equal the computed sums.
 * ─────────────────────────────────────────────────────────────────────
 *  The quote's list total, net total, and effective discount must equal the recomputed sums of the
 *  lines — a guessed / hidden total is how an out-of-guardrail quote is dressed up as compliant.
 *  dealDeskMathConsistent() recomputes the totals from the determination's own line items and
 *  verifies they match; it reports the honest signal the Agent Fabric enforces via
 *  policy.dealdesk.discount-math-consistent. (The load-bearing correctness gate — mirrors the Good
 *  Faith Estimate Agent's math-consistent and the Subrogation Agent's recoverable-within-paid.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: an out-of-guardrail discount is never autonomously approved.
 * ─────────────────────────────────────────────────────────────────────
 *  A quote with any line whose discount exceeds its product's max auto-approve guardrail may NEVER be
 *  auto-approved — it must escalate to a human deal-desk owner. dealDeskNoAutonomousApproval() reports
 *  the honest signal the Agent Fabric enforces via
 *  policy.dealdesk.no-autonomous-out-of-guardrail-approval. (Mirrors the Account Management Agent's
 *  human-owner-before-contract-change and the Provider Contracting Agent's no-autonomous-term-change
 *  posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DECISION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A decision — auto-approve OR escalate — is a SAFE, honest OUTPUT: the task COMPLETES (an
 *  out-of-guardrail quote carries requiresDealDeskApproval:true). A within-guardrail quote is
 *  genuinely auto-approvable (a standard-discount quote does not need a human) — this is a low-risk
 *  commercial action, NOT a PHI / clinical decision. A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DECISION (an off-catalog product, totals that don't add up, or an out-of-guardrail quote
 *  marked auto-approved) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified CPQ / pricing system.
 * ─────────────────────────────────────────────────────────────────────
 *  The product catalog + guardrail percentages below are clearly-labeled ILLUSTRATIVE synthetics
 *  chosen to model the SHAPE of a deal-desk approval deterministically in the demo. Real quoting is
 *  governed by the company's CPQ system (e.g. Salesforce Revenue Cloud), its approved price book, and
 *  its deal-desk / finance discount-approval matrix. There is NO randomness and NO clock anywhere
 *  here: the decision is a pure function of the quote's own line items, so the same quote always
 *  yields the same totals / guardrail result / disposition — which is what lets the demo, the seeded
 *  trace, and the tests agree.
 */

/** Round to cents (avoids binary-float drift in the pricing math + the guards). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Money / percentage comparison tolerance. */
const EPSILON = 0.01;

/** A recorded product (a catalog entry that grounds pricing + the discount guardrail). */
export type DealDeskProduct = {
  /** Stable product id. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** The reference list price per unit. */
  listPrice: number;
  /** The maximum discount % the deal desk may AUTO-approve without human escalation. */
  maxAutoApproveDiscountPct: number;
};

/**
 * ILLUSTRATIVE, synthetic Pause-Health product catalog — clearly labeled, NOT a real price book.
 * Each line item must reference one of these, and its discount is guardrailed by the product's
 * max auto-approve discount.
 */
export const DEAL_DESK_PRODUCTS: DealDeskProduct[] = [
  {
    id: "product.platform-core",
    name: "Pause Platform — Core (per-provider-org / yr)",
    listPrice: 120000,
    maxAutoApproveDiscountPct: 15
  },
  {
    id: "product.data-cloud-activation",
    name: "Data 360 Activation (per-org / yr)",
    listPrice: 60000,
    maxAutoApproveDiscountPct: 20
  },
  {
    id: "product.premium-support",
    name: "Premium Support & SLA (per-org / yr)",
    listPrice: 24000,
    maxAutoApproveDiscountPct: 10
  },
  {
    id: "product.implementation-services",
    name: "Implementation & Onboarding (one-time)",
    listPrice: 45000,
    maxAutoApproveDiscountPct: 25
  }
];

/** Look up a product by id (undefined when off-catalog). */
export function getDealDeskProduct(id: string): DealDeskProduct | undefined {
  return DEAL_DESK_PRODUCTS.find((p) => p.id === id);
}

/** A proposed quote line item. */
export type QuoteLineItem = {
  /** The product id (must resolve in the catalog). */
  productId: string;
  /** The list price per unit as quoted (should match the catalog reference). */
  listPrice: number;
  /** The quantity. */
  quantity: number;
  /** The proposed discount %, e.g. 15 for 15%. */
  proposedDiscountPct: number;
};

/** A quote-approval request. */
export type QuoteRequest = {
  /** Synthetic quote reference. */
  quoteRef: string;
  /** Synthetic account reference. */
  accountRef: string;
  /** The proposed line items. */
  lineItems: QuoteLineItem[];
};

/** How the deal is dispositioned. */
export type QuoteDisposition = "auto-approve" | "escalate-to-deal-desk";

/** A priced + guardrail-checked line. */
export type PricedLine = {
  productId: string;
  productName: string;
  listPrice: number;
  quantity: number;
  proposedDiscountPct: number;
  /** The product's max auto-approve discount (0 when off-catalog). */
  maxAutoApproveDiscountPct: number;
  /** listPrice × quantity. */
  lineListTotal: number;
  /** lineListTotal × (1 − discount/100). */
  lineNetTotal: number;
  /** Whether the line's discount is within its product's guardrail. */
  withinGuardrail: boolean;
};

/** The deterministic quote decision the agent returns. */
export type QuoteDecision = {
  /** Synthetic quote reference. */
  quoteRef: string;
  /** Synthetic account reference. */
  accountRef: string;
  /** The priced + guardrail-checked lines. */
  lines: PricedLine[];
  /** Σ line list totals. */
  listTotal: number;
  /** Σ line net totals. */
  netTotal: number;
  /** listTotal − netTotal. */
  discountTotal: number;
  /** The effective blended discount % ((listTotal − netTotal) / listTotal × 100). */
  effectiveDiscountPct: number;
  /** Whether every line is within its guardrail. */
  withinGuardrail: boolean;
  /** The product ids whose discount breaches the guardrail. */
  breachingLines: string[];
  /** The disposition. */
  disposition: QuoteDisposition;
  /** Whether the quote was auto-approved (true only when within guardrail). */
  autoApproved: boolean;
  /** Whether the quote requires a human deal-desk owner's approval. */
  requiresDealDeskApproval: boolean;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the catalog + guardrails are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * The deterministic deal-desk function — the heart of the service. DETERMINISTIC: a pure function of
 * the quote's own line items (no randomness, no clock). It prices each line, sums the totals,
 * computes the effective blended discount, checks each line's discount against its product's
 * guardrail, and decides whether the quote auto-approves or must escalate to a human deal-desk owner.
 * Nothing is committed here — an out-of-guardrail quote is escalated, never auto-approved.
 */
export function evaluateQuote(request: QuoteRequest): QuoteDecision {
  const lines: PricedLine[] = request.lineItems.map((item) => {
    const product = getDealDeskProduct(item.productId);
    const lineListTotal = round2(item.listPrice * item.quantity);
    const lineNetTotal = round2(lineListTotal * (1 - item.proposedDiscountPct / 100));
    const maxAutoApproveDiscountPct = product?.maxAutoApproveDiscountPct ?? 0;
    // An off-catalog product can never be within guardrail (it is caught separately by the
    // catalog-sourced guard, but we also refuse to call it compliant here).
    const withinGuardrail =
      product !== undefined && item.proposedDiscountPct <= maxAutoApproveDiscountPct + EPSILON;
    return {
      productId: item.productId,
      productName: product?.name ?? "unknown product",
      listPrice: round2(item.listPrice),
      quantity: item.quantity,
      proposedDiscountPct: item.proposedDiscountPct,
      maxAutoApproveDiscountPct,
      lineListTotal,
      lineNetTotal,
      withinGuardrail
    };
  });

  const listTotal = round2(lines.reduce((sum, l) => sum + l.lineListTotal, 0));
  const netTotal = round2(lines.reduce((sum, l) => sum + l.lineNetTotal, 0));
  const discountTotal = round2(listTotal - netTotal);
  const effectiveDiscountPct =
    listTotal > 0 ? round2((discountTotal / listTotal) * 100) : 0;

  const breachingLines = lines.filter((l) => !l.withinGuardrail).map((l) => l.productId);
  const withinGuardrail = breachingLines.length === 0;

  const disposition: QuoteDisposition = withinGuardrail
    ? "auto-approve"
    : "escalate-to-deal-desk";
  const autoApproved = withinGuardrail;
  const requiresDealDeskApproval = !withinGuardrail;

  const reason = withinGuardrail
    ? `Quote ${request.quoteRef} for ${request.accountRef}: net ${netTotal.toFixed(2)} (${effectiveDiscountPct.toFixed(1)}% effective discount) — every line within its discount guardrail; auto-approved`
    : `Quote ${request.quoteRef} for ${request.accountRef}: net ${netTotal.toFixed(2)} (${effectiveDiscountPct.toFixed(1)}% effective discount) — ${breachingLines.length} line(s) exceed the discount guardrail (${breachingLines.join(", ")}); ESCALATED to a human deal-desk owner, never auto-approved`;

  return {
    quoteRef: request.quoteRef,
    accountRef: request.accountRef,
    lines,
    listTotal,
    netTotal,
    discountTotal,
    effectiveDiscountPct,
    withinGuardrail,
    breachingLines,
    disposition,
    autoApproved,
    requiresDealDeskApproval,
    reason,
    synthetic: true,
    note:
      `Deal-desk quote ${request.quoteRef}: list ${listTotal.toFixed(2)} / net ${netTotal.toFixed(2)} / ${effectiveDiscountPct.toFixed(1)}% effective discount, ${withinGuardrail ? "within guardrail — auto-approved" : `${breachingLines.length} line(s) out of guardrail — escalated to deal-desk owner`}. ` +
      "Commercial plane — NO patient PHI. Synthetic/illustrative product catalog + guardrails — NOT a certified CPQ / pricing system; real quoting is governed by the company's CPQ (e.g. Salesforce Revenue Cloud), its approved price book, and its deal-desk / finance discount-approval matrix."
  };
}

/**
 * Pricing-catalog-sourced check: does every line reference a recorded product? True only when each
 * line's product id resolves in the catalog; the guard that catches an ad-hoc / off-catalog product
 * (which cannot be correctly priced or guardrailed). Anything evaluateQuote() produces from cataloged
 * products satisfies it. This is the honest signal the route reports to
 * policy.dealdesk.pricing-catalog-sourced. A non-object input is a violation.
 */
export function dealDeskCatalogSourced(
  decision: { lines?: Array<{ productId?: string }> } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (!Array.isArray(decision.lines)) return false;
  return decision.lines.every(
    (l) => typeof l?.productId === "string" && getDealDeskProduct(l.productId) !== undefined
  );
}

/**
 * Discount-math-consistent check: do the quote totals equal the recomputed sums? True unless a line's
 * list/net total, or the quote's list/net/discount totals or effective discount, disagree with the
 * recomputation from the line items; the guard that catches a guessed / hidden total. Anything
 * evaluateQuote() produces satisfies it. This is the honest signal the route reports to
 * policy.dealdesk.discount-math-consistent. A non-object / malformed input is a violation.
 */
export function dealDeskMathConsistent(
  decision:
    | {
        lines?: Array<{
          listPrice?: number;
          quantity?: number;
          proposedDiscountPct?: number;
          lineListTotal?: number;
          lineNetTotal?: number;
        }>;
        listTotal?: number;
        netTotal?: number;
        discountTotal?: number;
        effectiveDiscountPct?: number;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (!Array.isArray(decision.lines)) return false;

  let listTotal = 0;
  let netTotal = 0;
  for (const l of decision.lines) {
    if (
      typeof l?.listPrice !== "number" ||
      typeof l.quantity !== "number" ||
      typeof l.proposedDiscountPct !== "number" ||
      typeof l.lineListTotal !== "number" ||
      typeof l.lineNetTotal !== "number"
    ) {
      return false;
    }
    const expectedLineList = round2(l.listPrice * l.quantity);
    const expectedLineNet = round2(expectedLineList * (1 - l.proposedDiscountPct / 100));
    if (Math.abs(expectedLineList - l.lineListTotal) > EPSILON) return false;
    if (Math.abs(expectedLineNet - l.lineNetTotal) > EPSILON) return false;
    listTotal += expectedLineList;
    netTotal += expectedLineNet;
  }
  listTotal = round2(listTotal);
  netTotal = round2(netTotal);
  const discountTotal = round2(listTotal - netTotal);
  const effectiveDiscountPct = listTotal > 0 ? round2((discountTotal / listTotal) * 100) : 0;

  if (typeof decision.listTotal !== "number" || Math.abs(decision.listTotal - listTotal) > EPSILON) {
    return false;
  }
  if (typeof decision.netTotal !== "number" || Math.abs(decision.netTotal - netTotal) > EPSILON) {
    return false;
  }
  if (
    typeof decision.discountTotal === "number" &&
    Math.abs(decision.discountTotal - discountTotal) > EPSILON
  ) {
    return false;
  }
  if (
    typeof decision.effectiveDiscountPct === "number" &&
    Math.abs(decision.effectiveDiscountPct - effectiveDiscountPct) > EPSILON
  ) {
    return false;
  }
  return true;
}

/**
 * No-autonomous-out-of-guardrail-approval check: did the agent avoid auto-approving an out-of-
 * guardrail quote? True unless the decision is not within guardrail AND it was auto-approved (or does
 * not require deal-desk approval); the guard that catches an autonomously-approved discount exception.
 * Anything evaluateQuote() produces satisfies it. This is the honest signal the route reports to
 * policy.dealdesk.no-autonomous-out-of-guardrail-approval. A non-object input is a violation.
 */
export function dealDeskNoAutonomousApproval(
  decision:
    | { withinGuardrail?: boolean; autoApproved?: boolean; requiresDealDeskApproval?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.withinGuardrail === false) {
    if (decision.autoApproved === true) return false;
    if (decision.requiresDealDeskApproval === false) return false;
  }
  return true;
}

/**
 * A compact, trace-safe summary of a decision — the shape stamped onto the Agent Fabric trace + the
 * response `meta`.
 */
export function quoteSummary(decision: QuoteDecision): {
  quoteRef: string;
  accountRef: string;
  listTotal: number;
  netTotal: number;
  effectiveDiscountPct: number;
  withinGuardrail: boolean;
  disposition: QuoteDisposition;
  requiresDealDeskApproval: boolean;
  synthetic: boolean;
} {
  return {
    quoteRef: decision.quoteRef,
    accountRef: decision.accountRef,
    listTotal: decision.listTotal,
    netTotal: decision.netTotal,
    effectiveDiscountPct: decision.effectiveDiscountPct,
    withinGuardrail: decision.withinGuardrail,
    disposition: decision.disposition,
    requiresDealDeskApproval: decision.requiresDealDeskApproval,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a standard quote where every line's discount is within its
 * guardrail → auto-approved. Synthetic.
 */
export const DEMO_QUOTE_REQUEST: QuoteRequest = {
  quoteRef: "quote-001",
  accountRef: "account-northstar-health",
  lineItems: [
    { productId: "product.platform-core", listPrice: 120000, quantity: 1, proposedDiscountPct: 12 },
    {
      productId: "product.data-cloud-activation",
      listPrice: 60000,
      quantity: 1,
      proposedDiscountPct: 18
    },
    { productId: "product.premium-support", listPrice: 24000, quantity: 1, proposedDiscountPct: 8 }
  ]
};

/**
 * A representative demo request: a quote where the platform-core line's 25% discount exceeds its 15%
 * guardrail → escalated to a human deal-desk owner. Synthetic.
 */
export const DEMO_QUOTE_ESCALATE_REQUEST: QuoteRequest = {
  quoteRef: "quote-002",
  accountRef: "account-cascade-systems",
  lineItems: [
    { productId: "product.platform-core", listPrice: 120000, quantity: 2, proposedDiscountPct: 25 },
    {
      productId: "product.implementation-services",
      listPrice: 45000,
      quantity: 1,
      proposedDiscountPct: 20
    }
  ]
};

/**
 * A representative demo request: a deep-discount services quote right at its 25% guardrail →
 * auto-approved (boundary case). Synthetic.
 */
export const DEMO_QUOTE_BOUNDARY_REQUEST: QuoteRequest = {
  quoteRef: "quote-003",
  accountRef: "account-summit-clinics",
  lineItems: [
    {
      productId: "product.implementation-services",
      listPrice: 45000,
      quantity: 1,
      proposedDiscountPct: 25
    }
  ]
};
