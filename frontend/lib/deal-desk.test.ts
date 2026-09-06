import { describe, expect, it } from "vitest";

import {
  DEAL_DESK_PRODUCTS,
  DEMO_QUOTE_BOUNDARY_REQUEST,
  DEMO_QUOTE_ESCALATE_REQUEST,
  DEMO_QUOTE_REQUEST,
  dealDeskCatalogSourced,
  dealDeskMathConsistent,
  dealDeskNoAutonomousApproval,
  evaluateQuote,
  getDealDeskProduct,
  quoteSummary
} from "./deal-desk";

describe("evaluateQuote", () => {
  it("auto-approves a quote where every line is within its guardrail", () => {
    const d = evaluateQuote(DEMO_QUOTE_REQUEST);
    expect(d.withinGuardrail).toBe(true);
    expect(d.disposition).toBe("auto-approve");
    expect(d.autoApproved).toBe(true);
    expect(d.requiresDealDeskApproval).toBe(false);
    expect(d.breachingLines).toEqual([]);
    // 120000*0.88 + 60000*0.82 + 24000*0.92 = 105600 + 49200 + 22080 = 176880
    expect(d.listTotal).toBe(204000);
    expect(d.netTotal).toBe(176880);
    expect(d.discountTotal).toBe(27120);
    expect(d.effectiveDiscountPct).toBeCloseTo(13.29, 2);
    expect(d.synthetic).toBe(true);
  });

  it("escalates a quote with an out-of-guardrail line", () => {
    const d = evaluateQuote(DEMO_QUOTE_ESCALATE_REQUEST);
    expect(d.withinGuardrail).toBe(false);
    expect(d.disposition).toBe("escalate-to-deal-desk");
    expect(d.autoApproved).toBe(false);
    expect(d.requiresDealDeskApproval).toBe(true);
    expect(d.breachingLines).toContain("product.platform-core");
    // platform-core 25% > 15% guardrail is the only breach; implementation 20% < 25% is fine.
    expect(d.breachingLines).not.toContain("product.implementation-services");
  });

  it("auto-approves a discount exactly at the guardrail (boundary)", () => {
    const d = evaluateQuote(DEMO_QUOTE_BOUNDARY_REQUEST);
    expect(d.withinGuardrail).toBe(true);
    expect(d.disposition).toBe("auto-approve");
    // 45000 * (1 - 0.25) = 33750
    expect(d.netTotal).toBe(33750);
    expect(d.effectiveDiscountPct).toBe(25);
  });

  it("treats an off-catalog product as not within guardrail", () => {
    const d = evaluateQuote({
      quoteRef: "q",
      accountRef: "a",
      lineItems: [
        { productId: "product.nope", listPrice: 1000, quantity: 1, proposedDiscountPct: 5 }
      ]
    });
    expect(d.lines[0].withinGuardrail).toBe(false);
    expect(d.lines[0].productName).toBe("unknown product");
    expect(d.withinGuardrail).toBe(false);
  });

  it("computes each line's list and net totals", () => {
    const d = evaluateQuote({
      quoteRef: "q",
      accountRef: "a",
      lineItems: [
        {
          productId: "product.data-cloud-activation",
          listPrice: 60000,
          quantity: 3,
          proposedDiscountPct: 10
        }
      ]
    });
    const line = d.lines[0];
    expect(line.lineListTotal).toBe(180000);
    expect(line.lineNetTotal).toBe(162000);
    expect(line.maxAutoApproveDiscountPct).toBe(20);
  });

  it("guards divide-by-zero when the list total is zero", () => {
    const d = evaluateQuote({
      quoteRef: "q",
      accountRef: "a",
      lineItems: [
        { productId: "product.platform-core", listPrice: 0, quantity: 1, proposedDiscountPct: 10 }
      ]
    });
    expect(d.listTotal).toBe(0);
    expect(d.effectiveDiscountPct).toBe(0);
  });

  it("is deterministic — same quote yields the same decision", () => {
    const a = evaluateQuote(DEMO_QUOTE_ESCALATE_REQUEST);
    const b = evaluateQuote(DEMO_QUOTE_ESCALATE_REQUEST);
    expect(a).toEqual(b);
  });
});

