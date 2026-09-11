import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_OUTREACH_ALL_REQUEST,
  DEMO_OUTREACH_REQUEST,
  DEMO_OUTREACH_TIGHT_REQUEST,
  evaluateOutreachPrioritization
} from "../../../../../lib/outreach-prioritization";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/outreach-prioritization/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the some-deferred demo — the block base. */
const VALID_DETERMINATION = evaluateOutreachPrioritization(DEMO_OUTREACH_REQUEST);

describe("POST /api/agents/outreach-prioritization/tasks", () => {
  it("some-deferred → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-op-deferred-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_OUTREACH_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("some-deferred");
    expect(body.result.metadata.agentFabric.totalBenefit).toBe(140);
    expect(body.result.metadata.agentFabric.outreachSelectionsSourced).toBe(true);
    expect(body.result.metadata.agentFabric.outreachAllocationOptimal).toBe(true);
    expect(body.result.metadata.agentFabric.outreachNoAutonomousSchedule).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("outreach.receive-candidates");
    expect(ops).toContain("outreach.optimize-allocation");
    expect(ops).toContain("outreach.classify-disposition");
    expect(ops).toContain("outreach.log-audit");
    const optSpan = spans.find((s) => s.operation === "outreach.optimize-allocation");
    expect(optSpan?.agentId).toBe("outreach-prioritization-agent");
    expect(optSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("all-scheduled → completed", async () => {
    const taskId = "test-op-all-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_OUTREACH_ALL_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("all-scheduled");
    expect(body.result.metadata.agentFabric.deferredCount).toBe(0);
  });

  it("tight capacity → completed, some-deferred", async () => {
    const taskId = "test-op-tight-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_OUTREACH_TIGHT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("some-deferred");
    expect(body.result.metadata.agentFabric.totalBenefit).toBe(80);
  });

  it("blocks a phantom intervention (selections-sourced)", async () => {
    const taskId = "test-op-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_OUTREACH_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  selected: [...VALID_DETERMINATION.selected, { id: "phantom", cost: 0, benefit: 0 }]
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
    expect(ids).toContain("policy.outreach.selections-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "outreach.optimize-allocation.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "outreach.log-audit")).toBe(false);
  });

  it("blocks a sub-optimal allocation (allocation-optimal)", async () => {
    const taskId = "test-op-suboptimal-block-001";
    const hrt = VALID_DETERMINATION.candidates.find((c) => c.id === "iv-hrt-titration")!;
    const sdoh = VALID_DETERMINATION.candidates.find((c) => c.id === "iv-sdoh-checkin")!;
    const dexa = VALID_DETERMINATION.candidates.find((c) => c.id === "iv-dexa-reminder")!;
    const edu = VALID_DETERMINATION.candidates.find((c) => c.id === "iv-education")!;
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_OUTREACH_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  selected: [hrt, sdoh],
                  deferred: [dexa, edu],
                  totalCost: 9,
                  totalBenefit: 100,
                  remainingCapacity: 1
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
    expect(ids).toContain("policy.outreach.allocation-optimal");
  });

  it("blocks an autonomous schedule (no-autonomous-schedule)", async () => {
    const taskId = "test-op-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_OUTREACH_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresCareLeadReview: false,
                  autoScheduled: true
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
    expect(ids).toContain("policy.outreach.no-autonomous-schedule");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/outreach-prioritization/tasks", {
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
      new Request("http://localhost/api/agents/outreach-prioritization/tasks", {
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
