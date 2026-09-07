import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_SCREENING_CLEAR_REQUEST,
  DEMO_SCREENING_COINCIDENCE_REQUEST,
  DEMO_SCREENING_REQUEST
} from "../../../../../lib/exclusion-screening";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/exclusion-screening/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/exclusion-screening/tasks", () => {
  it("reports a confirmed NPI match → completed, with a parented non-PHI trace", async () => {
    const taskId = "test-exc-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_SCREENING_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.matchStrength).toBe("confirmed");
    expect(body.result.metadata.agentFabric.matchedExclusionId).toBe("leie-1001");
    expect(body.result.metadata.agentFabric.exclusionMatchSourced).toBe(true);
    expect(body.result.metadata.agentFabric.exclusionMatchNotOverstated).toBe(true);
    expect(body.result.metadata.agentFabric.exclusionNoAutonomousBlockOrClear).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("exclusion.receive-party");
    expect(ops).toContain("exclusion.match-leie");
    expect(ops).toContain("exclusion.recommend-disposition");
    const matchSpan = spans.find((s) => s.operation === "exclusion.match-leie");
    expect(matchSpan?.agentId).toBe("exclusion-screening-agent");
    // Deliberately NOT PHI-bearing.
    expect(matchSpan?.attributes?.phiAccessed).toBe(false);
  });

  it("honestly reports a name coincidence as possible", async () => {
    const taskId = "test-exc-coincidence-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_SCREENING_COINCIDENCE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.matchStrength).toBe("possible");
  });

  it("reports no-match for a clean party", async () => {
    const taskId = "test-exc-clear-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_SCREENING_CLEAR_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.matchStrength).toBe("no-match");
  });

  it("blocks a match with no sourced LEIE record (match-record-sourced)", async () => {
    const taskId = "test-exc-unsourced-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_SCREENING_REQUEST,
                determination: {
                  partyRef: "provider-3391",
                  matchStrength: "confirmed",
                  matchedExclusionId: null,
                  npiMatch: true,
                  nameMatch: true,
                  dobMatch: true,
                  requiresComplianceReview: true,
                  autoBlockedPayment: false,
                  autoCleared: false
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
    expect(ids).toContain("policy.exclusion.match-record-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "exclusion.match-leie.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "exclusion.recommend-disposition")).toBe(false);
  });

  it("blocks an overstated match strength (match-not-overstated)", async () => {
    const taskId = "test-exc-overstated-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_SCREENING_COINCIDENCE_REQUEST,
                determination: {
                  partyRef: "provider-7742",
                  matchStrength: "confirmed",
                  matchedExclusionId: "leie-1001",
                  npiMatch: null,
                  nameMatch: false,
                  dobMatch: false,
                  requiresComplianceReview: true,
                  autoBlockedPayment: false,
                  autoCleared: false
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
    expect(ids).toContain("policy.exclusion.match-not-overstated");
  });

  it("blocks an autonomously-blocked payment (no-autonomous-block-or-clear)", async () => {
    const taskId = "test-exc-autoblock-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_SCREENING_REQUEST,
                determination: {
                  partyRef: "provider-3391",
                  matchStrength: "confirmed",
                  matchedExclusionId: "leie-1001",
                  npiMatch: true,
                  nameMatch: true,
                  dobMatch: true,
                  requiresComplianceReview: false,
                  autoBlockedPayment: true,
                  autoCleared: false
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
    expect(ids).toContain("policy.exclusion.no-autonomous-block-or-clear");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/exclusion-screening/tasks", {
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
      new Request("http://localhost/api/agents/exclusion-screening/tasks", {
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
