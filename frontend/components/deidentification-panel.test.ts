import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEIDENTIFICATION_PRESETS,
  buildDeidentificationRequestBody,
  deidentificationViewFromTask,
  runDeidentificationTask
} from "./deidentification-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_DEIDENTIFICATION_REQUEST,
  DEMO_DEIDENTIFICATION_RETAINED_REQUEST,
  deidAllCategoriesScreened,
  deidMethodCited,
  deidNoReleaseOfReidentifiable,
  evaluateDeidentification
} from "../lib/deidentification";

/**
 * Unit coverage for the /demo/intake De-Identification & Safe Harbor agent panel. This repo
 * tests components as node-env pure functions (see balance-billing-panel.test.ts) rather than
 * rendering them, so we exercise the exact logic the panel invokes: the JSON-RPC A2A body it
 * POSTs, that runDeidentificationTask returns the resulting task, and that
 * deidentificationViewFromTask lifts a determination and a governance block into
 * render-ready shapes. The task fixtures mirror the shapes app/api/agents/deidentification
 * actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateDeidentification(DEMO_DEIDENTIFICATION_REQUEST);
  return {
    id: "deid-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "DeidentificationDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: { determination, datasetRef: DEMO_DEIDENTIFICATION_REQUEST.datasetRef }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.deid.all-categories-screened"],
        traceSpanId: "span-1",
        traceTaskId: "deid-abc",
        datasetRef: determination.datasetRef,
        method: determination.method,
        fieldCount: determination.fieldCount,
        categoriesScreened: determination.categoriesScreened.length,
        allCategoriesScreened: determination.allCategoriesScreened,
        remainingIdentifierCategoryCount: determination.remainingIdentifierCategories.length,
        methodCited: determination.methodCited,
        deidentified: determination.deidentified,
        releaseApproved: determination.releaseApproved,
        requiresHumanReview: determination.requiresHumanReview,
        deidAllCategoriesScreened: true,
        deidMethodCited: true,
        deidNoReleaseOfReidentifiable: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "deid-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this de-identification run: policy.deid.no-release-of-reidentifiable (remaining identifier)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.deid.no-release-of-reidentifiable"],
        violations: [
          {
            policyId: "policy.deid.no-release-of-reidentifiable",
            reason: "a re-identifiable dataset was marked de-identified"
          }
        ]
      }
    }
  };
}

describe("DEIDENTIFICATION_PRESETS", () => {
  it("has a Safe Harbor preset resolving to a de-identified dataset", () => {
    const preset = DEIDENTIFICATION_PRESETS.find((p) => p.id === "safe-harbor-deidentified");
    expect(preset).toBeDefined();
    const d = evaluateDeidentification(preset!.request!);
    expect(d.deidentified).toBe(true);
    expect(d.allCategoriesScreened).toBe(true);
  });

  it("has a retained-identifier preset resolving to a not-de-identified dataset", () => {
    const preset = DEIDENTIFICATION_PRESETS.find((p) => p.id === "retained-identifier");
    expect(preset).toBeDefined();
    const d = evaluateDeidentification(preset!.request!);
    expect(d.deidentified).toBe(false);
    expect(preset!.request).toEqual(DEMO_DEIDENTIFICATION_RETAINED_REQUEST);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const incomplete = DEIDENTIFICATION_PRESETS.find((p) => p.id === "incomplete-screen-block");
    expect(deidAllCategoriesScreened(incomplete!.determination as never)).toBe(false);

    const noMethod = DEIDENTIFICATION_PRESETS.find((p) => p.id === "no-method-block");
    expect(deidMethodCited(noMethod!.determination as never)).toBe(false);

    const release = DEIDENTIFICATION_PRESETS.find((p) => p.id === "release-reidentifiable-block");
    expect(deidNoReleaseOfReidentifiable(release!.determination as never)).toBe(false);
  });
});

describe("buildDeidentificationRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildDeidentificationRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_DEIDENTIFICATION_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_DEIDENTIFICATION_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildDeidentificationRequestBody({
      taskId: "task-block",
      determination: { deidentified: true, remainingIdentifierCategories: ["mrn"] }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { deidentified: true, remainingIdentifierCategories: ["mrn"] }
    });
  });
});

describe("runDeidentificationTask", () => {
  it("POSTs the A2A body to the de-identification agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/deidentification/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.method).toBe("safe-harbor");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runDeidentificationTask(
      { taskId: "task-1", request: DEMO_DEIDENTIFICATION_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("deid-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runDeidentificationTask(
        { taskId: "t", request: DEMO_DEIDENTIFICATION_RETAINED_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("deidentificationViewFromTask", () => {
  it("lifts a produced determination with the decision, screen, and honesty signals", () => {
    const view = deidentificationViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.datasetRef).toBe("deid-dataset-001");
    expect(view.method).toBe("safe-harbor");
    expect(view.deidentified).toBe(true);
    expect(view.releaseApproved).toBe(true);
    expect(view.categoriesScreened).toBe(18);
    expect(view.allCategoriesScreened).toBe(true);
    expect(view.remainingIdentifierCategoryCount).toBe(0);
    expect(view.deidAllCategoriesScreened).toBe(true);
    expect(view.deidMethodCited).toBe(true);
    expect(view.deidNoReleaseOfReidentifiable).toBe(true);
    expect(view.traceTaskId).toBe("deid-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = deidentificationViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this de-identification run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.deid.no-release-of-reidentifiable"
    );
    expect(view.policiesEvaluated).toContain("policy.deid.no-release-of-reidentifiable");
    expect(view.traceTaskId).toBe("deid-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "deid-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The de-identification determination could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = deidentificationViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
