import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_ABN_EXCLUDED_REQUEST,
  DEMO_ABN_NONCOVERED_REQUEST,
  DEMO_ABN_REQUEST,
  DEMO_ABN_WITH_ABN_REQUEST
} from "../../../../../lib/advance-beneficiary-notice";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/advance-beneficiary-notice/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/advance-beneficiary-notice/tasks", () => {
  it("passes a covered service → completed, with a parented trace", async () => {
    const taskId = "test-abn-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ABN_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.coverageAssessment).toBe("likely-covered");
    expect(body.result.metadata.agentFabric.abnRequired).toBe(false);
    expect(body.result.metadata.agentFabric.modifier).toBe("none");
    expect(body.result.metadata.agentFabric.disposition).toBe("proceed-covered");
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(false);
    expect(body.result.metadata.agentFabric.abnCoverageRuleSourced).toBe(true);
    expect(body.result.metadata.agentFabric.abnRequiredWhenNoncovered).toBe(true);
    expect(body.result.metadata.agentFabric.abnNoAutonomousBeneficiaryLiability).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("abn.receive-request");
    expect(ops).toContain("abn.assess-coverage");
    expect(ops).toContain("abn.decide-liability");
    expect(ops).toContain("abn.log-audit");
    const assessSpan = spans.find((s) => s.operation === "abn.assess-coverage");
    expect(assessSpan?.agentId).toBe("advance-beneficiary-notice-agent");
    expect(assessSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("issues an ABN before the service for a non-covered service with no ABN (review-gated)", async () => {
    const taskId = "test-abn-noncovered-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ABN_NONCOVERED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.coverageAssessment).toBe("likely-non-covered");
    expect(body.result.metadata.agentFabric.modifier).toBe("GZ");
    expect(body.result.metadata.agentFabric.disposition).toBe("issue-abn-before-service");
    expect(body.result.metadata.agentFabric.patientMayBeBilled).toBe(false);
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(true);
  });

  it("bills the beneficiary for a non-covered service with a valid ABN (GA)", async () => {
    const taskId = "test-abn-with-abn-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ABN_WITH_ABN_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.modifier).toBe("GA");
    expect(body.result.metadata.agentFabric.disposition).toBe("bill-beneficiary-with-abn");
    expect(body.result.metadata.agentFabric.patientMayBeBilled).toBe(true);
  });

  it("marks a statutorily-excluded service GY", async () => {
    const taskId = "test-abn-excluded-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ABN_EXCLUDED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.coverageAssessment).toBe("statutorily-excluded");
    expect(body.result.metadata.agentFabric.modifier).toBe("GY");
    expect(body.result.metadata.agentFabric.disposition).toBe("notify-statutory-exclusion");
  });

  it("blocks an un-sourced coverage rule (coverage-rule-sourced)", async () => {
    const taskId = "test-abn-unsourced-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ABN_REQUEST,
                determination: {
                  requestRef: "abn-req-001",
                  coverageRuleId: "rule.abn.we-made-up",
                  coverageAssessment: "likely-covered",
                  abnRequired: false,
                  abnValid: false,
                  patientMayBeBilled: false,
                  modifier: "none",
                  disposition: "proceed-covered",
                  requiresHumanReview: false,
                  autoAssignedLiability: false
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
    expect(ids).toContain("policy.abn.coverage-rule-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "abn.decide-liability.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "abn.log-audit")).toBe(false);
  });

  it("blocks a non-covered service marked as needing no ABN (abn-required-when-noncovered)", async () => {
    const taskId = "test-abn-missing-req-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ABN_NONCOVERED_REQUEST,
                determination: {
                  requestRef: "abn-req-002",
                  coverageRuleId: "rule.abn.vitamin-d-testing",
                  coverageAssessment: "likely-non-covered",
                  abnRequired: false,
                  abnValid: false,
                  patientMayBeBilled: false,
                  modifier: "GZ",
                  disposition: "issue-abn-before-service",
                  requiresHumanReview: true,
                  autoAssignedLiability: false
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
    expect(ids).toContain("policy.abn.abn-required-when-noncovered");
  });

  it("blocks billing the beneficiary with no valid ABN (no-autonomous-beneficiary-liability)", async () => {
    const taskId = "test-abn-liability-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ABN_NONCOVERED_REQUEST,
                determination: {
                  requestRef: "abn-req-002",
                  coverageRuleId: "rule.abn.vitamin-d-testing",
                  coverageAssessment: "likely-non-covered",
                  abnRequired: true,
                  abnValid: false,
                  patientMayBeBilled: true,
                  modifier: "GA",
                  disposition: "bill-beneficiary-with-abn",
                  requiresHumanReview: false,
                  autoAssignedLiability: true
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
    expect(ids).toContain("policy.abn.no-autonomous-beneficiary-liability");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/advance-beneficiary-notice/tasks", {
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
      new Request("http://localhost/api/agents/advance-beneficiary-notice/tasks", {
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
