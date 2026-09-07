import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_ACCESS_ENDANGER_REQUEST,
  DEMO_ACCESS_EXTENSION_REQUEST,
  DEMO_ACCESS_PSYCH_REQUEST,
  DEMO_ACCESS_REQUEST
} from "../../../../../lib/right-of-access";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/right-of-access/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/right-of-access/tasks", () => {
  it("grants a routine copy in full → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-roa-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ACCESS_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("grant-in-full");
    expect(body.result.metadata.agentFabric.responseDeadline).toBe("2026-09-19");
    expect(body.result.metadata.agentFabric.daysUntilDeadline).toBe(12);
    expect(body.result.metadata.agentFabric.accessGroundSourced).toBe(true);
    expect(body.result.metadata.agentFabric.accessDeadlineComputed).toBe(true);
    expect(body.result.metadata.agentFabric.accessNoAutonomousDenialOrRelease).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("access.receive-request");
    expect(ops).toContain("access.assess-grounds");
    expect(ops).toContain("access.compute-deadline");
    expect(ops).toContain("access.log-audit");
    const deadlineSpan = spans.find((s) => s.operation === "access.compute-deadline");
    expect(deadlineSpan?.agentId).toBe("right-of-access-agent");
    expect(deadlineSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("denies psychotherapy notes as an unreviewable ground", async () => {
    const taskId = "test-roa-psych-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ACCESS_PSYCH_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("deny-unreviewable");
    expect(body.result.metadata.agentFabric.responseDeadline).toBe("2026-09-24");
  });

  it("routes an endangerment concern to a reviewable denial", async () => {
    const taskId = "test-roa-endanger-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ACCESS_ENDANGER_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("deny-reviewable-needs-review");
  });

  it("computes a +60 deadline when the extension is invoked", async () => {
    const taskId = "test-roa-extension-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ACCESS_EXTENSION_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.responseDeadline).toBe("2026-10-19");
    expect(body.result.metadata.agentFabric.daysUntilDeadline).toBe(42);
  });

  it("blocks a denial on an off-catalog ground (ground-sourced)", async () => {
    const taskId = "test-roa-offcatalog-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ACCESS_REQUEST,
                determination: {
                  requestRef: "access-001",
                  patientRef: "patient-8842",
                  requestType: "copy",
                  inDesignatedRecordSet: true,
                  exceptionId: "exception.we-made-up",
                  exceptionType: "unknown",
                  extensionInvoked: false,
                  responseDeadline: "2026-09-19",
                  daysUntilDeadline: 12,
                  disposition: "deny-unreviewable",
                  accessGranted: false,
                  autoReleased: false,
                  requiresHumanReview: true
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
    expect(ids).toContain("policy.access.ground-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "access.compute-deadline.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "access.log-audit")).toBe(false);
  });

  it("blocks a mis-computed deadline (deadline-computed)", async () => {
    const taskId = "test-roa-baddeadline-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ACCESS_REQUEST,
                determination: {
                  requestRef: "access-001",
                  patientRef: "patient-8842",
                  requestType: "copy",
                  inDesignatedRecordSet: true,
                  exceptionId: "",
                  exceptionType: "none",
                  extensionInvoked: false,
                  responseDeadline: "2026-11-01",
                  daysUntilDeadline: 55,
                  disposition: "grant-in-full",
                  accessGranted: true,
                  autoReleased: false,
                  requiresHumanReview: true
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
    expect(ids).toContain("policy.access.deadline-computed");
  });

  it("blocks an autonomously-released determination (no-autonomous-denial-or-release)", async () => {
    const taskId = "test-roa-autorelease-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ACCESS_REQUEST,
                determination: {
                  requestRef: "access-001",
                  patientRef: "patient-8842",
                  requestType: "copy",
                  inDesignatedRecordSet: true,
                  exceptionId: "",
                  exceptionType: "none",
                  extensionInvoked: false,
                  responseDeadline: "2026-09-19",
                  daysUntilDeadline: 12,
                  disposition: "grant-in-full",
                  accessGranted: true,
                  autoReleased: true,
                  requiresHumanReview: false
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
    expect(ids).toContain("policy.access.no-autonomous-denial-or-release");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/right-of-access/tasks", {
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
      new Request("http://localhost/api/agents/right-of-access/tasks", {
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
