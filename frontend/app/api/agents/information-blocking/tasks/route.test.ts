import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST,
  DEMO_INFORMATION_BLOCKING_NO_INTERFERENCE_REQUEST,
  DEMO_INFORMATION_BLOCKING_REQUEST
} from "../../../../../lib/information-blocking";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/information-blocking/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/information-blocking/tasks", () => {
  it("exception fully met → completed, with a parented EHI-bearing trace", async () => {
    const taskId = "test-ib-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_INFORMATION_BLOCKING_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("not-information-blocking-exception-met");
    expect(body.result.metadata.agentFabric.exceptionSatisfied).toBe(true);
    expect(body.result.metadata.agentFabric.blockingExceptionSourced).toBe(true);
    expect(body.result.metadata.agentFabric.blockingDeterminationNotOverstated).toBe(true);
    expect(body.result.metadata.agentFabric.blockingNoAutonomousBlockOrRelease).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("blocking.receive-practice");
    expect(ops).toContain("blocking.assess-exception");
    expect(ops).toContain("blocking.check-conditions");
    expect(ops).toContain("blocking.log-audit");
    const exceptionSpan = spans.find((s) => s.operation === "blocking.assess-exception");
    expect(exceptionSpan?.agentId).toBe("information-blocking-agent");
    expect(exceptionSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("no interference → not blocking", async () => {
    const taskId = "test-ib-nointerf-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_INFORMATION_BLOCKING_NO_INTERFERENCE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("not-information-blocking-no-interference");
  });

  it("missing condition → potential blocking, needs review", async () => {
    const taskId = "test-ib-missing-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            { type: "data", data: { request: DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST } }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe(
      "potential-information-blocking-needs-review"
    );
    expect(body.result.metadata.agentFabric.missingConditions).toContain(
      "responded-within-10-business-days"
    );
  });

  it("blocks an off-catalog exception (exception-sourced)", async () => {
    const taskId = "test-ib-offcatalog-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_INFORMATION_BLOCKING_REQUEST,
                determination: {
                  requestRef: "ib-001",
                  interferedWithAccess: true,
                  claimedExceptionId: "exception.we-made-up",
                  exceptionCategory: "unknown",
                  requiredConditions: [],
                  missingConditions: [],
                  exceptionSatisfied: false,
                  disposition: "potential-information-blocking-needs-review",
                  requiresComplianceReview: true,
                  autoBlockedEhi: false,
                  autoReleasedEhi: false
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
    expect(ids).toContain("policy.information-blocking.exception-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "blocking.assess-exception.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "blocking.log-audit")).toBe(false);
  });

  it("blocks an overstated exception (determination-not-overstated)", async () => {
    const taskId = "test-ib-overstated-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_INFORMATION_BLOCKING_MISSING_CONDITION_REQUEST,
                determination: {
                  requestRef: "ib-003",
                  interferedWithAccess: true,
                  claimedExceptionId: "exception.infeasibility",
                  exceptionCategory: "not-fulfilling",
                  requiredConditions: [
                    "infeasible-under-circumstances",
                    "responded-within-10-business-days"
                  ],
                  missingConditions: [],
                  exceptionSatisfied: true,
                  disposition: "not-information-blocking-exception-met",
                  requiresComplianceReview: true,
                  autoBlockedEhi: false,
                  autoReleasedEhi: false
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
    expect(ids).toContain("policy.information-blocking.determination-not-overstated");
  });

  it("blocks autonomously-withheld EHI (no-autonomous-block-or-release)", async () => {
    const taskId = "test-ib-autoblock-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_INFORMATION_BLOCKING_REQUEST,
                determination: {
                  requestRef: "ib-001",
                  interferedWithAccess: true,
                  claimedExceptionId: "exception.privacy",
                  exceptionCategory: "not-fulfilling",
                  requiredConditions: ["privacy-precondition-unmet", "no-improper-intent"],
                  missingConditions: [],
                  exceptionSatisfied: true,
                  disposition: "not-information-blocking-exception-met",
                  requiresComplianceReview: false,
                  autoBlockedEhi: true,
                  autoReleasedEhi: false
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
    expect(ids).toContain("policy.information-blocking.no-autonomous-block-or-release");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/information-blocking/tasks", {
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
      new Request("http://localhost/api/agents/information-blocking/tasks", {
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
