import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_INTERPRETER_ASSIGNMENT_GREEDY_TRAP_REQUEST,
  DEMO_INTERPRETER_ASSIGNMENT_INFEASIBLE_REQUEST,
  DEMO_INTERPRETER_ASSIGNMENT_REQUEST,
  evaluateInterpreterAssignment
} from "../../../../../lib/interpreter-assignment";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/interpreter-assignment/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateInterpreterAssignment(DEMO_INTERPRETER_ASSIGNMENT_REQUEST);

describe("POST /api/agents/interpreter-assignment/tasks", () => {
  it("assignable roster → completed, with a parented PHI-adjacent trace", async () => {
    const taskId = "test-ia-assignable-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_INTERPRETER_ASSIGNMENT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("assignable");
    expect(body.result.metadata.agentFabric.totalCost).toBe(12);
    expect(body.result.metadata.agentFabric.feasible).toBe(true);
    expect(body.result.metadata.agentFabric.interpAssignmentSourced).toBe(true);
    expect(body.result.metadata.agentFabric.interpAssignmentOptimal).toBe(true);
    expect(body.result.metadata.agentFabric.interpNoAutonomousDispatch).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("interpasg.receive-roster");
    expect(ops).toContain("interpasg.assign");
    expect(ops).toContain("interpasg.classify-disposition");
    expect(ops).toContain("interpasg.log-audit");
    const assignSpan = spans.find((s) => s.operation === "interpasg.assign");
    expect(assignSpan?.agentId).toBe("interpreter-assignment-agent");
    expect(assignSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("infeasible roster → completed (infeasible)", async () => {
    const res = await POST(
      rpc({
        id: "test-ia-infeasible-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_INTERPRETER_ASSIGNMENT_INFEASIBLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("infeasible");
    expect(body.result.metadata.agentFabric.unmatchedCount).toBe(1);
  });

  it("greedy-trap roster → completed (assignable, optimal spread)", async () => {
    const res = await POST(
      rpc({
        id: "test-ia-greedy-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_INTERPRETER_ASSIGNMENT_GREEDY_TRAP_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.totalCost).toBe(3);
  });

  it("blocks a reused interpreter (assignment-sourced)", async () => {
    const taskId = "test-ia-sourced-block-001";
    const assignments = [
      { interpreter: "interp-ES", appointment: "appt-A-spanish", cost: 4 },
      { interpreter: "interp-ES", appointment: "appt-B-mandarin", cost: 2 },
      { interpreter: "interp-AR", appointment: "appt-C-arabic", cost: 6 }
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
                request: DEMO_INTERPRETER_ASSIGNMENT_REQUEST,
                determination: { ...VALID_DETERMINATION, assignments, totalCost: 12 }
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
    expect(ids).toContain("policy.interpasg.assignment-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "interpasg.assign.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "interpasg.log-audit")).toBe(false);
  });

  it("blocks a sub-optimal assignment (cost-optimal)", async () => {
    // A valid one-to-one matching that isn't optimal: ES→A(4), ZH→B(3), AR→C(6) = 13 (optimum is 12).
    const assignments = [
      { interpreter: "interp-ES", appointment: "appt-A-spanish", cost: 4 },
      { interpreter: "interp-ZH", appointment: "appt-B-mandarin", cost: 3 },
      { interpreter: "interp-AR", appointment: "appt-C-arabic", cost: 6 }
    ];
    const res = await POST(
      rpc({
        id: "test-ia-optimal-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_INTERPRETER_ASSIGNMENT_REQUEST,
                determination: { ...VALID_DETERMINATION, assignments, totalCost: 13 }
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
    expect(ids).toContain("policy.interpasg.cost-optimal");
    // Isolable: it passed sourced.
    expect(ids).not.toContain("policy.interpasg.assignment-sourced");
  });

  it("blocks an autonomous dispatch (no-autonomous-dispatch)", async () => {
    const res = await POST(
      rpc({
        id: "test-ia-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_INTERPRETER_ASSIGNMENT_REQUEST,
                determination: { ...VALID_DETERMINATION, requiresCoordinatorReview: false, autoDispatched: true }
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
    expect(ids).toContain("policy.interpasg.no-autonomous-dispatch");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/interpreter-assignment/tasks", {
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
      new Request("http://localhost/api/agents/interpreter-assignment/tasks", {
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
