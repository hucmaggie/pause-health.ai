import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BREAK_THE_GLASS_PRESETS,
  breakTheGlassViewFromTask,
  buildBreakTheGlassRequestBody,
  runBreakTheGlassTask
} from "./break-the-glass-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_EMERGENCY_ACCESS_REQUEST,
  accessHasJustification,
  accessIsMinimumNecessaryTimeBoxed,
  accessLoggedForReview,
  evaluateEmergencyAccess
} from "../lib/break-the-glass";

/**
 * Unit coverage for the /demo/intake Break-the-Glass agent panel. This repo tests
 * components as node-env pure functions (see master-patient-index-panel.test.ts)
 * rather than rendering them, so we exercise the exact logic the panel invokes: the
 * JSON-RPC A2A body it POSTs, that runBreakTheGlassTask returns the resulting task,
 * and that breakTheGlassViewFromTask lifts a decision and a governance block into
 * render-ready shapes. The task fixtures mirror the shapes
 * app/api/agents/break-the-glass actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const decision = evaluateEmergencyAccess(DEMO_EMERGENCY_ACCESS_REQUEST);
  return {
    id: "btg-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "EmergencyAccessDecision",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result: { decision, patientRef: DEMO_EMERGENCY_ACCESS_REQUEST.patientRef } }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.btg.justification-required"],
        traceSpanId: "span-1",
        traceTaskId: "btg-abc",
        granted: decision.granted,
        purpose: decision.purpose,
        grantedFieldCount: decision.grantedScope.length,
        durationMinutes: decision.durationMinutes,
        expiresAt: decision.expiresAt,
        auditEventId: decision.auditEventId,
        requiresPostAccessReview: decision.requiresPostAccessReview,
        accessHasJustification: true,
        accessIsMinimumNecessaryTimeBoxed: true,
        accessLoggedForReview: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "btg-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this emergency-access run: policy.btg.justification-required (no justification)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.btg.justification-required"],
        violations: [
          {
            policyId: "policy.btg.justification-required",
            reason: "an emergency access was granted with no recorded clinical justification"
          }
        ]
      }
    }
  };
}

describe("BREAK_THE_GLASS_PRESETS", () => {
  it("has a valid-grant preset that resolves to a time-boxed, minimum-necessary grant", () => {
    const preset = BREAK_THE_GLASS_PRESETS.find((p) => p.id === "valid-grant");
    expect(preset).toBeDefined();
    const d = evaluateEmergencyAccess(preset!.request!);
    expect(d.granted).toBe(true);
    expect(d.grantedScope).toEqual(["allergies", "medications", "problems", "vitals"]);
    expect(d.durationMinutes).toBe(60);
    expect(d.requiresPostAccessReview).toBe(true);
  });

  it("has a non-emergency preset that resolves to a safe deny", () => {
    const preset = BREAK_THE_GLASS_PRESETS.find((p) => p.id === "non-emergency-deny");
    expect(preset).toBeDefined();
    const d = evaluateEmergencyAccess(preset!.request!);
    expect(d.granted).toBe(false);
  });

  it("has the three governance-block presets asserting an offending grant", () => {
    const noJust = BREAK_THE_GLASS_PRESETS.find((p) => p.id === "no-justification-block");
    expect(accessHasJustification(noJust!.grant as never)).toBe(false);

    const standing = BREAK_THE_GLASS_PRESETS.find((p) => p.id === "standing-access-block");
    expect(accessIsMinimumNecessaryTimeBoxed(standing!.grant as never)).toBe(false);

    const unaudited = BREAK_THE_GLASS_PRESETS.find((p) => p.id === "unaudited-block");
    expect(accessLoggedForReview(unaudited!.grant as never)).toBe(false);
  });
});

describe("buildBreakTheGlassRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildBreakTheGlassRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_EMERGENCY_ACCESS_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_EMERGENCY_ACCESS_REQUEST });
  });

  it("posts an asserted grant under its data part", () => {
    const body = buildBreakTheGlassRequestBody({
      taskId: "task-block",
      grant: { granted: true, justificationRecorded: false }
    });
    expect(body.params.message.parts[0].data).toEqual({
      grant: { granted: true, justificationRecorded: false }
    });
  });
});

describe("runBreakTheGlassTask", () => {
  it("POSTs the A2A body to the break-the-glass agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/break-the-glass/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.patientRef).toBe("btg-patient-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runBreakTheGlassTask(
      { taskId: "task-1", request: DEMO_EMERGENCY_ACCESS_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("btg-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runBreakTheGlassTask(
        { taskId: "t", request: DEMO_EMERGENCY_ACCESS_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("breakTheGlassViewFromTask", () => {
  it("lifts a produced decision with the granted scope, expiry, audit id, and honesty signals", () => {
    const view = breakTheGlassViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.patientRef).toBe("btg-patient-001");
    expect(view.granted).toBe(true);
    expect(view.grantedScope).toEqual(["allergies", "medications", "problems", "vitals"]);
    expect(view.durationMinutes).toBe(60);
    expect(view.expiresAt).toBe("2026-03-01T03:30:00.000Z");
    expect(view.requiresPostAccessReview).toBe(true);
    expect(view.accessHasJustification).toBe(true);
    expect(view.accessIsMinimumNecessaryTimeBoxed).toBe(true);
    expect(view.accessLoggedForReview).toBe(true);
    expect(view.traceTaskId).toBe("btg-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = breakTheGlassViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this emergency-access run/);
    expect(view.violations.map((v) => v.policyId)).toContain("policy.btg.justification-required");
    expect(view.policiesEvaluated).toContain("policy.btg.justification-required");
    expect(view.traceTaskId).toBe("btg-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "btg-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The emergency-access decision could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = breakTheGlassViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
