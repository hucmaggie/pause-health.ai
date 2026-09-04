import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FINANCIAL_ASSISTANCE_PRESETS,
  buildFinancialAssistanceRequestBody,
  financialAssistanceViewFromTask,
  runFinancialAssistanceTask
} from "./financial-assistance-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_FINANCIAL_ASSISTANCE_NOT_ELIGIBLE_REQUEST,
  DEMO_FINANCIAL_ASSISTANCE_REQUEST,
  ecaGatedOnScreening,
  evaluateFinancialAssistance,
  finAssistHumanReviewed,
  finAssistScheduleCited
} from "../lib/financial-assistance";

/**
 * Unit coverage for the /demo/intake Patient Financial Assistance & Charity Care agent
 * panel. This repo tests components as node-env pure functions (see
 * overpayment-recovery-panel.test.ts) rather than rendering them, so we exercise the
 * exact logic the panel invokes: the JSON-RPC A2A body it POSTs, that
 * runFinancialAssistanceTask returns the resulting task, and that
 * financialAssistanceViewFromTask lifts a determination and a governance block into
 * render-ready shapes. The task fixtures mirror the shapes
 * app/api/agents/financial-assistance actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateFinancialAssistance(DEMO_FINANCIAL_ASSISTANCE_REQUEST);
  return {
    id: "finassist-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "FinancialAssistanceDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: { determination, patientRef: DEMO_FINANCIAL_ASSISTANCE_REQUEST.patientRef }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.finassist.fap-schedule-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "finassist-abc",
        patientRef: determination.patientRef,
        fplPercent: determination.fplPercent,
        assistanceTier: determination.assistanceTier,
        tierId: determination.tierId,
        discountPct: determination.discountPct,
        presumptivelyEligible: determination.presumptivelyEligible,
        screeningComplete: determination.screeningComplete,
        ecaAllowed: determination.ecaAllowed,
        requiresHumanReview: determination.requiresHumanReview,
        ecaGatedOnScreening: true,
        finAssistScheduleCited: true,
        finAssistHumanReviewed: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "finassist-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this financial-assistance run: policy.finassist.no-eca-before-screening (collections before screening)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.finassist.no-eca-before-screening"],
        violations: [
          {
            policyId: "policy.finassist.no-eca-before-screening",
            reason: "a collection action was asserted before screening was complete"
          }
        ]
      }
    }
  };
}

describe("FINANCIAL_ASSISTANCE_PRESETS", () => {
  it("has a full-charity preset resolving to a 100% discount", () => {
    const preset = FINANCIAL_ASSISTANCE_PRESETS.find((p) => p.id === "full-charity");
    expect(preset).toBeDefined();
    const d = evaluateFinancialAssistance(preset!.request!);
    expect(d.assistanceTier).toBe("full-charity");
    expect(d.discountPct).toBe(100);
  });

  it("has a not-eligible preset that requires human review", () => {
    const preset = FINANCIAL_ASSISTANCE_PRESETS.find((p) => p.id === "not-eligible");
    expect(preset).toBeDefined();
    const d = evaluateFinancialAssistance(preset!.request!);
    expect(d.assistanceTier).toBe("not-eligible");
    expect(d.requiresHumanReview).toBe(true);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const eca = FINANCIAL_ASSISTANCE_PRESETS.find((p) => p.id === "eca-before-screening-block");
    expect(ecaGatedOnScreening(eca!.determination as never)).toBe(false);

    const noTier = FINANCIAL_ASSISTANCE_PRESETS.find((p) => p.id === "no-tier-block");
    expect(finAssistScheduleCited(noTier!.determination as never)).toBe(false);

    const autonomous = FINANCIAL_ASSISTANCE_PRESETS.find((p) => p.id === "autonomous-denial-block");
    expect(finAssistHumanReviewed(autonomous!.determination as never)).toBe(false);
  });
});

describe("buildFinancialAssistanceRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildFinancialAssistanceRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_FINANCIAL_ASSISTANCE_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_FINANCIAL_ASSISTANCE_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildFinancialAssistanceRequestBody({
      taskId: "task-block",
      determination: { ecaAllowed: true, screeningComplete: false }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { ecaAllowed: true, screeningComplete: false }
    });
  });
});

describe("runFinancialAssistanceTask", () => {
  it("POSTs the A2A body to the financial-assistance agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/financial-assistance/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.patientRef).toBe("finassist-patient-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runFinancialAssistanceTask(
      { taskId: "task-1", request: DEMO_FINANCIAL_ASSISTANCE_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("finassist-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runFinancialAssistanceTask(
        { taskId: "t", request: DEMO_FINANCIAL_ASSISTANCE_NOT_ELIGIBLE_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("financialAssistanceViewFromTask", () => {
  it("lifts a produced determination with the tier, discount, and honesty signals", () => {
    const view = financialAssistanceViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.patientRef).toBe("finassist-patient-001");
    expect(view.assistanceTier).toBe("full-charity");
    expect(view.tierId).toBe("fap.tier.full-charity");
    expect(view.discountPct).toBe(100);
    expect(view.ecaGatedOnScreening).toBe(true);
    expect(view.finAssistScheduleCited).toBe(true);
    expect(view.finAssistHumanReviewed).toBe(true);
    expect(view.traceTaskId).toBe("finassist-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = financialAssistanceViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this financial-assistance run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.finassist.no-eca-before-screening"
    );
    expect(view.policiesEvaluated).toContain("policy.finassist.no-eca-before-screening");
    expect(view.traceTaskId).toBe("finassist-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "finassist-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [
            { type: "text", text: "The financial-assistance determination could not be produced." }
          ]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = financialAssistanceViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
