import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FWA_DETECTION_PRESETS,
  buildFwaDetectionRequestBody,
  fwaDetectionViewFromTask,
  runFwaDetectionTask
} from "./fwa-detection-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_CLEAR_REQUEST,
  DEMO_IMPOSSIBLE_DAY_REQUEST,
  DEMO_MULTI_FLAG_REQUEST,
  DEMO_PHANTOM_SERVICE_REQUEST,
  DEMO_UPCODING_REQUEST,
  screenClaim
} from "../lib/fwa-detection";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const report = screenClaim(DEMO_IMPOSSIBLE_DAY_REQUEST);
  return {
    id: "fwa-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "FwaScreeningReport",
        index: 0,
        parts: [{ type: "data", data: { result: { report } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.fwa.pattern-catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "fwa-abc",
        requestRef: report.requestRef,
        providerRef: report.providerRef,
        claimRef: report.claimRef,
        fwaDecision: report.decision,
        flagCount: report.flags.length,
        primaryPatternId: report.primaryPatternId,
        primarySeverity: report.primarySeverity,
        routedTo: report.routedTo,
        requiresSiuReview: report.requiresSiuReview,
        patternsTraceToCatalog: true,
        reportRequiresSiuReview: true,
        noProtectedClassFactors: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "fwa-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this FWA screening: policy.fwa.pattern-catalog-sourced (off-catalog pattern)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.fwa.pattern-catalog-sourced"],
        violations: [
          {
            policyId: "policy.fwa.pattern-catalog-sourced",
            reason: "pattern.made-up is off-catalog"
          }
        ]
      }
    }
  };
}

describe("FWA_DETECTION_PRESETS", () => {
  it("has a clear preset", () => {
    const preset = FWA_DETECTION_PRESETS.find((p) => p.id === "clear");
    expect(preset).toBeDefined();
    const r = screenClaim(preset!.request!);
    expect(r.decision).toBe("clear");
  });

  it("has an upcoding preset routing to SIU standard", () => {
    const preset = FWA_DETECTION_PRESETS.find((p) => p.id === "upcoding-medium");
    expect(preset!.request).toEqual(DEMO_UPCODING_REQUEST);
    const r = screenClaim(preset!.request!);
    expect(r.decision).toBe("flag-for-siu-review");
    expect(r.routedTo).toBe("siu-standard-queue");
  });

  it("has an impossible-day preset routing to SIU priority", () => {
    const preset = FWA_DETECTION_PRESETS.find((p) => p.id === "impossible-day-high");
    expect(preset!.request).toEqual(DEMO_IMPOSSIBLE_DAY_REQUEST);
    const r = screenClaim(preset!.request!);
    expect(r.routedTo).toBe("siu-priority-queue");
  });

  it("has a phantom-service preset", () => {
    const preset = FWA_DETECTION_PRESETS.find((p) => p.id === "phantom-service-high");
    expect(preset!.request).toEqual(DEMO_PHANTOM_SERVICE_REQUEST);
    const r = screenClaim(preset!.request!);
    expect(r.primaryPatternId).toBe("pattern.phantom-service");
  });

  it("has a multi-flag preset", () => {
    const preset = FWA_DETECTION_PRESETS.find((p) => p.id === "multi-flag");
    expect(preset!.request).toEqual(DEMO_MULTI_FLAG_REQUEST);
    const r = screenClaim(preset!.request!);
    expect(r.flags.length).toBeGreaterThanOrEqual(3);
  });

  it("has the three governance-block presets asserting offending inputs", () => {
    const off = FWA_DETECTION_PRESETS.find((p) => p.id === "offcat-pattern-block");
    expect(off!.reportOverride!.flags[0].patternId).toBe("pattern.made-up");
    const inv = FWA_DETECTION_PRESETS.find((p) => p.id === "autonomous-investigation-block");
    expect(inv!.reportOverride!.investigationOpened).toBe(true);
    const protectedClass = FWA_DETECTION_PRESETS.find((p) => p.id === "protected-class-block");
    expect(
      (protectedClass!.request!.factorsInUse ?? []).some((f) =>
        f.includes("provider-ethnicity")
      )
    ).toBe(true);
  });
});

describe("buildFwaDetectionRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildFwaDetectionRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_CLEAR_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_CLEAR_REQUEST });
  });
});

describe("runFwaDetectionTask", () => {
  it("POSTs the A2A body and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/fwa-detection/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.requestRef).toBe(
        DEMO_IMPOSSIBLE_DAY_REQUEST.requestRef
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runFwaDetectionTask(
      { taskId: "task-1", request: DEMO_IMPOSSIBLE_DAY_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("fwa-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runFwaDetectionTask(
        { taskId: "t", request: DEMO_CLEAR_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("fwaDetectionViewFromTask", () => {
  it("lifts a produced report with all signals true", () => {
    const view = fwaDetectionViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.report.decision).toBe("flag-for-siu-review");
    expect(view.report.primaryPatternId).toBe("pattern.impossible-day-billing");
    expect(view.patternsTraceToCatalog).toBe(true);
    expect(view.reportRequiresSiuReview).toBe(true);
    expect(view.noProtectedClassFactors).toBe(true);
    expect(view.traceTaskId).toBe("fwa-abc");
  });

  it("lifts a governance block", () => {
    const view = fwaDetectionViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.fwa.pattern-catalog-sourced"
    );
  });

  it("treats a failed non-block task as invalid", () => {
    const task: A2ATask = {
      id: "fwa-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The FWA screening could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = fwaDetectionViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
