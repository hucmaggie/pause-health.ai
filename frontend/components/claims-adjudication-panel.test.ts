import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLAIMS_ADJUDICATION_PRESETS,
  buildClaimsAdjudicationRequestBody,
  claimsAdjudicationViewFromTask,
  runClaimsAdjudicationTask
} from "./claims-adjudication-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_CLEAN_CLAIM,
  DEMO_DUPLICATE_CLAIM,
  DEMO_LCD_PEND_CLAIM,
  DEMO_MULTI_EDIT_CLAIM,
  adjudicateClaim
} from "../lib/claims-adjudication";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const decision = adjudicateClaim(DEMO_DUPLICATE_CLAIM);
  return {
    id: "claims-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "ClaimAdjudicationDecision",
        index: 0,
        parts: [{ type: "data", data: { result: { decision } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.claims.edit-catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "claims-abc",
        claimRef: decision.claimRef,
        memberRef: decision.memberRef,
        claimDecision: decision.decision,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        appliedEditCount: decision.appliedEdits.length,
        totalBilledCents: decision.totalBilledCents,
        requiresAdjudicatorCosign: decision.requiresAdjudicatorCosign,
        editsTraceToCatalog: true,
        denialRequiresAdjudicatorCosign: true,
        decisionsCiteReasonCodes: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "claims-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this claim adjudication: policy.claims.edit-catalog-sourced (off-catalog edit)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.claims.edit-catalog-sourced"],
        violations: [
          {
            policyId: "policy.claims.edit-catalog-sourced",
            reason: "edit.made-up is off-catalog"
          }
        ]
      }
    }
  };
}

describe("CLAIMS_ADJUDICATION_PRESETS", () => {
  it("has a clean-pay preset", () => {
    const preset = CLAIMS_ADJUDICATION_PRESETS.find((p) => p.id === "clean-pay");
    expect(preset).toBeDefined();
    const d = adjudicateClaim(preset!.request!);
    expect(d.decision).toBe("clean-pay");
  });

  it("has a deny-drafted preset (duplicate submission)", () => {
    const preset = CLAIMS_ADJUDICATION_PRESETS.find((p) => p.id === "deny-duplicate");
    expect(preset!.request).toEqual(DEMO_DUPLICATE_CLAIM);
    const d = adjudicateClaim(preset!.request!);
    expect(d.decision).toBe("deny-drafted");
    expect(d.primaryReasonCode).toBe("reason.CO-18");
  });

  it("has a pend-clinical-review preset (LCD)", () => {
    const preset = CLAIMS_ADJUDICATION_PRESETS.find((p) => p.id === "pend-lcd");
    expect(preset!.request).toEqual(DEMO_LCD_PEND_CLAIM);
    const d = adjudicateClaim(preset!.request!);
    expect(d.decision).toBe("pend-clinical-review");
  });

  it("has a multi-edit preset — deny wins by precedence", () => {
    const preset = CLAIMS_ADJUDICATION_PRESETS.find((p) => p.id === "multi-edit");
    expect(preset!.request).toEqual(DEMO_MULTI_EDIT_CLAIM);
    const d = adjudicateClaim(preset!.request!);
    expect(d.decision).toBe("deny-drafted");
    expect(d.primaryReasonCode).toBe("reason.CO-29");
  });

  it("has the three governance-block presets asserting offending overrides", () => {
    const off = CLAIMS_ADJUDICATION_PRESETS.find((p) => p.id === "offcat-edit-block");
    expect(off!.decisionOverride!.appliedEdits[0].editId).toBe("edit.made-up");
    const auto = CLAIMS_ADJUDICATION_PRESETS.find((p) => p.id === "auto-cosign-block");
    expect(auto!.decisionOverride!.cosigned).toBe(true);
    const noReason = CLAIMS_ADJUDICATION_PRESETS.find((p) => p.id === "no-reason-block");
    expect(noReason!.decisionOverride!.primaryReasonCode).toBeNull();
  });
});

describe("buildClaimsAdjudicationRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildClaimsAdjudicationRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_CLEAN_CLAIM
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_CLEAN_CLAIM });
  });

  it("posts a decision override when provided", () => {
    const decision = adjudicateClaim(DEMO_DUPLICATE_CLAIM);
    const body = buildClaimsAdjudicationRequestBody({
      taskId: "task-block",
      request: DEMO_DUPLICATE_CLAIM,
      decisionOverride: decision
    });
    expect(body.params.message.parts[0].data).toMatchObject({
      request: DEMO_DUPLICATE_CLAIM,
      decisionOverride: { claimRef: decision.claimRef }
    });
  });
});

describe("runClaimsAdjudicationTask", () => {
  it("POSTs the A2A body to the claims agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/claims-adjudication/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.claimRef).toBe(
        DEMO_DUPLICATE_CLAIM.claimRef
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runClaimsAdjudicationTask(
      { taskId: "task-1", request: DEMO_DUPLICATE_CLAIM },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("claims-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runClaimsAdjudicationTask(
        { taskId: "t", request: DEMO_DUPLICATE_CLAIM },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("claimsAdjudicationViewFromTask", () => {
  it("lifts a produced decision with all signals true", () => {
    const view = claimsAdjudicationViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.decision.decision).toBe("deny-drafted");
    expect(view.decision.primaryReasonCode).toBe("reason.CO-18");
    expect(view.editsTraceToCatalog).toBe(true);
    expect(view.denialRequiresAdjudicatorCosign).toBe(true);
    expect(view.decisionsCiteReasonCodes).toBe(true);
    expect(view.traceTaskId).toBe("claims-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = claimsAdjudicationViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this claim adjudication/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.claims.edit-catalog-sourced"
    );
    expect(view.traceTaskId).toBe("claims-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "claims-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [
            { type: "text", text: "The claim adjudication could not be produced." }
          ]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = claimsAdjudicationViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
