import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUDIT_LOG_PRESETS,
  auditLogViewFromTask,
  buildAuditLogRequestBody,
  runAuditLogTask
} from "./audit-log-integrity-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_AUDIT_LOG_REQUEST,
  auditLogHashChainVerified,
  auditLogNoAutonomousRedaction,
  auditLogSequenceComplete,
  evaluateAuditLogIntegrity
} from "../lib/audit-log-integrity";

/**
 * Unit coverage for the /demo/intake Audit Log Integrity panel — tested as node-env pure
 * functions (this repo tests components as logic, not renders). We exercise the JSON-RPC A2A
 * body it POSTs, that runAuditLogTask returns the resulting task, and that auditLogViewFromTask
 * lifts a determination and a governance block into render-ready shapes. The task fixtures
 * mirror what app/api/agents/audit-log-integrity actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const determination = evaluateAuditLogIntegrity(DEMO_AUDIT_LOG_REQUEST);
  return {
    id: "al-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "AuditLogDetermination",
        index: 0,
        parts: [
          {
            type: "data",
            data: {
              result: { determination, logRef: DEMO_AUDIT_LOG_REQUEST.logRef }
            }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.auditlog.hash-chain-verified"],
        traceSpanId: "span-1",
        traceTaskId: "al-abc",
        logRef: determination.logRef,
        entryCount: determination.entryCount,
        verified: determination.verified,
        hashChainIntact: determination.hashChainIntact,
        sequenceComplete: determination.sequenceComplete,
        brokenLinks: determination.brokenLinks,
        sequenceGaps: determination.sequenceGaps,
        requiresForensicReview: determination.requiresForensicReview,
        auditLogHashChainVerified: true,
        auditLogSequenceComplete: true,
        auditLogNoAutonomousRedaction: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "al-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this audit-log integrity run: policy.auditlog.hash-chain-verified (broken chain)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.auditlog.hash-chain-verified"],
        violations: [
          {
            policyId: "policy.auditlog.hash-chain-verified",
            reason: "a verified log over a broken hash chain"
          }
        ]
      }
    }
  };
}

describe("AUDIT_LOG_PRESETS", () => {
  it("has an intact preset that verifies", () => {
    const preset = AUDIT_LOG_PRESETS.find((p) => p.id === "intact");
    expect(preset).toBeDefined();
    const d = evaluateAuditLogIntegrity(preset!.request!);
    expect(d.verified).toBe(true);
    expect(d.requiresForensicReview).toBe(false);
  });

  it("has a tampered preset that breaks the chain", () => {
    const preset = AUDIT_LOG_PRESETS.find((p) => p.id === "tampered");
    expect(preset).toBeDefined();
    const d = evaluateAuditLogIntegrity(preset!.request!);
    expect(d.verified).toBe(false);
    expect(d.brokenLinks).toBeGreaterThanOrEqual(1);
  });

  it("has a gap preset that fails the sequence check", () => {
    const preset = AUDIT_LOG_PRESETS.find((p) => p.id === "gap");
    expect(preset).toBeDefined();
    const d = evaluateAuditLogIntegrity(preset!.request!);
    expect(d.sequenceComplete).toBe(false);
  });

  it("has the three governance-block presets asserting an offending determination", () => {
    const breakBlock = AUDIT_LOG_PRESETS.find((p) => p.id === "verified-over-break-block");
    expect(auditLogHashChainVerified(breakBlock!.determination as never)).toBe(false);

    const gapBlock = AUDIT_LOG_PRESETS.find((p) => p.id === "verified-with-gap-block");
    expect(auditLogSequenceComplete(gapBlock!.determination as never)).toBe(false);

    const repairBlock = AUDIT_LOG_PRESETS.find((p) => p.id === "repaired-block");
    expect(auditLogNoAutonomousRedaction(repairBlock!.determination as never)).toBe(false);
  });
});

describe("buildAuditLogRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildAuditLogRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_AUDIT_LOG_REQUEST
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_AUDIT_LOG_REQUEST });
  });

  it("posts an asserted determination under its data part", () => {
    const body = buildAuditLogRequestBody({
      taskId: "task-block",
      determination: { verified: true, hashChainIntact: false }
    });
    expect(body.params.message.parts[0].data).toEqual({
      determination: { verified: true, hashChainIntact: false }
    });
  });
});

describe("runAuditLogTask", () => {
  it("POSTs the A2A body to the audit-log-integrity agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/audit-log-integrity/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.logRef).toBe("audit-log-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runAuditLogTask(
      { taskId: "task-1", request: DEMO_AUDIT_LOG_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("al-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runAuditLogTask(
        { taskId: "t", request: DEMO_AUDIT_LOG_REQUEST },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("auditLogViewFromTask", () => {
  it("lifts a produced determination with the flags and honesty signals", () => {
    const view = auditLogViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.logRef).toBe("audit-log-001");
    expect(view.entryCount).toBe(5);
    expect(view.verified).toBe(true);
    expect(view.brokenLinks).toBe(0);
    expect(view.sequenceGaps).toBe(0);
    expect(view.requiresForensicReview).toBe(false);
    expect(view.entryChecks.length).toBe(5);
    expect(view.auditLogHashChainVerified).toBe(true);
    expect(view.auditLogSequenceComplete).toBe(true);
    expect(view.auditLogNoAutonomousRedaction).toBe(true);
    expect(view.traceTaskId).toBe("al-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = auditLogViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this audit-log integrity run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.auditlog.hash-chain-verified"
    );
    expect(view.policiesEvaluated).toContain("policy.auditlog.hash-chain-verified");
    expect(view.traceTaskId).toBe("al-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "al-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The audit-log integrity determination could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = auditLogViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
