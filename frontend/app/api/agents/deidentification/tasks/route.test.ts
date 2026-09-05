import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_DEIDENTIFICATION_REQUEST,
  DEMO_DEIDENTIFICATION_RETAINED_REQUEST
} from "../../../../../lib/deidentification";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/deidentification/tasks", {
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

describe("POST /api/agents/deidentification/tasks", () => {
  it("de-identifies a scrubbed Safe Harbor dataset → completed, with a parented trace", async () => {
    const taskId = "test-deid-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DEIDENTIFICATION_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.deidentified).toBe(true);
    expect(body.result.metadata.agentFabric.releaseApproved).toBe(true);
    expect(body.result.metadata.agentFabric.allCategoriesScreened).toBe(true);
    expect(body.result.metadata.agentFabric.deidAllCategoriesScreened).toBe(true);
    expect(body.result.metadata.agentFabric.deidMethodCited).toBe(true);
    expect(body.result.metadata.agentFabric.deidNoReleaseOfReidentifiable).toBe(true);

    const data = dataPart(body).data as {
      result: { determination: { deidentified: boolean; remainingIdentifierCategories: string[] } };
    };
    expect(data.result.determination.deidentified).toBe(true);
    expect(data.result.determination.remainingIdentifierCategories).toEqual([]);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("deid.receive-dataset");
    expect(ops).toContain("deid.screen");
    expect(ops).toContain("deid.determine");
    expect(ops).toContain("deid.log-audit");
    const screenSpan = spans.find((s) => s.operation === "deid.screen");
    expect(screenSpan?.agentId).toBe("deidentification-agent");
    expect(screenSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("completes with a not-de-identified determination for a retained identifier", async () => {
    const taskId = "test-deid-retained-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            { type: "data", data: { request: DEMO_DEIDENTIFICATION_RETAINED_REQUEST } }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.deidentified).toBe(false);
    expect(body.result.metadata.agentFabric.releaseApproved).toBe(false);
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(true);
    expect(body.result.metadata.agentFabric.remainingIdentifierCategoryCount).toBe(1);
  });

  it("blocks an incomplete screen marked de-identified (all-categories-screened)", async () => {
    const taskId = "test-deid-incomplete-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DEIDENTIFICATION_REQUEST,
                determination: {
                  datasetRef: "deid-dataset-001",
                  method: "safe-harbor",
                  remainingIdentifierCategories: [],
                  allCategoriesScreened: false,
                  methodCited: true,
                  deidentified: true,
                  releaseApproved: true
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
    expect(ids).toContain("policy.deid.all-categories-screened");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "deid.screen.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "deid.determine")).toBe(false);
  });

  it("blocks an ad-hoc de-identification citing no recognized method (method-cited)", async () => {
    const taskId = "test-deid-nomethod-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DEIDENTIFICATION_REQUEST,
                determination: {
                  datasetRef: "deid-dataset-001",
                  method: "ad-hoc",
                  remainingIdentifierCategories: [],
                  allCategoriesScreened: true,
                  methodCited: false,
                  deidentified: false,
                  releaseApproved: false
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
    expect(ids).toContain("policy.deid.method-cited");
  });

  it("blocks a re-identifiable dataset marked de-identified (no-release-of-reidentifiable)", async () => {
    const taskId = "test-deid-release-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DEIDENTIFICATION_REQUEST,
                determination: {
                  datasetRef: "deid-dataset-003",
                  method: "safe-harbor",
                  remainingIdentifierCategories: ["mrn"],
                  allCategoriesScreened: true,
                  methodCited: true,
                  deidentified: true,
                  releaseApproved: true
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
    expect(ids).toContain("policy.deid.no-release-of-reidentifiable");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/deidentification/tasks", {
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
      new Request("http://localhost/api/agents/deidentification/tasks", {
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
