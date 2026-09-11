import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  CONTACT_RATE_LIMIT_PRESETS,
  buildContactRateLimitRequestBody,
  contactRateLimitViewFromTask,
  runContactRateLimitTask
} from "./contact-rate-limit-panel";

describe("CONTACT_RATE_LIMIT_PRESETS", () => {
  it("has the three throttle presets and the three governance-block presets", () => {
    const ids = CONTACT_RATE_LIMIT_PRESETS.map((p) => p.id);
    expect(ids).toContain("throttled");
    expect(ids).toContain("within");
    expect(ids).toContain("burst");
    expect(ids).toContain("reordered-block");
    expect(ids).toContain("under-throttled-block");
    expect(ids).toContain("auto-sent-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of CONTACT_RATE_LIMIT_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildContactRateLimitRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildContactRateLimitRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { memberRef: "m", capacity: 3, refillPerHour: 1, attempts: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { memberRef: string }).memberRef).toBe("m");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildContactRateLimitRequestBody({
      taskId: "t-2",
      determination: { disposition: "throttled" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "throttled" });
  });
});

describe("runContactRateLimitTask", () => {
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
    const result = await runContactRateLimitTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runContactRateLimitTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("contactRateLimitViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "ContactRateLimitDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  memberRef: "member-outreach-7731",
                  determination: {
                    memberRef: "member-outreach-7731",
                    disposition: "throttled",
                    decisions: [
                      { id: "call-1", atMs: 1, decision: "permitted", tokensBefore: 3 },
                      { id: "call-2", atMs: 2, decision: "throttled", tokensBefore: 0.3 }
                    ],
                    permittedCount: 4,
                    throttledCount: 1,
                    finalTokens: 0.5,
                    capacity: 3,
                    refillPerHour: 1,
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
          contactReplaySourced: true,
          contactThrottleExact: true,
          contactNoAutonomousSend: true
        }
      }
    };
    const view = contactRateLimitViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("throttled");
      expect(view.permittedCount).toBe(4);
      expect(view.throttledCount).toBe(1);
      expect(view.decisions).toHaveLength(2);
      expect(view.contactThrottleExact).toBe(true);
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
          policiesEvaluated: ["policy.contactrate.throttle-exact"],
          violations: [{ policyId: "policy.contactrate.throttle-exact", reason: "under-throttled" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = contactRateLimitViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.contactrate.throttle-exact");
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
    const view = contactRateLimitViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
