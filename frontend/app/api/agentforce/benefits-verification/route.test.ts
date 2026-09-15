import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * Tests for GET /api/agentforce/benefits-verification — the flat REST alias the
 * Agentforce External Service (verifyBenefits) binds to. The load-bearing
 * invariants: it returns the flat CoverageBenefitResult summary (not an A2A
 * envelope), it stays deterministic (same query → same synthetic txn id), it
 * always labels itself synthetic + sourced, and it enforces the SAME governance
 * gate as the A2A agent (consent=false must block, not fabricate a result).
 */

function req(qs: string): Request {
  return new Request(`https://pause-health.ai/api/agentforce/benefits-verification${qs}`);
}

async function body(qs: string) {
  const res = await GET(req(qs));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("GET /api/agentforce/benefits-verification", () => {
  it("returns a flat, synthetic, sourced coverage summary for a known payer", async () => {
    const { status, json } = await body("?payer=Aetna&zip=92614");
    expect(status).toBe(200);
    expect(json.blocked).toBeUndefined();
    expect(json.synthetic).toBe(true);
    expect(json.sourced).toBe(true);
    expect(json.eligibilityStatus).toBe("active");
    expect(json.payerName).toBe("Aetna");
    expect(typeof json.ebvTransactionId).toBe("string");
    expect(typeof json.estimatedPatientResponsibility).toBe("number");
    // Flat shape — no A2A task envelope leaking through.
    expect(json).not.toHaveProperty("status");
    expect(json).not.toHaveProperty("jsonrpc");
  });

  it("resolves a non-contracted payer as out-of-network", async () => {
    const { json } = await body("?payer=Humana");
    expect(json.network).toBe("out-of-network");
  });

  it("is deterministic — same query yields the same synthetic txn id", async () => {
    const a = await body("?payer=BCBS&zip=10001");
    const b = await body("?payer=BCBS&zip=10001");
    expect(a.json.ebvTransactionId).toBe(b.json.ebvTransactionId);
    expect(a.json.ebvTransactionId).toBeTruthy();
  });

  it("enforces the governance gate: consent=false blocks instead of fabricating", async () => {
    const { status, json } = await body("?payer=Aetna&consent=false");
    expect(status).toBe(200);
    expect(json.blocked).toBe(true);
    expect(json.decision).toBe("block");
    expect(Array.isArray(json.violations)).toBe(true);
    expect((json.violations as Array<{ policyId: string }>).map((v) => v.policyId)).toContain(
      "policy.data360.consent-required-before-grounding"
    );
    // A blocked call must NOT leak a coverage result.
    expect(json.eligibilityStatus).toBeUndefined();
    expect(json.estimatedPatientResponsibility).toBeUndefined();
  });
});
