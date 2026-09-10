import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_HOUSEHOLD_COMPOSITION_CHAIN_REQUEST,
  DEMO_HOUSEHOLD_COMPOSITION_REQUEST,
  DEMO_HOUSEHOLD_COMPOSITION_SINGLETONS_REQUEST
} from "../../../../../lib/household-composition";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/household-composition/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the 6-member / 3-household demo — the block base. */
const VALID_DETERMINATION = {
  batchRef: "hh-batch-001",
  members: ["m1", "m2", "m3", "m4", "m5", "m6"],
  links: [
    { a: "m1", b: "m2", basis: "shared-subscriber" },
    { a: "m2", b: "m3", basis: "shared-address" },
    { a: "m4", b: "m5", basis: "shared-subscriber" }
  ],
  households: [
    { householdId: "hh-1", members: ["m1", "m2", "m3"], size: 3 },
    { householdId: "hh-2", members: ["m4", "m5"], size: 2 },
    { householdId: "hh-3", members: ["m6"], size: 1 }
  ],
  householdCount: 3,
  largestHouseholdSize: 3,
  memberCount: 6,
  disposition: "households-formed",
  requiresStewardReview: true,
  autoMerged: false
};

describe("POST /api/agents/household-composition/tasks", () => {
  it("households-formed → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-hh-formed-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_HOUSEHOLD_COMPOSITION_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("households-formed");
    expect(body.result.metadata.agentFabric.householdCount).toBe(3);
    expect(body.result.metadata.agentFabric.householdLinksSourced).toBe(true);
    expect(body.result.metadata.agentFabric.householdPartitionConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.householdNoAutonomousMerge).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("household.receive-batch");
    expect(ops).toContain("household.compute-components");
    expect(ops).toContain("household.classify-disposition");
    expect(ops).toContain("household.log-audit");
    const computeSpan = spans.find((s) => s.operation === "household.compute-components");
    expect(computeSpan?.agentId).toBe("household-composition-agent");
    expect(computeSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("transitive chain → completed, one household of five", async () => {
    const taskId = "test-hh-chain-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_HOUSEHOLD_COMPOSITION_CHAIN_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.householdCount).toBe(1);
    expect(body.result.metadata.agentFabric.largestHouseholdSize).toBe(5);
  });

  it("all-singletons → completed", async () => {
    const taskId = "test-hh-singletons-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_HOUSEHOLD_COMPOSITION_SINGLETONS_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("all-singletons");
  });

  it("blocks a phantom relationship link (links-sourced)", async () => {
    const taskId = "test-hh-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_HOUSEHOLD_COMPOSITION_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  links: [...VALID_DETERMINATION.links, { a: "m1", b: "ghost-x", basis: "shared-address" }]
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
    expect(ids).toContain("policy.household.links-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "household.compute-components.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "household.log-audit")).toBe(false);
  });

  it("blocks a mis-grouped partition (partition-consistent)", async () => {
    const taskId = "test-hh-misgroup-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_HOUSEHOLD_COMPOSITION_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  households: [
                    { householdId: "hh-1", members: ["m1", "m2", "m3", "m4"], size: 4 },
                    { householdId: "hh-2", members: ["m5", "m6"], size: 2 }
                  ],
                  householdCount: 2,
                  largestHouseholdSize: 4
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
    expect(ids).toContain("policy.household.partition-consistent");
  });

  it("blocks an autonomous merge (no-autonomous-merge)", async () => {
    const taskId = "test-hh-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_HOUSEHOLD_COMPOSITION_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresStewardReview: false,
                  autoMerged: true
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
    expect(ids).toContain("policy.household.no-autonomous-merge");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/household-composition/tasks", {
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
      new Request("http://localhost/api/agents/household-composition/tasks", {
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
