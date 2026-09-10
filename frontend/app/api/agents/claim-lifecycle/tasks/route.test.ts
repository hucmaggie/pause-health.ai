import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEFAULT_CLAIM_STATE_MACHINE,
  DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST,
  DEMO_CLAIM_LIFECYCLE_REQUEST,
  DEMO_CLAIM_LIFECYCLE_UNREACHABLE_REQUEST
} from "../../../../../lib/claim-lifecycle";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/claim-lifecycle/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the draft→paid illegal-but-reachable demo — the block base. */
const VALID_DETERMINATION = {
  claimRef: "clm-002",
  patientRef: "patient-5528",
  currentStatus: "draft",
  requestedStatus: "paid",
  stateMachine: {
    states: [...DEFAULT_CLAIM_STATE_MACHINE.states],
    transitions: { ...DEFAULT_CLAIM_STATE_MACHINE.transitions },
    terminalStates: [...DEFAULT_CLAIM_STATE_MACHINE.terminalStates]
  },
  directEdge: false,
  reachable: true,
  allowedNextStates: ["submitted", "void"],
  shortestPath: ["draft", "submitted", "acknowledged", "adjudicated", "paid"],
  pathLength: 4,
  disposition: "transition-illegal-but-reachable",
  requiresAdjusterReview: true,
  autoAdvanced: false
};

describe("POST /api/agents/claim-lifecycle/tasks", () => {
  it("transition-allowed → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-claim-allowed-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CLAIM_LIFECYCLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("transition-allowed");
    expect(body.result.metadata.agentFabric.directEdge).toBe(true);
    expect(body.result.metadata.agentFabric.claimStatesSourced).toBe(true);
    expect(body.result.metadata.agentFabric.claimTransitionConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.claimNoAutonomousAdvance).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("claim.receive-transition");
    expect(ops).toContain("claim.check-transition");
    expect(ops).toContain("claim.compute-reachability");
    expect(ops).toContain("claim.log-audit");
    const checkSpan = spans.find((s) => s.operation === "claim.check-transition");
    expect(checkSpan?.agentId).toBe("claim-lifecycle-agent");
    expect(checkSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("illegal-but-reachable → completed, with the path length", async () => {
    const taskId = "test-claim-illegal-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("transition-illegal-but-reachable");
    expect(body.result.metadata.agentFabric.pathLength).toBe(4);
  });

  it("unreachable → completed", async () => {
    const taskId = "test-claim-unreach-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CLAIM_LIFECYCLE_UNREACHABLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("transition-unreachable");
    expect(body.result.metadata.agentFabric.reachable).toBe(false);
  });

  it("blocks a fabricated lifecycle state (states-sourced)", async () => {
    const taskId = "test-claim-fab-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  shortestPath: ["draft", "submitted", "teleport", "adjudicated", "paid"]
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
    expect(ids).toContain("policy.claim.states-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "claim.check-transition.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "claim.log-audit")).toBe(false);
  });

  it("blocks a wrong direct-edge flag (transition-consistent)", async () => {
    const taskId = "test-claim-consistent-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  directEdge: true,
                  disposition: "transition-allowed"
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
    expect(ids).toContain("policy.claim.transition-consistent");
  });

  it("blocks an autonomous advance (no-autonomous-advance)", async () => {
    const taskId = "test-claim-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CLAIM_LIFECYCLE_ILLEGAL_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresAdjusterReview: false,
                  autoAdvanced: true
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
    expect(ids).toContain("policy.claim.no-autonomous-advance");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/claim-lifecycle/tasks", {
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
      new Request("http://localhost/api/agents/claim-lifecycle/tasks", {
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
