import { afterEach, describe, expect, it, vi } from "vitest";

import {
  POPULATION_HEALTH_PRESETS,
  buildPopulationHealthRequestBody,
  populationHealthViewFromTask,
  runPopulationHealthTask
} from "./population-health-panel";
import type { A2ATask } from "../lib/a2a";
import {
  excludesProtectedAttributes,
  riskScoreTracesToFactors,
  stratifyPanel,
  tierActionsReviewedByHuman,
  type PatientPanelSignals
} from "../lib/population-health";

/**
 * Unit coverage for the /demo/intake Population Health agent panel. This repo
 * tests components as node-env pure functions (see remote-monitoring-panel.test.ts)
 * rather than rendering them, so we exercise the exact logic the panel invokes:
 * the JSON-RPC A2A body it POSTs, that runPopulationHealthTask returns the
 * resulting task, and that populationHealthViewFromTask lifts a stratification and
 * a governance block into render-ready shapes. The task fixtures mirror the shapes
 * app/api/agents/population-health actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const preset = POPULATION_HEALTH_PRESETS.find((p) => p.id === "mixed-panel")!;
  const stratification = stratifyPanel(preset.panel as PatientPanelSignals[]);
  return {
    id: "ph-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "PanelStratification",
        index: 0,
        parts: [{ type: "data", data: { stratification } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.pophealth.transparent-risk-model"],
        traceSpanId: "span-1",
        traceTaskId: "ph-abc",
        patientsStratified: stratification.perPatient.length,
        tierCounts: stratification.tierCounts,
        worklistLength: stratification.worklist.length,
        riskScoreTracesToFactors: true,
        excludesProtectedAttributes: true,
        tierReviewedByHuman: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "ph-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this population-health run: policy.pophealth.no-protected-class-factors (protected class)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.pophealth.no-protected-class-factors"],
        violations: [
          {
            policyId: "policy.pophealth.no-protected-class-factors",
            reason: "protected-class attribute used as a factor"
          }
        ]
      }
    }
  };
}

describe("POPULATION_HEALTH_PRESETS", () => {
  it("stratifies the mixed-panel preset into a low/rising/high mix", () => {
    const preset = POPULATION_HEALTH_PRESETS.find((p) => p.id === "mixed-panel");
    expect(preset).toBeDefined();
    const strat = stratifyPanel(preset!.panel as PatientPanelSignals[]);
    expect(strat.tierCounts.high).toBeGreaterThan(0);
    expect(strat.tierCounts.rising).toBeGreaterThan(0);
    expect(strat.tierCounts.low).toBeGreaterThan(0);
    expect(riskScoreTracesToFactors(strat.perPatient)).toBe(true);
  });

  it("has an opaque-score preset whose asserted profile doesn't trace to the factors", () => {
    const preset = POPULATION_HEALTH_PRESETS.find((p) => p.id === "opaque-score-block");
    expect(preset).toBeDefined();
    expect(
      riskScoreTracesToFactors(
        preset!.assertedProfiles as Array<{
          score: number;
          tier: "low" | "rising" | "high";
          contributingFactors: { factorId: string; points: number }[];
        }>
      )
    ).toBe(false);
  });

  it("has a protected-class preset whose scoring factors include a protected attribute", () => {
    const preset = POPULATION_HEALTH_PRESETS.find((p) => p.id === "protected-class-block");
    expect(preset).toBeDefined();
    expect(excludesProtectedAttributes(preset!.scoringFactors)).toBe(false);
  });

  it("has an autonomous-decision preset whose action isn't routed to a human", () => {
    const preset = POPULATION_HEALTH_PRESETS.find(
      (p) => p.id === "autonomous-decision-block"
    );
    expect(preset).toBeDefined();
    expect(
      tierActionsReviewedByHuman(
        preset!.careActions as Array<{ routedTo: "care-manager-review" }>
      )
    ).toBe(false);
  });
});

describe("buildPopulationHealthRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a panel data part", () => {
    const panel: PatientPanelSignals[] = [
      { patientRef: "p-1", intakeSeverity: "high" }
    ];
    const body = buildPopulationHealthRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      panel
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ panel });
  });

  it("posts asserted scoring factors, care actions, and profiles under their data parts", () => {
    const body = buildPopulationHealthRequestBody({
      taskId: "task-block",
      scoringFactors: ["attr.race"],
      careActions: [{ routedTo: "auto-enroll" }],
      assertedProfiles: [{ patientRef: "p", score: 9, tier: "high", contributingFactors: [] }]
    });
    expect(body.params.message.parts[0].data).toEqual({
      scoringFactors: ["attr.race"],
      careActions: [{ routedTo: "auto-enroll" }],
      profiles: [{ patientRef: "p", score: 9, tier: "high", contributingFactors: [] }]
    });
  });
});

describe("runPopulationHealthTask", () => {
  it("POSTs the A2A body to the population-health agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/population-health/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(Array.isArray(sent.params.message.parts[0].data.panel)).toBe(true);
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runPopulationHealthTask(
      { taskId: "task-1", panel: [{ patientRef: "p-1", intakeSeverity: "high" }] },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("ph-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runPopulationHealthTask(
        { taskId: "t", panel: [] },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("populationHealthViewFromTask", () => {
  it("lifts a produced stratification with per-patient tiers + a worklist", () => {
    const view = populationHealthViewFromTask(completedTask());
    expect(view.kind).toBe("stratified");
    if (view.kind !== "stratified") return;
    expect(view.perPatient.length).toBeGreaterThan(0);
    expect(view.worklist.length).toBeGreaterThan(0);
    expect(view.tierCounts.high).toBeGreaterThan(0);
    expect(view.riskScoreTracesToFactors).toBe(true);
    expect(view.excludesProtectedAttributes).toBe(true);
    expect(view.tierReviewedByHuman).toBe(true);
    expect(view.traceTaskId).toBe("ph-abc");
    // Every tier traces to the defined factors.
    expect(riskScoreTracesToFactors(view.perPatient)).toBe(true);
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = populationHealthViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this population-health run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.pophealth.no-protected-class-factors"
    );
    expect(view.policiesEvaluated).toContain(
      "policy.pophealth.no-protected-class-factors"
    );
    expect(view.traceTaskId).toBe("ph-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "ph-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The panel stratification could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = populationHealthViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
