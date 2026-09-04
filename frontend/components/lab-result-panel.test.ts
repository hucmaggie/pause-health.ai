import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LAB_RESULT_PRESETS,
  buildLabResultRequestBody,
  labResultViewFromTask,
  runLabResultTask
} from "./lab-result-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_LAB_RESULT_ABNORMAL_REQUEST,
  DEMO_LAB_RESULT_CRITICAL_REQUEST,
  DEMO_LAB_RESULT_REQUEST,
  evaluateLabResult,
  labClinicianReviewed,
  labCriticalValueNotified,
  labRangeCited
} from "../lib/lab-result";

/**
 * Unit coverage for the /demo/intake Lab Result & Critical-Value Notification agent
 * panel. This repo tests components as node-env pure functions (see
 * financial-assistance-panel.test.ts) rather than rendering them, so we exercise the
 * exact logic the panel invokes: the JSON-RPC A2A body it POSTs, that runLabResultTask
 * returns the resulting task, and that labResultViewFromTask lifts a determination and a
 * governance block into render-ready shapes. The task fixtures mirror the shapes
 * app/api/agents/lab-result actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateLabResult(DEMO_LAB_RESULT_CRITICAL_REQUEST);
  return {
    id: "lab-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "LabResultDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: { determination, patientRef: DEMO_LAB_RESULT_CRITICAL_REQUEST.patientRef }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.lab.critical-value-notified"],
        traceSpanId: "span-1",
        traceTaskId: "lab-abc",
        patientRef: determination.patientRef,
        analyteId: determination.analyteId,
        value: determination.value,
        classification: determination.classification,
        isCritical: determination.isCritical,
        requiresProviderNotification: determination.requiresProviderNotification,
        requiresClinicianReview: determination.requiresClinicianReview,
        labCriticalValueNotified: true,
        labRangeCited: true,
        labClinicianReviewed: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "lab-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this lab-result run: policy.lab.critical-value-notified (suppressed critical value)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.lab.critical-value-notified"],
        violations: [
          {
            policyId: "policy.lab.critical-value-notified",
            reason: "a critical value was flagged as not requiring notification"
          }
        ]
      }
    }
  };
}

describe("LAB_RESULT_PRESETS", () => {
  it("has a critical-high preset resolving to mandatory notification", () => {
    const preset = LAB_RESULT_PRESETS.find((p) => p.id === "critical-high");
    expect(preset).toBeDefined();
    const d = evaluateLabResult(preset!.request!);
    expect(d.classification).toBe("critical-high");
    expect(d.requiresProviderNotification).toBe(true);
  });

  it("has an abnormal-high preset that requires review but not notification", () => {
    const preset = LAB_RESULT_PRESETS.find((p) => p.id === "abnormal-high");
    expect(preset).toBeDefined();
    const d = evaluateLabResult(preset!.request!);
    expect(d.classification).toBe("abnormal-high");
    expect(d.requiresProviderNotification).toBe(false);
    expect(d.requiresClinicianReview).toBe(true);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const suppress = LAB_RESULT_PRESETS.find((p) => p.id === "suppress-critical-block");
    expect(labCriticalValueNotified(suppress!.determination as never)).toBe(false);

    const noRange = LAB_RESULT_PRESETS.find((p) => p.id === "no-range-block");
    expect(labRangeCited(noRange!.determination as never)).toBe(false);

    const autonomous = LAB_RESULT_PRESETS.find((p) => p.id === "autonomous-action-block");
    expect(labClinicianReviewed(autonomous!.determination as never)).toBe(false);
  });
});

describe("buildLabResultRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildLabResultRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_LAB_RESULT_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_LAB_RESULT_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildLabResultRequestBody({
      taskId: "task-block",
      determination: { isCritical: true, requiresProviderNotification: false }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { isCritical: true, requiresProviderNotification: false }
    });
  });
});

describe("runLabResultTask", () => {
  it("POSTs the A2A body to the lab-result agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/lab-result/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.analyteId).toBe("analyte.potassium");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runLabResultTask(
      { taskId: "task-1", request: DEMO_LAB_RESULT_CRITICAL_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("lab-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runLabResultTask(
        { taskId: "t", request: DEMO_LAB_RESULT_ABNORMAL_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("labResultViewFromTask", () => {
  it("lifts a produced determination with the classification and honesty signals", () => {
    const view = labResultViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.patientRef).toBe("lab-patient-002");
    expect(view.analyteId).toBe("analyte.potassium");
    expect(view.classification).toBe("critical-high");
    expect(view.isCritical).toBe(true);
    expect(view.requiresProviderNotification).toBe(true);
    expect(view.labCriticalValueNotified).toBe(true);
    expect(view.labRangeCited).toBe(true);
    expect(view.labClinicianReviewed).toBe(true);
    expect(view.traceTaskId).toBe("lab-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = labResultViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this lab-result run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.lab.critical-value-notified"
    );
    expect(view.policiesEvaluated).toContain("policy.lab.critical-value-notified");
    expect(view.traceTaskId).toBe("lab-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "lab-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [
            { type: "text", text: "The lab-result classification could not be produced." }
          ]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = labResultViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
