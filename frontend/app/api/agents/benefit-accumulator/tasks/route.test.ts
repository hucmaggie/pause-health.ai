import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_BENEFIT_ACCUMULATOR_IMMEDIATE_REQUEST,
  DEMO_BENEFIT_ACCUMULATOR_REQUEST,
  DEMO_BENEFIT_ACCUMULATOR_UNDER_REQUEST,
  evaluateBenefitAccumulator
} from "../../../../../lib/benefit-accumulator";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/benefit-accumulator/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateBenefitAccumulator(DEMO_BENEFIT_ACCUMULATOR_REQUEST);

describe("POST /api/agents/benefit-accumulator/tasks", () => {
  it("oop-max-met ledger → completed, with a parented PHI-adjacent trace", async () => {
    const taskId = "test-ba-met-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_BENEFIT_ACCUMULATOR_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("oop-max-met");
    expect(body.result.metadata.agentFabric.totalApplied).toBe(3550);
    expect(body.result.metadata.agentFabric.crossoverIndex).toBe(4);
    expect(body.result.metadata.agentFabric.benefitLedgerSourced).toBe(true);
    expect(body.result.metadata.agentFabric.benefitAccumulatorExact).toBe(true);
    expect(body.result.metadata.agentFabric.benefitNoAutonomousAdjust).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("benefitacc.receive-ledger");
    expect(ops).toContain("benefitacc.accumulate");
    expect(ops).toContain("benefitacc.classify-disposition");
    expect(ops).toContain("benefitacc.log-audit");
    const accSpan = spans.find((s) => s.operation === "benefitacc.accumulate");
    expect(accSpan?.agentId).toBe("benefit-accumulator-agent");
    expect(accSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("under-oop-max ledger → completed (under-oop-max)", async () => {
    const res = await POST(
      rpc({
        id: "test-ba-under-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_BENEFIT_ACCUMULATOR_UNDER_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("under-oop-max");
    expect(body.result.metadata.agentFabric.crossoverIndex).toBe(-1);
  });

  it("immediate crossover → completed (oop-max-met at claim 0)", async () => {
    const res = await POST(
      rpc({
        id: "test-ba-immediate-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_BENEFIT_ACCUMULATOR_IMMEDIATE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.crossoverIndex).toBe(0);
  });

  it("blocks a fabricated running total (ledger-sourced)", async () => {
    const taskId = "test-ba-sourced-block-001";
    const runningTotals = VALID_DETERMINATION.runningTotals.map((t, i) => (i === 2 ? t + 100 : t));
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_BENEFIT_ACCUMULATOR_REQUEST,
                determination: { ...VALID_DETERMINATION, runningTotals }
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
    expect(ids).toContain("policy.benefitacc.ledger-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "benefitacc.ledger.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "benefitacc.log-audit")).toBe(false);
  });

  it("blocks a mislocated crossover (accumulator-exact)", async () => {
    // Index 3 is in-range but not where the OOP max is crossed (index 4): passes sourced, fails exact.
    const res = await POST(
      rpc({
        id: "test-ba-exact-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_BENEFIT_ACCUMULATOR_REQUEST,
                determination: { ...VALID_DETERMINATION, crossoverIndex: 3 }
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
    expect(ids).toContain("policy.benefitacc.accumulator-exact");
    // Isolable: it passed sourced.
    expect(ids).not.toContain("policy.benefitacc.ledger-sourced");
  });

  it("blocks an autonomous adjustment (no-autonomous-adjust)", async () => {
    const res = await POST(
      rpc({
        id: "test-ba-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_BENEFIT_ACCUMULATOR_REQUEST,
                determination: { ...VALID_DETERMINATION, requiresAnalystReview: false, autoAdjusted: true }
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
    expect(ids).toContain("policy.benefitacc.no-autonomous-adjust");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/benefit-accumulator/tasks", {
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
      new Request("http://localhost/api/agents/benefit-accumulator/tasks", {
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
