import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  EXCLUSION_SCREENING_PRESETS,
  buildExclusionScreeningRequestBody,
  exclusionScreeningViewFromTask,
  runExclusionScreeningTask
} from "./exclusion-screening-panel";
import { DEMO_SCREENING_REQUEST } from "../lib/exclusion-screening";

describe("EXCLUSION_SCREENING_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(EXCLUSION_SCREENING_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of EXCLUSION_SCREENING_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = EXCLUSION_SCREENING_PRESETS.map((p) => p.id);
    expect(ids).toContain("unsourced-match-block");
    expect(ids).toContain("overstated-match-block");
    expect(ids).toContain("auto-block-block");
  });
});

describe("buildExclusionScreeningRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildExclusionScreeningRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_SCREENING_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_SCREENING_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildExclusionScreeningRequestBody({
      taskId: "t2",
      determination: { autoBlockedPayment: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoBlockedPayment: true });
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

describe("runExclusionScreeningTask", () => {
  it("POSTs to the exclusion-screening route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runExclusionScreeningTask(
      { taskId: "t", request: DEMO_SCREENING_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/exclusion-screening/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runExclusionScreeningTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("exclusionScreeningViewFromTask", () => {
  it("lifts a resolved determination from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "ScreeningDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  partyRef: "provider-3391",
                  determination: {
                    partyRef: "provider-3391",
                    matchStrength: "confirmed",
                    matchedExclusionId: "leie-1001",
                    exclusionType: "1128(a)(1)",
                    npiMatch: true,
                    nameMatch: true,
                    dobMatch: true,
                    disposition: "recommend-block-pending-review",
                    requiresComplianceReview: true,
                    autoBlockedPayment: false,
                    autoCleared: false,
                    reason: "ok",
                    synthetic: true,
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
          exclusionMatchSourced: true,
          exclusionMatchNotOverstated: true,
          exclusionNoAutonomousBlockOrClear: true
        }
      }
    };
    const view = exclusionScreeningViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.matchStrength).toBe("confirmed");
      expect(view.matchedExclusionId).toBe("leie-1001");
      expect(view.exclusionMatchNotOverstated).toBe(true);
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
          policiesEvaluated: ["policy.exclusion.match-not-overstated"],
          violations: [
            { policyId: "policy.exclusion.match-not-overstated", reason: "overstated" }
          ]
        }
      }
    };
    const view = exclusionScreeningViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.exclusion.match-not-overstated");
      expect(view.policiesEvaluated).toContain("policy.exclusion.match-not-overstated");
    }
  });
});
