import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  CONSENSUS_PRESETS,
  buildConsensusRequestBody,
  consensusViewFromTask,
  runConsensusTask
} from "./source-consensus-panel";

describe("CONSENSUS_PRESETS", () => {
  it("has the three reconciliation presets and the three governance-block presets", () => {
    const ids = CONSENSUS_PRESETS.map((p) => p.id);
    expect(ids).toContain("strict-majority");
    expect(ids).toContain("no-majority");
    expect(ids).toContain("unanimous");
    expect(ids).toContain("phantom-source-block");
    expect(ids).toContain("wrong-winner-block");
    expect(ids).toContain("auto-written-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of CONSENSUS_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildConsensusRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildConsensusRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { fieldRef: "f", votes: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { fieldRef: string }).fieldRef).toBe("f");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildConsensusRequestBody({
      taskId: "t-2",
      determination: { disposition: "consensus" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "consensus" });
  });
});

describe("runConsensusTask", () => {
  it("POSTs and returns the A2A task result", async () => {
    const task: A2ATask = {
      id: "t-9",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } }
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t-9", result: task }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const result = await runConsensusTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runConsensusTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("consensusViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "ConsensusDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  fieldRef: "provider-4417.specialty",
                  determination: {
                    fieldRef: "provider-4417.specialty",
                    disposition: "consensus",
                    candidate: "Endocrinology",
                    candidateCount: 4,
                    total: 5,
                    hasConsensus: true,
                    agreements: [
                      { sourceId: "ehr-feed", value: "Endocrinology", agreesWithConsensus: true }
                    ],
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
          consensusVotesSourced: true,
          consensusConsistent: true,
          consensusNoAutonomousWrite: true
        }
      }
    };
    const view = consensusViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("consensus");
      expect(view.candidate).toBe("Endocrinology");
      expect(view.candidateCount).toBe(4);
      expect(view.consensusConsistent).toBe(true);
    }
  });

  it("lifts a blocked view from a governance block", () => {
    const task: A2ATask = {
      id: "t-2",
      status: {
        state: "failed",
        timestamp: "now",
        message: { role: "agent", parts: [{ type: "text", text: "blocked" }] }
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: ["policy.consensus.consensus-consistent"],
          violations: [
            { policyId: "policy.consensus.consensus-consistent", reason: "wrong winner" }
          ],
          traceTaskId: "t-2"
        }
      }
    };
    const view = consensusViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.consensus.consensus-consistent");
    }
  });

  it("lifts an invalid view from a non-block failure", () => {
    const task: A2ATask = {
      id: "t-3",
      status: {
        state: "failed",
        timestamp: "now",
        message: { role: "agent", parts: [{ type: "text", text: "nope" }] }
      },
      metadata: { agentFabric: { decision: "invalid", traceTaskId: "t-3" } }
    };
    const view = consensusViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
