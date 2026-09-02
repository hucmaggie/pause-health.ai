import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COB_PRESETS,
  buildCobRequestBody,
  cobViewFromTask,
  runCobTask
} from "./coordination-of-benefits-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_COB_DECREE_REQUEST,
  DEMO_COB_REQUEST,
  cobDecreeHonored,
  cobHumanCosigned,
  cobRuleCited,
  evaluateCoordinationOfBenefits
} from "../lib/coordination-of-benefits";

/**
 * Unit coverage for the /demo/intake Coordination of Benefits agent panel. This repo
 * tests components as node-env pure functions (see records-retention-panel.test.ts)
 * rather than rendering them, so we exercise the exact logic the panel invokes: the
 * JSON-RPC A2A body it POSTs, that runCobTask returns the resulting task, and that
 * cobViewFromTask lifts a determination and a governance block into render-ready
 * shapes. The task fixtures mirror the shapes app/api/agents/coordination-of-benefits
 * actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateCoordinationOfBenefits(DEMO_COB_REQUEST);
  return {
    id: "cob-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "CobDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result: { determination, patientRef: DEMO_COB_REQUEST.patientRef } }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.cob.order-of-benefits-rule-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "cob-abc",
        patientRef: determination.patientRef,
        isDependentChild: determination.isDependentChild,
        primaryCoverageId: determination.primaryCoverageId,
        citedRuleIds: determination.citedRuleIds,
        custodyDecreeApplied: determination.custodyDecreeApplied,
        requiresHumanCosign: determination.requiresHumanCosign,
        cobDecreeHonored: true,
        cobRuleCited: true,
        cobHumanCosigned: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "cob-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this coordination-of-benefits run: policy.cob.custody-decree-overrides-birthday (ignored decree)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.cob.custody-decree-overrides-birthday"],
        violations: [
          {
            policyId: "policy.cob.custody-decree-overrides-birthday",
            reason: "an ordering ignored an active custody decree"
          }
        ]
      }
    }
  };
}

describe("COB_PRESETS", () => {
  it("has a subscriber-before-dependent preset resolving to the subscriber plan", () => {
    const preset = COB_PRESETS.find((p) => p.id === "subscriber-before-dependent");
    expect(preset).toBeDefined();
    const d = evaluateCoordinationOfBenefits(preset!.request!);
    expect(d.primaryCoverageId).toBe("coverage-own-ppo");
  });

  it("has a custody-decree preset that overrides the birthday rule", () => {
    const preset = COB_PRESETS.find((p) => p.id === "custody-decree");
    expect(preset).toBeDefined();
    const d = evaluateCoordinationOfBenefits(preset!.request!);
    expect(d.primaryCoverageId).toBe("coverage-dad-hmo");
    expect(d.custodyDecreeApplied).toBe(true);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const decree = COB_PRESETS.find((p) => p.id === "decree-ignored-block");
    expect(cobDecreeHonored(decree!.determination as never)).toBe(false);

    const noRule = COB_PRESETS.find((p) => p.id === "no-rule-block");
    expect(cobRuleCited(noRule!.determination as never)).toBe(false);

    const autonomous = COB_PRESETS.find((p) => p.id === "autonomous-adjudication-block");
    expect(cobHumanCosigned(autonomous!.determination as never)).toBe(false);
  });
});

describe("buildCobRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildCobRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_COB_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_COB_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildCobRequestBody({
      taskId: "task-block",
      determination: { primaryCoverageId: "coverage-mom-ppo", requiresHumanCosign: false }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { primaryCoverageId: "coverage-mom-ppo", requiresHumanCosign: false }
    });
  });
});

describe("runCobTask", () => {
  it("POSTs the A2A body to the coordination-of-benefits agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/coordination-of-benefits/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.patientRef).toBe("cob-patient-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runCobTask(
      { taskId: "task-1", request: DEMO_COB_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("cob-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runCobTask(
        { taskId: "t", request: DEMO_COB_DECREE_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("cobViewFromTask", () => {
  it("lifts a produced determination with the primary, ordering, and honesty signals", () => {
    const view = cobViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.patientRef).toBe("cob-patient-001");
    expect(view.primaryCoverageId).toBe("coverage-own-ppo");
    expect(view.orderedCoverages[0].decidingRuleId).toBe(
      "rule.cob.subscriber-before-dependent"
    );
    expect(view.requiresHumanCosign).toBe(true);
    expect(view.cobDecreeHonored).toBe(true);
    expect(view.cobRuleCited).toBe(true);
    expect(view.cobHumanCosigned).toBe(true);
    expect(view.traceTaskId).toBe("cob-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = cobViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this coordination-of-benefits run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.cob.custody-decree-overrides-birthday"
    );
    expect(view.policiesEvaluated).toContain("policy.cob.custody-decree-overrides-birthday");
    expect(view.traceTaskId).toBe("cob-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "cob-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The coordination-of-benefits determination could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = cobViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
