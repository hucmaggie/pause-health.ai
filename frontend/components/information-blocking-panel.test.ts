import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  INFORMATION_BLOCKING_PRESETS,
  buildInformationBlockingRequestBody,
  informationBlockingViewFromTask,
  runInformationBlockingTask
} from "./information-blocking-panel";
import { DEMO_INFORMATION_BLOCKING_REQUEST } from "../lib/information-blocking";

describe("INFORMATION_BLOCKING_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(INFORMATION_BLOCKING_PRESETS.length).toBeGreaterThanOrEqual(7);
    for (const p of INFORMATION_BLOCKING_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = INFORMATION_BLOCKING_PRESETS.map((p) => p.id);
    expect(ids).toContain("off-catalog-exception-block");
    expect(ids).toContain("overstated-exception-block");
    expect(ids).toContain("auto-blocked-ehi-block");
  });
});

describe("buildInformationBlockingRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildInformationBlockingRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_INFORMATION_BLOCKING_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_INFORMATION_BLOCKING_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildInformationBlockingRequestBody({
      taskId: "t2",
      determination: { autoBlockedEhi: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoBlockedEhi: true });
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

describe("runInformationBlockingTask", () => {
  it("POSTs to the information-blocking route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runInformationBlockingTask(
      { taskId: "t", request: DEMO_INFORMATION_BLOCKING_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/information-blocking/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runInformationBlockingTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("informationBlockingViewFromTask", () => {
  it("lifts a resolved determination from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "InformationBlockingDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  requestRef: "ib-003",
                  determination: {
                    requestRef: "ib-003",
                    actorRef: "vendor-7788",
                    actorType: "health-it-developer",
                    ehiRequestType: "use",
                    interferedWithAccess: true,
                    claimedExceptionId: "exception.infeasibility",
                    claimedExceptionName: "Infeasibility",
                    exceptionCategory: "not-fulfilling",
                    requiredConditions: [
                      "infeasible-under-circumstances",
                      "responded-within-10-business-days"
                    ],
                    missingConditions: ["responded-within-10-business-days"],
                    exceptionSatisfied: false,
                    disposition: "potential-information-blocking-needs-review",
                    requiresComplianceReview: true,
                    autoBlockedEhi: false,
                    autoReleasedEhi: false,
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
          blockingExceptionSourced: true,
          blockingDeterminationNotOverstated: true,
          blockingNoAutonomousBlockOrRelease: true
        }
      }
    };
    const view = informationBlockingViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("potential-information-blocking-needs-review");
      expect(view.missingConditions).toContain("responded-within-10-business-days");
      expect(view.exceptionSatisfied).toBe(false);
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
          policiesEvaluated: ["policy.information-blocking.determination-not-overstated"],
          violations: [
            {
              policyId: "policy.information-blocking.determination-not-overstated",
              reason: "overstated"
            }
          ]
        }
      }
    };
    const view = informationBlockingViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe(
        "policy.information-blocking.determination-not-overstated"
      );
      expect(view.policiesEvaluated).toContain(
        "policy.information-blocking.determination-not-overstated"
      );
    }
  });
});
