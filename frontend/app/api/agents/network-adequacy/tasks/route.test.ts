import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_NETWORK_ADEQUACY_GAP_REQUEST,
  DEMO_NETWORK_ADEQUACY_NO_PROVIDER_REQUEST,
  DEMO_NETWORK_ADEQUACY_REQUEST
} from "../../../../../lib/network-adequacy";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/network-adequacy/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the endocrinology GAP demo — the block base. */
const VALID_DETERMINATION = {
  caseRef: "adequacy-case-002",
  member: { memberRef: "mbr-2", latitude: 40.7128, longitude: -74.006 },
  requiredSpecialty: "endocrinology",
  maxDistanceMiles: 10,
  providers: [
    { providerId: "e1", specialty: "endocrinology", latitude: 40.9, longitude: -74.2, label: "Uptown Endocrine" },
    { providerId: "e2", specialty: "endocrinology", latitude: 41.0, longitude: -74.5, label: "Suburban Endocrine" },
    { providerId: "p3", specialty: "dermatology", latitude: 40.713, longitude: -74.007, label: "Village Dermatology" }
  ],
  evaluated: [
    {
      providerId: "e1",
      label: "Uptown Endocrine",
      specialty: "endocrinology",
      latitude: 40.9,
      longitude: -74.2,
      distanceMiles: 16.44
    },
    {
      providerId: "e2",
      label: "Suburban Endocrine",
      specialty: "endocrinology",
      latitude: 41.0,
      longitude: -74.5,
      distanceMiles: 32.56
    }
  ],
  nearest: { providerId: "e1", label: "Uptown Endocrine", distanceMiles: 16.44 },
  nearestDistanceMiles: 16.44,
  matchingProviderCount: 2,
  disposition: "adequacy-gap",
  requiresNetworkReview: true,
  autoCertified: false
};

describe("POST /api/agents/network-adequacy/tasks", () => {
  it("adequacy-met → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-na-met-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_NETWORK_ADEQUACY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("adequacy-met");
    expect(body.result.metadata.agentFabric.nearestDistanceMiles).toBe(0.54);
    expect(body.result.metadata.agentFabric.providersSourced).toBe(true);
    expect(body.result.metadata.agentFabric.distancesConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.noAutonomousNetworkChange).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("adequacy.receive-request");
    expect(ops).toContain("adequacy.compute-distances");
    expect(ops).toContain("adequacy.classify-disposition");
    expect(ops).toContain("adequacy.log-audit");
    const computeSpan = spans.find((s) => s.operation === "adequacy.compute-distances");
    expect(computeSpan?.agentId).toBe("network-adequacy-agent");
    expect(computeSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("adequacy-gap → completed", async () => {
    const taskId = "test-na-gap-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_NETWORK_ADEQUACY_GAP_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("adequacy-gap");
    expect(body.result.metadata.agentFabric.nearestDistanceMiles).toBe(16.44);
  });

  it("no in-network provider → completed, adequacy-gap with null nearest", async () => {
    const taskId = "test-na-noprov-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_NETWORK_ADEQUACY_NO_PROVIDER_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("adequacy-gap");
    expect(body.result.metadata.agentFabric.nearestDistanceMiles).toBeNull();
    expect(body.result.metadata.agentFabric.matchingProviderCount).toBe(0);
  });

  it("blocks a phantom provider (providers-sourced)", async () => {
    const taskId = "test-na-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_NETWORK_ADEQUACY_GAP_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  evaluated: [
                    {
                      providerId: "ex",
                      label: "Phantom Endocrine",
                      specialty: "endocrinology",
                      latitude: 40.715,
                      longitude: -74.008,
                      distanceMiles: 0.18
                    },
                    ...VALID_DETERMINATION.evaluated
                  ],
                  nearest: { providerId: "ex", label: "Phantom Endocrine", distanceMiles: 0.18 },
                  nearestDistanceMiles: 0.18,
                  matchingProviderCount: 3,
                  disposition: "adequacy-met"
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
    expect(ids).toContain("policy.adequacy.providers-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "adequacy.compute-distances.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "adequacy.log-audit")).toBe(false);
  });

  it("blocks a mis-measured distance (distances-consistent)", async () => {
    const taskId = "test-na-mismeasure-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_NETWORK_ADEQUACY_GAP_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  evaluated: [
                    {
                      providerId: "e1",
                      label: "Uptown Endocrine",
                      specialty: "endocrinology",
                      latitude: 40.9,
                      longitude: -74.2,
                      distanceMiles: 5.0
                    },
                    VALID_DETERMINATION.evaluated[1]
                  ],
                  nearest: { providerId: "e1", label: "Uptown Endocrine", distanceMiles: 5.0 },
                  nearestDistanceMiles: 5.0,
                  disposition: "adequacy-met"
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
    expect(ids).toContain("policy.adequacy.distances-consistent");
  });

  it("blocks an autonomous certification (no-autonomous-network-change)", async () => {
    const taskId = "test-na-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_NETWORK_ADEQUACY_GAP_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresNetworkReview: false,
                  autoCertified: true
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
    expect(ids).toContain("policy.adequacy.no-autonomous-network-change");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/network-adequacy/tasks", {
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
      new Request("http://localhost/api/agents/network-adequacy/tasks", {
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
