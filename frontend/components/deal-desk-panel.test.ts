import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  DEAL_DESK_PRESETS,
  buildDealDeskRequestBody,
  dealDeskViewFromTask,
  runDealDeskTask
} from "./deal-desk-panel";
import { DEMO_QUOTE_REQUEST } from "../lib/deal-desk";

describe("DEAL_DESK_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(DEAL_DESK_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of DEAL_DESK_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = DEAL_DESK_PRESETS.map((p) => p.id);
    expect(ids).toContain("off-catalog-product-block");
    expect(ids).toContain("bad-math-block");
    expect(ids).toContain("out-of-guardrail-approved-block");
  });
});

describe("buildDealDeskRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildDealDeskRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_QUOTE_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_QUOTE_REQUEST);
    expect(data.decision).toBeUndefined();
  });

  it("carries a caller-asserted decision when present", () => {
    const body = buildDealDeskRequestBody({
      taskId: "t2",
      decision: { autoApproved: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.decision).toEqual({ autoApproved: true });
  });
});

function okResponse(task: A2ATask): Response {
  const payload: A2ARpcResponse<A2ATask> = { jsonrpc: "2.0", id: "x", result: task };
  return {
    ok: true,
    status: 200,
    json: async () => payload
  } as unknown as Response;
}

describe("runDealDeskTask", () => {
  it("POSTs to the deal-desk route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runDealDeskTask({ taskId: "t", request: DEMO_QUOTE_REQUEST }, fetchImpl as unknown as typeof fetch);
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/deal-desk/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runDealDeskTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("dealDeskViewFromTask", () => {
  it("lifts a resolved decision from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "QuoteDecision",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  quoteRef: "quote-001",
                  decision: {
                    quoteRef: "quote-001",
                    accountRef: "acct",
                    lines: [],
                    listTotal: 100,
                    netTotal: 90,
                    discountTotal: 10,
                    effectiveDiscountPct: 10,
                    withinGuardrail: true,
                    breachingLines: [],
                    disposition: "auto-approve",
                    autoApproved: true,
                    requiresDealDeskApproval: false,
                    reason: "ok",
                    synthetic: true,
                    note: "note"
                  }
                }
              }
            }
          ]
        }
      ],
      metadata: {
        agentFabric: {
          decision: "allow",
          traceTaskId: "trace-1",
          dealDeskCatalogSourced: true,
          dealDeskMathConsistent: true,
          dealDeskNoAutonomousApproval: true
        }
      }
    };
    const view = dealDeskViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("auto-approve");
      expect(view.netTotal).toBe(90);
      expect(view.dealDeskCatalogSourced).toBe(true);
      expect(view.traceTaskId).toBe("trace-1");
    }
  });

  it("lifts a blocked view from a failed task with a fabric block", () => {
    const task: A2ATask = {
      id: "t",
      status: {
        state: "failed",
        timestamp: new Date().toISOString(),
        message: { role: "agent", parts: [{ type: "text", text: "blocked" }] }
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: ["policy.dealdesk.pricing-catalog-sourced"],
          violations: [{ policyId: "policy.dealdesk.pricing-catalog-sourced", reason: "off-catalog" }]
        }
      }
    };
    const view = dealDeskViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.dealdesk.pricing-catalog-sourced");
      expect(view.policiesEvaluated).toContain("policy.dealdesk.pricing-catalog-sourced");
    }
  });
});
