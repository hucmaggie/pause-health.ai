import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_NETWORK_BUILDOUT_PARTITIONED_REQUEST,
  DEMO_NETWORK_BUILDOUT_REQUEST,
  DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST,
  evaluateNetworkBuildout
} from "../../../../../lib/network-buildout";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/network-buildout/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_REQUEST);

describe("POST /api/agents/network-buildout/tasks", () => {
  it("connected network → completed, with a parented PHI-adjacent trace", async () => {
    const taskId = "test-nb-connected-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_NETWORK_BUILDOUT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("connected");
    expect(body.result.metadata.agentFabric.totalCost).toBe(18);
    expect(body.result.metadata.agentFabric.componentCount).toBe(1);
    expect(body.result.metadata.agentFabric.networkTreeSourced).toBe(true);
    expect(body.result.metadata.agentFabric.networkTreeCostOptimal).toBe(true);
    expect(body.result.metadata.agentFabric.networkNoAutonomousProvision).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("netbuildout.receive-network");
    expect(ops).toContain("netbuildout.build");
    expect(ops).toContain("netbuildout.classify-disposition");
    expect(ops).toContain("netbuildout.log-audit");
    const buildSpan = spans.find((s) => s.operation === "netbuildout.build");
    expect(buildSpan?.agentId).toBe("network-buildout-agent");
    expect(buildSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("partitioned network → completed (partitioned is a legitimate finding, not a governance block)", async () => {
    const res = await POST(
      rpc({
        id: "test-nb-partitioned-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_NETWORK_BUILDOUT_PARTITIONED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("partitioned");
    expect(body.result.metadata.agentFabric.componentCount).toBe(2);
  });

  it("triangle → completed (connected, drops the cycle-closing link)", async () => {
    const res = await POST(
      rpc({
        id: "test-nb-triangle-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("connected");
    expect(body.result.metadata.agentFabric.totalCost).toBe(3);
  });

  it("blocks a fabricated link (tree-sourced)", async () => {
    const taskId = "test-nb-sourced-block-001";
    // Replace a chosen link with a fabricated cheap hub-west link that isn't a submitted candidate.
    const chosenLinks = [...VALID_DETERMINATION.chosenLinks.slice(0, 3), { a: "hub", b: "west", cost: 1 }];
    const totalCost = chosenLinks.reduce((s, l) => s + l.cost, 0);
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_NETWORK_BUILDOUT_REQUEST,
                determination: { ...VALID_DETERMINATION, chosenLinks, totalCost }
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
    expect(ids).toContain("policy.netbuildout.tree-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "netbuildout.build.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "netbuildout.log-audit")).toBe(false);
  });

  it("blocks a sub-optimal tree (cost-optimal)", async () => {
    const tri = evaluateNetworkBuildout(DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST);
    // x-y(1) + x-z(9) is a valid acyclic spanning tree but not minimal (skips y-z(2)).
    const chosenLinks = [
      { a: "site-x", b: "site-y", cost: 1 },
      { a: "site-x", b: "site-z", cost: 9 }
    ];
    const res = await POST(
      rpc({
        id: "test-nb-optimal-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_NETWORK_BUILDOUT_TRIANGLE_REQUEST,
                determination: { ...tri, chosenLinks, totalCost: 10, componentCount: 1 }
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
    expect(ids).toContain("policy.netbuildout.cost-optimal");
    // Isolable: it passed sourced.
    expect(ids).not.toContain("policy.netbuildout.tree-sourced");
  });

  it("blocks an autonomous provisioning (no-autonomous-provision)", async () => {
    const res = await POST(
      rpc({
        id: "test-nb-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_NETWORK_BUILDOUT_REQUEST,
                determination: { ...VALID_DETERMINATION, requiresArchitectReview: false, autoProvisioned: true }
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
    expect(ids).toContain("policy.netbuildout.no-autonomous-provision");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/network-buildout/tasks", {
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
      new Request("http://localhost/api/agents/network-buildout/tasks", {
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
