import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_ACCOUNTING_MIXED_REQUEST,
  DEMO_ACCOUNTING_REQUEST,
  DEMO_ACCOUNTING_TPO_ONLY_REQUEST
} from "../../../../../lib/accounting-of-disclosures";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/accounting-of-disclosures/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/accounting-of-disclosures/tasks", () => {
  it("assembles a mixed accounting → completed, with a parented trace", async () => {
    const taskId = "test-acct-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ACCOUNTING_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.accountableCount).toBe(2);
    expect(body.result.metadata.agentFabric.excludedCount).toBe(2);
    expect(body.result.metadata.agentFabric.outOfWindowCount).toBe(1);
    expect(body.result.metadata.agentFabric.windowStart).toBe("2020-09-01");
    expect(body.result.metadata.agentFabric.requiresPrivacyOfficerReview).toBe(true);
    expect(body.result.metadata.agentFabric.accountingPurposeSourced).toBe(true);
    expect(body.result.metadata.agentFabric.accountingDisclosuresComplete).toBe(true);
    expect(body.result.metadata.agentFabric.accountingNoAutonomousSuppression).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("accounting.receive-log");
    expect(ops).toContain("accounting.classify");
    expect(ops).toContain("accounting.assemble");
    expect(ops).toContain("accounting.log-audit");
    const classifySpan = spans.find((s) => s.operation === "accounting.classify");
    expect(classifySpan?.agentId).toBe("accounting-of-disclosures-agent");
    expect(classifySpan?.attributes?.phiAccessed).toBe(true);
  });

  it("accounts judicial + research and excludes an authorized disclosure", async () => {
    const taskId = "test-acct-mixed-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ACCOUNTING_MIXED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.accountableCount).toBe(2);
    expect(body.result.metadata.agentFabric.excludedCount).toBe(1);
  });

  it("produces an empty accounting for an all-TPO log, still review-gated", async () => {
    const taskId = "test-acct-tpo-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ACCOUNTING_TPO_ONLY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.accountableCount).toBe(0);
    expect(body.result.metadata.agentFabric.requiresPrivacyOfficerReview).toBe(true);
  });

  it("blocks a disclosure classified under an off-catalog purpose (purpose-category-sourced)", async () => {
    const taskId = "test-acct-offcatalog-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ACCOUNTING_REQUEST,
                determination: {
                  requestRef: "acct-req-001",
                  patientRef: "patient-acct-001",
                  classified: [
                    {
                      disclosureId: "disc-x",
                      date: "2026-04-20",
                      recipient: "State Department of Public Health",
                      purposeId: "purpose.we-made-up",
                      inWindow: true,
                      disposition: "in-accounting"
                    }
                  ],
                  requiresPrivacyOfficerReview: true,
                  autonomousSuppression: false
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
    expect(ids).toContain("policy.accounting.purpose-category-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "accounting.assemble.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "accounting.log-audit")).toBe(false);
  });

  it("blocks an accountable, in-window disclosure dropped from the accounting (accountable-disclosures-complete)", async () => {
    const taskId = "test-acct-dropped-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ACCOUNTING_REQUEST,
                determination: {
                  requestRef: "acct-req-001",
                  patientRef: "patient-acct-001",
                  classified: [
                    {
                      disclosureId: "disc-004",
                      date: "2026-06-11",
                      recipient: "County Sheriff's Office",
                      purposeId: "purpose.law-enforcement",
                      inWindow: true,
                      disposition: "excluded-tpo"
                    }
                  ],
                  requiresPrivacyOfficerReview: true,
                  autonomousSuppression: false
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
    expect(ids).toContain("policy.accounting.accountable-disclosures-complete");
  });

  it("blocks an autonomously-suppressed / auto-released accounting (no-autonomous-suppression)", async () => {
    const taskId = "test-acct-suppress-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ACCOUNTING_REQUEST,
                determination: {
                  requestRef: "acct-req-001",
                  patientRef: "patient-acct-001",
                  classified: [
                    {
                      disclosureId: "disc-004",
                      date: "2026-06-11",
                      recipient: "County Sheriff's Office",
                      purposeId: "purpose.law-enforcement",
                      inWindow: true,
                      disposition: "in-accounting"
                    }
                  ],
                  requiresPrivacyOfficerReview: false,
                  autonomousSuppression: true
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
    expect(ids).toContain("policy.accounting.no-autonomous-suppression");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/accounting-of-disclosures/tasks", {
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
      new Request("http://localhost/api/agents/accounting-of-disclosures/tasks", {
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
