import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ABN_PRESETS,
  buildAbnRequestBody,
  runAbnTask,
  abnViewFromTask
} from "./advance-beneficiary-notice-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_ABN_NONCOVERED_REQUEST,
  DEMO_ABN_REQUEST,
  abnCoverageRuleSourced,
  abnNoAutonomousBeneficiaryLiability,
  abnRequiredWhenNoncovered,
  evaluateAbn
} from "../lib/advance-beneficiary-notice";

/**
 * Unit coverage for the /demo/intake Advance Beneficiary Notice panel — tested as node-env pure
 * functions (this repo tests components as logic, not renders). We exercise the JSON-RPC A2A body
 * it POSTs, that runAbnTask returns the resulting task, and that abnViewFromTask lifts a
 * determination and a governance block into render-ready shapes. The task fixtures mirror what
 * app/api/agents/advance-beneficiary-notice actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateAbn(DEMO_ABN_REQUEST);
  return {
    id: "abn-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "AbnDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: { determination, requestRef: DEMO_ABN_REQUEST.requestRef }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.abn.coverage-rule-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "abn-abc",
        requestRef: determination.requestRef,
        coverageRuleId: determination.coverageRuleId,
        coverageAssessment: determination.coverageAssessment,
        abnRequired: determination.abnRequired,
        abnValid: determination.abnValid,
        patientMayBeBilled: determination.patientMayBeBilled,
        modifier: determination.modifier,
        disposition: determination.disposition,
        requiresHumanReview: determination.requiresHumanReview,
        abnCoverageRuleSourced: true,
        abnRequiredWhenNoncovered: true,
        abnNoAutonomousBeneficiaryLiability: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "abn-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this ABN run: policy.abn.no-autonomous-beneficiary-liability (billed with no valid ABN)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.abn.no-autonomous-beneficiary-liability"],
        violations: [
          {
            policyId: "policy.abn.no-autonomous-beneficiary-liability",
            reason: "the beneficiary was billed for a non-covered service with no valid ABN"
          }
        ]
      }
    }
  };
}

describe("ABN_PRESETS", () => {
  it("has a covered preset that proceeds with no ABN", () => {
    const preset = ABN_PRESETS.find((p) => p.id === "covered");
    expect(preset).toBeDefined();
    const d = evaluateAbn(preset!.request!);
    expect(d.coverageAssessment).toBe("likely-covered");
    expect(d.abnRequired).toBe(false);
    expect(d.disposition).toBe("proceed-covered");
  });

  it("has a non-covered preset that issues an ABN before the service", () => {
    const preset = ABN_PRESETS.find((p) => p.id === "noncovered");
    expect(preset).toBeDefined();
    expect(preset!.request).toEqual(DEMO_ABN_NONCOVERED_REQUEST);
    const d = evaluateAbn(preset!.request!);
    expect(d.abnRequired).toBe(true);
    expect(d.disposition).toBe("issue-abn-before-service");
    expect(d.requiresHumanReview).toBe(true);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const unsourced = ABN_PRESETS.find((p) => p.id === "unsourced-rule-block");
    expect(abnCoverageRuleSourced(unsourced!.determination as never)).toBe(false);

    const missingReq = ABN_PRESETS.find((p) => p.id === "missing-abn-requirement-block");
    expect(abnRequiredWhenNoncovered(missingReq!.determination as never)).toBe(false);

    const autoLiability = ABN_PRESETS.find((p) => p.id === "auto-liability-block");
    expect(abnNoAutonomousBeneficiaryLiability(autoLiability!.determination as never)).toBe(false);
  });
});

describe("buildAbnRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildAbnRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_ABN_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_ABN_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildAbnRequestBody({
      taskId: "task-block",
      determination: { coverageRuleId: "rule.abn.made-up", coverageAssessment: "likely-covered" }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { coverageRuleId: "rule.abn.made-up", coverageAssessment: "likely-covered" }
    });
  });
});

describe("runAbnTask", () => {
  it("POSTs the A2A body to the ABN agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/advance-beneficiary-notice/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.requestRef).toBe("abn-req-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runAbnTask(
      { taskId: "task-1", request: DEMO_ABN_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("abn-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runAbnTask(
        { taskId: "t", request: DEMO_ABN_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("abnViewFromTask", () => {
  it("lifts a produced determination with the modifier and honesty signals", () => {
    const view = abnViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.requestRef).toBe("abn-req-001");
    expect(view.coverageAssessment).toBe("likely-covered");
    expect(view.abnRequired).toBe(false);
    expect(view.modifier).toBe("none");
    expect(view.disposition).toBe("proceed-covered");
    expect(view.requiresHumanReview).toBe(false);
    expect(view.abnCoverageRuleSourced).toBe(true);
    expect(view.abnRequiredWhenNoncovered).toBe(true);
    expect(view.abnNoAutonomousBeneficiaryLiability).toBe(true);
    expect(view.traceTaskId).toBe("abn-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = abnViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this ABN run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.abn.no-autonomous-beneficiary-liability"
    );
    expect(view.policiesEvaluated).toContain("policy.abn.no-autonomous-beneficiary-liability");
    expect(view.traceTaskId).toBe("abn-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "abn-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The ABN determination could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = abnViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
