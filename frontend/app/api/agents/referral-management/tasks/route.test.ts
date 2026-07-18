import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/referral-management/tasks", {
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

describe("POST /api/agents/referral-management/tasks", () => {
  it("triages referrals, drafts cosign-gated requests, and parks them on await-cosign", async () => {
    const taskId = "test-referral-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                context: {
                  primarySymptom: "mood",
                  severity: "severe",
                  redFlagsAcknowledged: "yes",
                  routedPathway: "behavioral-health-handoff",
                  riskFlags: { osteoporosisRisk: true }
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    // The honesty invariant: outbound referrals are always clinician-cosign-gated.
    expect(body.result.metadata.agentFabric.referralHasClinicianCosign).toBe(true);
    expect(body.result.metadata.agentFabric.referralsRecommended).toBeGreaterThan(0);

    const data = dataPart(body).data as {
      recommendations: { specialtyId: string; reason: string }[];
      referrals: {
        specialtyId: string;
        requiresClinicianCosign: boolean;
        status: string;
        sent: boolean;
      }[];
    };
    expect(data.recommendations.length).toBeGreaterThan(0);
    for (const r of data.recommendations) {
      expect(r.specialtyId).toMatch(/^referral\./);
      expect(r.reason.length).toBeGreaterThan(0);
    }
    // Every drafted referral is cosign-gated, drafted, and unsent.
    expect(data.referrals.length).toBeGreaterThan(0);
    for (const r of data.referrals) {
      expect(r.requiresClinicianCosign).toBe(true);
      expect(r.status).toBe("drafted");
      expect(r.sent).toBe(false);
    }

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("referral.triage");
    expect(ops).toContain("referral.draft");
    expect(ops).toContain("referral.await-cosign");
    const triage = spans.find((s) => s.operation === "referral.triage");
    expect(triage?.agentId).toBe("referral-management-agent");
    expect(triage?.attributes?.referralHasClinicianCosign).toBe(true);
    const awaitCosign = spans.find((s) => s.operation === "referral.await-cosign");
    expect(awaitCosign?.attributes?.sent).toBe(false);
  });

  it("falls back to the demo context when none is provided", async () => {
    const taskId = "test-referral-default-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: { role: "user", parts: [{ type: "data", data: {} }] }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.referralsRecommended).toBeGreaterThan(0);
  });

  it("blocks a caller-asserted autonomous send (no clinician cosign)", async () => {
    const taskId = "test-referral-autonomous-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                context: { riskFlags: { osteoporosisRisk: true } },
                referralAction: { kind: "send" }
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
    expect(violationIds).toContain("policy.referral.clinician-cosign");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "referral.triage.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "referral.triage")).toBe(false);
  });

  it("allows a clinician-cosigned send", async () => {
    const taskId = "test-referral-cosigned-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                context: { riskFlags: { osteoporosisRisk: true } },
                referralAction: { kind: "send", clinicianCosigned: true }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/referral-management/tasks", {
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
      new Request("http://localhost/api/agents/referral-management/tasks", {
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
