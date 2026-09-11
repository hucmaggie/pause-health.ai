import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_TIMELINE_MERGE_CLEAN_REQUEST,
  DEMO_TIMELINE_MERGE_REQUEST,
  DEMO_TIMELINE_MERGE_SINGLE_REQUEST,
  evaluateTimelineMerge
} from "../../../../../lib/timeline-merge";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/timeline-merge/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the duplicates-found demo — the block base. */
const VALID_DETERMINATION = evaluateTimelineMerge(DEMO_TIMELINE_MERGE_REQUEST);

describe("POST /api/agents/timeline-merge/tasks", () => {
  it("duplicates-found → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-tm-dupes-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_TIMELINE_MERGE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("duplicates-found");
    expect(body.result.metadata.agentFabric.duplicateCount).toBe(2);
    expect(body.result.metadata.agentFabric.timelineEventsSourced).toBe(true);
    expect(body.result.metadata.agentFabric.timelineMergeConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.timelineNoAutonomousMerge).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("timeline.receive-streams");
    expect(ops).toContain("timeline.merge-streams");
    expect(ops).toContain("timeline.classify-disposition");
    expect(ops).toContain("timeline.log-audit");
    const mergeSpan = spans.find((s) => s.operation === "timeline.merge-streams");
    expect(mergeSpan?.agentId).toBe("timeline-merge-agent");
    expect(mergeSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("clean-merge → completed", async () => {
    const taskId = "test-tm-clean-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_TIMELINE_MERGE_CLEAN_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("clean-merge");
    expect(body.result.metadata.agentFabric.duplicateCount).toBe(0);
  });

  it("single stream → completed, clean-merge", async () => {
    const taskId = "test-tm-single-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_TIMELINE_MERGE_SINGLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("clean-merge");
  });

  it("blocks a phantom event (events-sourced)", async () => {
    const taskId = "test-tm-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_TIMELINE_MERGE_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  timeline: [
                    ...VALID_DETERMINATION.timeline,
                    {
                      eventId: "x9",
                      source: "ghost",
                      timestamp: 999,
                      kind: "phantom",
                      dedupKey: "phantom|999",
                      duplicateOf: null
                    }
                  ]
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.timeline.events-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "timeline.merge-streams.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "timeline.log-audit")).toBe(false);
  });

  it("blocks a mis-ordered timeline (merge-consistent)", async () => {
    const taskId = "test-tm-misorder-block-001";
    const reordered = [...VALID_DETERMINATION.timeline];
    const i = reordered.findIndex((e) => e.eventId === "b1");
    const j = reordered.findIndex((e) => e.eventId === "a2");
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_TIMELINE_MERGE_REQUEST,
                determination: { ...VALID_DETERMINATION, timeline: reordered }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.timeline.merge-consistent");
  });

  it("blocks an autonomous write-back (no-autonomous-merge)", async () => {
    const taskId = "test-tm-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_TIMELINE_MERGE_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresStewardReview: false,
                  autoWritten: true
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.timeline.no-autonomous-merge");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/timeline-merge/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "x", method: "tasks/get" })
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("rejects unparseable JSON with -32700", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/timeline-merge/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json"
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });
});
