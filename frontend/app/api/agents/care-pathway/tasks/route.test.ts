import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_CARE_PATHWAY_CYCLE_REQUEST,
  DEMO_CARE_PATHWAY_MISSING_REQUEST,
  DEMO_CARE_PATHWAY_REQUEST
} from "../../../../../lib/care-pathway";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/care-pathway/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/care-pathway/tasks", () => {
  it("clean pathway → completed, sequenced, with a parented PHI-bearing trace", async () => {
    const taskId = "test-pathway-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CARE_PATHWAY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("sequenced");
    expect(body.result.metadata.agentFabric.stepCount).toBe(6);
    expect(body.result.metadata.agentFabric.stageCount).toBe(5);
    expect(body.result.metadata.agentFabric.pathwayStepsSourced).toBe(true);
    expect(body.result.metadata.agentFabric.pathwaySequenceValid).toBe(true);
    expect(body.result.metadata.agentFabric.pathwayNoAutonomousExecution).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("pathway.receive-steps");
    expect(ops).toContain("pathway.check-prerequisites");
    expect(ops).toContain("pathway.topological-sort");
    expect(ops).toContain("pathway.log-audit");
    const sortSpan = spans.find((s) => s.operation === "pathway.topological-sort");
    expect(sortSpan?.agentId).toBe("care-pathway-agent");
    expect(sortSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("cyclic pathway → completed, cannot-sequence-cycle-detected", async () => {
    const taskId = "test-pathway-cycle-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CARE_PATHWAY_CYCLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("cannot-sequence-cycle-detected");
    expect(body.result.metadata.agentFabric.cycleCount).toBe(3);
  });

  it("missing-prerequisite pathway → completed, cannot-sequence-missing-prerequisite", async () => {
    const taskId = "test-pathway-missing-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CARE_PATHWAY_MISSING_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe(
      "cannot-sequence-missing-prerequisite"
    );
    expect(body.result.metadata.agentFabric.missingCount).toBe(1);
  });

  it("blocks a fabricated step id (steps-sourced)", async () => {
    const taskId = "test-pathway-fabricated-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CARE_PATHWAY_REQUEST,
                determination: {
                  requestRef: "pathway-001",
                  pathwayRef: "menopause-workup-v1",
                  patientRef: "patient-4821",
                  disposition: "sequenced",
                  orderedSteps: ["s1", "sX"],
                  stageByStep: { s1: 0, sX: 1 },
                  cycleMembers: [],
                  unmetPrerequisites: [],
                  steps: [{ stepId: "s1", name: "Baseline labs", prerequisites: [] }],
                  requiresClinicianReview: true,
                  autoExecuted: false
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
    expect(ids).toContain("policy.pathway.steps-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "pathway.topological-sort.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "pathway.log-audit")).toBe(false);
  });

  it("blocks a sequence that violates a prerequisite (sequence-valid)", async () => {
    const taskId = "test-pathway-invalid-order-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CARE_PATHWAY_REQUEST,
                determination: {
                  requestRef: "pathway-001",
                  pathwayRef: "menopause-workup-v1",
                  patientRef: "patient-4821",
                  disposition: "sequenced",
                  orderedSteps: ["s2", "s1"],
                  stageByStep: { s2: 0, s1: 1 },
                  cycleMembers: [],
                  unmetPrerequisites: [],
                  steps: [
                    { stepId: "s1", name: "Baseline labs", prerequisites: [] },
                    { stepId: "s2", name: "Confirm diagnosis", prerequisites: ["s1"] }
                  ],
                  requiresClinicianReview: true,
                  autoExecuted: false
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
    expect(ids).toContain("policy.pathway.sequence-valid");
  });

  it("blocks an autonomous step execution (no-autonomous-execution)", async () => {
    const taskId = "test-pathway-autoexec-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CARE_PATHWAY_REQUEST,
                determination: {
                  requestRef: "pathway-001",
                  pathwayRef: "menopause-workup-v1",
                  patientRef: "patient-4821",
                  disposition: "sequenced",
                  orderedSteps: ["s1", "s2"],
                  stageByStep: { s1: 0, s2: 1 },
                  cycleMembers: [],
                  unmetPrerequisites: [],
                  steps: [
                    { stepId: "s1", name: "Baseline labs", prerequisites: [] },
                    { stepId: "s2", name: "Confirm diagnosis", prerequisites: ["s1"] }
                  ],
                  requiresClinicianReview: false,
                  autoExecuted: true
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
    expect(ids).toContain("policy.pathway.no-autonomous-execution");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/care-pathway/tasks", {
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
      new Request("http://localhost/api/agents/care-pathway/tasks", {
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
