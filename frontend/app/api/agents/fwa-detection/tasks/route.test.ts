import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEFAULT_FWA_FACTORS,
  DEMO_CLEAR_REQUEST,
  DEMO_IMPOSSIBLE_DAY_REQUEST,
  DEMO_MULTI_FLAG_REQUEST,
  DEMO_UPCODING_REQUEST
} from "../../../../../lib/fwa-detection";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/fwa-detection/tasks", {
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

describe("POST /api/agents/fwa-detection/tasks", () => {
  it("clears a clean claim + records a parented trace with all signals true", async () => {
    const taskId = "test-fwa-clear-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CLEAR_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.fwaDecision).toBe("clear");
    expect(body.result.metadata.agentFabric.patternsTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.reportRequiresSiuReview).toBe(true);
    expect(body.result.metadata.agentFabric.noProtectedClassFactors).toBe(true);
    expect(body.result.metadata.agentFabric.requiresSiuReview).toBe(false);
  });

  it("flags impossible-day for SIU-priority-queue review; investigation + freeze still false", async () => {
    const taskId = "test-fwa-impossible-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_IMPOSSIBLE_DAY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.fwaDecision).toBe("flag-for-siu-review");
    expect(body.result.metadata.agentFabric.primaryPatternId).toBe(
      "pattern.impossible-day-billing"
    );
    expect(body.result.metadata.agentFabric.primarySeverity).toBe("high");
    expect(body.result.metadata.agentFabric.routedTo).toBe("siu-priority-queue");

    const data = dataPart(body).data as {
      result: {
        report: {
          investigationOpened: boolean;
          paymentFrozen: boolean;
          requiresSiuReview: boolean;
        };
      };
    };
    expect(data.result.report.investigationOpened).toBe(false);
    expect(data.result.report.paymentFrozen).toBe(false);
    expect(data.result.report.requiresSiuReview).toBe(true);
  });

  it("flags upcoding for SIU-standard-queue (medium severity)", async () => {
    const taskId = "test-fwa-upcode-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_UPCODING_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.primaryPatternId).toBe("pattern.upcoding");
    expect(body.result.metadata.agentFabric.routedTo).toBe("siu-standard-queue");
  });

  it("primary is highest-severity across multi-flag hits", async () => {
    const taskId = "test-fwa-multi-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_MULTI_FLAG_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    // Duplicate-billing is high (wins over medium unbundling / quantity).
    expect(body.result.metadata.agentFabric.primaryPatternId).toBe(
      "pattern.duplicate-billing"
    );
    expect(body.result.metadata.agentFabric.primarySeverity).toBe("high");
  });

  it("blocks a report with an off-catalog pattern (pattern-catalog-sourced)", async () => {
    const taskId = "test-fwa-offcat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CLEAR_REQUEST,
                reportOverride: {
                  requestRef: DEMO_CLEAR_REQUEST.requestRef,
                  providerRef: DEMO_CLEAR_REQUEST.providerRef,
                  claimRef: DEMO_CLEAR_REQUEST.claimRef,
                  memberRef: DEMO_CLEAR_REQUEST.memberRef,
                  asOfDate: DEMO_CLEAR_REQUEST.asOfDate,
                  decision: "flag-for-siu-review",
                  flags: [
                    {
                      patternId: "pattern.made-up",
                      patternLabel: "Fake pattern",
                      severity: "high",
                      reason: "fabricated"
                    }
                  ],
                  primaryPatternId: "pattern.made-up",
                  primarySeverity: "high",
                  routedTo: "siu-priority-queue",
                  requiresSiuReview: true,
                  investigationOpened: false,
                  paymentFrozen: false,
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
    expect(violationIds).toContain("policy.fwa.pattern-catalog-sourced");
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "fwa.screen.blocked")).toBe(true);
  });

  it("blocks an autonomous investigation (no-autonomous-denial)", async () => {
    const taskId = "test-fwa-invest-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_IMPOSSIBLE_DAY_REQUEST,
                reportOverride: {
                  requestRef: DEMO_IMPOSSIBLE_DAY_REQUEST.requestRef,
                  providerRef: DEMO_IMPOSSIBLE_DAY_REQUEST.providerRef,
                  claimRef: DEMO_IMPOSSIBLE_DAY_REQUEST.claimRef,
                  memberRef: DEMO_IMPOSSIBLE_DAY_REQUEST.memberRef,
                  asOfDate: DEMO_IMPOSSIBLE_DAY_REQUEST.asOfDate,
                  decision: "flag-for-siu-review",
                  flags: [
                    {
                      patternId: "pattern.impossible-day-billing",
                      patternLabel: "Impossible-day",
                      severity: "high",
                      reason: "over 24h"
                    }
                  ],
                  primaryPatternId: "pattern.impossible-day-billing",
                  primarySeverity: "high",
                  routedTo: "siu-priority-queue",
                  requiresSiuReview: true,
                  investigationOpened: true as unknown as false,
                  paymentFrozen: false,
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
    expect(violationIds).toContain("policy.fwa.no-autonomous-denial");
  });

  it("blocks a factor list with a protected-class attribute (no-protected-class-factors)", async () => {
    const taskId = "test-fwa-protected-001";
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
                  ...DEMO_CLEAR_REQUEST,
                  factorsInUse: [...DEFAULT_FWA_FACTORS, "attr.provider-ethnicity"]
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
    expect(violationIds).toContain("policy.fwa.no-protected-class-factors");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/fwa-detection/tasks", {
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
      new Request("http://localhost/api/agents/fwa-detection/tasks", {
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
