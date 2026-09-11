import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  TIMELINE_MERGE_PRESETS,
  buildTimelineMergeRequestBody,
  runTimelineMergeTask,
  timelineMergeViewFromTask
} from "./timeline-merge-panel";

describe("TIMELINE_MERGE_PRESETS", () => {
  it("has the three merge presets and the three governance-block presets", () => {
    const ids = TIMELINE_MERGE_PRESETS.map((p) => p.id);
    expect(ids).toContain("duplicates-found");
    expect(ids).toContain("clean-merge");
    expect(ids).toContain("single-stream");
    expect(ids).toContain("phantom-event-block");
    expect(ids).toContain("mis-ordered-block");
    expect(ids).toContain("auto-written-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of TIMELINE_MERGE_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildTimelineMergeRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildTimelineMergeRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { recordRef: "r", streams: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { recordRef: string }).recordRef).toBe("r");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildTimelineMergeRequestBody({
      taskId: "t-2",
      determination: { disposition: "duplicates-found" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "duplicates-found" });
  });
});

describe("runTimelineMergeTask", () => {
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
    const result = await runTimelineMergeTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runTimelineMergeTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("timelineMergeViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "TimelineMergeDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  recordRef: "record-merge-001",
                  determination: {
                    recordRef: "record-merge-001",
                    disposition: "duplicates-found",
                    timeline: [
                      { eventId: "a1", source: "ehr-a", timestamp: 100, kind: "visit", dedupKey: "visit|100", duplicateOf: null },
                      { eventId: "b1", source: "ehr-b", timestamp: 100, kind: "visit", dedupKey: "visit|100", duplicateOf: "a1" }
                    ],
                    sourceContributions: [],
                    totalSubmitted: 2,
                    keptCount: 1,
                    duplicateCount: 1,
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
          timelineEventsSourced: true,
          timelineMergeConsistent: true,
          timelineNoAutonomousMerge: true
        }
      }
    };
    const view = timelineMergeViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("duplicates-found");
      expect(view.timeline).toHaveLength(2);
      expect(view.duplicateCount).toBe(1);
      expect(view.timelineMergeConsistent).toBe(true);
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
          policiesEvaluated: ["policy.timeline.merge-consistent"],
          violations: [{ policyId: "policy.timeline.merge-consistent", reason: "out of order" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = timelineMergeViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.timeline.merge-consistent");
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
    const view = timelineMergeViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
