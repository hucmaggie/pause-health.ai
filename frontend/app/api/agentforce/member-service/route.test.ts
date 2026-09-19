import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * Tests for GET /api/agentforce/member-service — the flat REST alias the
 * Agentforce External Service (answerBillingQuestion) binds to. Invariants: it
 * returns the flat billing summary + answer text (not an A2A envelope), stays
 * deterministic (same member+query → same cited claims), always labels itself
 * synthetic + sourced, routes out-of-scope requests to a human, and enforces a
 * query. (The governance gate is the same as the A2A agent; a normal in-scope
 * answer always traces to a claim, so it is not blocked.)
 */

function req(qs: string): Request {
  return new Request(`https://pause-health.ai/api/agentforce/member-service${qs}`);
}
async function body(qs: string) {
  const res = await GET(req(qs));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("GET /api/agentforce/member-service", () => {
  it("answers a claim-status question, sourced and synthetic", async () => {
    const { status, json } = await body("?query=what%20is%20my%20claim%20status&memberId=M-123");
    expect(status).toBe(200);
    expect(json.blocked).toBeUndefined();
    expect(json.synthetic).toBe(true);
    expect(json.sourced).toBe(true);
    expect(json.intent).toBe("claim-status");
    expect(json.kind).toBe("billing-answer");
    expect(typeof json.answer).toBe("string");
    // Flat shape — no A2A task envelope.
    expect(json).not.toHaveProperty("jsonrpc");
    expect(json).not.toHaveProperty("citedClaims"); // full records not leaked; only ids/count
  });

  it("computes an outstanding balance that traces to a claim", async () => {
    const { json } = await body("?query=what%20is%20my%20outstanding%20balance&memberId=M-123");
    expect(json.intent).toBe("balance");
    expect(typeof json.patientResponsibility).toBe("number");
    expect(json.sourced).toBe(true);
  });

  it("routes an out-of-scope request to a human", async () => {
    const { json } = await body("?query=can%20you%20refill%20my%20prescription&memberId=M-123");
    expect(json.intent).toBe("out-of-scope");
    expect(json.kind).toBe("route-to-human");
    expect(json.routeToHuman).toBe(true);
    expect(typeof json.routeToHumanQueue).toBe("string");
  });

  it("is deterministic — same member+query yields the same cited claims", async () => {
    const a = await body("?query=balance&memberId=M-999");
    const b = await body("?query=balance&memberId=M-999");
    expect(a.json.citedClaimIds).toEqual(b.json.citedClaimIds);
  });

  it("requires a query", async () => {
    const { status, json } = await body("?memberId=M-123");
    expect(status).toBe(400);
    expect(json.error).toBe("missing-query");
  });
});
