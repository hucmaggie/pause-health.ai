import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONTROLLED_SUBSTANCE_PRESETS,
  buildControlledSubstanceRequestBody,
  controlledSubstanceViewFromTask,
  runControlledSubstanceTask
} from "./controlled-substance-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST,
  DEMO_CONTROLLED_SUBSTANCE_REQUEST,
  controlledSubstanceGuidelineSourced,
  controlledSubstanceMmeComputed,
  controlledSubstanceNoAutonomousDecision,
  evaluateControlledSubstance
} from "../lib/controlled-substance";

/**
 * Unit coverage for the /demo/intake Controlled Substance panel — tested as node-env pure
 * functions (this repo tests components as logic, not renders). We exercise the JSON-RPC A2A body
 * it POSTs, that runControlledSubstanceTask returns the resulting task, and that
 * controlledSubstanceViewFromTask lifts a determination and a governance block into render-ready
 * shapes. The task fixtures mirror what app/api/agents/controlled-substance actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateControlledSubstance(DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST);
  return {
    id: "cs-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "ControlledSubstanceDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: {
                determination,
                requestRef: DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST.requestRef
              }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.controlledsubstance.guideline-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "cs-abc",
        requestRef: determination.requestRef,
        guidelineId: determination.guidelineId,
        totalMmePerDay: determination.totalMmePerDay,
        concurrentOpioidBenzo: determination.concurrentOpioidBenzo,
        distinctPrescribers: determination.distinctPrescribers,
        distinctPharmacies: determination.distinctPharmacies,
        riskLevel: determination.riskLevel,
        disposition: determination.disposition,
        requiresPrescriberReview: determination.requiresPrescriberReview,
        controlledSubstanceGuidelineSourced: true,
        controlledSubstanceMmeComputed: true,
        controlledSubstanceNoAutonomousDecision: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "cs-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this controlled-substance run: policy.controlledsubstance.mme-computed (guessed dose)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.controlledsubstance.mme-computed"],
        violations: [
          {
            policyId: "policy.controlledsubstance.mme-computed",
            reason: "a total that does not match the computed proposed + concurrent sum"
          }
        ]
      }
    }
  };
}

describe("CONTROLLED_SUBSTANCE_PRESETS", () => {
  it("has a low-risk preset", () => {
    const preset = CONTROLLED_SUBSTANCE_PRESETS.find((p) => p.id === "low");
    expect(preset).toBeDefined();
    const d = evaluateControlledSubstance(preset!.request!);
    expect(d.riskLevel).toBe("low");
    expect(d.requiresPrescriberReview).toBe(false);
  });

  it("has a high-MME preset that sums over the threshold", () => {
    const preset = CONTROLLED_SUBSTANCE_PRESETS.find((p) => p.id === "high-mme");
    expect(preset).toBeDefined();
    expect(preset!.request).toEqual(DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST);
    const d = evaluateControlledSubstance(preset!.request!);
    expect(d.totalMmePerDay).toBe(100);
    expect(d.riskLevel).toBe("high");
  });

  it("has an opioid+benzo preset flagged high risk", () => {
    const preset = CONTROLLED_SUBSTANCE_PRESETS.find((p) => p.id === "opioid-benzo");
    expect(preset).toBeDefined();
    const d = evaluateControlledSubstance(preset!.request!);
    expect(d.concurrentOpioidBenzo).toBe(true);
    expect(d.riskLevel).toBe("high");
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const unsourced = CONTROLLED_SUBSTANCE_PRESETS.find((p) => p.id === "unsourced-guideline-block");
    expect(controlledSubstanceGuidelineSourced(unsourced!.determination as never)).toBe(false);

    const guessed = CONTROLLED_SUBSTANCE_PRESETS.find((p) => p.id === "guessed-mme-block");
    expect(controlledSubstanceMmeComputed(guessed!.determination as never)).toBe(false);

    const auto = CONTROLLED_SUBSTANCE_PRESETS.find((p) => p.id === "auto-decision-block");
    expect(controlledSubstanceNoAutonomousDecision(auto!.determination as never)).toBe(false);
  });
});

describe("buildControlledSubstanceRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildControlledSubstanceRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_CONTROLLED_SUBSTANCE_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_CONTROLLED_SUBSTANCE_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildControlledSubstanceRequestBody({
      taskId: "task-block",
      determination: { guidelineId: "guideline.made-up", riskLevel: "low" }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { guidelineId: "guideline.made-up", riskLevel: "low" }
    });
  });
});

describe("runControlledSubstanceTask", () => {
  it("POSTs the A2A body to the controlled-substance agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/controlled-substance/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.requestRef).toBe("cs-request-002");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runControlledSubstanceTask(
      { taskId: "task-1", request: DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("cs-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runControlledSubstanceTask(
        { taskId: "t", request: DEMO_CONTROLLED_SUBSTANCE_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("controlledSubstanceViewFromTask", () => {
  it("lifts a produced determination with the total, risk, and honesty signals", () => {
    const view = controlledSubstanceViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.requestRef).toBe("cs-request-002");
    expect(view.totalMmePerDay).toBe(100);
    expect(view.riskLevel).toBe("high");
    expect(view.requiresPrescriberReview).toBe(true);
    expect(view.controlledSubstanceGuidelineSourced).toBe(true);
    expect(view.controlledSubstanceMmeComputed).toBe(true);
    expect(view.controlledSubstanceNoAutonomousDecision).toBe(true);
    expect(view.traceTaskId).toBe("cs-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = controlledSubstanceViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this controlled-substance run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.controlledsubstance.mme-computed"
    );
    expect(view.policiesEvaluated).toContain("policy.controlledsubstance.mme-computed");
    expect(view.traceTaskId).toBe("cs-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "cs-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [
            { type: "text", text: "The controlled-substance determination could not be produced." }
          ]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = controlledSubstanceViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
