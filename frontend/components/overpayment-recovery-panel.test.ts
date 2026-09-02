import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RECOVERY_PRESETS,
  buildRecoveryRequestBody,
  recoveryViewFromTask,
  runRecoveryTask
} from "./overpayment-recovery-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_RECOVERY_PAST_WINDOW_REQUEST,
  DEMO_RECOVERY_REQUEST,
  evaluateRecovery,
  recoveryClawbackHumanReviewed,
  recoveryReasonCited,
  recoveryWithinLookback
} from "../lib/overpayment-recovery";

/**
 * Unit coverage for the /demo/intake Claims Overpayment & Recovery agent panel. This
 * repo tests components as node-env pure functions (see coordination-of-benefits-panel
 * .test.ts) rather than rendering them, so we exercise the exact logic the panel
 * invokes: the JSON-RPC A2A body it POSTs, that runRecoveryTask returns the resulting
 * task, and that recoveryViewFromTask lifts a determination and a governance block into
 * render-ready shapes. The task fixtures mirror the shapes
 * app/api/agents/overpayment-recovery actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateRecovery(DEMO_RECOVERY_REQUEST);
  return {
    id: "recovery-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "RecoveryDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result: { determination, claimId: DEMO_RECOVERY_REQUEST.claimId } }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.recovery.reason-catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "recovery-abc",
        claimId: determination.claimId,
        overpaymentAmount: determination.overpaymentAmount,
        recoverable: determination.recoverable,
        recoveryReasonId: determination.recoveryReasonId,
        recoveryDeadline: determination.recoveryDeadline,
        withinLookbackWindow: determination.withinLookbackWindow,
        requiresHumanReview: determination.requiresHumanReview,
        recoveryWithinLookback: true,
        recoveryReasonCited: true,
        recoveryClawbackHumanReviewed: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "recovery-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this overpayment-recovery run: policy.recovery.within-lookback-window (past window)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.recovery.within-lookback-window"],
        violations: [
          {
            policyId: "policy.recovery.within-lookback-window",
            reason: "a clawback was asserted past the statutory lookback window"
          }
        ]
      }
    }
  };
}

describe("RECOVERY_PRESETS", () => {
  it("has a duplicate-payment preset resolving to a recoverable overpayment", () => {
    const preset = RECOVERY_PRESETS.find((p) => p.id === "duplicate-payment");
    expect(preset).toBeDefined();
    const d = evaluateRecovery(preset!.request!);
    expect(d.recoverable).toBe("recoverable");
    expect(d.overpaymentAmount).toBe(600);
  });

  it("has a past-window preset that is not recoverable", () => {
    const preset = RECOVERY_PRESETS.find((p) => p.id === "past-window");
    expect(preset).toBeDefined();
    const d = evaluateRecovery(preset!.request!);
    expect(d.recoverable).toBe("not-recoverable-within-window");
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const window = RECOVERY_PRESETS.find((p) => p.id === "past-window-block");
    expect(recoveryWithinLookback(window!.determination as never)).toBe(false);

    const noReason = RECOVERY_PRESETS.find((p) => p.id === "no-reason-block");
    expect(recoveryReasonCited(noReason!.determination as never)).toBe(false);

    const autonomous = RECOVERY_PRESETS.find((p) => p.id === "autonomous-clawback-block");
    expect(recoveryClawbackHumanReviewed(autonomous!.determination as never)).toBe(false);
  });
});

describe("buildRecoveryRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildRecoveryRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_RECOVERY_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_RECOVERY_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildRecoveryRequestBody({
      taskId: "task-block",
      determination: { recoverable: "recoverable", withinLookbackWindow: false }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { recoverable: "recoverable", withinLookbackWindow: false }
    });
  });
});

describe("runRecoveryTask", () => {
  it("POSTs the A2A body to the overpayment-recovery agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/overpayment-recovery/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.claimId).toBe("recovery-claim-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runRecoveryTask(
      { taskId: "task-1", request: DEMO_RECOVERY_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("recovery-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runRecoveryTask(
        { taskId: "t", request: DEMO_RECOVERY_PAST_WINDOW_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("recoveryViewFromTask", () => {
  it("lifts a produced determination with the overpayment, classification, and honesty signals", () => {
    const view = recoveryViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.claimId).toBe("recovery-claim-001");
    expect(view.overpaymentAmount).toBe(600);
    expect(view.recoverable).toBe("recoverable");
    expect(view.recoveryReasonId).toBe("reason.recovery.duplicate-payment");
    expect(view.requiresHumanReview).toBe(true);
    expect(view.recoveryWithinLookback).toBe(true);
    expect(view.recoveryReasonCited).toBe(true);
    expect(view.recoveryClawbackHumanReviewed).toBe(true);
    expect(view.traceTaskId).toBe("recovery-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = recoveryViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this overpayment-recovery run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.recovery.within-lookback-window"
    );
    expect(view.policiesEvaluated).toContain("policy.recovery.within-lookback-window");
    expect(view.traceTaskId).toBe("recovery-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "recovery-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [
            {
              type: "text",
              text: "The overpayment-recovery determination could not be produced."
            }
          ]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = recoveryViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
