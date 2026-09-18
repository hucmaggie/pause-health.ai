import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  AUDIT_SAMPLE_PRESETS,
  auditSampleViewFromTask,
  buildAuditSampleRequestBody,
  runAuditSampleTask
} from "./audit-sample-panel";

describe("AUDIT_SAMPLE_PRESETS", () => {
  it("has the three sample presets and the three governance-block presets", () => {
    const ids = AUDIT_SAMPLE_PRESETS.map((p) => p.id);
    expect(ids).toContain("sampled");
    expect(ids).toContain("reseed");
    expect(ids).toContain("full-population");
    expect(ids).toContain("fabricated-id-block");
    expect(ids).toContain("cherry-picked-block");
    expect(ids).toContain("auto-audited-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of AUDIT_SAMPLE_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildAuditSampleRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildAuditSampleRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { auditRef: "a", sampleSize: 5, seed: 1, recordIds: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { auditRef: string }).auditRef).toBe("a");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildAuditSampleRequestBody({
      taskId: "t-2",
      determination: { disposition: "sampled" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "sampled" });
  });
});

describe("runAuditSampleTask", () => {
  it("POSTs and returns the A2A task result", async () => {
    const task: A2ATask = {
      id: "t-9",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [], timestamp: "now" } }
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t-9", result: task }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const result = await runAuditSampleTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runAuditSampleTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("auditSampleViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [], timestamp: "now" } },
      artifacts: [
        {
          name: "AuditSampleDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  auditRef: "siu-audit-2026-Q3-4402",
                  determination: {
                    auditRef: "siu-audit-2026-Q3-4402",
                    disposition: "sampled",
                    sample: ["CLM-44200", "CLM-44208", "CLM-44207"],
                    populationSize: 20,
                    effectiveSampleSize: 5,
                    inclusionProbability: 0.25,
                    seed: 20260913,
                    reason: "r",
                    note: "n"
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
          traceTaskId: "t-1",
          auditSampleSourced: true,
          auditSelectionReproducible: true,
          auditNoAutonomousAudit: true
        }
      }
    };
    const view = auditSampleViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("sampled");
      expect(view.populationSize).toBe(20);
      expect(view.inclusionProbability).toBe(0.25);
      expect(view.seed).toBe(20260913);
      expect(view.auditSelectionReproducible).toBe(true);
    }
  });

  it("lifts a blocked view from a governance block", () => {
    const task: A2ATask = {
      id: "t-2",
      status: {
        state: "failed",
        timestamp: "now",
        message: { role: "agent", parts: [{ type: "text", text: "blocked" }], timestamp: "now" }
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: ["policy.auditsample.selection-reproducible"],
          violations: [
            { policyId: "policy.auditsample.selection-reproducible", reason: "cherry-picked" }
          ],
          traceTaskId: "t-2"
        }
      }
    };
    const view = auditSampleViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.auditsample.selection-reproducible");
    }
  });

  it("lifts an invalid view from a non-block failure", () => {
    const task: A2ATask = {
      id: "t-3",
      status: {
        state: "failed",
        timestamp: "now",
        message: { role: "agent", parts: [{ type: "text", text: "nope" }], timestamp: "now" }
      },
      metadata: { agentFabric: { decision: "invalid", traceTaskId: "t-3" } }
    };
    const view = auditSampleViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
