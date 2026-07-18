import { describe, expect, it } from "vitest";
import {
  CLAIM_STATUSES,
  type ClaimRecord,
  DEFAULT_MEMBER_ID,
  DEMO_BILLING_QUERY,
  answerBillingQuestion,
  answerTracesToClaim,
  billingAnswerSummary,
  classifyIntent,
  generateClaims
} from "./member-service";

/**
 * Tests for lib/member-service.ts — the deterministic synthetic claim/EOB
 * billing-answer engine behind the Member Service / Billing Agent. Generation
 * and answering are pure functions of the inputs (no randomness, no clock), so
 * the same member always yields the same claims and the same question always
 * answers identically. These pin determinism, claim-generation ranges + status
 * consistency, that EVERY in-scope answer cites a claim record, the route-to-
 * human context bundle on an out-of-scope request, and the rejection/flagging
 * of an unsourced (fabricated) answer.
 */

/** A finalized adjudicated claim fixture (member owes a patient balance). */
function adjudicatedClaim(overrides: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    claimId: "clm-fixture-adj",
    dateOfService: "2026-01-20",
    provider: "Pause MSCP Telehealth (synthetic)",
    billedAmount: 400,
    allowedAmount: 240,
    planPaid: 192,
    patientResponsibility: 48,
    status: "adjudicated",
    synthetic: true,
    ...overrides
  };
}

describe("generateClaims · determinism + ranges", () => {
  it("is deterministic — the same member yields the same claims", () => {
    expect(generateClaims(DEFAULT_MEMBER_ID)).toEqual(
      generateClaims(DEFAULT_MEMBER_ID)
    );
  });

  it("different members yield different claim ids", () => {
    const a = generateClaims("member-a").map((c) => c.claimId);
    const b = generateClaims("member-b").map((c) => c.claimId);
    expect(a).not.toEqual(b);
  });

  it("generates the requested number of claims, sorted most-recent first", () => {
    const claims = generateClaims(DEFAULT_MEMBER_ID, 6);
    expect(claims).toHaveLength(6);
    for (let i = 1; i < claims.length; i++) {
      expect(
        claims[i - 1].dateOfService >= claims[i].dateOfService
      ).toBe(true);
    }
  });

  it("every claim has realistic figures + a valid status + the synthetic marker", () => {
    for (const c of generateClaims(DEFAULT_MEMBER_ID, 12)) {
      expect(c.claimId).toMatch(/^clm-/);
      expect(c.synthetic).toBe(true);
      expect(CLAIM_STATUSES).toContain(c.status);
      expect(c.dateOfService).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Billed range $150–$1,025 in $25 steps.
      expect(c.billedAmount).toBeGreaterThanOrEqual(150);
      expect(c.billedAmount).toBeLessThanOrEqual(1025);
      expect(c.billedAmount % 25).toBe(0);
      // Amounts are non-negative and never exceed the billed charge.
      for (const n of [c.allowedAmount, c.planPaid, c.patientResponsibility]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(c.billedAmount);
      }
      if (c.status === "adjudicated" || c.status === "paid") {
        // Finalized: allowed splits into plan-paid + patient responsibility.
        expect(c.allowedAmount).toBeGreaterThan(0);
        expect(c.planPaid + c.patientResponsibility).toBe(c.allowedAmount);
      } else {
        // Submitted / denied: no finalized amounts invented.
        expect(c.allowedAmount).toBe(0);
        expect(c.planPaid).toBe(0);
        expect(c.patientResponsibility).toBe(0);
      }
    }
  });
});

describe("classifyIntent · billing/coverage self-service scope", () => {
  it("classifies the four in-scope billing intents", () => {
    expect(classifyIntent("what is the status of my claim?")).toBe(
      "claim-status"
    );
    expect(classifyIntent("how much do I owe for my last visit?")).toBe(
      "patient-responsibility"
    );
    expect(classifyIntent("what is my copay?")).toBe("patient-responsibility");
    expect(classifyIntent("what is my outstanding balance?")).toBe("balance");
    expect(classifyIntent("can you explain my EOB?")).toBe("eob-explanation");
  });

  it("routes clinical / prescription / scheduling requests out of scope", () => {
    expect(classifyIntent("can I reschedule my appointment?")).toBe(
      "out-of-scope"
    );
    expect(classifyIntent("I need a refill of my HRT prescription")).toBe(
      "out-of-scope"
    );
    expect(classifyIntent("what dose should I take?")).toBe("out-of-scope");
    expect(classifyIntent("")).toBe("out-of-scope");
    expect(classifyIntent("hello there")).toBe("out-of-scope");
  });

  it("is deterministic", () => {
    expect(classifyIntent(DEMO_BILLING_QUERY)).toBe(
      classifyIntent(DEMO_BILLING_QUERY)
    );
  });
});

