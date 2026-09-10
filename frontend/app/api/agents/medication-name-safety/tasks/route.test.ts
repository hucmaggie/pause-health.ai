import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEFAULT_FORMULARY_CATALOG,
  DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST,
  DEMO_MEDICATION_NAME_SAFETY_REQUEST,
  DEMO_MEDICATION_NAME_SAFETY_UNRECOGNIZED_REQUEST
} from "../../../../../lib/medication-name-safety";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/medication-name-safety/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the premarin LASA demo — the base for the block cases. */
const VALID_DETERMINATION = {
  requestRef: "mns-002",
  patientRef: "patient-6640",
  prescribedName: "premarin",
  normalizedName: "premarin",
  editDistanceThreshold: 2,
  catalog: DEFAULT_FORMULARY_CATALOG.map((c) => ({ drugId: c.drugId, name: c.name })),
  catalogSize: DEFAULT_FORMULARY_CATALOG.length,
  exactMatch: true,
  nearestMatch: { drugId: "drug-premarin", name: "premarin", editDistance: 0 },
  confusable: [{ drugId: "drug-primaxin", name: "primaxin", editDistance: 2 }],
  disposition: "lasa-warning",
  requiresPharmacistReview: true,
  autoSubstituted: false
};

describe("POST /api/agents/medication-name-safety/tasks", () => {
  it("recognized-clear → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-mns-clear-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_MEDICATION_NAME_SAFETY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("recognized-clear");
    expect(body.result.metadata.agentFabric.exactMatch).toBe(true);
    expect(body.result.metadata.agentFabric.confusableCount).toBe(0);
    expect(body.result.metadata.agentFabric.lasaCandidatesSourced).toBe(true);
    expect(body.result.metadata.agentFabric.lasaDistancesConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.lasaNoAutonomousSubstitution).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("lasa.receive-name");
    expect(ops).toContain("lasa.compute-distances");
    expect(ops).toContain("lasa.flag-lookalike");
    expect(ops).toContain("lasa.log-audit");
    const computeSpan = spans.find((s) => s.operation === "lasa.compute-distances");
    expect(computeSpan?.agentId).toBe("medication-name-safety-agent");
    expect(computeSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("lasa-warning → completed, one look-alike", async () => {
    const taskId = "test-mns-lasa-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("lasa-warning");
    expect(body.result.metadata.agentFabric.confusableCount).toBe(1);
    expect(body.result.metadata.agentFabric.nearestName).toBe("premarin");
  });

  it("unrecognized → completed", async () => {
    const taskId = "test-mns-unrec-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_MEDICATION_NAME_SAFETY_UNRECOGNIZED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("unrecognized");
  });

  it("blocks a fabricated / mislabeled candidate (candidates-sourced)", async () => {
    const taskId = "test-mns-fab-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  nearestMatch: { drugId: "drug-premarin", name: "premaryn", editDistance: 0 }
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
    expect(ids).toContain("policy.lasa.candidates-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "lasa.compute-distances.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "lasa.log-audit")).toBe(false);
  });

  it("blocks a wrong disposition (distances-consistent)", async () => {
    const taskId = "test-mns-dist-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  disposition: "recognized-clear"
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
    expect(ids).toContain("policy.lasa.distances-consistent");
  });

  it("blocks an autonomous substitution (no-autonomous-substitution)", async () => {
    const taskId = "test-mns-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_MEDICATION_NAME_SAFETY_LASA_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresPharmacistReview: false,
                  autoSubstituted: true
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
    expect(ids).toContain("policy.lasa.no-autonomous-substitution");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/medication-name-safety/tasks", {
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
      new Request("http://localhost/api/agents/medication-name-safety/tasks", {
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
