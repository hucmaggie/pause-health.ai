import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_ACCESS_ANOMALY_BURST_REQUEST,
  DEMO_ACCESS_ANOMALY_NORMAL_REQUEST,
  DEMO_ACCESS_ANOMALY_REQUEST
} from "../../../../../lib/access-anomaly";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/access-anomaly/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid trio of events + a valid peak window over them, for the governance-block cases. */
const BLOCK_EVENTS = [
  { eventId: "evt-1", patientRef: "patient-1", action: "view", timestamp: "2025-01-15T09:00:00Z", epochMs: 1736931600000 },
  { eventId: "evt-2", patientRef: "patient-2", action: "view", timestamp: "2025-01-15T09:02:00Z", epochMs: 1736931720000 },
  { eventId: "evt-3", patientRef: "patient-3", action: "view", timestamp: "2025-01-15T09:04:00Z", epochMs: 1736931840000 }
];
const BLOCK_PEAK = {
  startTime: "2025-01-15T09:00:00Z",
  endTime: "2025-01-15T09:04:00Z",
  startEpochMs: 1736931600000,
  endEpochMs: 1736931840000,
  count: 3,
  distinctPatients: 3,
  eventIds: ["evt-1", "evt-2", "evt-3"]
};

function blockDetermination(overrides: Record<string, unknown>) {
  return {
    requestRef: "aad-001",
    actorRef: "actor-3391",
    disposition: "normal",
    windowMinutes: 60,
    threshold: 20,
    peakWindow: BLOCK_PEAK,
    totalEvents: 3,
    distinctPatientsTotal: 3,
    hasAnomaly: false,
    events: BLOCK_EVENTS,
    invalidEvents: [],
    requiresPrivacyReview: true,
    autoLockedAccount: false,
    autoRevokedAccess: false,
    ...overrides
  };
}

describe("POST /api/agents/access-anomaly/tasks", () => {
  it("anomalous access volume → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-access-anomalous-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ACCESS_ANOMALY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("anomalous-access-volume");
    expect(body.result.metadata.agentFabric.peakCount).toBe(24);
    expect(body.result.metadata.agentFabric.hasAnomaly).toBe(true);
    expect(body.result.metadata.agentFabric.accessEventsSourced).toBe(true);
    expect(body.result.metadata.agentFabric.accessWindowCountConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.accessNoAutonomousAction).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("access.receive-events");
    expect(ops).toContain("access.scan-window");
    expect(ops).toContain("access.flag-anomaly");
    expect(ops).toContain("access.log-audit");
    const scanSpan = spans.find((s) => s.operation === "access.scan-window");
    expect(scanSpan?.agentId).toBe("access-anomaly-agent");
    expect(scanSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("routine spread-out access → completed, normal", async () => {
    const taskId = "test-access-normal-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ACCESS_ANOMALY_NORMAL_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("normal");
    expect(body.result.metadata.agentFabric.hasAnomaly).toBe(false);
  });

  it("high total, small bursts → completed, normal (windowed)", async () => {
    const taskId = "test-access-burst-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ACCESS_ANOMALY_BURST_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("normal");
    expect(body.result.metadata.agentFabric.peakCount).toBe(3);
  });

  it("blocks a fabricated peak (events-sourced)", async () => {
    const taskId = "test-access-fabricated-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ACCESS_ANOMALY_REQUEST,
                determination: blockDetermination({
                  peakWindow: { ...BLOCK_PEAK, distinctPatients: 9 }
                })
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
    expect(ids).toContain("policy.access.events-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "access.flag-anomaly.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "access.log-audit")).toBe(false);
  });

  it("blocks an inconsistent window count / anomaly flag (window-count-consistent)", async () => {
    const taskId = "test-access-badcount-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ACCESS_ANOMALY_REQUEST,
                determination: blockDetermination({
                  disposition: "anomalous-access-volume",
                  hasAnomaly: true // wrong: a peak of 3 does not exceed the threshold of 20
                })
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
    expect(ids).toContain("policy.access.window-count-consistent");
  });

  it("blocks an autonomous access action (no-autonomous-action)", async () => {
    const taskId = "test-access-autoaction-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ACCESS_ANOMALY_REQUEST,
                determination: blockDetermination({ autoLockedAccount: true })
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
    expect(ids).toContain("policy.access.no-autonomous-action");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/access-anomaly/tasks", {
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
      new Request("http://localhost/api/agents/access-anomaly/tasks", {
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
