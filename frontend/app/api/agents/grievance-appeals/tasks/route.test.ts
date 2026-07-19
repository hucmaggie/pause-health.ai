import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/grievance-appeals/tasks", {
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

const EXPEDITED_INTAKE = {
  memberRef: "member-001",
  complaintText:
    "The prior auth for my HRT was denied and my menopause symptoms are worsening — I cannot wait 30 days.",
  involvesCoverageDenial: true,
  memberRequestedExpedited: true,
  receivedDate: "2026-07-01"
};

const BILLING_INTAKE = {
  memberRef: "member-002",
  complaintText: "I received a bill for a copay I do not believe I owe.",
  involvesCoverageDenial: false,
  memberRequestedExpedited: false,
  receivedDate: "2026-07-01"
};

describe("POST /api/agents/grievance-appeals/tasks", () => {
  it("classifies an expedited coverage-denial appeal, routes to clinical-review, stamps a 3-day deadline; records a parented trace", async () => {
    const taskId = "test-grievance-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { intake: EXPEDITED_INTAKE } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.caseType).toBe(
      "case.appeal-expedited-coverage-denial"
    );
    expect(body.result.metadata.agentFabric.urgency).toBe("expedited");
    expect(body.result.metadata.agentFabric.queue).toBe("clinical-review");
    expect(body.result.metadata.agentFabric.deadlineDate).toBe("2026-07-04");
    expect(body.result.metadata.agentFabric.deadlineDays).toBe(3);
    expect(body.result.metadata.agentFabric.caseResolutionRequiresHumanQueue).toBe(true);
    expect(body.result.metadata.agentFabric.deadlineTracesToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.routingSummaryIsPhiSafe).toBe(true);

    const data = dataPart(body).data as {
      result: {
        case: {
          state: string;
          phiSafeRoutingSummary: { phiSafe: boolean };
        };
        proposal: { requiresHumanQueueAction: boolean; applied: boolean };
      };
    };
    expect(data.result.case.state).toBe("queued-for-human-review");
    expect(data.result.case.phiSafeRoutingSummary.phiSafe).toBe(true);
    expect(data.result.proposal.requiresHumanQueueAction).toBe(true);
    expect(data.result.proposal.applied).toBe(false);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("grievance.classify");
    expect(ops).toContain("grievance.route-to-queue");
    const classify = spans.find((s) => s.operation === "grievance.classify");
    expect(classify?.agentId).toBe("grievance-appeals-agent");
    expect(classify?.attributes?.phiAccessed).toBe(true);
  });

  it("classifies a standard billing grievance, routes to member-services, stamps a 30-day deadline", async () => {
    const taskId = "test-grievance-billing-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { intake: BILLING_INTAKE } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.caseType).toBe(
      "case.grievance-billing-dispute"
    );
    expect(body.result.metadata.agentFabric.queue).toBe("member-services");
    expect(body.result.metadata.agentFabric.deadlineDate).toBe("2026-07-31");
  });

  it("blocks an autonomous case resolution (no-autonomous-resolution)", async () => {
    const taskId = "test-grievance-auto-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                intake: EXPEDITED_INTAKE,
                proposals: [
                  {
                    caseId: "case-x",
                    queue: "clinical-review",
                    rationale: "auto-resolve",
                    requiresHumanQueueAction: false,
                    applied: true
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
    expect(violationIds).toContain("policy.grievance.no-autonomous-resolution");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "grievance.classify.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "grievance.classify")).toBe(false);
  });

  it("blocks a deadline extended past the regulatory maximum (deadline-integrity)", async () => {
    const taskId = "test-grievance-deadline-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                intake: EXPEDITED_INTAKE,
                deadlineOverride: {
                  caseType: "case.appeal-expedited-coverage-denial",
                  receivedDate: "2026-07-01",
                  // Regulatory max for expedited is 3 days — 30 days breaches.
                  deadlineDate: "2026-07-31"
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
    expect(violationIds).toContain("policy.grievance.deadline-integrity");
  });

  it("blocks a routing summary that leaks free-text PHI (no-phi-in-routing-summary)", async () => {
    const taskId = "test-grievance-phi-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                intake: EXPEDITED_INTAKE,
                routingSummaryOverride: {
                  memberRef: EXPEDITED_INTAKE.memberRef,
                  caseType: "case.appeal-expedited-coverage-denial",
                  urgency: "expedited",
                  queue: "clinical-review",
                  deadlineDate: "2026-07-04",
                  phiSafe: true,
                  // Extra free-text key with PHI keywords — a violation.
                  clinicalDetail:
                    "denial for estradiol patch; menopause symptoms worsening"
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
    expect(violationIds).toContain("policy.grievance.no-phi-in-routing-summary");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/grievance-appeals/tasks", {
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
      new Request("http://localhost/api/agents/grievance-appeals/tasks", {
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