describe("getDealDeskProduct", () => {
  it("resolves a cataloged product", () => {
    expect(getDealDeskProduct("product.platform-core")?.maxAutoApproveDiscountPct).toBe(15);
  });
  it("returns undefined for an off-catalog product", () => {
    expect(getDealDeskProduct("product.nope")).toBeUndefined();
  });
  it("every catalog product has a non-negative guardrail", () => {
    for (const p of DEAL_DESK_PRODUCTS) {
      expect(p.maxAutoApproveDiscountPct).toBeGreaterThanOrEqual(0);
      expect(p.listPrice).toBeGreaterThan(0);
    }
  });
});

describe("dealDeskCatalogSourced", () => {
  it("passes a decision whose lines all price cataloged products", () => {
    expect(dealDeskCatalogSourced(evaluateQuote(DEMO_QUOTE_REQUEST))).toBe(true);
  });
  it("fails a decision pricing an off-catalog product", () => {
    expect(
      dealDeskCatalogSourced({ lines: [{ productId: "product.nope" }] })
    ).toBe(false);
  });
  it("fails a null / malformed input", () => {
    expect(dealDeskCatalogSourced(null)).toBe(false);
    expect(dealDeskCatalogSourced({})).toBe(false);
  });
});

describe("dealDeskMathConsistent", () => {
  it("passes a produced decision", () => {
    expect(dealDeskMathConsistent(evaluateQuote(DEMO_QUOTE_ESCALATE_REQUEST))).toBe(true);
  });
  it("fails when the net total does not match the lines", () => {
    const d = evaluateQuote(DEMO_QUOTE_BOUNDARY_REQUEST);
    expect(dealDeskMathConsistent({ ...d, netTotal: d.netTotal + 1000 })).toBe(false);
  });
  it("fails when a line's net total is wrong", () => {
    const d = evaluateQuote(DEMO_QUOTE_BOUNDARY_REQUEST);
    const lines = d.lines.map((l) => ({ ...l, lineNetTotal: l.lineNetTotal + 500 }));
    expect(dealDeskMathConsistent({ ...d, lines })).toBe(false);
  });
  it("fails a null / malformed input", () => {
    expect(dealDeskMathConsistent(null)).toBe(false);
    expect(dealDeskMathConsistent({})).toBe(false);
  });
});

describe("dealDeskNoAutonomousApproval", () => {
  it("passes an escalated out-of-guardrail decision", () => {
    expect(dealDeskNoAutonomousApproval(evaluateQuote(DEMO_QUOTE_ESCALATE_REQUEST))).toBe(true);
  });
  it("passes an auto-approved within-guardrail decision", () => {
    expect(dealDeskNoAutonomousApproval(evaluateQuote(DEMO_QUOTE_REQUEST))).toBe(true);
  });
  it("fails an out-of-guardrail decision marked auto-approved", () => {
    expect(
      dealDeskNoAutonomousApproval({
        withinGuardrail: false,
        autoApproved: true,
        requiresDealDeskApproval: false
      })
    ).toBe(false);
  });
  it("fails an out-of-guardrail decision that does not require approval", () => {
    expect(
      dealDeskNoAutonomousApproval({
        withinGuardrail: false,
        autoApproved: false,
        requiresDealDeskApproval: false
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(dealDeskNoAutonomousApproval(null)).toBe(false);
  });
});

describe("quoteSummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = quoteSummary(evaluateQuote(DEMO_QUOTE_ESCALATE_REQUEST));
    expect(s.disposition).toBe("escalate-to-deal-desk");
    expect(s.requiresDealDeskApproval).toBe(true);
    expect(s.synthetic).toBe(true);
    expect(typeof s.netTotal).toBe("number");
  });
});
