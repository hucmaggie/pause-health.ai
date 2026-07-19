import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/care-team/tasks", {
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

const PATIENT = {
  patientRef: "careteam-patient-001",
  asOfDate: "2026-07-01",
  clinicalNeeds: ["menopause-focus", "cardiovascular", "bone-health"],
  currentMembers: [
    {
      roleId: "role.pcp",
      roleLabel: "PCP",
      responsibility: "",
      memberRef: "member-pcp-001",
      memberName: "Dr. A. Reyes",
      assignedAt: "2025-08-14"
    },
    {
      roleId: "role.mscp",
      roleLabel: "MSCP",
      responsibility: "",
      memberRef: "member-mscp-001",
      memberName: "Dr. J. Okafor",
      assignedAt: "2025-08-14"
    },
    {
      roleId: "role.cardiology",
      roleLabel: "Cardiology",
      responsibility: "",
      memberRef: "member-card-001",
      memberName: "Dr. K. Patel",
      assignedAt: "2025-09-02"
    }
  ]
};

describe("POST /api/agents/care-team/tasks", () => {
  it("assembles the team, assigns a case manager, and records a parented trace", async () => {
    const taskId = "test-careteam-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: { role: "user", parts: [{ type: "data", data: { patient: PATIENT } }] }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.rolesTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.teamChangeRequiresCaseManager).toBe(true);
    expect(body.result.metadata.agentFabric.teamIncludesPcp).toBe(true);
    expect(body.result.metadata.agentFabric.caseManagerId).toBeTruthy();

    const data = dataPart(body).data as {
      result: {
        assembly: {
          roster: { roleId: string }[];
          gaps: { roleId: string }[];
          caseManager: { id: string } | null;
        };
        proposal: { requiresCaseManagerApproval: boolean; applied: boolean } | null;
      };
    };
    expect(data.result.assembly.roster.some((m) => m.roleId === "role.pcp")).toBe(true);
    // Two bone-health roles are gaps (endocrinology + bone-health).
    const gapIds = data.result.assembly.gaps.map((g) => g.roleId);
    expect(gapIds).toContain("role.endocrinology");
    expect(data.result.proposal?.requiresCaseManagerApproval).toBe(true);
    expect(data.result.proposal?.applied).toBe(false);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("careteam.assemble");
    expect(ops).toContain("careteam.draft-proposals");
    const assemble = spans.find((s) => s.operation === "careteam.assemble");
    expect(assemble?.agentId).toBe("care-team-management-agent");
    expect(assemble?.attributes?.phiAccessed).toBe(true);
  });

  it("blocks a roster with an off-catalog role (role-catalog-sourced)", async () => {
    const taskId = "test-careteam-offcat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: PATIENT,
                rosterOverride: [
                  {
                    roleId: "role.made-up",
                    roleLabel: "AI Concierge",
                    responsibility: "",
                    memberRef: "made-up",
                    memberName: "N/A",
                    assignedAt: "2026-01-01"
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
    expect(violationIds).toContain("policy.careteam.role-catalog-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "careteam.assemble.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "careteam.assemble")).toBe(false);
  });

  it("blocks an autonomously-applied team change (no-autonomous-assignment)", async () => {
    const taskId = "test-careteam-auto-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: PATIENT,
                proposals: [
                  {
                    action: "add-member",
                    roleId: "role.endocrinology",
                    rationale: "auto-add",
                    requiresCaseManagerApproval: false,
                    applied: true,
                    state: "applied"
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
    expect(violationIds).toContain("policy.careteam.no-autonomous-assignment");
  });

  it("blocks a roster without a PCP (pcp-required)", async () => {
    const taskId = "test-careteam-nopcp-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                patient: {
                  ...PATIENT,
                  currentMembers: PATIENT.currentMembers.filter(
                    (m) => m.roleId !== "role.pcp"
                  )
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
    expect(violationIds).toContain("policy.careteam.pcp-required");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/care-team/tasks", {
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
      new Request("http://localhost/api/agents/care-team/tasks", {
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
