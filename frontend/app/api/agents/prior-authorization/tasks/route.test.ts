import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/prior-authorization/tasks", {
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

const completeContext = {
  moderateToSevereSymptoms: true,
  contraindicationsScreened: true,
  conservativeMeasuresTried: true
};
const completeDocs = [
  "doc.clinical-notes",
  "doc.diagnosis-code",
  "doc.medication-history"
];

describe("POST /api/agents/prior-authorization/tasks", () => {
  it("assembles a clinician-gated PA package and parks it on await-clinician", async () => {
    const taskId = "test-priorauth-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: {
                  itemId: "pa.systemic-hrt",
                  member: { memberId: "m-1", planId: "p-1", payer: "Aetna" },
                  clinicalContext: completeContext,
                  attachedDocuments: completeDocs
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    // The honesty invariants: never autonomously submitted; clinician-gated.
    expect(body.result.metadata.agentFabric.submitted).toBe(false);
    expect(body.result.metadata.agentFabric.requiresClinicianApproval).toBe(true);
    expect(body.result.metadata.agentFabric.status).toBe("ready-for-clinician");

    const data = dataPart(body).data as {
      package: {
        itemId: string;
        criteria: { criteriaId: string; met: boolean }[];
        documentation: { complete: boolean; missing: string[] };
        requiresClinicianApproval: boolean;
        submitted: boolean;
        status: string;
      };
    };
    expect(data.package.itemId).toBe("pa.systemic-hrt");
    expect(data.package.submitted).toBe(false);
    expect(data.package.requiresClinicianApproval).toBe(true);
    for (const c of data.package.criteria) {
      expect(c.criteriaId).toMatch(/^pa\./);
    }
    expect(data.package.documentation.complete).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("priorauth.criteria.match");
    expect(ops).toContain("priorauth.docs.assemble");
    expect(ops).toContain("priorauth.await-clinician");
    const match = spans.find((s) => s.operation === "priorauth.criteria.match");
    expect(match?.agentId).toBe("prior-authorization-agent");
    const awaitSpan = spans.find((s) => s.operation === "priorauth.await-clinician");
    expect(awaitSpan?.attributes?.submitted).toBe(false);
  });

  it("falls back to the demo request when none is provided", async () => {
    const taskId = "test-priorauth-default-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: { role: "user", parts: [{ type: "data", data: {} }] }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.itemId).toBe("pa.systemic-hrt");
  });

  it("blocks a caller-asserted autonomous submit (no clinician approval)", async () => {
    const taskId = "test-priorauth-autonomous-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: {
                  itemId: "pa.systemic-hrt",
                  member: { memberId: "m-1", planId: "p-1" },
                  clinicalContext: completeContext,
                  attachedDocuments: completeDocs,
                  action: { kind: "submit" }
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
    expect(violationIds).toContain("policy.pa.no-autonomous-submission");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "priorauth.assemble.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "priorauth.criteria.match")).toBe(false);
  });

  it("blocks a submit missing required documentation (documentation integrity)", async () => {
    const taskId = "test-priorauth-incomplete-docs-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: {
                  itemId: "pa.systemic-hrt",
                  member: { memberId: "m-1", planId: "p-1" },
                  clinicalContext: completeContext,
                  // Missing doc.diagnosis-code + doc.medication-history.
                  attachedDocuments: ["doc.clinical-notes"],
                  // Clinician approved, so the only violation is documentation.
                  action: { kind: "submit", clinicianApproved: true }
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
    expect(violationIds).toContain("policy.pa.documentation-integrity");
    // Clinician DID approve, so the no-autonomous-submission block must NOT fire.
    expect(violationIds).not.toContain("policy.pa.no-autonomous-submission");
  });

  it("allows a clinician-approved, documentation-complete submit and records a submit span", async () => {
    const taskId = "test-priorauth-submit-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: {
                  itemId: "pa.systemic-hrt",
                  member: { memberId: "m-1", planId: "p-1" },
                  clinicalContext: completeContext,
                  attachedDocuments: completeDocs,
                  action: { kind: "submit", clinicianApproved: true }
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.submitted).toBe(true);
    expect(body.result.metadata.agentFabric.status).toBe("submitted");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "priorauth.submit")).toBe(true);
  });

  it("refuses an off-catalog PA item", async () => {
    const taskId = "test-priorauth-offcatalog-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: {
                  itemId: "pa.made-up",
                  member: { memberId: "m-1", planId: "p-1" },
                  clinicalContext: {}
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "priorauth.assemble.invalid")).toBe(true);
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/prior-authorization/tasks", {
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
      new Request("http://localhost/api/agents/prior-authorization/tasks", {
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
