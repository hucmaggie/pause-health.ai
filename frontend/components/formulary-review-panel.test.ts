import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FORMULARY_REVIEW_PRESETS,
  buildFormularyReviewRequestBody,
  formularyReviewViewFromTask,
  runFormularyReviewTask
} from "./formulary-review-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_PREFERRED_REQUEST,
  DEMO_STEP_THERAPY_REQUEST,
  DEMO_NON_FORMULARY_REQUEST,
  reviewFormularyRequest
} from "../lib/formulary-review";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const decision = reviewFormularyRequest(DEMO_STEP_THERAPY_REQUEST);
  return {
    id: "formulary-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "FormularyReviewDecision",
        index: 0,
        parts: [{ type: "data", data: { result: { decision } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.formulary.catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "formulary-abc",
        requestRef: decision.requestRef,
        memberRef: decision.memberRef,
        proposedDrugId: decision.proposedDrugId,
        formularyDecision: decision.decision,
        tier: String(decision.tier),
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        appliedRuleCount: decision.appliedRules.length,
        requiresClinicianCosign: decision.requiresClinicianCosign,
        rulesTraceToCatalog: true,
        stepTherapyIsHonored: true,
        exceptionRequiresClinicianCosign: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "formulary-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this formulary review: policy.formulary.catalog-sourced (off-catalog rule)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.formulary.catalog-sourced"],
        violations: [
          {
            policyId: "policy.formulary.catalog-sourced",
            reason: "rule.made-up is off-catalog"
          }
        ]
      }
    }
  };
}

describe("FORMULARY_REVIEW_PRESETS", () => {
  it("has a preferred-approved preset", () => {
    const preset = FORMULARY_REVIEW_PRESETS.find((p) => p.id === "preferred-approved");
    expect(preset).toBeDefined();
    const d = reviewFormularyRequest(preset!.request!);
    expect(d.decision).toBe("preferred-approved");
  });

  it("has a step-therapy pend preset", () => {
    const preset = FORMULARY_REVIEW_PRESETS.find((p) => p.id === "pend-step-therapy");
    expect(preset!.request).toEqual(DEMO_STEP_THERAPY_REQUEST);
    const d = reviewFormularyRequest(preset!.request!);
    expect(d.decision).toBe("pend-step-therapy");
  });

  it("has a non-formulary pend preset (Veozah)", () => {
    const preset = FORMULARY_REVIEW_PRESETS.find((p) => p.id === "pend-non-formulary");
    expect(preset!.request).toEqual(DEMO_NON_FORMULARY_REQUEST);
    const d = reviewFormularyRequest(preset!.request!);
    expect(d.decision).toBe("pend-non-formulary");
  });

  it("has the three governance-block presets asserting offending overrides", () => {
    const off = FORMULARY_REVIEW_PRESETS.find((p) => p.id === "offcat-rule-block");
    expect(off!.decisionOverride!.appliedRules[0].ruleId).toBe("rule.made-up");
    const step = FORMULARY_REVIEW_PRESETS.find((p) => p.id === "step-therapy-lied-block");
    expect(step!.decisionOverride!.decision).toBe("preferred-approved");
    const auto = FORMULARY_REVIEW_PRESETS.find((p) => p.id === "auto-cosign-block");
    expect(auto!.decisionOverride!.cosigned).toBe(true);
  });
});

describe("buildFormularyReviewRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildFormularyReviewRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_PREFERRED_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_PREFERRED_REQUEST });
  });
});

describe("runFormularyReviewTask", () => {
  it("POSTs the A2A body and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/formulary-review/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.requestRef).toBe(
        DEMO_STEP_THERAPY_REQUEST.requestRef
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runFormularyReviewTask(
      { taskId: "task-1", request: DEMO_STEP_THERAPY_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("formulary-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runFormularyReviewTask(
        { taskId: "t", request: DEMO_STEP_THERAPY_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("formularyReviewViewFromTask", () => {
  it("lifts a produced decision with all signals true", () => {
    const view = formularyReviewViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.decision.decision).toBe("pend-step-therapy");
    expect(view.rulesTraceToCatalog).toBe(true);
    expect(view.stepTherapyIsHonored).toBe(true);
    expect(view.exceptionRequiresClinicianCosign).toBe(true);
    expect(view.traceTaskId).toBe("formulary-abc");
  });

  it("lifts a governance block with the blocking policy", () => {
    const view = formularyReviewViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.formulary.catalog-sourced"
    );
  });

  it("treats a failed non-block task as invalid", () => {
    const task: A2ATask = {
      id: "formulary-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [
            { type: "text", text: "The formulary review could not be produced." }
          ]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = formularyReviewViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
