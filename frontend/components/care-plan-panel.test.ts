import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CARE_PLAN_PRESETS,
  buildCarePlanRequestBody,
  carePlanViewFromTask,
  runCarePlanTask
} from "./care-plan-panel";
import type { A2ATask } from "../lib/a2a";
import {
  carePlanContextFromIntake,
  instantiateCarePlan,
  isCatalogTemplate,
  planTracesToTemplate,
  scriptedSummarizeCarePlan,
  type CarePlanSummaryResult,
  type InstantiatedCarePlan
} from "../lib/care-plan";

/**
 * Unit coverage for the /demo/intake Care Plan agent panel — the SECOND
 * live-Claude agent. This repo tests components as node-env pure functions
 * (see benefits-panel.test.ts) rather than rendering them, so we exercise
 * the exact logic the panel invokes:
 *   - the JSON-RPC A2A body it POSTs to the Care Plan agent (both an
 *     intake/pathway and a caller-asserted plan),
 *   - that runCarePlanTask returns the resulting task,
 *   - and that carePlanViewFromTask lifts an instantiated plan + summary
 *     (BOTH the claude-api and scripted-fallback cases) and a governance
 *     block into render-ready shapes.
 * The task fixtures mirror the shapes app/api/agents/care-plan actually
 * returns (see that route + lib/care-plan).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE_PLAN: InstantiatedCarePlan = instantiateCarePlan(
  carePlanContextFromIntake(
    {
      preferredName: "Ada",
      ageBand: "45-49",
      cycleStatus: "perimenopausal",
      primarySymptom: "vasomotor",
      severity: "moderate"
    },
    { pathway: "mscp-virtual-visit" }
  )
);

function completedTask(opts?: {
  plan?: InstantiatedCarePlan;
  summary?: Partial<CarePlanSummaryResult>;
}): A2ATask {
  const plan = opts?.plan ?? BASE_PLAN;
  const summary: CarePlanSummaryResult = {
    summary: scriptedSummarizeCarePlan(plan),
    via: "scripted-fallback",
    modelProvenance: {
      provider: "pause-scripted",
      model: "pause-care-plan-summarizer@1.0",
      via: "scripted-fallback"
    },
    fallbackReason: "ANTHROPIC_API_KEY not set; using deterministic Pause care-plan summarizer.",
    ...(opts?.summary ?? {})
  };
  return {
    id: "careplan-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "CarePlan",
        index: 0,
        parts: [{ type: "data", data: { plan, summary } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: [
          "policy.careplan.template-sourced",
          "policy.model.anthropic-claude-sonnet-allowlisted"
        ],
        traceSpanId: "span-1",
        traceTaskId: "careplan-abc",
        templateId: plan.templateId,
        planTracesToTemplate: true,
        summaryVia: summary.via,
        ...(summary.fallbackReason ? { fallbackReason: summary.fallbackReason } : {})
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "careplan-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this care-plan task: policy.careplan.template-sourced (off-catalog plan)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.careplan.template-sourced"],
        violations: [
          {
            policyId: "policy.careplan.template-sourced",
            reason: "plan does not trace to a defined template"
          }
        ]
      }
    }
  };
}

describe("CARE_PLAN_PRESETS", () => {
  it("instantiates a catalog template for each intake preset", () => {
    const intakePresets = CARE_PLAN_PRESETS.filter((p) => p.intake);
    expect(intakePresets.length).toBeGreaterThanOrEqual(3);
    for (const preset of intakePresets) {
      const plan = instantiateCarePlan(
        carePlanContextFromIntake(preset.intake!, { pathway: preset.pathway! }, {
          onHrt: preset.onHrt
        })
      );
      expect(planTracesToTemplate(plan)).toBe(true);
    }
  });

  it("steers an on-HRT preset to the HRT-management template", () => {
    const preset = CARE_PLAN_PRESETS.find((p) => p.id === "on-hrt");
    expect(preset).toBeDefined();
    const plan = instantiateCarePlan(
      carePlanContextFromIntake(preset!.intake!, { pathway: preset!.pathway! }, {
        onHrt: preset!.onHrt
      })
    );
    expect(plan.templateId).toBe("careplan.hrt-management");
  });

  it("steers a behavioral-health preset to the mood template", () => {
    const preset = CARE_PLAN_PRESETS.find((p) => p.id === "behavioral-health");
    expect(preset).toBeDefined();
    const plan = instantiateCarePlan(
      carePlanContextFromIntake(preset!.intake!, { pathway: preset!.pathway! })
    );
    expect(plan.templateId).toBe("careplan.mood-behavioral");
  });

  it("has an off-catalog preset whose asserted plan is NOT a catalog template", () => {
    const preset = CARE_PLAN_PRESETS.find((p) => p.id === "off-catalog-block");
    expect(preset).toBeDefined();
    expect(preset!.assertedPlan).toBeDefined();
    expect(preset!.intake).toBeUndefined();
    expect(isCatalogTemplate(preset!.assertedPlan!.templateId as string)).toBe(false);
  });
});

describe("buildCarePlanRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with intake + pathway data part", () => {
    const intake = { preferredName: "Ada", severity: "moderate" };
    const body = buildCarePlanRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      pathway: "mscp-virtual-visit",
      intake,
      onHrt: true
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({
      pathway: "mscp-virtual-visit",
      intake,
      onHrt: true
    });
  });

  it("posts a caller-asserted plan under a `plan` data part", () => {
    const plan = { templateId: "careplan.totally-invented" };
    const body = buildCarePlanRequestBody({ taskId: "task-block", assertedPlan: plan });
    expect(body.params.message.parts[0].data).toEqual({ plan });
  });
});

describe("runCarePlanTask", () => {
  it("POSTs the A2A body to the Care Plan agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/care-plan/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.pathway).toBe("mscp-virtual-visit");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runCarePlanTask(
      {
        taskId: "task-1",
        pathway: "mscp-virtual-visit",
        intake: { severity: "moderate", primarySymptom: "vasomotor" }
      },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("careplan-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runCarePlanTask(
        { taskId: "t", pathway: "mscp-virtual-visit", intake: {} },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("carePlanViewFromTask", () => {
  it("lifts an instantiated plan with goals, interventions, cadence, and template id", () => {
    const view = carePlanViewFromTask(completedTask());
    expect(view.kind).toBe("instantiated");
    if (view.kind !== "instantiated") return;
    expect(view.templateId).toMatch(/^careplan\./);
    expect(view.goals.length).toBeGreaterThan(0);
    expect(view.interventions.length).toBeGreaterThan(0);
    expect(view.followUp.intervalDays).toBeGreaterThan(0);
    expect(view.planTracesToTemplate).toBe(true);
    expect(view.traceTaskId).toBe("careplan-abc");
  });

  it("renders the scripted-fallback case with via + fallbackReason", () => {
    const view = carePlanViewFromTask(completedTask());
    expect(view.kind).toBe("instantiated");
    if (view.kind !== "instantiated") return;
    expect(view.via).toBe("scripted-fallback");
    expect(view.modelProvider).toBe("pause-scripted");
    expect(view.fallbackReason).toMatch(/ANTHROPIC_API_KEY not set/);
    expect(view.summary).toMatch(/does not add or change any prescription/i);
  });

  it("renders the live claude-api case with no fallbackReason", () => {
    const view = carePlanViewFromTask(
      completedTask({
        summary: {
          summary: "Ada is progressing well on her plan.",
          via: "claude-api",
          modelProvenance: {
            provider: "anthropic",
            model: "claude-sonnet-4-5-20250929",
            via: "claude-api"
          },
          fallbackReason: undefined
        }
      })
    );
    expect(view.kind).toBe("instantiated");
    if (view.kind !== "instantiated") return;
    expect(view.via).toBe("claude-api");
    expect(view.modelProvider).toBe("anthropic");
    expect(view.model).toBe("claude-sonnet-4-5-20250929");
    expect(view.fallbackReason).toBeUndefined();
    expect(view.summary).toBe("Ada is progressing well on her plan.");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = carePlanViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this care-plan task/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.careplan.template-sourced"
    );
    expect(view.policiesEvaluated).toContain("policy.careplan.template-sourced");
    expect(view.traceTaskId).toBe("careplan-block");
  });

  it("treats a failed non-block task as an invalid (not-instantiated) result", () => {
    const task: A2ATask = {
      id: "careplan-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The care plan could not be instantiated." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = carePlanViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be instantiated/);
  });
});
