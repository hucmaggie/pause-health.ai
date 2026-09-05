import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TIMELY_FILING_PRESETS,
  buildTimelyFilingRequestBody,
  runTimelyFilingTask,
  timelyFilingViewFromTask
} from "./timely-filing-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_TIMELY_FILING_EXCEPTION_REQUEST,
  DEMO_TIMELY_FILING_REQUEST,
  evaluateTimelyFiling,
  timelyFilingDeadlineComputed,
  timelyFilingNoAutonomousWriteOff,
  timelyFilingRuleSourced
} from "../lib/timely-filing";

/**
 * Unit coverage for the /demo/intake Timely Filing panel — tested as node-env pure functions
 * (this repo tests components as logic, not renders). We exercise the JSON-RPC A2A body it POSTs,
 * that runTimelyFilingTask returns the resulting task, and that timelyFilingViewFromTask lifts a
 * determination and a governance block into render-ready shapes. The task fixtures mirror what
 * app/api/agents/timely-filing actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateTimelyFiling(DEMO_TIMELY_FILING_REQUEST);
  return {
    id: "tf-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "TimelyFilingDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: { determination, claimRef: DEMO_TIMELY_FILING_REQUEST.claimRef }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.timelyfiling.filing-limit-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "tf-abc",
        claimRef: determination.claimRef,
        filingRuleId: determination.filingRuleId,
        limitDays: determination.limitDays,
        deadline: determination.deadline,
        daysLate: determination.daysLate,
        timely: determination.timely,
        exceptionRecognized: determination.exceptionRecognized,
        disposition: determination.disposition,
        requiresHumanReview: determination.requiresHumanReview,
        timelyFilingRuleSourced: true,
        timelyFilingDeadlineComputed: true,
        timelyFilingNoAutonomousWriteOff: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "tf-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this timely-filing run: policy.timelyfiling.deadline-computed (guessed deadline)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.timelyfiling.deadline-computed"],
        violations: [
          {
            policyId: "policy.timelyfiling.deadline-computed",
            reason: "a deadline that does not match the computed date of service + limit"
          }
        ]
      }
    }
  };
}

describe("TIMELY_FILING_PRESETS", () => {
  it("has a timely preset that accepts", () => {
    const preset = TIMELY_FILING_PRESETS.find((p) => p.id === "timely");
    expect(preset).toBeDefined();
    const d = evaluateTimelyFiling(preset!.request!);
    expect(d.timely).toBe(true);
    expect(d.disposition).toBe("accept");
  });

  it("has an exception preset that routes to appeal", () => {
    const preset = TIMELY_FILING_PRESETS.find((p) => p.id === "exception");
    expect(preset).toBeDefined();
    expect(preset!.request).toEqual(DEMO_TIMELY_FILING_EXCEPTION_REQUEST);
    const d = evaluateTimelyFiling(preset!.request!);
    expect(d.exceptionRecognized).toBe(true);
    expect(d.disposition).toBe("appeal-with-exception");
    expect(d.requiresHumanReview).toBe(true);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const unsourced = TIMELY_FILING_PRESETS.find((p) => p.id === "unsourced-rule-block");
    expect(timelyFilingRuleSourced(unsourced!.determination as never)).toBe(false);

    const guessed = TIMELY_FILING_PRESETS.find((p) => p.id === "guessed-deadline-block");
    expect(timelyFilingDeadlineComputed(guessed!.determination as never)).toBe(false);

    const writeOff = TIMELY_FILING_PRESETS.find((p) => p.id === "auto-write-off-block");
    expect(timelyFilingNoAutonomousWriteOff(writeOff!.determination as never)).toBe(false);
  });
});

describe("buildTimelyFilingRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildTimelyFilingRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_TIMELY_FILING_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_TIMELY_FILING_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildTimelyFilingRequestBody({
      taskId: "task-block",
      determination: { filingRuleId: "rule.filing.made-up", timely: true }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { filingRuleId: "rule.filing.made-up", timely: true }
    });
  });
});

describe("runTimelyFilingTask", () => {
  it("POSTs the A2A body to the timely-filing agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/timely-filing/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.claimRef).toBe("claim-tf-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runTimelyFilingTask(
      { taskId: "task-1", request: DEMO_TIMELY_FILING_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("tf-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runTimelyFilingTask(
        { taskId: "t", request: DEMO_TIMELY_FILING_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("timelyFilingViewFromTask", () => {
  it("lifts a produced determination with the deadline and honesty signals", () => {
    const view = timelyFilingViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.claimRef).toBe("claim-tf-001");
    expect(view.limitDays).toBe(90);
    expect(view.deadline).toBe("2026-04-10");
    expect(view.timely).toBe(true);
    expect(view.disposition).toBe("accept");
    expect(view.requiresHumanReview).toBe(false);
    expect(view.timelyFilingRuleSourced).toBe(true);
    expect(view.timelyFilingDeadlineComputed).toBe(true);
    expect(view.timelyFilingNoAutonomousWriteOff).toBe(true);
    expect(view.traceTaskId).toBe("tf-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = timelyFilingViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this timely-filing run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.timelyfiling.deadline-computed"
    );
    expect(view.policiesEvaluated).toContain("policy.timelyfiling.deadline-computed");
    expect(view.traceTaskId).toBe("tf-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "tf-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The timely-filing determination could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = timelyFilingViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