describe("answerBillingQuestion · every in-scope answer cites a claim", () => {
  const claims = generateClaims(DEFAULT_MEMBER_ID);

  it("is deterministic", () => {
    expect(answerBillingQuestion(DEMO_BILLING_QUERY, claims)).toEqual(
      answerBillingQuestion(DEMO_BILLING_QUERY, claims)
    );
  });

  it("every in-scope intent returns a claim-cited billing answer", () => {
    for (const query of [
      "what is the status of my claim?",
      "how much do I owe?",
      "what is my balance?",
      "explain my EOB"
    ]) {
      const answer = answerBillingQuestion(query, claims);
      expect(answer.kind).toBe("billing-answer");
      expect(answer.citedClaims.length).toBeGreaterThan(0);
      for (const c of answer.citedClaims) {
        expect(c.claimId).toMatch(/^clm-/);
        expect(c.synthetic).toBe(true);
      }
      expect(answer.source.synthetic).toBe(true);
      expect(answer.routeToHuman.required).toBe(false);
      expect(answerTracesToClaim(answer)).toBe(true);
    }
  });

  it("a patient-responsibility answer states the amount from an adjudicated claim", () => {
    const answer = answerBillingQuestion("how much do I owe?", [
      adjudicatedClaim()
    ]);
    expect(answer.intent).toBe("patient-responsibility");
    expect(answer.citedClaims[0].claimId).toBe("clm-fixture-adj");
    expect(answer.answer).toContain("$48");
  });

  it("a balance answer sums patient responsibility across outstanding claims", () => {
    const answer = answerBillingQuestion("what is my balance?", [
      adjudicatedClaim({ claimId: "clm-a", patientResponsibility: 48 }),
      adjudicatedClaim({ claimId: "clm-b", patientResponsibility: 30 }),
      adjudicatedClaim({
        claimId: "clm-paid",
        status: "paid",
        patientResponsibility: 20
      })
    ]);
    expect(answer.intent).toBe("balance");
    // Only the two adjudicated (outstanding) claims contribute: $48 + $30 = $78.
    expect(answer.answer).toContain("$78");
    expect(answer.citedClaims.map((c) => c.claimId).sort()).toEqual([
      "clm-a",
      "clm-b"
    ]);
  });
});

describe("answerBillingQuestion · route-to-human context bundle", () => {
  const claims = generateClaims(DEFAULT_MEMBER_ID);

  it("routes an out-of-scope request to a human with a PII-safe context bundle", () => {
    const answer = answerBillingQuestion(
      "can I reschedule my appointment?",
      claims
    );
    expect(answer.intent).toBe("out-of-scope");
    expect(answer.kind).toBe("route-to-human");
    expect(answer.citedClaims).toHaveLength(0);
    expect(answer.routeToHuman.required).toBe(true);
    expect(answer.routeToHuman.queue).toBe("member-services-billing");
    expect(answer.routeToHuman.reason.length).toBeGreaterThan(0);
    // The context bundle carries recent claim ids for the human — structured
    // signals only, no free-text PII.
    expect(answer.routeToHuman.contextBundle.intent).toBe("out-of-scope");
    expect(answer.routeToHuman.contextBundle.claimCount).toBe(claims.length);
    expect(
      answer.routeToHuman.contextBundle.citedClaimIds.length
    ).toBeGreaterThan(0);
    // A handoff asserts no billing figure, so it is honestly source-clean.
    expect(answerTracesToClaim(answer)).toBe(true);
  });

  it("routes an in-scope question with NO claim on file to a human rather than inventing a figure", () => {
    const answer = answerBillingQuestion("how much do I owe?", []);
    expect(answer.kind).toBe("route-to-human");
    expect(answer.routeToHuman.required).toBe(true);
    expect(answer.citedClaims).toHaveLength(0);
  });
});

describe("answerTracesToClaim · claim-sourced honesty signal", () => {
  it("is true for an in-scope answer that cites a claim", () => {
    const answer = answerBillingQuestion("explain my EOB", [
      adjudicatedClaim()
    ]);
    expect(answerTracesToClaim(answer)).toBe(true);
  });

  it("is true for a route-to-human handoff (no billing figure asserted)", () => {
    const answer = answerBillingQuestion("reschedule my appointment", []);
    expect(answerTracesToClaim(answer)).toBe(true);
  });

  it("is FALSE for a caller-asserted billing answer with no cited claim (fabricated)", () => {
    expect(
      answerTracesToClaim({ kind: "billing-answer", citedClaims: [] })
    ).toBe(false);
    expect(answerTracesToClaim(null)).toBe(false);
    expect(answerTracesToClaim(undefined)).toBe(false);
  });

  it("is FALSE for a billing answer citing a non-synthetic / id-less claim", () => {
    expect(
      answerTracesToClaim({
        kind: "billing-answer",
        citedClaims: [{ claimId: "", synthetic: true } as ClaimRecord]
      })
    ).toBe(false);
  });
});

describe("billingAnswerSummary · trace-safe projection", () => {
  it("projects a compact, PII-safe summary of the answer", () => {
    const answer = answerBillingQuestion("how much do I owe?", [
      adjudicatedClaim()
    ]);
    const summary = billingAnswerSummary(answer);
    expect(summary.intent).toBe("patient-responsibility");
    expect(summary.kind).toBe("billing-answer");
    expect(summary.citedClaimIds).toEqual(["clm-fixture-adj"]);
    expect(summary.citedClaimCount).toBe(1);
    expect(summary.patientResponsibility).toBe(48);
    expect(summary.routeToHuman).toBe(false);
    expect(summary.sourced).toBe(true);
  });
});
