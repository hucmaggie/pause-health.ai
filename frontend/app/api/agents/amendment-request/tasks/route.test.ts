import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_AMENDMENT_ACCURATE_REQUEST,
  DEMO_AMENDMENT_EXTENSION_REQUEST,
  DEMO_AMENDMENT_REQUEST
} from "../../../../../lib/amendment-request";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/amendment-request/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/amendment-request/tasks", () => {
  it("recommends accept → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-amd-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AMENDMENT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("recommend-accept");
    expect(body.result.metadata.agentFabric.responseDeadline).toBe("2026-10-14");
    expect(body.result.metadata.agentFabric.amendmentGroundSourced).toBe(true);
    expect(body.result.metadata.agentFabric.amendmentDeadlineComputed).toBe(true);
    expect(body.result.metadata.agentFabric.amendmentNoAutonomousWrite).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("amendment.receive-request");
    expect(ops).toContain("amendment.assess-grounds");
    expect(ops).toContain("amendment.compute-deadline");
    expect(ops).toContain("amendment.log-audit");
    const groundsSpan = spans.find((s) => s.operation === "amendment.assess-grounds");
    expect(groundsSpan?.agentId).toBe("amendment-request-agent");
    expect(groundsSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("recommends deny on the accurate-and-complete ground", async () => {
    const taskId = "test-amd-accurate-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AMENDMENT_ACCURATE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("recommend-deny");
    expect(body.result.metadata.agentFabric.deniedOnGround).toBe("ground.accurate-and-complete");
    expect(body.result.metadata.agentFabric.patientMayStatementOfDisagreement).toBe(true);
  });

  it("computes a 90-day deadline when the extension is invoked", async () => {
    const taskId = "test-amd-extension-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AMENDMENT_EXTENSION_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.responseDeadline).toBe("2026-11-13");
  });

  it("blocks a denial on an off-catalog ground (ground-sourced)", async () => {
    const taskId = "test-amd-offcatalog-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_AMENDMENT_REQUEST,
                determination: {
                  requestRef: "amend-001",
                  requestType: "correct-clinical",
                  requestDate: "2026-08-15",
                  asOfDate: "2026-09-07",
                  responseDeadline: "2026-10-14",
                  daysUntilDeadline: 37,
                  disposition: "recommend-deny",
                  deniedOnGround: "ground.we-made-up",
                  requiresHumanReview: true,
                  autoAmended: false,
                  autoDenied: false
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
    expect(ids).toContain("policy.amendment.ground-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "amendment.assess-grounds.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "amendment.log-audit")).toBe(false);
  });

  it("blocks a mis-computed deadline (deadline-computed)", async () => {
    const taskId = "test-amd-baddeadline-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_AMENDMENT_REQUEST,
                determination: {
                  requestRef: "amend-001",
                  requestType: "correct-clinical",
                  requestDate: "2026-08-15",
                  asOfDate: "2026-09-07",
                  responseDeadline: "2026-12-31",
                  daysUntilDeadline: 115,
                  disposition: "recommend-accept",
                  deniedOnGround: null,
                  requiresHumanReview: true,
                  autoAmended: false,
                  autoDenied: false
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
    expect(ids).toContain("policy.amendment.deadline-computed");
  });

  it("blocks an autonomously-amended record (no-autonomous-write-or-denial)", async () => {
    const taskId = "test-amd-autoamend-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_AMENDMENT_REQUEST,
                determination: {
                  requestRef: "amend-001",
                  requestType: "correct-clinical",
                  requestDate: "2026-08-15",
                  asOfDate: "2026-09-07",
                  responseDeadline: "2026-10-14",
                  daysUntilDeadline: 37,
                  disposition: "recommend-accept",
                  deniedOnGround: null,
                  requiresHumanReview: false,
                  autoAmended: true,
                  autoDenied: false
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
    expect(ids).toContain("policy.amendment.no-autonomous-write-or-denial");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/amendment-request/tasks", {
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
      new Request("http://localhost/api/agents/amendment-request/tasks", {
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
