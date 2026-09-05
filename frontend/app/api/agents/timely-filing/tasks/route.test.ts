import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_TIMELY_FILING_EXCEPTION_REQUEST,
  DEMO_TIMELY_FILING_REQUEST,
  DEMO_TIMELY_FILING_UNTIMELY_REQUEST
} from "../../../../../lib/timely-filing";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/timely-filing/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/timely-filing/tasks", () => {
  it("accepts a timely claim → completed, with a parented trace", async () => {
    const taskId = "test-tf-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_TIMELY_FILING_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.timely).toBe(true);
    expect(body.result.metadata.agentFabric.deadline).toBe("2026-04-10");
    expect(body.result.metadata.agentFabric.disposition).toBe("accept");
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(false);
    expect(body.result.metadata.agentFabric.timelyFilingRuleSourced).toBe(true);
    expect(body.result.metadata.agentFabric.timelyFilingDeadlineComputed).toBe(true);
    expect(body.result.metadata.agentFabric.timelyFilingNoAutonomousWriteOff).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("timelyfiling.receive-claim");
    expect(ops).toContain("timelyfiling.compute-deadline");
    expect(ops).toContain("timelyfiling.decide");
    expect(ops).toContain("timelyfiling.log-audit");
    const computeSpan = spans.find((s) => s.operation === "timelyfiling.compute-deadline");
    expect(computeSpan?.agentId).toBe("timely-filing-agent");
    expect(computeSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("routes an untimely-with-exception claim to appeal (still completed, review-gated)", async () => {
    const taskId = "test-tf-exception-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_TIMELY_FILING_EXCEPTION_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.timely).toBe(false);
    expect(body.result.metadata.agentFabric.exceptionRecognized).toBe(true);
    expect(body.result.metadata.agentFabric.disposition).toBe("appeal-with-exception");
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(true);
  });

  it("blocks an un-sourced filing rule (filing-limit-sourced)", async () => {
    const taskId = "test-tf-unsourced-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_TIMELY_FILING_REQUEST,
                determination: {
                  claimRef: "claim-tf-001",
                  filingRuleId: "rule.filing.we-made-up",
                  serviceDate: "2026-01-10",
                  limitDays: 90,
                  deadline: "2026-04-10",
                  timely: true,
                  requiresHumanReview: false,
                  writtenOff: false
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
    expect(ids).toContain("policy.timelyfiling.filing-limit-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "timelyfiling.decide.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "timelyfiling.log-audit")).toBe(false);
  });

  it("blocks a guessed deadline (deadline-computed)", async () => {
    const taskId = "test-tf-guessed-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_TIMELY_FILING_UNTIMELY_REQUEST,
                determination: {
                  claimRef: "claim-tf-003",
                  filingRuleId: "rule.filing.commercial-90day",
                  serviceDate: "2026-01-10",
                  limitDays: 90,
                  deadline: "2026-07-01",
                  timely: true,
                  requiresHumanReview: false,
                  writtenOff: false
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
    expect(ids).toContain("policy.timelyfiling.deadline-computed");
  });

  it("blocks an autonomous write-off (no-autonomous-write-off)", async () => {
    const taskId = "test-tf-writeoff-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_TIMELY_FILING_UNTIMELY_REQUEST,
                determination: {
                  claimRef: "claim-tf-003",
                  filingRuleId: "rule.filing.commercial-90day",
                  serviceDate: "2026-01-10",
                  limitDays: 90,
                  deadline: "2026-04-10",
                  timely: false,
                  requiresHumanReview: false,
                  writtenOff: true
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
    expect(ids).toContain("policy.timelyfiling.no-autonomous-write-off");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/timely-filing/tasks", {
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
      new Request("http://localhost/api/agents/timely-filing/tasks", {
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
