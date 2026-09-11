import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_CONTACT_RATE_LIMIT_BURST_REQUEST,
  DEMO_CONTACT_RATE_LIMIT_REQUEST,
  DEMO_CONTACT_RATE_LIMIT_WITHIN_REQUEST,
  evaluateContactRateLimit
} from "../../../../../lib/contact-rate-limit";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/contact-rate-limit/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST);

describe("POST /api/agents/contact-rate-limit/tasks", () => {
  it("throttled burst → completed, with a parented PHI-adjacent trace", async () => {
    const taskId = "test-crl-throttled-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONTACT_RATE_LIMIT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("throttled");
    expect(body.result.metadata.agentFabric.permittedCount).toBe(4);
    expect(body.result.metadata.agentFabric.throttledCount).toBe(1);
    expect(body.result.metadata.agentFabric.contactReplaySourced).toBe(true);
    expect(body.result.metadata.agentFabric.contactThrottleExact).toBe(true);
    expect(body.result.metadata.agentFabric.contactNoAutonomousSend).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("contactrate.receive-attempts");
    expect(ops).toContain("contactrate.throttle");
    expect(ops).toContain("contactrate.classify-disposition");
    expect(ops).toContain("contactrate.log-audit");
    const throttleSpan = spans.find((s) => s.operation === "contactrate.throttle");
    expect(throttleSpan?.agentId).toBe("contact-rate-limit-agent");
    expect(throttleSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("within-limits cadence → completed (within-limits)", async () => {
    const res = await POST(
      rpc({
        id: "test-crl-within-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONTACT_RATE_LIMIT_WITHIN_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("within-limits");
    expect(body.result.metadata.agentFabric.throttledCount).toBe(0);
  });

  it("dense burst → completed (throttled)", async () => {
    const res = await POST(
      rpc({
        id: "test-crl-burst-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONTACT_RATE_LIMIT_BURST_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.permittedCount).toBe(1);
  });

  it("blocks a reordered replay (replay-sourced)", async () => {
    const taskId = "test-crl-sourced-block-001";
    const decisions = [
      VALID_DETERMINATION.decisions[1],
      VALID_DETERMINATION.decisions[0],
      ...VALID_DETERMINATION.decisions.slice(2)
    ];
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CONTACT_RATE_LIMIT_REQUEST,
                determination: { ...VALID_DETERMINATION, decisions }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.contactrate.replay-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "contactrate.throttle.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "contactrate.log-audit")).toBe(false);
  });

  it("blocks an under-throttled decision (throttle-exact)", async () => {
    // Flip the throttled attempt (index 3) to permitted: self-consistent replay, but the bucket would throttle.
    const decisions = VALID_DETERMINATION.decisions.map((x, i) =>
      i === 3 ? { ...x, decision: "permitted" as const } : x
    );
    const res = await POST(
      rpc({
        id: "test-crl-exact-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CONTACT_RATE_LIMIT_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  decisions,
                  permittedCount: 5,
                  throttledCount: 0,
                  disposition: "within-limits"
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.contactrate.throttle-exact");
    // Isolable: it passed sourced.
    expect(ids).not.toContain("policy.contactrate.replay-sourced");
  });

  it("blocks an autonomous send (no-autonomous-send)", async () => {
    const res = await POST(
      rpc({
        id: "test-crl-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CONTACT_RATE_LIMIT_REQUEST,
                determination: { ...VALID_DETERMINATION, requiresCoordinatorReview: false, autoSent: true }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.contactrate.no-autonomous-send");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/contact-rate-limit/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "x", method: "tasks/get" })
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("rejects unparseable JSON with -32700", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/contact-rate-limit/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json"
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });
});
