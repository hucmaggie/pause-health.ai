import { describe, expect, it } from "vitest";
import {
  CLAIM_EDIT_CATALOG,
  CLAIM_REASON_CODE_CATALOG,
  DEMO_CLEAN_CLAIM,
  DEMO_DUPLICATE_CLAIM,
  DEMO_LCD_PEND_CLAIM,
  DEMO_MULTI_EDIT_CLAIM,
  adjudicateClaim,
  decisionsCiteReasonCodes,
  denialRequiresAdjudicatorCosign,
  editsTraceToCatalog,
  evaluateClaimEdits,
  getClaimEdit,
  getClaimReasonCode,
  isClaimEdit,
  isClaimReasonCode,
  summarizeDecision
} from "./claims-adjudication";

/**
 * Tests for lib/claims-adjudication.ts — the deterministic first-pass
 * claims adjudicator behind the Claims Adjudication Agent. Adjudication is
 * a pure function of the request (no randomness, no clock), so the same
 * request always yields the same decision + edits + reason code. These
 * pin determinism, the catalog-sourced edit + reason-code lookups, the
 * decision precedence, and the three honest governance signals.
 */

describe("catalogs", () => {
  it("exposes an edit catalog + a reason-code catalog", () => {
    expect(CLAIM_EDIT_CATALOG.length).toBeGreaterThan(0);
    for (const e of CLAIM_EDIT_CATALOG) {
      expect(e.id).toMatch(/^edit\./);
      expect(e.synthetic).toBe(true);
      expect(["deny-drafted", "pend-clinical-review", "pend-adjudicator-review"]).toContain(
        e.defaultDecision
      );
    }
    expect(CLAIM_REASON_CODE_CATALOG.length).toBeGreaterThan(0);
    for (const c of CLAIM_REASON_CODE_CATALOG) {
      expect(c.id).toMatch(/^reason\./);
      expect(c.synthetic).toBe(true);
    }
  });

  it("catalog lookups agree with the catalogs", () => {
    for (const e of CLAIM_EDIT_CATALOG) {
      expect(isClaimEdit(e.id)).toBe(true);
      expect(getClaimEdit(e.id)?.label).toBe(e.label);
    }
    expect(isClaimEdit("edit.made-up")).toBe(false);
    for (const c of CLAIM_REASON_CODE_CATALOG) {
      expect(isClaimReasonCode(c.id)).toBe(true);
      expect(getClaimReasonCode(c.id)?.label).toBe(c.label);
    }
    expect(isClaimReasonCode("reason.made-up")).toBe(false);
    expect(isClaimEdit(42)).toBe(false);
  });
});

describe("evaluateClaimEdits", () => {
  it("returns an empty array for a clean claim", () => {
    const hits = evaluateClaimEdits(DEMO_CLEAN_CLAIM);
    expect(hits).toEqual([]);
  });

  it("fires the duplicate-submission edit for a repeat claim", () => {
    const hits = evaluateClaimEdits(DEMO_DUPLICATE_CLAIM);
    expect(hits.map((h) => h.editId)).toEqual(["edit.duplicate-submission"]);
    expect(hits[0].reasonCode).toBe("reason.CO-18");
  });

  it("fires the LCD edit for a claim flagged under LCD review", () => {
    const hits = evaluateClaimEdits(DEMO_LCD_PEND_CLAIM);
    expect(hits.map((h) => h.editId)).toEqual(["edit.lcd-coverage"]);
  });

  it("fires multiple edits on a claim with multiple problems + sorts by edit-id", () => {
    const hits = evaluateClaimEdits(DEMO_MULTI_EDIT_CLAIM);
    const ids = hits.map((h) => h.editId);
    expect(ids).toEqual(
      [
        "edit.out-of-network",
        "edit.prior-auth-missing",
        "edit.timely-filing-window"
      ].sort()
    );
  });

  it("fires NCCI-PTP unbundling when a mutually-exclusive pair is on the claim", () => {
    const hits = evaluateClaimEdits({
      ...DEMO_CLEAN_CLAIM,
      lines: [
        { lineId: "line-1", cptCode: "10001", billedAmountCents: 5000 },
        { lineId: "line-2", cptCode: "10002", billedAmountCents: 5000 }
      ],
      benefits: {
        ...DEMO_CLEAN_CLAIM.benefits,
        ncciPtpPairs: [["10001", "10002"]]
      }
    });
    expect(hits.map((h) => h.editId)).toContain("edit.ncci-ptp-unbundling");
  });
});

