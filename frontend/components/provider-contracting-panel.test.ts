import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PROVIDER_CONTRACTING_PRESETS,
  buildProviderContractingRequestBody,
  runProviderContractingTask,
  providerContractingViewFromTask
} from "./provider-contracting-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_CONTRACT_FFS,
  DEMO_CONTRACT_GOOD_STANDING,
  DEMO_CONTRACT_QUALITY_MISS,
  DEMO_CONTRACT_SPEND_DRIFT,
  DEMO_CONTRACT_TERM_CHANGE,
  evaluateContract
} from "../lib/provider-contracting";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const decision = evaluateContract(DEMO_CONTRACT_GOOD_STANDING);
  return {
    id: "pc-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "ProviderContractDecision",
        index: 0,
        parts: [{ type: "data", data: { result: { decision } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.contracting.contract-type-catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "pc-abc",
        requestRef: decision.requestRef,
        providerRef: decision.providerRef,
        contractRef: decision.contractRef,
        contractTypeId: decision.contractTypeId,
        methodologyId: decision.methodologyId,
        contractingDecision: decision.decision,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        qualityGateMet: decision.qualityGateMet,
        spendDriftFraction: decision.spendDriftFraction,
        appliedRuleCount: decision.appliedRules.length,
        requiresAccountOwnerCosign: decision.requiresAccountOwnerCosign,
        contractsTraceToCatalog: true,
        contractChangeRequiresOwnerCosign: true,
        benchmarksTraceToMethodology: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "pc-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this contracting decision: policy.contracting.no-autonomous-term-change"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.contracting.no-autonomous-term-change"],
        violations: [
          {
            policyId: "policy.contracting.no-autonomous-term-change",
            reason: "autonomously cosigned term change"
          }
        ]
      }
    }
  };
}

describe("PROVIDER_CONTRACTING_PRESETS", () => {
  it("has an in-good-standing preset that clean-approves", () => {
    const preset = PROVIDER_CONTRACTING_PRESETS.find((p) => p.id === "in-good-standing");
    expect(preset).toBeDefined();
    const d = evaluateContract(preset!.request!);
    expect(d.decision).toBe("in-good-standing");
  });

  it("has quality-miss + spend-drift + term-change presets", () => {
    expect(
      PROVIDER_CONTRACTING_PRESETS.find((p) => p.id === "quality-gate-missed")!.request
    ).toEqual(DEMO_CONTRACT_QUALITY_MISS);
    expect(
      PROVIDER_CONTRACTING_PRESETS.find((p) => p.id === "spend-drift-exceeded")!.request
    ).toEqual(DEMO_CONTRACT_SPEND_DRIFT);
    expect(
      PROVIDER_CONTRACTING_PRESETS.find((p) => p.id === "term-change-drafted")!.request
    ).toEqual(DEMO_CONTRACT_TERM_CHANGE);
    expect(PROVIDER_CONTRACTING_PRESETS.find((p) => p.id === "non-vbc-ffs")!.request).toEqual(
      DEMO_CONTRACT_FFS
    );
  });

  it("has the three governance-block presets asserting offending overrides", () => {
    const off = PROVIDER_CONTRACTING_PRESETS.find((p) => p.id === "offcat-contract-block");
    expect(off!.decisionOverride!.contractTypeId).toBe("contract-type.made-up");
    const auto = PROVIDER_CONTRACTING_PRESETS.find((p) => p.id === "autonomous-cosign-block");
    expect(auto!.decisionOverride!.cosigned).toBe(true);
    const bench = PROVIDER_CONTRACTING_PRESETS.find((p) => p.id === "benchmark-drift-block");
    expect(bench!.decisionOverride!.qualityGateThreshold).toBe(0.5);
  });
});

describe("buildProviderContractingRequestBody", () => {
  it("builds a JSON-RPC envelope with a request data part", () => {
    const body = buildProviderContractingRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_CONTRACT_GOOD_STANDING
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.message.parts[0].data).toEqual({ request: DEMO_CONTRACT_GOOD_STANDING });
  });
});

describe("runProviderContractingTask", () => {
  it("POSTs the body and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("/api/agents/provider-contracting/tasks");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });
    const out = await runProviderContractingTask(
      { taskId: "task-1", request: DEMO_CONTRACT_GOOD_STANDING },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("pc-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runProviderContractingTask(
        { taskId: "t", request: DEMO_CONTRACT_GOOD_STANDING },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("providerContractingViewFromTask", () => {
  it("lifts a produced decision with all signals true", () => {
    const view = providerContractingViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.decision.decision).toBe("in-good-standing");
    expect(view.contractsTraceToCatalog).toBe(true);
    expect(view.contractChangeRequiresOwnerCosign).toBe(true);
    expect(view.benchmarksTraceToMethodology).toBe(true);
  });

  it("lifts a governance block", () => {
    const view = providerContractingViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.contracting.no-autonomous-term-change"
    );
  });

  it("treats a failed non-block task as invalid", () => {
    const task: A2ATask = {
      id: "pc-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The contracting decision could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = providerContractingViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
