import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  CARE_PATHWAY_PRESETS,
  buildCarePathwayRequestBody,
  carePathwayViewFromTask,
  runCarePathwayTask
} from "./care-pathway-panel";
import { DEMO_CARE_PATHWAY_REQUEST } from "../lib/care-pathway";

describe("CARE_PATHWAY_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(CARE_PATHWAY_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of CARE_PATHWAY_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = CARE_PATHWAY_PRESETS.map((p) => p.id);
    expect(ids).toContain("fabricated-step-block");
    expect(ids).toContain("invalid-order-block");
    expect(ids).toContain("auto-executed-block");
  });
});

describe("buildCarePathwayRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildCarePathwayRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_CARE_PATHWAY_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_CARE_PATHWAY_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildCarePathwayRequestBody({
      taskId: "t2",
      determination: { autoExecuted: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoExecuted: true });
  });
});

function okResponse(task: A2ATask): Response {
  const payload: A2ARpcResponse<A2ATask> = { jsonrpc: "2.0", id: "x", result: task };
  return {
    ok: true,
    status: 200,
    json: async () => payload
  } as unknown as Response;
}

describe("runCarePathwayTask", () => {
  it("POSTs to the care-pathway route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runCarePathwayTask(
      { taskId: "t", request: DEMO_CARE_PATHWAY_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/care-pathway/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runCarePathwayTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("carePathwayViewFromTask", () => {
  it("lifts a resolved sequencing from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "CarePathwayDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  requestRef: "pathway-001",
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
                    reason: "ok",
                    note: "note"
                  }
                }
              }
            }
          ]
        }
      ],
      metadata: {
        agentFabric: {
          decision: "allow",
          traceTaskId: "trace-1",
          pathwayStepsSourced: true,
          pathwaySequenceValid: true,
          pathwayNoAutonomousExecution: true
        }
      }
    };
    const view = carePathwayViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("sequenced");
      expect(view.orderedSteps).toEqual(["s1", "s2"]);
      expect(view.steps).toHaveLength(2);
      expect(view.traceTaskId).toBe("trace-1");
    }
  });

  it("lifts a blocked view from a failed task with a fabric block", () => {
    const task: A2ATask = {
      id: "t",
      status: {
        state: "failed",
        timestamp: new Date().toISOString(),
        message: { role: "agent", parts: [{ type: "text", text: "blocked" }] }
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: ["policy.pathway.sequence-valid"],
          violations: [{ policyId: "policy.pathway.sequence-valid", reason: "prerequisite violated" }]
        }
      }
    };
    const view = carePathwayViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.pathway.sequence-valid");
      expect(view.policiesEvaluated).toContain("policy.pathway.sequence-valid");
    }
  });
});
