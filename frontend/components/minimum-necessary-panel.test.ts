import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MINIMUM_NECESSARY_PRESETS,
  buildMinimumNecessaryRequestBody,
  minimumNecessaryViewFromTask,
  runMinimumNecessaryTask
} from "./minimum-necessary-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_MINIMUM_NECESSARY_INSCOPE_REQUEST,
  DEMO_MINIMUM_NECESSARY_REQUEST,
  evaluateMinimumNecessary,
  minNecNoAutonomousOverDisclosure,
  minNecPurposeSourced,
  minNecScoped
} from "../lib/minimum-necessary";

/**
 * Unit coverage for the /demo/intake Minimum Necessary agent panel — tested as node-env pure
 * functions (this repo tests components as logic, not renders). We exercise the JSON-RPC A2A
 * body it POSTs, that runMinimumNecessaryTask returns the resulting task, and that
 * minimumNecessaryViewFromTask lifts a determination and a governance block into render-ready
 * shapes. The task fixtures mirror what app/api/agents/minimum-necessary actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateMinimumNecessary(DEMO_MINIMUM_NECESSARY_REQUEST);
  return {
    id: "mn-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "MinimumNecessaryDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: { determination, requestRef: DEMO_MINIMUM_NECESSARY_REQUEST.requestRef }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.minnec.purpose-of-use-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "mn-abc",
        requestRef: determination.requestRef,
        purposeId: determination.purposeId,
        requestorRole: determination.requestorRole,
        recordScope: determination.recordScope,
        exempt: determination.exempt,
        releasedCount: determination.releasedCount,
        withheldCount: determination.withheldCount,
        minimumNecessary: determination.minimumNecessary,
        bulk: determination.bulk,
        requiresHumanReview: determination.requiresHumanReview,
        minNecPurposeSourced: true,
        minNecScoped: true,
        minNecNoAutonomousOverDisclosure: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "mn-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this minimum-necessary run: policy.minnec.minimum-necessary-scoped (over-disclosure)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.minnec.minimum-necessary-scoped"],
        violations: [
          {
            policyId: "policy.minnec.minimum-necessary-scoped",
            reason: "a released field is beyond the minimum-necessary scope"
          }
        ]
      }
    }
  };
}

describe("MINIMUM_NECESSARY_PRESETS", () => {
  it("has a narrowed payment preset that withholds an out-of-scope field", () => {
    const preset = MINIMUM_NECESSARY_PRESETS.find((p) => p.id === "payment-narrowed");
    expect(preset).toBeDefined();
    const d = evaluateMinimumNecessary(preset!.request!);
    expect(d.withheldCount).toBe(1);
    expect(d.requiresHumanReview).toBe(true);
  });

  it("has a fully in-scope payment preset with no review", () => {
    const preset = MINIMUM_NECESSARY_PRESETS.find((p) => p.id === "payment-inscope");
    expect(preset).toBeDefined();
    expect(preset!.request).toEqual(DEMO_MINIMUM_NECESSARY_INSCOPE_REQUEST);
    const d = evaluateMinimumNecessary(preset!.request!);
    expect(d.minimumNecessary).toBe(true);
    expect(d.requiresHumanReview).toBe(false);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const noPurpose = MINIMUM_NECESSARY_PRESETS.find((p) => p.id === "no-purpose-block");
    expect(minNecPurposeSourced(noPurpose!.determination as never)).toBe(false);

    const overScope = MINIMUM_NECESSARY_PRESETS.find((p) => p.id === "over-scope-block");
    expect(minNecScoped(overScope!.determination as never)).toBe(false);

    const autonomous = MINIMUM_NECESSARY_PRESETS.find((p) => p.id === "autonomous-block");
    expect(minNecNoAutonomousOverDisclosure(autonomous!.determination as never)).toBe(false);
  });
});

describe("buildMinimumNecessaryRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildMinimumNecessaryRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_MINIMUM_NECESSARY_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_MINIMUM_NECESSARY_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildMinimumNecessaryRequestBody({
      taskId: "task-block",
      determination: { purposeId: "purpose.payment", minimumNecessary: false }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { purposeId: "purpose.payment", minimumNecessary: false }
    });
  });
});

describe("runMinimumNecessaryTask", () => {
  it("POSTs the A2A body to the minimum-necessary agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/minimum-necessary/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.purposeId).toBe("purpose.payment");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runMinimumNecessaryTask(
      { taskId: "task-1", request: DEMO_MINIMUM_NECESSARY_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("mn-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runMinimumNecessaryTask(
        { taskId: "t", request: DEMO_MINIMUM_NECESSARY_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("minimumNecessaryViewFromTask", () => {
  it("lifts a produced determination with the counts and honesty signals", () => {
    const view = minimumNecessaryViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.requestRef).toBe("mn-request-001");
    expect(view.purposeId).toBe("purpose.payment");
    expect(view.releasedCount).toBe(4);
    expect(view.withheldCount).toBe(1);
    expect(view.minimumNecessary).toBe(false);
    expect(view.requiresHumanReview).toBe(true);
    expect(view.fieldDecisions.length).toBe(5);
    expect(view.minNecPurposeSourced).toBe(true);
    expect(view.minNecScoped).toBe(true);
    expect(view.minNecNoAutonomousOverDisclosure).toBe(true);
    expect(view.traceTaskId).toBe("mn-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = minimumNecessaryViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this minimum-necessary run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.minnec.minimum-necessary-scoped"
    );
    expect(view.policiesEvaluated).toContain("policy.minnec.minimum-necessary-scoped");
    expect(view.traceTaskId).toBe("mn-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "mn-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The minimum-necessary determination could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = minimumNecessaryViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
