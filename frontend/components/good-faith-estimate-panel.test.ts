import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GOOD_FAITH_ESTIMATE_PRESETS,
  buildGoodFaithEstimateRequestBody,
  goodFaithEstimateViewFromTask,
  runGoodFaithEstimateTask
} from "./good-faith-estimate-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_GFE_IMAGING_REQUEST,
  DEMO_GFE_REQUEST,
  evaluateGoodFaithEstimate,
  gfeChargeMasterSourced,
  gfeEstimateNotBinding,
  gfeExpectedItemsComplete
} from "../lib/good-faith-estimate";

/**
 * Unit coverage for the /demo/intake Good Faith Estimate agent panel. This repo tests
 * components as node-env pure functions (see lab-result-panel.test.ts) rather than
 * rendering them, so we exercise the exact logic the panel invokes: the JSON-RPC A2A body
 * it POSTs, that runGoodFaithEstimateTask returns the resulting task, and that
 * goodFaithEstimateViewFromTask lifts a determination and a governance block into
 * render-ready shapes. The task fixtures mirror the shapes app/api/agents/good-faith-estimate
 * actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateGoodFaithEstimate(DEMO_GFE_REQUEST);
  return {
    id: "gfe-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "GoodFaithEstimateDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: { determination, patientRef: DEMO_GFE_REQUEST.patientRef }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.gfe.charge-master-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "gfe-abc",
        patientRef: determination.patientRef,
        primaryServiceId: determination.primaryServiceId,
        lineItemCount: determination.lineItems.length,
        totalEstimate: determination.totalEstimate,
        allLineItemsSourced: determination.allLineItemsSourced,
        expectedItemsComplete: determination.expectedItemsComplete,
        binding: determination.binding,
        requiresPatientConfirmation: determination.requiresPatientConfirmation,
        disputeThreshold: determination.disputeThreshold,
        gfeChargeMasterSourced: true,
        gfeExpectedItemsComplete: true,
        gfeEstimateNotBinding: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "gfe-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this good-faith-estimate run: policy.gfe.expected-items-complete (missing item)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.gfe.expected-items-complete"],
        violations: [
          {
            policyId: "policy.gfe.expected-items-complete",
            reason: "the estimate omitted a reasonably-expected item"
          }
        ]
      }
    }
  };
}

describe("GOOD_FAITH_ESTIMATE_PRESETS", () => {
  it("has a complete-consult preset resolving to a $580 sourced estimate", () => {
    const preset = GOOD_FAITH_ESTIMATE_PRESETS.find((p) => p.id === "complete-consult");
    expect(preset).toBeDefined();
    const d = evaluateGoodFaithEstimate(preset!.request!);
    expect(d.totalEstimate).toBe(580);
    expect(d.expectedItemsComplete).toBe(true);
    expect(d.allLineItemsSourced).toBe(true);
  });

  it("has a complete-imaging preset resolving to a $470 estimate", () => {
    const preset = GOOD_FAITH_ESTIMATE_PRESETS.find((p) => p.id === "complete-imaging");
    expect(preset).toBeDefined();
    const d = evaluateGoodFaithEstimate(preset!.request!);
    expect(d.totalEstimate).toBe(470);
    // Sanity: the imaging preset matches the exported demo constant.
    expect(preset!.request).toEqual(DEMO_GFE_IMAGING_REQUEST);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const offCatalog = GOOD_FAITH_ESTIMATE_PRESETS.find((p) => p.id === "off-catalog-block");
    expect(gfeChargeMasterSourced(offCatalog!.determination as never)).toBe(false);

    const missing = GOOD_FAITH_ESTIMATE_PRESETS.find((p) => p.id === "missing-item-block");
    expect(gfeExpectedItemsComplete(missing!.determination as never)).toBe(false);

    const binding = GOOD_FAITH_ESTIMATE_PRESETS.find((p) => p.id === "binding-bill-block");
    expect(gfeEstimateNotBinding(binding!.determination as never)).toBe(false);
  });
});

describe("buildGoodFaithEstimateRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildGoodFaithEstimateRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_GFE_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_GFE_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildGoodFaithEstimateRequestBody({
      taskId: "task-block",
      determination: { binding: true }
    });
    expect(body.params.message.parts[0].data).toEqual({ determination: { binding: true } });
  });
});

describe("runGoodFaithEstimateTask", () => {
  it("POSTs the A2A body to the good-faith-estimate agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/good-faith-estimate/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.primaryServiceId).toBe(
        "svc.menopause-consult-comprehensive"
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runGoodFaithEstimateTask(
      { taskId: "task-1", request: DEMO_GFE_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("gfe-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runGoodFaithEstimateTask(
        { taskId: "t", request: DEMO_GFE_IMAGING_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("goodFaithEstimateViewFromTask", () => {
  it("lifts a produced estimate with the total, line items, and honesty signals", () => {
    const view = goodFaithEstimateViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.patientRef).toBe("gfe-patient-001");
    expect(view.primaryServiceId).toBe("svc.menopause-consult-comprehensive");
    expect(view.totalEstimate).toBe(580);
    expect(view.lineItems.length).toBe(2);
    expect(view.binding).toBe(false);
    expect(view.gfeChargeMasterSourced).toBe(true);
    expect(view.gfeExpectedItemsComplete).toBe(true);
    expect(view.gfeEstimateNotBinding).toBe(true);
    expect(view.traceTaskId).toBe("gfe-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = goodFaithEstimateViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this good-faith-estimate run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.gfe.expected-items-complete"
    );
    expect(view.policiesEvaluated).toContain("policy.gfe.expected-items-complete");
    expect(view.traceTaskId).toBe("gfe-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "gfe-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The good-faith-estimate could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = goodFaithEstimateViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
