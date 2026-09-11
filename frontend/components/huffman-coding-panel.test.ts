import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  HUFFMAN_CODING_PRESETS,
  buildHuffmanCodingRequestBody,
  huffmanCodingViewFromTask,
  runHuffmanCodingTask
} from "./huffman-coding-panel";

describe("HUFFMAN_CODING_PRESETS", () => {
  it("has the three coding presets and the three governance-block presets", () => {
    const ids = HUFFMAN_CODING_PRESETS.map((p) => p.id);
    expect(ids).toContain("compressible");
    expect(ids).toContain("uniform");
    expect(ids).toContain("skewed");
    expect(ids).toContain("non-prefix-free-block");
    expect(ids).toContain("sub-optimal-block");
    expect(ids).toContain("auto-deployed-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of HUFFMAN_CODING_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildHuffmanCodingRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildHuffmanCodingRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { streamRef: "s", symbols: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { streamRef: string }).streamRef).toBe("s");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildHuffmanCodingRequestBody({
      taskId: "t-2",
      determination: { disposition: "compressible" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "compressible" });
  });
});

describe("runHuffmanCodingTask", () => {
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
    const result = await runHuffmanCodingTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runHuffmanCodingTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("huffmanCodingViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "HuffmanDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  streamRef: "rpm-device-events",
                  determination: {
                    streamRef: "rpm-device-events",
                    disposition: "compressible",
                    codes: [
                      { symbol: "heartbeat", code: "0", length: 1, frequency: 50 },
                      { symbol: "sync-error", code: "1111", length: 4, frequency: 3 }
                    ],
                    weightedTotal: 178,
                    fixedTotal: 300,
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
          huffCodeSourced: true,
          huffCodeOptimal: true,
          huffCodeNoAutonomousDeploy: true
        }
      }
    };
    const view = huffmanCodingViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("compressible");
      expect(view.weightedTotal).toBe(178);
      expect(view.savedBits).toBe(122);
      expect(view.codes).toHaveLength(2);
      expect(view.huffCodeOptimal).toBe(true);
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
          policiesEvaluated: ["policy.huffcode.code-optimal"],
          violations: [{ policyId: "policy.huffcode.code-optimal", reason: "sub-optimal" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = huffmanCodingViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.huffcode.code-optimal");
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
    const view = huffmanCodingViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
