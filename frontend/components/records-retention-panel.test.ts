import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RECORDS_RETENTION_PRESETS,
  buildRecordsRetentionRequestBody,
  recordsRetentionViewFromTask,
  runRecordsRetentionTask
} from "./records-retention-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_RETENTION_REQUEST,
  evaluateRetention,
  purgeHumanApproved,
  retentionRespectsLegalHold,
  retentionRuleCited
} from "../lib/records-retention";

/**
 * Unit coverage for the /demo/intake Data Retention agent panel. This repo tests
 * components as node-env pure functions (see break-the-glass-panel.test.ts) rather
 * than rendering them, so we exercise the exact logic the panel invokes: the
 * JSON-RPC A2A body it POSTs, that runRecordsRetentionTask returns the resulting
 * task, and that recordsRetentionViewFromTask lifts a disposition and a governance
 * block into render-ready shapes. The task fixtures mirror the shapes
 * app/api/agents/records-retention actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const disposition = evaluateRetention(DEMO_RETENTION_REQUEST);
  return {
    id: "retention-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "RetentionDisposition",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result: { disposition, recordId: DEMO_RETENTION_REQUEST.recordId } }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.retention.schedule-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "retention-abc",
        recordId: disposition.recordId,
        recommendation: disposition.recommendation,
        retentionRuleId: disposition.retentionRuleId,
        retentionExpiresAt: disposition.retentionExpiresAt,
        underLegalHold: disposition.underLegalHold,
        requiresHumanApproval: disposition.requiresHumanApproval,
        retentionRespectsLegalHold: true,
        retentionRuleCited: true,
        purgeHumanApproved: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "retention-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this records-disposition run: policy.retention.legal-hold-overrides-purge (purge under hold)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.retention.legal-hold-overrides-purge"],
        violations: [
          {
            policyId: "policy.retention.legal-hold-overrides-purge",
            reason: "a record on active legal hold was marked eligible-for-purge"
          }
        ]
      }
    }
  };
}

describe("RECORDS_RETENTION_PRESETS", () => {
  it("has a valid-retain preset that resolves to a retain under the cited schedule", () => {
    const preset = RECORDS_RETENTION_PRESETS.find((p) => p.id === "valid-retain");
    expect(preset).toBeDefined();
    const d = evaluateRetention(preset!.record!);
    expect(d.recommendation).toBe("retain");
    expect(d.retentionRuleId).toBe("rule.retention.clinical-record-7y");
  });

  it("has an eligible-for-purge preset that resolves to a human-approval-gated recommendation", () => {
    const preset = RECORDS_RETENTION_PRESETS.find((p) => p.id === "eligible-for-purge");
    expect(preset).toBeDefined();
    const d = evaluateRetention(preset!.record!);
    expect(d.recommendation).toBe("eligible-for-purge");
    expect(d.requiresHumanApproval).toBe(true);
  });

  it("has a legal-hold preset that resolves to a hold (overrides purge)", () => {
    const preset = RECORDS_RETENTION_PRESETS.find((p) => p.id === "legal-hold");
    expect(preset).toBeDefined();
    const d = evaluateRetention(preset!.record!);
    expect(d.recommendation).toBe("hold");
    expect(d.underLegalHold).toBe(true);
  });

  it("has the three governance-block presets asserting an offending disposition", () => {
    const holdPurge = RECORDS_RETENTION_PRESETS.find((p) => p.id === "purge-under-hold-block");
    expect(retentionRespectsLegalHold(holdPurge!.disposition as never)).toBe(false);

    const noSchedule = RECORDS_RETENTION_PRESETS.find((p) => p.id === "no-schedule-block");
    expect(retentionRuleCited(noSchedule!.disposition as never)).toBe(false);

    const autonomous = RECORDS_RETENTION_PRESETS.find((p) => p.id === "autonomous-purge-block");
    expect(purgeHumanApproved(autonomous!.disposition as never)).toBe(false);
  });
});

describe("buildRecordsRetentionRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a record data part", () => {
    const body = buildRecordsRetentionRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      record: DEMO_RETENTION_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ record: DEMO_RETENTION_REQUEST });
  });

  it("posts an asserted disposition under its data part", () => {
    const body = buildRecordsRetentionRequestBody({
      taskId: "task-block",
      disposition: { recommendation: "eligible-for-purge", underLegalHold: true }
    });
    expect(body.params.message.parts[0].data).toEqual({
      disposition: { recommendation: "eligible-for-purge", underLegalHold: true }
    });
  });
});

describe("runRecordsRetentionTask", () => {
  it("POSTs the A2A body to the records-retention agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/records-retention/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.record.recordId).toBe("retention-record-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runRecordsRetentionTask(
      { taskId: "task-1", record: DEMO_RETENTION_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("retention-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runRecordsRetentionTask(
        { taskId: "t", record: DEMO_RETENTION_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("recordsRetentionViewFromTask", () => {
  it("lifts a produced disposition with the recommendation, cited rule, expiry, and honesty signals", () => {
    const view = recordsRetentionViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.recordId).toBe("retention-record-001");
    expect(view.recommendation).toBe("retain");
    expect(view.retentionRuleId).toBe("rule.retention.clinical-record-7y");
    expect(view.retentionExpiresAt).toBe("2032-06-15T00:00:00.000Z");
    expect(view.underLegalHold).toBe(false);
    expect(view.requiresHumanApproval).toBe(false);
    expect(view.retentionRespectsLegalHold).toBe(true);
    expect(view.retentionRuleCited).toBe(true);
    expect(view.purgeHumanApproved).toBe(true);
    expect(view.traceTaskId).toBe("retention-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = recordsRetentionViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this records-disposition run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.retention.legal-hold-overrides-purge"
    );
    expect(view.policiesEvaluated).toContain("policy.retention.legal-hold-overrides-purge");
    expect(view.traceTaskId).toBe("retention-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "retention-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The records-disposition could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = recordsRetentionViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
