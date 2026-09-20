import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * Tests for GET /api/agentforce/care-router — the flat REST alias the Agentforce
 * External Service (routeCarePathway) binds to. Invariants: it uses the
 * DETERMINISTIC scripted engine (same intake → same pathway + rationale), routes
 * red flags to the right acuity, returns a flat decision (not an A2A envelope),
 * and enforces the SAME governance gate as the A2A agent — a MISSING red-flag
 * screen is blocked (the agent must ask the mandatory question before routing).
 */

function req(qs: string): Request {
  return new Request(`https://pause-health.ai/api/agentforce/care-router${qs}`);
}
async function body(qs: string) {
  const res = await GET(req(qs));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("GET /api/agentforce/care-router", () => {
  it("routes moderate vasomotor (no red flags) to a routine MSCP pathway", async () => {
    const { status, json } = await body(
      "?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no&cycleStatus=perimenopause"
    );
    expect(status).toBe(200);
    expect(json.blocked).toBeUndefined();
    expect(json.synthetic).toBe(true);
    expect(typeof json.pathway).toBe("string");
    expect(Array.isArray(json.rationale)).toBe(true);
    expect((json.rationale as string[]).length).toBeGreaterThan(0);
    // Flat shape — no A2A task envelope.
    expect(json).not.toHaveProperty("jsonrpc");
    expect(json).not.toHaveProperty("modelProvenance"); // flattened to modelProvider
  });

  it("escalates an acknowledged red flag (bleeding) to urgent gynecology", async () => {
    const { json } = await body(
      "?primarySymptom=bleeding&severity=severe&redFlagsAcknowledged=yes"
    );
    expect(json.pathway).toBe("urgent-gynecology");
    expect((json.redFlagsTriggered as string[]).length).toBeGreaterThan(0);
  });

  it("blocks when the mandatory red-flag screen is missing", async () => {
    const { status, json } = await body("?primarySymptom=vasomotor&severity=mild");
    expect(status).toBe(200);
    expect(json.blocked).toBe(true);
    expect((json.violations as Array<{ policyId: string }>).map((v) => v.policyId)).toContain(
      "policy.intake.red-flag-mandatory"
    );
    expect(json.pathway).toBeUndefined();
  });

  it("is deterministic — same intake yields the same pathway + rationale", async () => {
    const qs = "?primarySymptom=sleep&severity=moderate&redFlagsAcknowledged=no";
    const a = await body(qs);
    const b = await body(qs);
    expect(a.json.pathway).toBe(b.json.pathway);
    expect(a.json.rationale).toEqual(b.json.rationale);
  });
});
