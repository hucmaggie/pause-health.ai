import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PROVIDER_CREDENTIALING_PRESETS,
  buildProviderCredentialingRequestBody,
  providerCredentialingViewFromTask,
  runProviderCredentialingTask
} from "./provider-credentialing-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_EXPIRED_PROVIDER,
  DEMO_SANCTIONED_PROVIDER,
  DEMO_STALE_DIRECTORY_PROVIDER,
  DEMO_VERIFIED_PROVIDER,
  verifyProvider
} from "../lib/provider-credentialing";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const record = verifyProvider(DEMO_VERIFIED_PROVIDER);
  return {
    id: "credentialing-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "ProviderCredentialingRecord",
        index: 0,
        parts: [{ type: "data", data: { result: { record } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.credentialing.source-integrity"],
        traceSpanId: "span-1",
        traceTaskId: "credentialing-abc",
        providerRef: record.providerRef,
        asOfDate: record.asOfDate,
        intent: "referral",
        status: record.status,
        sanctioned: record.sanctioned,
        canReferPatient: record.gates.canReferPatient,
        canBookAppointment: record.gates.canBookAppointment,
        canReturnInDirectoryResponse: record.gates.canReturnInDirectoryResponse,
        credentialsTraceToVerifiedSource: true,
        noReferralToExpiredOrSanctioned: true,
        directoryIsFresh: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "credentialing-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this credentialing check: policy.credentialing.no-referral-to-expired-or-sanctioned (expired license)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: [
          "policy.credentialing.no-referral-to-expired-or-sanctioned"
        ],
        violations: [
          {
            policyId: "policy.credentialing.no-referral-to-expired-or-sanctioned",
            reason: "state license expired"
          }
        ]
      }
    }
  };
}

describe("PROVIDER_CREDENTIALING_PRESETS", () => {
  it("has a verified-referral happy-path preset with all gates open", () => {
    const preset = PROVIDER_CREDENTIALING_PRESETS.find(
      (p) => p.id === "verified-referral"
    );
    expect(preset).toBeDefined();
    const r = verifyProvider(preset!.request!);
    expect(r.status).toBe("verified");
    expect(r.gates.canReferPatient).toBe(true);
  });

  it("has the three governance-block presets asserting an offending scenario", () => {
    const expired = PROVIDER_CREDENTIALING_PRESETS.find(
      (p) => p.id === "expired-license-block"
    );
    expect(expired!.request!.credentials!.some((c) => c.kind === "state-license" && c.expiresOn < expired!.request!.asOfDate)).toBe(
      true
    );
    const sanctioned = PROVIDER_CREDENTIALING_PRESETS.find(
      (p) => p.id === "sanctioned-block"
    );
    expect(
      sanctioned!.request!.credentials!.some(
        (c) => c.kind === "sanctions-clearance" && c.sanctioned === true
      )
    ).toBe(true);
    const stale = PROVIDER_CREDENTIALING_PRESETS.find(
      (p) => p.id === "stale-directory-block"
    );
    expect(stale!.request!.directoryProfile!.verifiedAsOf).toBe("2025-12-01");
    expect(stale!.request!.intent).toBe("directory-lookup");
  });

  it("matches the demo constants from the lib", () => {
    expect(
      PROVIDER_CREDENTIALING_PRESETS.find((p) => p.id === "verified-referral")!
        .request!
    ).toEqual(DEMO_VERIFIED_PROVIDER);
    expect(
      PROVIDER_CREDENTIALING_PRESETS.find((p) => p.id === "expired-license-block")!
        .request!.providerRef
    ).toBe(DEMO_EXPIRED_PROVIDER.providerRef);
    expect(
      PROVIDER_CREDENTIALING_PRESETS.find((p) => p.id === "sanctioned-block")!
        .request!.providerRef
    ).toBe(DEMO_SANCTIONED_PROVIDER.providerRef);
    expect(
      PROVIDER_CREDENTIALING_PRESETS.find((p) => p.id === "stale-directory-block")!
        .request!.providerRef
    ).toBe(DEMO_STALE_DIRECTORY_PROVIDER.providerRef);
  });
});

describe("buildProviderCredentialingRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a request data part", () => {
    const body = buildProviderCredentialingRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_VERIFIED_PROVIDER
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ request: DEMO_VERIFIED_PROVIDER });
  });
});

describe("runProviderCredentialingTask", () => {
  it("POSTs the A2A body to the credentialing agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/provider-credentialing/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.request.providerRef).toBe(
        "provider-mscp-001"
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runProviderCredentialingTask(
      { taskId: "task-1", request: DEMO_VERIFIED_PROVIDER },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("credentialing-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runProviderCredentialingTask(
        { taskId: "t", request: DEMO_VERIFIED_PROVIDER },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("providerCredentialingViewFromTask", () => {
  it("lifts a produced record with a verified status + all gates open", () => {
    const view = providerCredentialingViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.record.status).toBe("verified");
    expect(view.record.gates.canReferPatient).toBe(true);
    expect(view.credentialsTraceToVerifiedSource).toBe(true);
    expect(view.noReferralToExpiredOrSanctioned).toBe(true);
    expect(view.directoryIsFresh).toBe(true);
    expect(view.traceTaskId).toBe("credentialing-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = providerCredentialingViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this credentialing check/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.credentialing.no-referral-to-expired-or-sanctioned"
    );
    expect(view.policiesEvaluated).toContain(
      "policy.credentialing.no-referral-to-expired-or-sanctioned"
    );
    expect(view.traceTaskId).toBe("credentialing-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "credentialing-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The credentialing record could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = providerCredentialingViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