describe("summarizeDecision", () => {
  it("clean-pay when no edits hit", () => {
    const s = summarizeDecision([]);
    expect(s.decision).toBe("clean-pay");
    expect(s.primaryReasonCode).toBeNull();
    expect(s.routedTo).toBe("clean-pay-auto-post");
  });

  it("deny-drafted beats pend-clinical-review beats pend-adjudicator-review", () => {
    const hits = evaluateClaimEdits(DEMO_MULTI_EDIT_CLAIM);
    const s = summarizeDecision(hits);
    // Timely-filing → deny-drafted, so deny wins.
    expect(s.decision).toBe("deny-drafted");
    expect(s.primaryReasonCode).toBe("reason.CO-29");
    expect(s.routedTo).toBe("adjudicator");
  });

  it("pend-clinical-review for an LCD claim without denial-tier edits", () => {
    const hits = evaluateClaimEdits(DEMO_LCD_PEND_CLAIM);
    const s = summarizeDecision(hits);
    expect(s.decision).toBe("pend-clinical-review");
    expect(s.primaryReasonCode).toBe("reason.CO-50");
    expect(s.routedTo).toBe("clinical-reviewer");
  });
});

describe("adjudicateClaim", () => {
  it("is deterministic — same request always yields the same decision", () => {
    expect(adjudicateClaim(DEMO_CLEAN_CLAIM)).toEqual(adjudicateClaim(DEMO_CLEAN_CLAIM));
  });

  it("produces a clean-pay decision for the clean claim", () => {
    const d = adjudicateClaim(DEMO_CLEAN_CLAIM);
    expect(d.decision).toBe("clean-pay");
    expect(d.appliedEdits).toEqual([]);
    expect(d.primaryReasonCode).toBeNull();
    expect(d.requiresAdjudicatorCosign).toBe(false);
    expect(d.cosigned).toBe(false);
    expect(d.totalBilledCents).toBe(31000);
  });

  it("produces a deny-drafted decision that requires adjudicator cosign", () => {
    const d = adjudicateClaim(DEMO_DUPLICATE_CLAIM);
    expect(d.decision).toBe("deny-drafted");
    expect(d.primaryReasonCode).toBe("reason.CO-18");
    expect(d.requiresAdjudicatorCosign).toBe(true);
    expect(d.cosigned).toBe(false);
    expect(d.routedTo).toBe("adjudicator");
  });

  it("produces a pend-clinical-review decision for an LCD claim (no cosign gate needed)", () => {
    const d = adjudicateClaim(DEMO_LCD_PEND_CLAIM);
    expect(d.decision).toBe("pend-clinical-review");
    expect(d.requiresAdjudicatorCosign).toBe(false);
  });
});

describe("governance signals", () => {
  const cleanDecision = adjudicateClaim(DEMO_CLEAN_CLAIM);
  const denyDecision = adjudicateClaim(DEMO_DUPLICATE_CLAIM);
  const pendDecision = adjudicateClaim(DEMO_LCD_PEND_CLAIM);

  it("editsTraceToCatalog: true for produced edits, false for off-catalog", () => {
    expect(editsTraceToCatalog(denyDecision.appliedEdits)).toBe(true);
    expect(editsTraceToCatalog([])).toBe(true);
    expect(editsTraceToCatalog([{ editId: "edit.made-up" }])).toBe(false);
    expect(editsTraceToCatalog(null)).toBe(false);
  });

  it("denialRequiresAdjudicatorCosign: true for cosign-gated denials, false when bypassed", () => {
    expect(denialRequiresAdjudicatorCosign(denyDecision)).toBe(true);
    // Non-denial decisions trivially pass.
    expect(denialRequiresAdjudicatorCosign(cleanDecision)).toBe(true);
    expect(denialRequiresAdjudicatorCosign(pendDecision)).toBe(true);
    // Denial that claims cosigned:true fails.
    expect(
      denialRequiresAdjudicatorCosign({
        ...denyDecision,
        cosigned: true
      } as unknown as typeof denyDecision)
    ).toBe(false);
    // Denial that claims requiresAdjudicatorCosign:false fails.
    expect(
      denialRequiresAdjudicatorCosign({
        ...denyDecision,
        requiresAdjudicatorCosign: false
      })
    ).toBe(false);
    expect(denialRequiresAdjudicatorCosign(null)).toBe(false);
  });

  it("decisionsCiteReasonCodes: true for produced decisions, false when reason code missing / off-catalog", () => {
    expect(decisionsCiteReasonCodes(cleanDecision)).toBe(true); // clean-pay is exempt
    expect(decisionsCiteReasonCodes(denyDecision)).toBe(true);
    expect(decisionsCiteReasonCodes(pendDecision)).toBe(true);
    // Non-clean-pay with a null reason code fails.
    expect(
      decisionsCiteReasonCodes({
        ...denyDecision,
        primaryReasonCode: null
      })
    ).toBe(false);
    // Non-clean-pay with an off-catalog reason code fails.
    expect(
      decisionsCiteReasonCodes({
        ...denyDecision,
        primaryReasonCode: "reason.made-up"
      })
    ).toBe(false);
    // Non-clean-pay with an off-catalog reason on an appliedEdits row fails.
    expect(
      decisionsCiteReasonCodes({
        ...denyDecision,
        appliedEdits: [...denyDecision.appliedEdits, { reasonCode: "reason.made-up" }]
      })
    ).toBe(false);
    expect(decisionsCiteReasonCodes(null)).toBe(false);
  });
});
