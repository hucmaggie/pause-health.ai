import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BALANCE_BILLING_PRESETS,
  buildBalanceBillingRequestBody,
  balanceBillingViewFromTask,
  runBalanceBillingTask
} from "./balance-billing-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_BALANCE_BILLING_GROUND_AMBULANCE_REQUEST,
  DEMO_BALANCE_BILLING_REQUEST,
  balanceBillBasisCited,
  balanceBillCostShareInNetwork,
  balanceBillProhibitionHonored,
  evaluateBalanceBilling
} from "../lib/balance-billing";

/**
 * Unit coverage for the /demo/intake Balance Billing Protection agent panel. This repo
 * tests components as node-env pure functions (see good-faith-estimate-panel.test.ts)
 * rather than rendering them, so we exercise the exact logic the panel invokes: the
 * JSON-RPC A2A body it POSTs, that runBalanceBillingTask returns the resulting task, and
 * that balanceBillingViewFromTask lifts a determination and a governance block into
 * render-ready shapes. The task fixtures mirror the shapes app/api/agents/balance-billing
 * actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateBalanceBilling(DEMO_BALANCE_BILLING_REQUEST);
  return {
    id: "bb-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "BalanceBillingDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: { determination, claimRef: DEMO_BALANCE_BILLING_REQUEST.claimRef }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.balancebill.protection-basis-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "bb-abc",
        claimRef: determination.claimRef,
        patientRef: determination.patientRef,
        basisId: determination.basisId,
        protected: determination.protected,
        waiverEffective: determination.waiverEffective,
        balanceBillProhibited: determination.balanceBillProhibited,
        costShareBasis: determination.costShareBasis,
        patientCostShareBasisAmount: determination.patientCostShareBasisAmount,
        balanceBillAmount: determination.balanceBillAmount,
        balanceBillAllowed: determination.balanceBillAllowed,
        requiresHumanReview: determination.requiresHumanReview,
        balanceBillBasisCited: true,
        balanceBillCostShareInNetwork: true,
        balanceBillProhibitionHonored: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "bb-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this balance-billing run: policy.balancebill.cost-share-in-network-basis (over-charge)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.balancebill.cost-share-in-network-basis"],
        violations: [
          {
            policyId: "policy.balancebill.cost-share-in-network-basis",
            reason: "a protected patient's cost-share was based on the billed charge"
          }
        ]
      }
    }
  };
}

describe("BALANCE_BILLING_PRESETS", () => {
  it("has an emergency preset resolving to a protected, no-balance-bill determination", () => {
    const preset = BALANCE_BILLING_PRESETS.find((p) => p.id === "emergency-protected");
    expect(preset).toBeDefined();
    const d = evaluateBalanceBilling(preset!.request!);
    expect(d.protected).toBe(true);
    expect(d.balanceBillProhibited).toBe(true);
    expect(d.costShareBasis).toBe("in-network-qpa");
  });

  it("has a ground-ambulance preset resolving to a permitted balance bill", () => {
    const preset = BALANCE_BILLING_PRESETS.find((p) => p.id === "ground-ambulance");
    expect(preset).toBeDefined();
    const d = evaluateBalanceBilling(preset!.request!);
    expect(d.protected).toBe(false);
    expect(d.balanceBillAmount).toBe(1100);
    expect(preset!.request).toEqual(DEMO_BALANCE_BILLING_GROUND_AMBULANCE_REQUEST);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const noBasis = BALANCE_BILLING_PRESETS.find((p) => p.id === "no-basis-block");
    expect(balanceBillBasisCited(noBasis!.determination as never)).toBe(false);

    const costShare = BALANCE_BILLING_PRESETS.find((p) => p.id === "oon-cost-share-block");
    expect(balanceBillCostShareInNetwork(costShare!.determination as never)).toBe(false);

    const protectedBill = BALANCE_BILLING_PRESETS.find(
      (p) => p.id === "balance-bill-protected-block"
    );
    expect(balanceBillProhibitionHonored(protectedBill!.determination as never)).toBe(false);
  });
});

describe("buildBalanceBillingRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildBalanceBillingRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_BALANCE_BILLING_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_BALANCE_BILLING_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildBalanceBillingRequestBody({
      taskId: "task-block",
      determination: { protected: true, balanceBillAllowed: true }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { protected: true, balanceBillAllowed: true }
    });
  });
});

describe("runBalanceBillingTask", () => {
  it("POSTs the A2A body to the balance-billing agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/balance-billing/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.basisId).toBe("basis.emergency");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runBalanceBillingTask(
      { taskId: "task-1", request: DEMO_BALANCE_BILLING_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("bb-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runBalanceBillingTask(
        { taskId: "t", request: DEMO_BALANCE_BILLING_GROUND_AMBULANCE_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("balanceBillingViewFromTask", () => {
  it("lifts a produced determination with the protection, cost-share basis, and honesty signals", () => {
    const view = balanceBillingViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.claimRef).toBe("bb-claim-001");
    expect(view.basisId).toBe("basis.emergency");
    expect(view.protected).toBe(true);
    expect(view.balanceBillProhibited).toBe(true);
    expect(view.costShareBasis).toBe("in-network-qpa");
    expect(view.patientCostShareBasisAmount).toBe(1200);
    expect(view.balanceBillAmount).toBe(0);
    expect(view.balanceBillBasisCited).toBe(true);
    expect(view.balanceBillCostShareInNetwork).toBe(true);
    expect(view.balanceBillProhibitionHonored).toBe(true);
    expect(view.traceTaskId).toBe("bb-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = balanceBillingViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this balance-billing run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.balancebill.cost-share-in-network-basis"
    );
    expect(view.policiesEvaluated).toContain(
      "policy.balancebill.cost-share-in-network-basis"
    );
    expect(view.traceTaskId).toBe("bb-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "bb-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The balance-billing determination could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = balanceBillingViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
