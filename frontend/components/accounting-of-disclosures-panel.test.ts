import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNTING_PRESETS,
  buildAccountingRequestBody,
  runAccountingTask,
  accountingViewFromTask
} from "./accounting-of-disclosures-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_ACCOUNTING_REQUEST,
  DEMO_ACCOUNTING_TPO_ONLY_REQUEST,
  accountingComplete,
  accountingNoAutonomousSuppression,
  accountingPurposeSourced,
  evaluateAccounting
} from "../lib/accounting-of-disclosures";

/**
 * Unit coverage for the /demo/intake Accounting of Disclosures panel — tested as node-env pure
 * functions (this repo tests components as logic, not renders). We exercise the JSON-RPC A2A body it
 * POSTs, that runAccountingTask returns the resulting task, and that accountingViewFromTask lifts a
 * determination and a governance block into render-ready shapes. The task fixtures mirror what
 * app/api/agents/accounting-of-disclosures actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateAccounting(DEMO_ACCOUNTING_REQUEST);
  return {
    id: "acct-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "AccountingDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: { determination, requestRef: DEMO_ACCOUNTING_REQUEST.requestRef }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.accounting.purpose-category-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "acct-abc",
        requestRef: determination.requestRef,
        patientRef: determination.patientRef,
        windowStart: determination.windowStart,
        totalDisclosures: determination.totalDisclosures,
        accountableCount: determination.accountableCount,
        excludedCount: determination.excludedCount,
        outOfWindowCount: determination.outOfWindowCount,
        requiresPrivacyOfficerReview: determination.requiresPrivacyOfficerReview,
        accountingPurposeSourced: true,
        accountingDisclosuresComplete: true,
        accountingNoAutonomousSuppression: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "acct-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this accounting-of-disclosures run: policy.accounting.no-autonomous-suppression (a logged disclosure was suppressed)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.accounting.no-autonomous-suppression"],
        violations: [
          {
            policyId: "policy.accounting.no-autonomous-suppression",
            reason: "a logged disclosure was autonomously suppressed"
          }
        ]
      }
    }
  };
}

describe("ACCOUNTING_PRESETS", () => {
  it("has a mixed preset that accounts two non-TPO disclosures", () => {
    const preset = ACCOUNTING_PRESETS.find((p) => p.id === "mixed");
    expect(preset).toBeDefined();
    const d = evaluateAccounting(preset!.request!);
    expect(d.accountableCount).toBe(2);
    expect(d.outOfWindowCount).toBe(1);
  });

  it("has a TPO-only preset that yields an empty accounting", () => {
    const preset = ACCOUNTING_PRESETS.find((p) => p.id === "tpo-only");
    expect(preset).toBeDefined();
    expect(preset!.request).toEqual(DEMO_ACCOUNTING_TPO_ONLY_REQUEST);
    const d = evaluateAccounting(preset!.request!);
    expect(d.accountableCount).toBe(0);
    expect(d.requiresPrivacyOfficerReview).toBe(true);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const offCatalog = ACCOUNTING_PRESETS.find((p) => p.id === "off-catalog-purpose-block");
    expect(accountingPurposeSourced(offCatalog!.determination as never)).toBe(false);

    const dropped = ACCOUNTING_PRESETS.find((p) => p.id === "dropped-accountable-block");
    expect(accountingComplete(dropped!.determination as never)).toBe(false);

    const suppress = ACCOUNTING_PRESETS.find((p) => p.id === "auto-suppress-block");
    expect(accountingNoAutonomousSuppression(suppress!.determination as never)).toBe(false);
  });
});

describe("buildAccountingRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildAccountingRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_ACCOUNTING_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_ACCOUNTING_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildAccountingRequestBody({
      taskId: "task-block",
      determination: { autonomousSuppression: true }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { autonomousSuppression: true }
    });
  });
});

describe("runAccountingTask", () => {
  it("POSTs the A2A body to the accounting agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/accounting-of-disclosures/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.requestRef).toBe("acct-req-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runAccountingTask(
      { taskId: "task-1", request: DEMO_ACCOUNTING_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("acct-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runAccountingTask(
        { taskId: "t", request: DEMO_ACCOUNTING_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("accountingViewFromTask", () => {
  it("lifts a produced determination with counts and honesty signals", () => {
    const view = accountingViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.requestRef).toBe("acct-req-001");
    expect(view.accountableCount).toBe(2);
    expect(view.excludedCount).toBe(2);
    expect(view.outOfWindowCount).toBe(1);
    expect(view.windowStart).toBe("2020-09-01");
    expect(view.requiresPrivacyOfficerReview).toBe(true);
    expect(view.classified.length).toBe(5);
    expect(view.accountingPurposeSourced).toBe(true);
    expect(view.accountingDisclosuresComplete).toBe(true);
    expect(view.accountingNoAutonomousSuppression).toBe(true);
    expect(view.traceTaskId).toBe("acct-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = accountingViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this accounting-of-disclosures run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.accounting.no-autonomous-suppression"
    );
    expect(view.policiesEvaluated).toContain("policy.accounting.no-autonomous-suppression");
    expect(view.traceTaskId).toBe("acct-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "acct-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The accounting of disclosures could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = accountingViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
