import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_ATTRIBUTION_PANEL,
  attributePatient
} from "../../../../../lib/quality-attribution";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/quality-attribution/tasks", {
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

describe("POST /api/agents/quality-attribution/tasks", () => {
  it("attributes the demo panel + records a parented trace with all signals true", async () => {
    const taskId = "test-attr-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { panel: DEMO_ATTRIBUTION_PANEL } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.attributionsTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.attributionsHonorContractTerms).toBe(true);
    expect(body.result.metadata.agentFabric.attributionTieBreaksAreDocumented).toBe(true);
    expect(body.result.metadata.agentFabric.panelSize).toBe(
      DEMO_ATTRIBUTION_PANEL.length
    );

    const data = dataPart(body).data as {
      result: {
        report: {
          patients: Array<{ providerRef: string | null; tieBreakApplied: string | null }>;
          perProvider: Array<{ providerRef: string; attributedCount: number }>;
        };
      };
    };
    expect(data.result.report.patients).toHaveLength(DEMO_ATTRIBUTION_PANEL.length);
    // At least one tie-break has been applied (patient 2).
    expect(
      data.result.report.patients.some((p) => p.tieBreakApplied === "most-recent-visit-wins")
    ).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("attribution.attribute");
    expect(ops).toContain("attribution.rollup");
    const attr = spans.find((s) => s.operation === "attribution.attribute");
    expect(attr?.agentId).toBe("quality-attribution-agent");
    expect(attr?.attributes?.phiAccessed).toBe(true);
  });

  it("blocks an off-catalog attribution methodology (methodology-catalog-sourced)", async () => {
    const taskId = "test-attr-offcat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                panel: DEMO_ATTRIBUTION_PANEL,
                attributionOverrides: [
                  {
                    patientRef: "attr-patient-001",
                    methodologyId: "methodology.coin-flip",
                    providerRef: "provider-a",
                    clinicRef: "clinic-north",
                    contractRef: "contract.commercial-vbc-my2026",
                    tieBreakApplied: null,
                    excludedByContract: false,
                    exclusionReasons: [],
                    synthetic: true,
                    note: "override"
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
    expect(violationIds).toContain("policy.attribution.methodology-catalog-sourced");
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "attribution.attribute.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "attribution.attribute")).toBe(false);
  });

  it("blocks a caller who asserts excludedByContract:false on a patient the contract actually excludes (no-conflicting-contract-terms)", async () => {
    const taskId = "test-attr-contract-lie-001";
    // Patient 5 in the demo panel is age-band-excluded from Medicare
    // Advantage HEDIS. Assert the opposite.
    const excludedPatient = DEMO_ATTRIBUTION_PANEL[4];
    const truth = attributePatient(excludedPatient);
    expect(truth.excludedByContract).toBe(true);
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                panel: DEMO_ATTRIBUTION_PANEL,
                attributionOverrides: [
                  {
                    ...truth,
                    excludedByContract: false,
                    exclusionReasons: []
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
    expect(violationIds).toContain("policy.attribution.no-conflicting-contract-terms");
  });

  it("blocks an undocumented / opaque tie-break rule (tie-break-documented)", async () => {
    const taskId = "test-attr-opaque-tiebreak-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                panel: DEMO_ATTRIBUTION_PANEL,
                attributionOverrides: [
                  {
                    patientRef: "attr-patient-002",
                    methodologyId: "methodology.plurality-of-visits",
                    providerRef: "provider-a",
                    clinicRef: "clinic-north",
                    contractRef: "contract.commercial-vbc-my2026",
                    tieBreakApplied: "coin-flip",
                    excludedByContract: false,
                    exclusionReasons: [],
                    synthetic: true,
                    note: "override"
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
    expect(violationIds).toContain("policy.attribution.tie-break-documented");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/quality-attribution/tasks", {
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
      new Request("http://localhost/api/agents/quality-attribution/tasks", {
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
