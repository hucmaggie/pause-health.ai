import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/hedis-quality/tasks", {
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

describe("POST /api/agents/hedis-quality/tasks", () => {
  it("rolls up the demo panel and returns a human-approval-gated submission package; records a parented trace", async () => {
    const taskId = "test-hedis-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: { role: "user", parts: [{ type: "data", data: {} }] }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.measuresTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.exclusionsTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.submissionRequiresHumanApproval).toBe(true);
    expect(body.result.metadata.agentFabric.submissionState).toBe(
      "ready-for-quality-team-review"
    );

    const data = dataPart(body).data as {
      result: {
        report: { perMeasure: { measureId: string }[]; asOfPeriod: string };
        submission: {
          requiresQualityTeamApproval: boolean;
          submitted: boolean;
          state: string;
        };
      };
    };
    // Every reported measure traces to the catalog, and the submission is
    // gated on a human quality team — never autonomously filed.
    expect(data.result.report.perMeasure.length).toBeGreaterThan(0);
    expect(data.result.submission.requiresQualityTeamApproval).toBe(true);
    expect(data.result.submission.submitted).toBe(false);
    expect(data.result.submission.state).toBe("ready-for-quality-team-review");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("hedis.rollup");
    expect(ops).toContain("hedis.assemble-submission");
    const rollup = spans.find((s) => s.operation === "hedis.rollup");
    expect(rollup?.agentId).toBe("hedis-quality-agent");
    expect(rollup?.attributes?.phiAccessed).toBe(true);
  });

  it("blocks a report scoring an off-catalog measure (measure-catalog-sourced)", async () => {
    const taskId = "test-hedis-offcatalog-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                perMeasure: [{ measureId: "measure.made-up-quality-metric" }]
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
    expect(violationIds).toContain("policy.hedis.measure-catalog-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "hedis.rollup.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "hedis.rollup")).toBe(false);
  });

  it("blocks an ad-hoc / unlisted exclusion (exclusion-integrity)", async () => {
    const taskId = "test-hedis-adhoc-excl-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                appliedExclusions: [
                  {
                    measureId: "measure.breast-cancer-screening",
                    exclusionId: "exclusion.we-just-didnt-feel-like-it"
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
    expect(violationIds).toContain("policy.hedis.exclusion-integrity");
  });

  it("blocks an autonomous submission (no-autonomous-submission)", async () => {
    const taskId = "test-hedis-autosubmit-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                submissionPlan: {
                  requiresQualityTeamApproval: false,
                  submitted: true,
                  state: "submitted"
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
    expect(violationIds).toContain("policy.hedis.no-autonomous-submission");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/hedis-quality/tasks", {
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
      new Request("http://localhost/api/agents/hedis-quality/tasks", {
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
