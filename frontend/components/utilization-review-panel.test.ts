import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UTILIZATION_REVIEW_PRESETS,
  buildUtilizationReviewRequestBody,
  runUtilizationReviewTask,
  utilizationReviewViewFromTask
} from "./utilization-review-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_UR_APPROVE,
  DEMO_UR_NON_COVERED,
  DEMO_UR_P2P,
  DEMO_UR_PEND,
  reviewUtilization
} from "../lib/utilization-review";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const decision = reviewUtilization(DEMO_UR_APPROVE);
  return {
    id: "ur-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "UtilizationReviewDecision",
        index: 0,
        parts: [{ type: "data", data: { result: { decision } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.ur.criteria-catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "ur-abc",
        requestRef: decision.requestRef,
        memberRef: decision.memberRef,
        serviceTypeId: decision.serviceTypeId,
        urgency: decision.urgency,
        urDecision: decision.decision,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        slaWindowHours: decision.slaWindowHours,
        slaDeadline: decision.slaDeadline,
        appliedRuleCount: decision.appliedRules.length,
        criteriaMetCount: decision.criteriaMet.length,
        criteriaMissingCount: decision.criteriaMissing.length,
        requiresClinicianCosign: decision.requiresClinicianCosign,
        criteriaTraceToCatalog: true,
        denialRequiresClinicianCosign: true,
        slaTracesToCatalog: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "ur-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this UR case: policy.ur.sla-integrity (deadline extended)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.ur.sla-integrity"],
        violations: [
          {
            policyId: "policy.ur.sla-integrity",
            reason: "SLA deadline silently extended past the catalog maximum"
          }
        ]
      }
    }
  };
}

describe("UTILIZATION_REVIEW_PRESETS", () => {
  it("has an approves-meets-criteria preset that clean-approves", () => {
    const preset = UTILIZATION_REVIEW_PRESETS.find((p) => p.id === "approves-meets-criteria");
    expect(preset).toBeDefined();
    const d = reviewUtilization(preset!.request!);
    expect(d.decision).toBe("approves-meets-criteria");
    expect(d.slaWindowHours).toBe(72);
  });

  it("has pend-clinical and require-peer-to-peer presets", () => {
    const pend = UTILIZATION_REVIEW_PRESETS.find((p) => p.id === "pend-clinical-review");
    expect(pend!.request).toEqual(DEMO_UR_PEND);
    const p2p = UTILIZATION_REVIEW_PRESETS.find((p) => p.id === "require-peer-to-peer");
    expect(p2p!.request).toEqual(DEMO_UR_P2P);
  });

  it("has blocked-non-covered preset citing the non-covered service", () => {
    const nc = UTILIZATION_REVIEW_PRESETS.find((p) => p.id === "blocked-non-covered");
    expect(nc!.request).toEqual(DEMO_UR_NON_COVERED);
  });

  it("has the three governance-block presets asserting offending overrides", () => {
    const off = UTILIZATION_REVIEW_PRESETS.find((p) => p.id === "offcat-service-block");
    expect(off!.decisionOverride!.serviceTypeId).toBe("service.made-up");
    const auto = UTILIZATION_REVIEW_PRESETS.find((p) => p.id === "autonomous-cosign-block");
    expect(auto!.decisionOverride!.cosigned).toBe(true);
    const sla = UTILIZATION_REVIEW_PRESETS.find((p) => p.id === "sla-extended-block");
    expect(sla!.decisionOverride!.slaWindowHours).toBe(168);
  });
});

describe("buildUtilizationReviewRequestBody", () => {
  it("builds a JSON-RPC envelope with a request data part", () => {
    const body = buildUtilizationReviewRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_UR_APPROVE
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.message.parts[0].data).toEqual({ request: DEMO_UR_APPROVE });
  });
});

describe("runUtilizationReviewTask", () => {
  it("POSTs the body and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("/api/agents/utilization-review/tasks");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });
    const out = await runUtilizationReviewTask(
      { taskId: "task-1", request: DEMO_UR_APPROVE },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("ur-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runUtilizationReviewTask(
        { taskId: "t", request: DEMO_UR_APPROVE },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("utilizationReviewViewFromTask", () => {
  it("lifts a produced decision with all signals true", () => {
    const view = utilizationReviewViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.decision.decision).toBe("approves-meets-criteria");
    expect(view.criteriaTraceToCatalog).toBe(true);
    expect(view.denialRequiresClinicianCosign).toBe(true);
    expect(view.slaTracesToCatalog).toBe(true);
  });

  it("lifts a governance block", () => {
    const view = utilizationReviewViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.violations.map((v) => v.policyId)).toContain("policy.ur.sla-integrity");
  });

  it("treats a failed non-block task as invalid", () => {
    const task: A2ATask = {
      id: "ur-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The UR case could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = utilizationReviewViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
