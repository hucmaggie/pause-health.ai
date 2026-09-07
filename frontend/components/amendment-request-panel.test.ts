import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  AMENDMENT_REQUEST_PRESETS,
  amendmentViewFromTask,
  buildAmendmentRequestBody,
  runAmendmentRequestTask
} from "./amendment-request-panel";
import { DEMO_AMENDMENT_REQUEST } from "../lib/amendment-request";

describe("AMENDMENT_REQUEST_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(AMENDMENT_REQUEST_PRESETS.length).toBeGreaterThanOrEqual(7);
    for (const p of AMENDMENT_REQUEST_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = AMENDMENT_REQUEST_PRESETS.map((p) => p.id);
    expect(ids).toContain("off-catalog-ground-block");
    expect(ids).toContain("wrong-deadline-block");
    expect(ids).toContain("auto-amended-block");
  });
});

describe("buildAmendmentRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildAmendmentRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_AMENDMENT_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_AMENDMENT_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildAmendmentRequestBody({
      taskId: "t2",
      determination: { autoAmended: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoAmended: true });
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

describe("runAmendmentRequestTask", () => {
  it("POSTs to the amendment-request route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runAmendmentRequestTask(
      { taskId: "t", request: DEMO_AMENDMENT_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/amendment-request/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runAmendmentRequestTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("amendmentViewFromTask", () => {
  it("lifts a resolved determination from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "AmendmentDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  requestRef: "amend-002",
                  determination: {
                    requestRef: "amend-002",
                    patientRef: "patient-7310",
                    recordRef: "note-61120",
                    requestType: "correct-clinical",
                    extensionInvoked: false,
                    responseDeadline: "2026-10-19",
                    daysUntilDeadline: 42,
                    disposition: "recommend-deny",
                    deniedOnGround: "ground.accurate-and-complete",
                    deniedOnGroundLabel: "PHI is accurate and complete",
                    patientMayStatementOfDisagreement: true,
                    requiresHumanReview: true,
                    autoAmended: false,
                    autoDenied: false,
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
          amendmentGroundSourced: true,
          amendmentDeadlineComputed: true,
          amendmentNoAutonomousWrite: true
        }
      }
    };
    const view = amendmentViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("recommend-deny");
      expect(view.deniedOnGround).toBe("ground.accurate-and-complete");
      expect(view.patientMayStatementOfDisagreement).toBe(true);
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
          policiesEvaluated: ["policy.amendment.deadline-computed"],
          violations: [
            { policyId: "policy.amendment.deadline-computed", reason: "mis-computed" }
          ]
        }
      }
    };
    const view = amendmentViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.amendment.deadline-computed");
      expect(view.policiesEvaluated).toContain("policy.amendment.deadline-computed");
    }
  });
});
