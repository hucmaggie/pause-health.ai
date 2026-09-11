import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_CARE_ROUTE_DIRECT_REQUEST,
  DEMO_CARE_ROUTE_NO_ROUTE_REQUEST,
  DEMO_CARE_ROUTE_REQUEST,
  evaluateCareRoute
} from "../../../../../lib/care-routing";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/care-routing/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the multi-hop demo — the block base. */
const VALID_DETERMINATION = evaluateCareRoute(DEMO_CARE_ROUTE_REQUEST);

describe("POST /api/agents/care-routing/tasks", () => {
  it("route-found → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-cr-route-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CARE_ROUTE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("route-found");
    expect(body.result.metadata.agentFabric.totalCost).toBe(7);
    expect(body.result.metadata.agentFabric.hops).toBe(3);
    expect(body.result.metadata.agentFabric.routePathSourced).toBe(true);
    expect(body.result.metadata.agentFabric.routeOptimal).toBe(true);
    expect(body.result.metadata.agentFabric.routeNoAutonomousRouting).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("route.receive-graph");
    expect(ops).toContain("route.compute-path");
    expect(ops).toContain("route.classify-disposition");
    expect(ops).toContain("route.log-audit");
    const computeSpan = spans.find((s) => s.operation === "route.compute-path");
    expect(computeSpan?.agentId).toBe("care-routing-agent");
    expect(computeSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("direct route → completed, cheapest direct edge", async () => {
    const res = await POST(
      rpc({
        id: "test-cr-direct-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CARE_ROUTE_DIRECT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.totalCost).toBe(2);
  });

  it("no-route → completed, unreachable", async () => {
    const res = await POST(
      rpc({
        id: "test-cr-noroute-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CARE_ROUTE_NO_ROUTE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("no-route");
    expect(body.result.metadata.agentFabric.reachable).toBe(false);
  });

  it("blocks a fabricated-edge path (path-sourced)", async () => {
    const taskId = "test-cr-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CARE_ROUTE_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  path: ["hospital", "home-health", "home"],
                  hops: 2
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
    expect(ids).toContain("policy.route.path-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "route.compute-path.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "route.log-audit")).toBe(false);
  });

  it("blocks a sub-optimal route (route-optimal)", async () => {
    const res = await POST(
      rpc({
        id: "test-cr-suboptimal-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CARE_ROUTE_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  path: ["hospital", "snf", "home"],
                  totalCost: 8,
                  hops: 2
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
    expect(ids).toContain("policy.route.route-optimal");
  });

  it("blocks an autonomous routing (no-autonomous-routing)", async () => {
    const res = await POST(
      rpc({
        id: "test-cr-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CARE_ROUTE_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresCareLeadReview: false,
                  autoRouted: true
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
    expect(ids).toContain("policy.route.no-autonomous-routing");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/care-routing/tasks", {
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
      new Request("http://localhost/api/agents/care-routing/tasks", {
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
