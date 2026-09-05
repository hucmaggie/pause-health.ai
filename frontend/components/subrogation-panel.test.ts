import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SUBROGATION_PRESETS,
  buildSubrogationRequestBody,
  runSubrogationTask,
  subrogationViewFromTask
} from "./subrogation-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_SUBROGATION_COMMONFUND_REQUEST,
  DEMO_SUBROGATION_REQUEST,
  evaluateSubrogation,
  subrogationBasisSourced,
  subrogationNoAutonomousLien,
  subrogationRecoverableWithinPaid
} from "../lib/subrogation";

/**
 * Unit coverage for the /demo/intake Subrogation panel — tested as node-env pure functions (this
 * repo tests components as logic, not renders). We exercise the JSON-RPC A2A body it POSTs, that
 * runSubrogationTask returns the resulting task, and that subrogationViewFromTask lifts a
 * determination and a governance block into render-ready shapes. The task fixtures mirror what
 * app/api/agents/subrogation actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateSubrogation(DEMO_SUBROGATION_REQUEST);
  return {
    id: "subro-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "SubrogationDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: { determination, caseRef: DEMO_SUBROGATION_REQUEST.caseRef }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.subrogation.basis-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "subro-abc",
        caseRef: determination.caseRef,
        eligible: determination.eligible,
        basisId: determination.basisId,
        planPaidAmount: determination.planPaidAmount,
        settlementAmount: determination.settlementAmount,
        recoverableAmount: determination.recoverableAmount,
        disposition: determination.disposition,
        requiresHumanReview: determination.requiresHumanReview,
        subrogationBasisSourced: true,
        subrogationRecoverableWithinPaid: true,
        subrogationNoAutonomousLien: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "subro-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this subrogation run: policy.subrogation.recoverable-within-paid (recoverable exceeds plan paid)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.subrogation.recoverable-within-paid"],
        violations: [
          {
            policyId: "policy.subrogation.recoverable-within-paid",
            reason: "the recoverable exceeds what the plan paid"
          }
        ]
      }
    }
  };
}

describe("SUBROGATION_PRESETS", () => {
  it("has a fully-recoverable preset", () => {
    const preset = SUBROGATION_PRESETS.find((p) => p.id === "auto-fully-recoverable");
    expect(preset).toBeDefined();
    const d = evaluateSubrogation(preset!.request!);
    expect(d.eligible).toBe(true);
    expect(d.recoverableAmount).toBe(42000);
  });

  it("has a common-fund preset that reduces recovery", () => {
    const preset = SUBROGATION_PRESETS.find((p) => p.id === "common-fund");
    expect(preset).toBeDefined();
    expect(preset!.request).toEqual(DEMO_SUBROGATION_COMMONFUND_REQUEST);
    const d = evaluateSubrogation(preset!.request!);
    expect(d.recoverableAmount).toBe(20100);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const offCatalog = SUBROGATION_PRESETS.find((p) => p.id === "off-catalog-basis-block");
    expect(subrogationBasisSourced(offCatalog!.determination as never)).toBe(false);

    const over = SUBROGATION_PRESETS.find((p) => p.id === "over-recoverable-block");
    expect(subrogationRecoverableWithinPaid(over!.determination as never)).toBe(false);

    const lien = SUBROGATION_PRESETS.find((p) => p.id === "auto-lien-block");
    expect(subrogationNoAutonomousLien(lien!.determination as never)).toBe(false);
  });
});

describe("buildSubrogationRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildSubrogationRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_SUBROGATION_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_SUBROGATION_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildSubrogationRequestBody({
      taskId: "task-block",
      determination: { basisId: "basis.made-up", recoverableAmount: 60000 }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { basisId: "basis.made-up", recoverableAmount: 60000 }
    });
  });
});

describe("runSubrogationTask", () => {
  it("POSTs the A2A body to the subrogation agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/subrogation/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.caseRef).toBe("subro-case-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runSubrogationTask(
      { taskId: "task-1", request: DEMO_SUBROGATION_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("subro-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runSubrogationTask(
        { taskId: "t", request: DEMO_SUBROGATION_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("subrogationViewFromTask", () => {
  it("lifts a produced determination with amounts and honesty signals", () => {
    const view = subrogationViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.caseRef).toBe("subro-case-001");
    expect(view.eligible).toBe(true);
    expect(view.planPaidAmount).toBe(42000);
    expect(view.recoverableAmount).toBe(42000);
    expect(view.disposition).toBe("assert-lien-with-review");
    expect(view.requiresHumanReview).toBe(true);
    expect(view.subrogationBasisSourced).toBe(true);
    expect(view.subrogationRecoverableWithinPaid).toBe(true);
    expect(view.subrogationNoAutonomousLien).toBe(true);
    expect(view.traceTaskId).toBe("subro-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = subrogationViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this subrogation run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.subrogation.recoverable-within-paid"
    );
    expect(view.policiesEvaluated).toContain("policy.subrogation.recoverable-within-paid");
    expect(view.traceTaskId).toBe("subro-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "subro-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The subrogation determination could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = subrogationViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
