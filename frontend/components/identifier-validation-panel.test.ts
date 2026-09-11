import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  IDENTIFIER_VALIDATION_PRESETS,
  buildIdentifierValidationRequestBody,
  identifierValidationViewFromTask,
  runIdentifierValidationTask
} from "./identifier-validation-panel";

describe("IDENTIFIER_VALIDATION_PRESETS", () => {
  it("has the three finding presets and the three governance-block presets", () => {
    const ids = IDENTIFIER_VALIDATION_PRESETS.map((p) => p.id);
    expect(ids).toContain("invalids-flagged");
    expect(ids).toContain("all-valid");
    expect(ids).toContain("invalid-format");
    expect(ids).toContain("fabricated-identifier-block");
    expect(ids).toContain("miscomputed-checksum-block");
    expect(ids).toContain("auto-rejected-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of IDENTIFIER_VALIDATION_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildIdentifierValidationRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildIdentifierValidationRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: {
        batchRef: "b",
        identifiers: [{ npi: "1234567893" }]
      }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { identifiers: { npi: string }[] }).identifiers[0].npi).toBe(
      "1234567893"
    );
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildIdentifierValidationRequestBody({
      taskId: "t-2",
      determination: { disposition: "invalids-flagged" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "invalids-flagged" });
  });
});

describe("runIdentifierValidationTask", () => {
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
    const result = await runIdentifierValidationTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runIdentifierValidationTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("identifierValidationViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "IdentifierValidationDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  batchRef: "npi-batch-001",
                  determination: {
                    batchRef: "npi-batch-001",
                    identifiers: [{ npi: "1234567893" }],
                    results: [
                      {
                        npi: "1234567893",
                        disposition: "valid",
                        expectedCheckDigit: 3,
                        actualCheckDigit: 3,
                        reason: "r"
                      }
                    ],
                    total: 1,
                    validCount: 1,
                    invalidFormatCount: 0,
                    invalidChecksumCount: 0,
                    disposition: "all-valid",
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
          identifiersSourced: true,
          checksumConsistent: true,
          identifierNoAutonomousReject: true
        }
      }
    };
    const view = identifierValidationViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("all-valid");
      expect(view.total).toBe(1);
      expect(view.results).toHaveLength(1);
      expect(view.checksumConsistent).toBe(true);
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
          policiesEvaluated: ["policy.identifier.checksum-consistent"],
          violations: [{ policyId: "policy.identifier.checksum-consistent", reason: "bad checksum" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = identifierValidationViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.identifier.checksum-consistent");
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
    const view = identifierValidationViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
