import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  CODE_TAXONOMY_PRESETS,
  buildCodeTaxonomyRequestBody,
  codeTaxonomyViewFromTask,
  runCodeTaxonomyTask
} from "./code-taxonomy-panel";

describe("CODE_TAXONOMY_PRESETS", () => {
  it("has the three classification presets and the three governance-block presets", () => {
    const ids = CODE_TAXONOMY_PRESETS.map((p) => p.id);
    expect(ids).toContain("mixed");
    expect(ids).toContain("all-classified");
    expect(ids).toContain("specificity");
    expect(ids).toContain("phantom-code-block");
    expect(ids).toContain("wrong-bucket-block");
    expect(ids).toContain("auto-applied-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of CODE_TAXONOMY_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildCodeTaxonomyRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildCodeTaxonomyRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { catalogRef: "c", taxonomy: [], codes: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { catalogRef: string }).catalogRef).toBe("c");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildCodeTaxonomyRequestBody({
      taskId: "t-2",
      determination: { disposition: "all-classified" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "all-classified" });
  });
});

describe("runCodeTaxonomyTask", () => {
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
    const result = await runCodeTaxonomyTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runCodeTaxonomyTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("codeTaxonomyViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "CodeTaxonomyDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  catalogRef: "code-catalog-001",
                  determination: {
                    catalogRef: "code-catalog-001",
                    disposition: "unclassified-present",
                    classifications: [
                      { code: "E28.310", category: "Primary ovarian failure", matchedPrefix: "E28.3" },
                      { code: "Z00.00", category: null, matchedPrefix: null }
                    ],
                    classifiedCount: 1,
                    unclassifiedCount: 1,
                    total: 2,
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
          codeClassificationsSourced: true,
          codeClassificationConsistent: true,
          codeNoAutonomousRecode: true
        }
      }
    };
    const view = codeTaxonomyViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("unclassified-present");
      expect(view.classifications).toHaveLength(2);
      expect(view.classifiedCount).toBe(1);
      expect(view.codeClassificationConsistent).toBe(true);
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
          policiesEvaluated: ["policy.code.classification-consistent"],
          violations: [
            { policyId: "policy.code.classification-consistent", reason: "wrong bucket" }
          ],
          traceTaskId: "t-2"
        }
      }
    };
    const view = codeTaxonomyViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.code.classification-consistent");
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
    const view = codeTaxonomyViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
