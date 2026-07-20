import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_CLEAN_CLAIM,
  DEMO_DUPLICATE_CLAIM,
  DEMO_LCD_PEND_CLAIM,
  DEMO_MULTI_EDIT_CLAIM
} from "../../../../../lib/claims-adjudication";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/claims-adjudication/tasks", {
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

describe("POST /api/agents/claims-adjudication/tasks", () => {
  it("clean-pays a clean claim; records a parented trace with all signals true", async () => {
    const taskId = "test-claims-clean-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CLEAN_CLAIM } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.claimDecision).toBe("clean-pay");
    expect(body.result.metadata.agentFabric.editsTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.denialRequiresAdjudicatorCosign).toBe(true);
    expect(body.result.metadata.agentFabric.decisionsCiteReasonCodes).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("claims.evaluate-edits");
    expect(ops).toContain("claims.decide");
  });

  it("drafts a denial for the duplicate-submission claim; adjudicator cosign required", async () => {
    const taskId = "test-claims-deny-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DUPLICATE_CLAIM } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.claimDecision).toBe("deny-drafted");
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.CO-18");
    expect(body.result.metadata.agentFabric.requiresAdjudicatorCosign).toBe(true);

    const data = dataPart(body).data as {
      result: {
        decision: {
          requiresAdjudicatorCosign: boolean;
          cosigned: boolean;
          decision: string;
        };
      };
    };
    expect(data.result.decision.decision).toBe("deny-drafted");
    expect(data.result.decision.requiresAdjudicatorCosign).toBe(true);
    expect(data.result.decision.cosigned).toBe(false);
  });

  it("pend-clinical-reviews an LCD claim (no cosign gate needed)", async () => {
    const taskId = "test-claims-lcd-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_LCD_PEND_CLAIM } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.claimDecision).toBe("pend-clinical-review");
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.CO-50");
    expect(body.result.metadata.agentFabric.routedTo).toBe("clinical-reviewer");
  });

  it("picks the highest-severity decision when multiple edits hit", async () => {
    const taskId = "test-claims-multi-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_MULTI_EDIT_CLAIM } }]
        }
      })
    );
    const body = await res.json();
    // Timely-filing is deny-drafted → wins over the pend-adjudicator edits.
    expect(body.result.metadata.agentFabric.claimDecision).toBe("deny-drafted");
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.CO-29");
  });

  it("blocks a decision with an off-catalog edit (edit-catalog-sourced)", async () => {
    const taskId = "test-claims-offcat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CLEAN_CLAIM,
                decisionOverride: {
                  claimRef: DEMO_CLEAN_CLAIM.claimRef,
                  memberRef: DEMO_CLEAN_CLAIM.memberRef,
                  asOfDate: DEMO_CLEAN_CLAIM.asOfDate,
                  decision: "deny-drafted",
                  appliedEdits: [
                    {
                      editId: "edit.made-up",
                      editLabel: "Fake edit",
                      reasonCode: "reason.CO-18",
                      reasonLabel: "duplicate",
                      detail: "fabricated"
                    }
                  ],
                  primaryReasonCode: "reason.CO-18",
                  routedTo: "adjudicator",
                  totalBilledCents: 10000,
                  requiresAdjudicatorCosign: true,
                  cosigned: false,
                  synthetic: true,
                  note: "override"
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
    expect(violationIds).toContain("policy.claims.edit-catalog-sourced");
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "claims.adjudicate.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "claims.evaluate-edits")).toBe(false);
  });

  it("blocks an autonomously-cosigned denial (no-autonomous-denial)", async () => {
    const taskId = "test-claims-auto-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DUPLICATE_CLAIM,
                decisionOverride: {
                  claimRef: DEMO_DUPLICATE_CLAIM.claimRef,
                  memberRef: DEMO_DUPLICATE_CLAIM.memberRef,
                  asOfDate: DEMO_DUPLICATE_CLAIM.asOfDate,
                  decision: "deny-drafted",
                  appliedEdits: [
                    {
                      editId: "edit.duplicate-submission",
                      editLabel: "dupe",
                      reasonCode: "reason.CO-18",
                      reasonLabel: "duplicate",
                      detail: "dupe"
                    }
                  ],
                  primaryReasonCode: "reason.CO-18",
                  routedTo: "adjudicator",
                  totalBilledCents: 10000,
                  requiresAdjudicatorCosign: false,
                  cosigned: true,
                  synthetic: true,
                  note: "override"
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
    expect(violationIds).toContain("policy.claims.no-autonomous-denial");
  });

  it("blocks a decision without a reason code (reason-code-integrity)", async () => {
    const taskId = "test-claims-noreason-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DUPLICATE_CLAIM,
                decisionOverride: {
                  claimRef: DEMO_DUPLICATE_CLAIM.claimRef,
                  memberRef: DEMO_DUPLICATE_CLAIM.memberRef,
                  asOfDate: DEMO_DUPLICATE_CLAIM.asOfDate,
                  decision: "deny-drafted",
                  appliedEdits: [
                    {
                      editId: "edit.duplicate-submission",
                      editLabel: "dupe",
                      reasonCode: "reason.CO-18",
                      reasonLabel: "duplicate",
                      detail: "dupe"
                    }
                  ],
                  primaryReasonCode: null,
                  routedTo: "adjudicator",
                  totalBilledCents: 10000,
                  requiresAdjudicatorCosign: true,
                  cosigned: false,
                  synthetic: true,
                  note: "override"
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
    expect(violationIds).toContain("policy.claims.reason-code-integrity");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/claims-adjudication/tasks", {
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
      new Request("http://localhost/api/agents/claims-adjudication/tasks", {
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
