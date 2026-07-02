import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { recordSpan } from "../../../../lib/agent-fabric";

/**
 * Route test for GET /api/agent-fabric/traces -- the trace viewer.
 * The span store is a shared module global (seeded + written to by other
 * tests), so every assertion here is scoped to a per-test unique task id and
 * never relies on total counts.
 */

function get(query = ""): Request {
  return new Request(`http://test/api/agent-fabric/traces${query}`);
}

function seedTask(taskId: string, count: number): void {
  const t0 = Date.now();
  for (let i = 0; i < count; i++) {
    recordSpan({
      taskId,
      agentId: "care-router-claude",
      agentName: "x",
      operation: `op-${i}`,
      protocol: "a2a",
      startedAt: new Date(t0 + i * 10).toISOString(),
      finishedAt: new Date(t0 + i * 10 + 5).toISOString(),
      durationMs: 5,
      status: "ok"
    });
  }
}

describe("GET /api/agent-fabric/traces", () => {
  it("with no params, returns the recent task-id index", async () => {
    const taskId = `route-traces-${Math.random().toString(36).slice(2)}`;
    seedTask(taskId, 1);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(Array.isArray(json.recentTaskIds)).toBe(true);
    expect(json.recentTaskIds).toContain(taskId);
    // The index branch does not return a span tree.
    expect(json.traces).toBeUndefined();
  });

  it("with ?taskId, returns only that task's spans in start order", async () => {
    const taskId = `route-traces-${Math.random().toString(36).slice(2)}`;
    seedTask(taskId, 3);
    const res = await GET(get(`?taskId=${encodeURIComponent(taskId)}`));
    const json = await res.json();
    expect(json.meta._query.taskId).toBe(taskId);
    expect(json.meta._spanCount).toBe(3);
    expect(json.traces).toHaveLength(3);
    expect(json.traces.every((s: { taskId: string }) => s.taskId === taskId)).toBe(
      true
    );
    expect(json.traces.map((s: { operation: string }) => s.operation)).toEqual([
      "op-0",
      "op-1",
      "op-2"
    ]);
  });

  it("clamps ?limit to the 1..200 range", async () => {
    const res = await GET(get("?limit=99999"));
    const json = await res.json();
    // Never returns more than the ring-buffer cap regardless of the ask.
    expect(json.traces.length).toBeLessThanOrEqual(200);
    expect(json.meta._spanCount).toBe(json.traces.length);
  });
});
