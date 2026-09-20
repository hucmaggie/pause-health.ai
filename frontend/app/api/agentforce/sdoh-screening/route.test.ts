import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * Tests for GET /api/agentforce/sdoh-screening — the flat REST alias the
 * Agentforce External Service (screenSocialNeeds) binds to. Invariants: it runs
 * the deterministic AHC-HRSN screen (same coded responses → same result),
 * surfaces a positive interpersonal-safety screen as a redFlag (mandatory human
 * escalation), and enforces the SAME governance gate as the A2A agent —
 * validated-screener-only, consent-before-referral, and 400 on malformed input.
 */

function req(qs: string): Request {
  return new Request(`https://pause-health.ai/api/agentforce/sdoh-screening${qs}`);
}
async function body(qs: string) {
  const res = await GET(req(qs));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// A fully-negative AHC-HRSN response (HITS total 4, below the >10 cutoff).
const NEG = "housing=0,0&food=0,0&transportation=0&utilities=0&safety=1,1,1,1";

describe("GET /api/agentforce/sdoh-screening", () => {
  it("returns zero positive domains for an all-negative screen", async () => {
    const { status, json } = await body(`?${NEG}`);
    expect(status).toBe(200);
    expect(json.blocked).toBeUndefined();
    expect(json.synthetic).toBe(true);
    expect(json.positiveDomainCount).toBe(0);
    expect(json.redFlags).toEqual([]);
    // Flat shape — no A2A task envelope.
    expect(json).not.toHaveProperty("jsonrpc");
  });

  it("flags a positive food domain (with referral consent)", async () => {
    const { json } = await body("?housing=0,0&food=1,1&transportation=0&utilities=0&safety=1,1,1,1&patientConsent=true");
    expect(json.positiveDomains).toContain("food");
    expect(json.positiveDomainCount).toBe(1);
  });

  it("blocks a positive screen with no referral consent", async () => {
    const { status, json } = await body("?housing=0,0&food=1,1&transportation=0&utilities=0&safety=1,1,1,1");
    expect(status).toBe(200);
    expect(json.blocked).toBe(true);
    expect((json.violations as Array<{ policyId: string }>).map((v) => v.policyId)).toContain(
      "policy.sdoh.consent-before-referral"
    );
  });

  it("surfaces a positive interpersonal-safety screen as a red flag", async () => {
    const { json } = await body("?housing=0,0&food=0,0&transportation=0&utilities=0&safety=4,4,4,4&patientConsent=true");
    expect((json.redFlags as Array<{ domain: string }>).map((f) => f.domain)).toContain("safety");
  });

  it("blocks an unvalidated screener", async () => {
    const { json } = await body(`?screener=phq9&${NEG}`);
    expect(json.blocked).toBe(true);
    expect((json.violations as Array<{ policyId: string }>).map((v) => v.policyId)).toContain(
      "policy.sdoh.validated-screener-only"
    );
  });

  it("returns 400 on a malformed response vector (wrong item count)", async () => {
    const { status, json } = await body("?housing=1&food=0,0&transportation=0&utilities=0&safety=1,1,1,1");
    expect(status).toBe(400);
    expect(json.error).toBe("invalid-screening-input");
  });
});
