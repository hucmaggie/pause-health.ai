import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  NETWORK_ADEQUACY_PRESETS,
  buildNetworkAdequacyRequestBody,
  networkAdequacyViewFromTask,
  runNetworkAdequacyTask
} from "./network-adequacy-panel";

describe("NETWORK_ADEQUACY_PRESETS", () => {
  it("has the three finding presets and the three governance-block presets", () => {
    const ids = NETWORK_ADEQUACY_PRESETS.map((p) => p.id);
    expect(ids).toContain("adequacy-met");
    expect(ids).toContain("adequacy-gap");
    expect(ids).toContain("no-provider");
    expect(ids).toContain("phantom-provider-block");
    expect(ids).toContain("mis-measured-block");
    expect(ids).toContain("auto-certified-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of NETWORK_ADEQUACY_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildNetworkAdequacyRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildNetworkAdequacyRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: {
        caseRef: "c",
        member: { memberRef: "m", latitude: 40, longitude: -74 },
        requiredSpecialty: "cardiology",
        maxDistanceMiles: 10,
        providers: []
      }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { requiredSpecialty: string }).requiredSpecialty).toBe("cardiology");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildNetworkAdequacyRequestBody({
      taskId: "t-2",
      determination: { disposition: "adequacy-gap" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "adequacy-gap" });
  });
});

describe("runNetworkAdequacyTask", () => {
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
    const result = await runNetworkAdequacyTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runNetworkAdequacyTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("networkAdequacyViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "NetworkAdequacyDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  caseRef: "adequacy-case-001",
                  determination: {
                    caseRef: "adequacy-case-001",
                    member: { memberRef: "mbr-1", latitude: 40.7128, longitude: -74.006 },
                    requiredSpecialty: "cardiology",
                    maxDistanceMiles: 10,
                    providers: [],
                    evaluated: [
                      {
                        providerId: "p1",
                        label: "Downtown Cardiology",
                        specialty: "cardiology",
                        latitude: 40.72,
                        longitude: -74.01,
                        distanceMiles: 0.54
                      }
                    ],
                    nearest: { providerId: "p1", label: "Downtown Cardiology", distanceMiles: 0.54 },
                    nearestDistanceMiles: 0.54,
                    matchingProviderCount: 1,
                    disposition: "adequacy-met",
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
          providersSourced: true,
          distancesConsistent: true,
          noAutonomousNetworkChange: true
        }
      }
    };
    const view = networkAdequacyViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("adequacy-met");
      expect(view.nearestDistanceMiles).toBe(0.54);
      expect(view.evaluated).toHaveLength(1);
      expect(view.distancesConsistent).toBe(true);
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
          policiesEvaluated: ["policy.adequacy.distances-consistent"],
          violations: [{ policyId: "policy.adequacy.distances-consistent", reason: "bad distance" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = networkAdequacyViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.adequacy.distances-consistent");
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
    const view = networkAdequacyViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
