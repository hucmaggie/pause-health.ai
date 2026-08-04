import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/risk-adjustment/tasks", {
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

const HAPPY_CONTEXT = {
  patientRef: "riskadj-patient-001",
  documentedEvidence: [
    "evidence.a1c-elevated",
    "evidence.diabetic-complication",
    "evidence.dexa-tscore-osteoporosis",
    "evidence.fragility-fracture",
    "evidence.phq9-moderate-plus",
    "evidence.depression-treatment"
  ],
  codedConditions: ["hcc.diabetes-with-complication", "hcc.osteoporosis-fracture"]
};

const OVERCODED_CONTEXT = {
  patientRef: "riskadj-patient-002",
  documentedEvidence: ["evidence.a1c-elevated", "evidence.diabetes-medication"],
  codedConditions: ["hcc.copd", "hcc.diabetes-without-complication"]
};

describe("POST /api/agents/risk-adjustment/tasks", () => {
  it("assesses a patient: confirmed HCCs + RAF score + a suspected coding gap; records a parented trace", async () => {
    const taskId = "test-riskadj-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { context: HAPPY_CONTEXT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.codesTraceToClinicalEvidence).toBe(true);
    expect(body.result.metadata.agentFabric.codingRequiresClinicianValidation).toBe(true);
    expect(body.result.metadata.agentFabric.noAutonomousCodeSubmission).toBe(true);
    expect(body.result.metadata.agentFabric.confirmedCount).toBe(2);
    expect(body.result.metadata.agentFabric.suspectedCount).toBe(1);
    expect(body.result.metadata.agentFabric.rafScore).toBeCloseTo(0.739, 3);
    expect(body.result.metadata.agentFabric.requiresClinicianValidation).toBe(true);
    expect(body.result.metadata.agentFabric.submitted).toBe(false);

    const data = dataPart(body).data as {
      result: {
        assessment: {
          codingGaps: { hccId: string }[];
          requiresClinicianValidation: boolean;
          submitted: boolean;
        };
      };
    };
    expect(data.result.assessment.codingGaps.map((h) => h.hccId)).toEqual([
      "hcc.major-depression"
    ]);
    expect(data.result.assessment.requiresClinicianValidation).toBe(true);
    expect(data.result.assessment.submitted).toBe(false);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("riskadj.review-documentation");
    expect(ops).toContain("riskadj.suspect-hccs");
    expect(ops).toContain("riskadj.score");
    expect(ops).toContain("riskadj.flag-for-validation");
    const suspect = spans.find((s) => s.operation === "riskadj.suspect-hccs");
    expect(suspect?.agentId).toBe("risk-adjustment-agent");
    expect(suspect?.attributes?.phiAccessed).toBe(true);
  });

  it("surfaces an unsupported / over-coded flag but still COMPLETES (safe, not a block)", async () => {
    const taskId = "test-riskadj-overcode-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { context: OVERCODED_CONTEXT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    // Surfacing an unsupported / over-coded flag is NOT a governance block.
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.unsupportedCount).toBeGreaterThan(0);
    // The agent's own output still traces to evidence (an unsupported flag makes no claim).
    expect(body.result.metadata.agentFabric.codesTraceToClinicalEvidence).toBe(true);
  });

  it("blocks a fabricated / unsupported code presented as supported (evidence-supported-coding)", async () => {
    const taskId = "test-riskadj-upcode-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                context: HAPPY_CONTEXT,
                hccs: [
                  { hccId: "hcc.chf", status: "confirmed", supportingEvidence: [] }
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
    expect(violationIds).toContain("policy.riskadj.evidence-supported-coding");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "riskadj.assess.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "riskadj.suspect-hccs")).toBe(false);
  });

  it("blocks using a suspected code as final without clinician validation (clinician-validation-required)", async () => {
    const taskId = "test-riskadj-validation-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                context: HAPPY_CONTEXT,
                action: { kind: "submit", clinicianValidated: false }
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
    expect(violationIds).toContain("policy.riskadj.clinician-validation-required");
    // The no-autonomous-submission block does NOT fire (no submission asserted yet).
    expect(violationIds).not.toContain("policy.riskadj.no-autonomous-submission");
  });

  it("blocks an autonomous code submission / claim adjustment (no-autonomous-submission)", async () => {
    const taskId = "test-riskadj-autonomous-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                context: HAPPY_CONTEXT,
                action: { kind: "submit", clinicianValidated: true, submitted: true }
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
    expect(violationIds).toContain("policy.riskadj.no-autonomous-submission");
    // Clinician validation was present, so that block does NOT fire.
    expect(violationIds).not.toContain("policy.riskadj.clinician-validation-required");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/risk-adjustment/tasks", {
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
      new Request("http://localhost/api/agents/risk-adjustment/tasks", {
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
