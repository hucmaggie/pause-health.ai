import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_QUOTE_BOUNDARY_REQUEST,
  DEMO_QUOTE_ESCALATE_REQUEST,
  DEMO_QUOTE_REQUEST
} from "../../../../../lib/deal-desk";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/deal-desk/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/deal-desk/tasks", () => {
  it("auto-approves a within-guardrail quote → completed, with a parented trace (no PHI)", async () => {
    const taskId = "test-dd-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_QUOTE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.withinGuardrail).toBe(true);
    expect(body.result.metadata.agentFabric.disposition).toBe("auto-approve");
    expect(body.result.metadata.agentFabric.autoApproved).toBe(true);
    expect(body.result.metadata.agentFabric.requiresDealDeskApproval).toBe(false);
    expect(body.result.metadata.agentFabric.dealDeskCatalogSourced).toBe(true);
    expect(body.result.metadata.agentFabric.dealDeskMathConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.dealDeskNoAutonomousApproval).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("dealdesk.receive-quote");
    expect(ops).toContain("dealdesk.validate-pricing");
    expect(ops).toContain("dealdesk.decide-approval");
    expect(ops).toContain("dealdesk.record-audit");
    const decideSpan = spans.find((s) => s.operation === "dealdesk.decide-approval");
    expect(decideSpan?.agentId).toBe("deal-desk-agent");
    // Commercial plane — no PHI.
    expect(decideSpan?.attributes?.phiAccessed).toBe(false);
  });

  it("escalates an out-of-guardrail quote to a human deal-desk owner", async () => {
    const taskId = "test-dd-escalate-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_QUOTE_ESCALATE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.withinGuardrail).toBe(false);
    expect(body.result.metadata.agentFabric.disposition).toBe("escalate-to-deal-desk");
    expect(body.result.metadata.agentFabric.requiresDealDeskApproval).toBe(true);
    expect(body.result.metadata.agentFabric.breachingLines).toContain("product.platform-core");
  });

  it("auto-approves a boundary discount at the guardrail", async () => {
    const taskId = "test-dd-boundary-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_QUOTE_BOUNDARY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("auto-approve");
  });

  it("blocks a decision pricing an off-catalog product (pricing-catalog-sourced)", async () => {
    const taskId = "test-dd-offcatalog-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_QUOTE_REQUEST,
                decision: {
                  quoteRef: "quote-001",
                  accountRef: "account-northstar-health",
                  lines: [
                    {
                      productId: "product.we-made-up",
                      listPrice: 100000,
                      quantity: 1,
                      proposedDiscountPct: 10,
                      maxAutoApproveDiscountPct: 0,
                      lineListTotal: 100000,
                      lineNetTotal: 90000,
                      withinGuardrail: false
                    }
                  ],
                  listTotal: 100000,
                  netTotal: 90000,
                  discountTotal: 10000,
                  effectiveDiscountPct: 10,
                  withinGuardrail: false,
                  breachingLines: ["product.we-made-up"],
                  disposition: "escalate-to-deal-desk",
                  autoApproved: false,
                  requiresDealDeskApproval: true
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
    expect(ids).toContain("policy.dealdesk.pricing-catalog-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "dealdesk.decide-approval.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "dealdesk.record-audit")).toBe(false);
  });

  it("blocks a decision whose totals do not add up (discount-math-consistent)", async () => {
    const taskId = "test-dd-badmath-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_QUOTE_REQUEST,
                decision: {
                  quoteRef: "quote-001",
                  accountRef: "account-northstar-health",
                  lines: [
                    {
                      productId: "product.platform-core",
                      listPrice: 120000,
                      quantity: 1,
                      proposedDiscountPct: 12,
                      maxAutoApproveDiscountPct: 15,
                      lineListTotal: 120000,
                      lineNetTotal: 105600,
                      withinGuardrail: true
                    }
                  ],
                  listTotal: 120000,
                  netTotal: 118000,
                  discountTotal: 2000,
                  effectiveDiscountPct: 1.7,
                  withinGuardrail: true,
                  breachingLines: [],
                  disposition: "auto-approve",
                  autoApproved: true,
                  requiresDealDeskApproval: false
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
    expect(ids).toContain("policy.dealdesk.discount-math-consistent");
  });

  it("blocks an out-of-guardrail discount marked auto-approved (no-autonomous-out-of-guardrail-approval)", async () => {
    const taskId = "test-dd-approve-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_QUOTE_ESCALATE_REQUEST,
                decision: {
                  quoteRef: "quote-002",
                  accountRef: "account-cascade-systems",
                  lines: [
                    {
                      productId: "product.platform-core",
                      listPrice: 120000,
                      quantity: 2,
                      proposedDiscountPct: 25,
                      maxAutoApproveDiscountPct: 15,
                      lineListTotal: 240000,
                      lineNetTotal: 180000,
                      withinGuardrail: false
                    }
                  ],
                  listTotal: 240000,
                  netTotal: 180000,
                  discountTotal: 60000,
                  effectiveDiscountPct: 25,
                  withinGuardrail: false,
                  breachingLines: ["product.platform-core"],
                  disposition: "auto-approve",
                  autoApproved: true,
                  requiresDealDeskApproval: false
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
    expect(ids).toContain("policy.dealdesk.no-autonomous-out-of-guardrail-approval");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/deal-desk/tasks", {
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
      new Request("http://localhost/api/agents/deal-desk/tasks", {
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
