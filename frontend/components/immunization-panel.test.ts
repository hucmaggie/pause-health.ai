import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IMMUNIZATION_PRESETS,
  buildImmunizationRequestBody,
  immunizationViewFromTask,
  runImmunizationTask
} from "./immunization-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_IMMUNIZATION_CONTRAINDICATION_REQUEST,
  DEMO_IMMUNIZATION_REQUEST,
  evaluateImmunization,
  immunizationContraindicationHonored,
  immunizationNoAutonomousAdministration,
  immunizationScheduleCited
} from "../lib/immunization";

/**
 * Unit coverage for the /demo/intake Immunization Forecasting agent panel — tested as
 * node-env pure functions (this repo tests components as logic, not renders). We exercise the
 * JSON-RPC A2A body it POSTs, that runImmunizationTask returns the resulting task, and that
 * immunizationViewFromTask lifts a determination and a governance block into render-ready
 * shapes. The task fixtures mirror what app/api/agents/immunization actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateImmunization(DEMO_IMMUNIZATION_REQUEST);
  return {
    id: "imm-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "ImmunizationDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: { determination, patientRef: DEMO_IMMUNIZATION_REQUEST.patientRef }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.immunization.schedule-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "imm-abc",
        patientRef: determination.patientRef,
        ageYears: determination.ageYears,
        dueCount: determination.dueCount,
        overdueCount: determination.overdueCount,
        contraindicatedCount: determination.contraindicatedCount,
        requiresClinicianOrder: determination.requiresClinicianOrder,
        immunizationScheduleCited: true,
        immunizationContraindicationHonored: true,
        immunizationNoAutonomousAdministration: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "imm-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this immunization run: policy.immunization.contraindication-honored (recommended a contraindicated vaccine)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.immunization.contraindication-honored"],
        violations: [
          {
            policyId: "policy.immunization.contraindication-honored",
            reason: "a contraindicated vaccine was recommended"
          }
        ]
      }
    }
  };
}

describe("IMMUNIZATION_PRESETS", () => {
  it("has a midlife preset resolving to a due/overdue determination", () => {
    const preset = IMMUNIZATION_PRESETS.find((p) => p.id === "midlife-due");
    expect(preset).toBeDefined();
    const d = evaluateImmunization(preset!.request!);
    expect(d.requiresClinicianOrder).toBe(true);
    expect(d.dueCount).toBe(1);
    expect(d.overdueCount).toBe(2);
  });

  it("has a contraindicated preset withholding the zoster vaccine", () => {
    const preset = IMMUNIZATION_PRESETS.find((p) => p.id === "contraindicated");
    expect(preset).toBeDefined();
    expect(preset!.request).toEqual(DEMO_IMMUNIZATION_CONTRAINDICATION_REQUEST);
    const d = evaluateImmunization(preset!.request!);
    expect(d.contraindicatedCount).toBe(1);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const offSchedule = IMMUNIZATION_PRESETS.find((p) => p.id === "off-schedule-block");
    expect(immunizationScheduleCited(offSchedule!.determination as never)).toBe(false);

    const contra = IMMUNIZATION_PRESETS.find((p) => p.id === "contraindication-block");
    expect(immunizationContraindicationHonored(contra!.determination as never)).toBe(false);

    const autonomous = IMMUNIZATION_PRESETS.find((p) => p.id === "autonomous-block");
    expect(immunizationNoAutonomousAdministration(autonomous!.determination as never)).toBe(false);
  });
});

describe("buildImmunizationRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildImmunizationRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_IMMUNIZATION_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_IMMUNIZATION_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildImmunizationRequestBody({
      taskId: "task-block",
      determination: { dueCount: 1, requiresClinicianOrder: false }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { dueCount: 1, requiresClinicianOrder: false }
    });
  });
});

describe("runImmunizationTask", () => {
  it("POSTs the A2A body to the immunization agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/immunization/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.patientRef).toBe("imm-patient-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runImmunizationTask(
      { taskId: "task-1", request: DEMO_IMMUNIZATION_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("imm-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runImmunizationTask(
        { taskId: "t", request: DEMO_IMMUNIZATION_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("immunizationViewFromTask", () => {
  it("lifts a produced determination with the counts and honesty signals", () => {
    const view = immunizationViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.patientRef).toBe("imm-patient-001");
    expect(view.ageYears).toBe(52);
    expect(view.dueCount).toBe(1);
    expect(view.overdueCount).toBe(2);
    expect(view.requiresClinicianOrder).toBe(true);
    expect(view.forecast.length).toBeGreaterThan(0);
    expect(view.immunizationScheduleCited).toBe(true);
    expect(view.immunizationContraindicationHonored).toBe(true);
    expect(view.immunizationNoAutonomousAdministration).toBe(true);
    expect(view.traceTaskId).toBe("imm-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = immunizationViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this immunization run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.immunization.contraindication-honored"
    );
    expect(view.policiesEvaluated).toContain("policy.immunization.contraindication-honored");
    expect(view.traceTaskId).toBe("imm-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "imm-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The immunization forecast could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = immunizationViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
