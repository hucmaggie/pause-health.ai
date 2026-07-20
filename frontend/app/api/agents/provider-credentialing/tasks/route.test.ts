import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_EXPIRED_PROVIDER,
  DEMO_SANCTIONED_PROVIDER,
  DEMO_STALE_DIRECTORY_PROVIDER,
  DEMO_VERIFIED_PROVIDER
} from "../../../../../lib/provider-credentialing";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/provider-credentialing/tasks", {
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

describe("POST /api/agents/provider-credentialing/tasks", () => {
  it("verifies a fully-credentialed provider for a referral; records a parented trace with all gates open", async () => {
    const taskId = "test-cred-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_VERIFIED_PROVIDER } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.status).toBe("verified");
    expect(body.result.metadata.agentFabric.sanctioned).toBe(false);
    expect(body.result.metadata.agentFabric.canReferPatient).toBe(true);
    expect(body.result.metadata.agentFabric.canBookAppointment).toBe(true);
    expect(body.result.metadata.agentFabric.canReturnInDirectoryResponse).toBe(true);
    expect(body.result.metadata.agentFabric.credentialsTraceToVerifiedSource).toBe(true);
    expect(body.result.metadata.agentFabric.noReferralToExpiredOrSanctioned).toBe(true);
    expect(body.result.metadata.agentFabric.directoryIsFresh).toBe(true);

    const data = dataPart(body).data as {
      result: {
        record: {
          status: string;
          gates: { canReferPatient: boolean };
        };
      };
    };
    expect(data.result.record.status).toBe("verified");
    expect(data.result.record.gates.canReferPatient).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("credentialing.verify");
    const verify = spans.find((s) => s.operation === "credentialing.verify");
    expect(verify?.agentId).toBe("provider-credentialing-agent");
    expect(verify?.attributes?.phiAccessed).toBe(true);
  });

  it("blocks a referral to a provider with an expired credential (no-referral-to-expired-or-sanctioned)", async () => {
    const taskId = "test-cred-expired-001";
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
                  ...DEMO_EXPIRED_PROVIDER,
                  intent: "referral"
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
    expect(violationIds).toContain(
      "policy.credentialing.no-referral-to-expired-or-sanctioned"
    );

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "credentialing.verify.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "credentialing.verify")).toBe(false);
  });

  it("blocks a referral to a sanctioned provider (no-referral-to-expired-or-sanctioned)", async () => {
    const taskId = "test-cred-sanctioned-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: { ...DEMO_SANCTIONED_PROVIDER, intent: "scheduling" }
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
    expect(violationIds).toContain(
      "policy.credentialing.no-referral-to-expired-or-sanctioned"
    );
  });

  it("blocks a directory-lookup outside the NSA freshness window (no-surprises-act-directory-accuracy)", async () => {
    const taskId = "test-cred-stale-dir-001";
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
                  ...DEMO_STALE_DIRECTORY_PROVIDER,
                  intent: "directory-lookup"
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
    expect(violationIds).toContain(
      "policy.credentialing.no-surprises-act-directory-accuracy"
    );
  });

  it("blocks a credential with an off-catalog / self-reported source (source-integrity)", async () => {
    const taskId = "test-cred-source-001";
    const badRequest = {
      ...DEMO_VERIFIED_PROVIDER,
      credentials: DEMO_VERIFIED_PROVIDER.credentials!.map((c) =>
        c.kind === "dea" ? { ...c, source: "self-reported" } : c
      )
    };
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: badRequest } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.credentialing.source-integrity");
  });

  it("allows a stale directory record for a referral intent (NSA gate only applies to directory-lookup)", async () => {
    // The stale-directory provider is still 'verified' overall — for a
    // referral intent, the NSA freshness gate doesn't fire.
    const taskId = "test-cred-stale-ok-for-referral-001";
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
                  ...DEMO_STALE_DIRECTORY_PROVIDER,
                  intent: "referral"
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
    // The signal is still reported honestly...
    expect(body.result.metadata.agentFabric.directoryIsFresh).toBe(false);
    // ...but the gate doesn't block for a referral intent.
    expect(body.result.metadata.agentFabric.canReferPatient).toBe(true);
    expect(body.result.metadata.agentFabric.canReturnInDirectoryResponse).toBe(false);
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/provider-credentialing/tasks", {
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
      new Request("http://localhost/api/agents/provider-credentialing/tasks", {
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
