import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/master-patient-index/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

function dataPart(body: {
  result: { artifacts: { parts: { type: string; data?: unknown }[] }[] };
}) {
  return body.result.artifacts[0].parts.find(
    (p: { type: string }) => p.type === "data"
  ) as { type: "data"; data: Record<string, unknown> };
}

const INCOMING = {
  recordId: "mpi-incoming-001",
  firstName: "Maria",
  lastName: "Gonzalez",
  dob: "1974-03-12",
  sex: "female",
  addressLine: "482 Juniper Way",
  postalCode: "94110",
  phone: "+1-415-555-0142",
  mrn: "MRN-4820",
  memberId: "MBR-77120"
};

const CLEAR_MATCH = { ...INCOMING, recordId: "mpi-candidate-clear-001", firstName: "MARIA" };

const POSSIBLE_MATCH = {
  recordId: "mpi-candidate-possible-001",
  firstName: "Maria",
  lastName: "Gonzalez",
  dob: "1974-03-12",
  sex: "female",
  addressLine: "19 Seaview Terrace",
  postalCode: "94019",
  phone: "+1-650-555-0999",
  mrn: "MRN-9981",
  memberId: "MBR-33001"
};

describe("POST /api/agents/master-patient-index/tasks", () => {
  it("resolves a clear match → merge and records a parented trace", async () => {
    const taskId = "test-mpi-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { incoming: INCOMING, candidates: [CLEAR_MATCH] } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.recommendation).toBe("merge");
    expect(body.result.metadata.agentFabric.classification).toBe("match");
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(false);
    expect(body.result.metadata.agentFabric.matchTracesToFeatures).toBe(true);
    expect(body.result.metadata.agentFabric.mergeRequiresHumanReview).toBe(true);
    expect(body.result.metadata.agentFabric.excludesProtectedAttributesInMatching).toBe(true);

    const data = dataPart(body).data as {
      result: { resolution: { bestMatch: { candidateId: string; score: number } } };
    };
    expect(data.result.resolution.bestMatch.candidateId).toBe("mpi-candidate-clear-001");
    expect(data.result.resolution.bestMatch.score).toBe(100);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("mpi.load-candidates");
    expect(ops).toContain("mpi.score");
    expect(ops).toContain("mpi.resolve");
    expect(ops).toContain("mpi.flag-for-review");
    const resolve = spans.find((s) => s.operation === "mpi.resolve");
    expect(resolve?.agentId).toBe("master-patient-index-agent");
    expect(resolve?.attributes?.phiAccessed).toBe(true);
  });

  it("recommends manual-review (requiresHumanReview) for a possible-match but still COMPLETES (safe, not a block)", async () => {
    const taskId = "test-mpi-possible-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { incoming: INCOMING, candidates: [POSSIBLE_MATCH] } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    // A possible-match / manual-review is NOT a governance block.
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.recommendation).toBe("manual-review");
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(true);
    expect(body.result.metadata.agentFabric.classification).toBe("possible-match");
  });

  it("blocks an opaque / off-spec match asserted as scored (transparent-matching)", async () => {
    const taskId = "test-mpi-opaque-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                incoming: INCOMING,
                candidates: [CLEAR_MATCH],
                scoredCandidates: [
                  {
                    candidateId: "mpi-candidate-clear-001",
                    score: 99,
                    matchedFeatures: [{ id: "feature.opaque-ml-score", label: "Opaque", weight: 99 }],
                    classification: "match"
                  }
                ]
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.mpi.transparent-matching");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "mpi.resolve.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "mpi.resolve")).toBe(false);
  });

  it("blocks an autonomous merge below the auto threshold (no-autonomous-merge)", async () => {
    const taskId = "test-mpi-autonomous-merge-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                incoming: INCOMING,
                candidates: [POSSIBLE_MATCH],
                resolution: {
                  recommendation: "merge",
                  requiresHumanReview: false,
                  bestMatch: {
                    candidateId: "mpi-candidate-possible-001",
                    score: 60,
                    matchedFeatures: [],
                    classification: "possible-match"
                  }
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.mpi.no-autonomous-merge");
  });

  it("blocks a protected-class attribute used as a matching feature (no-protected-class-matching)", async () => {
    const taskId = "test-mpi-protected-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                incoming: INCOMING,
                candidates: [CLEAR_MATCH],
                matchingFeatureIds: ["feature.name", "feature.dob", "attr.race"]
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.mpi.no-protected-class-matching");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/master-patient-index/tasks", {
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
      new Request("http://localhost/api/agents/master-patient-index/tasks", {
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
