import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DATA_SHARING_TEFCA_PRESETS,
  buildDataSharingTefcaRequestBody,
  runDataSharingTefcaTask,
  dataSharingTefcaViewFromTask
} from "./data-sharing-tefca-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_DS_NON_TPO_CONSENTED,
  DEMO_DS_NON_TPO_NO_CONSENT,
  DEMO_DS_PATIENT_ACCESS,
  DEMO_DS_TPO_TREATMENT,
  DEMO_DS_UNVERIFIED_PARTICIPANT,
  evaluateDataSharing
} from "../lib/data-sharing-tefca";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const decision = evaluateDataSharing(DEMO_DS_TPO_TREATMENT);
  return {
    id: "ds-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "DataSharingDecision",
        index: 0,
        parts: [{ type: "data", data: { result: { decision } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.data-sharing.purpose-catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "ds-abc",
        requestRef: decision.requestRef,
        patientRef: decision.patientRef,
        requesterRef: decision.requesterRef,
        networkId: decision.networkId,
        purposeId: decision.purposeId,
        dataSharingDecision: decision.decision,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        isTpo: decision.isTpo,
        appliedRuleCount: decision.appliedRules.length,
        requiresPrivacyOfficerCosign: decision.requiresPrivacyOfficerCosign,
        purposesTraceToCatalog: true,
        releaseHonorsNonTpoConsent: true,
        participantIdentityVerified: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "ds-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this data-sharing exchange: policy.data-sharing.no-autonomous-non-tpo-release"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.data-sharing.no-autonomous-non-tpo-release"],
        violations: [
          {
            policyId: "policy.data-sharing.no-autonomous-non-tpo-release",
            reason: "non-TPO release without consent"
          }
        ]
      }
    }
  };
}

describe("DATA_SHARING_TEFCA_PRESETS", () => {
  it("has a TPO release preset", () => {
    const preset = DATA_SHARING_TEFCA_PRESETS.find((p) => p.id === "release-tpo-treatment");
    expect(preset).toBeDefined();
    const d = evaluateDataSharing(preset!.request!);
    expect(d.decision).toBe("release-authorized");
    expect(d.isTpo).toBe(true);
  });

  it("has non-TPO consented + no-consent + unverified + patient-access presets", () => {
    expect(
      DATA_SHARING_TEFCA_PRESETS.find((p) => p.id === "release-non-tpo-consented")!.request
    ).toEqual(DEMO_DS_NON_TPO_CONSENTED);
    expect(
      DATA_SHARING_TEFCA_PRESETS.find((p) => p.id === "blocked-non-tpo-no-consent")!.request
    ).toEqual(DEMO_DS_NON_TPO_NO_CONSENT);
    expect(
      DATA_SHARING_TEFCA_PRESETS.find((p) => p.id === "blocked-unverified-participant")!.request
    ).toEqual(DEMO_DS_UNVERIFIED_PARTICIPANT);
    expect(
      DATA_SHARING_TEFCA_PRESETS.find((p) => p.id === "release-patient-access")!.request
    ).toEqual(DEMO_DS_PATIENT_ACCESS);
  });

  it("has the three governance-block presets asserting offending overrides", () => {
    const off = DATA_SHARING_TEFCA_PRESETS.find((p) => p.id === "offcat-purpose-block");
    expect(off!.decisionOverride!.purposeId).toBe("purpose.made-up");
    const rel = DATA_SHARING_TEFCA_PRESETS.find((p) => p.id === "non-tpo-release-lie-block");
    expect(rel!.decisionOverride!.decision).toBe("release-authorized");
    expect(rel!.decisionOverride!.isTpo).toBe(false);
    expect(rel!.decisionOverride!.consentedPurposeIds).toEqual([]);
    const par = DATA_SHARING_TEFCA_PRESETS.find(
      (p) => p.id === "unverified-participant-lie-block"
    );
    expect(par!.decisionOverride!.requesterIdentityVerified).toBe(false);
  });
});

describe("buildDataSharingTefcaRequestBody", () => {
  it("builds a JSON-RPC envelope with a request data part", () => {
    const body = buildDataSharingTefcaRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_DS_TPO_TREATMENT
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.message.parts[0].data).toEqual({ request: DEMO_DS_TPO_TREATMENT });
  });
});

describe("runDataSharingTefcaTask", () => {
  it("POSTs the body and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("/api/agents/data-sharing-tefca/tasks");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });
    const out = await runDataSharingTefcaTask(
      { taskId: "task-1", request: DEMO_DS_TPO_TREATMENT },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("ds-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runDataSharingTefcaTask(
        { taskId: "t", request: DEMO_DS_TPO_TREATMENT },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("dataSharingTefcaViewFromTask", () => {
  it("lifts a produced decision with all signals true", () => {
    const view = dataSharingTefcaViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.decision.decision).toBe("release-authorized");
    expect(view.purposesTraceToCatalog).toBe(true);
    expect(view.releaseHonorsNonTpoConsent).toBe(true);
    expect(view.participantIdentityVerified).toBe(true);
  });

  it("lifts a governance block", () => {
    const view = dataSharingTefcaViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.data-sharing.no-autonomous-non-tpo-release"
    );
  });

  it("treats a failed non-block task as invalid", () => {
    const task: A2ATask = {
      id: "ds-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The data-sharing decision could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = dataSharingTefcaViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
