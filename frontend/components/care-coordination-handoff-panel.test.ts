import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CARE_COORDINATION_HANDOFF_PRESETS,
  buildCareCoordinationHandoffRequestBody,
  runCareCoordinationHandoffTask,
  careCoordinationHandoffViewFromTask
} from "./care-coordination-handoff-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_HANDOFF_ACCEPTED,
  DEMO_HANDOFF_ED_TO_PCP,
  DEMO_HANDOFF_NO_CONSENT,
  DEMO_HANDOFF_SBAR_INCOMPLETE,
  DEMO_HANDOFF_UNCREDENTIALED,
  evaluateHandoff
} from "../lib/care-coordination-handoff";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const decision = evaluateHandoff(DEMO_HANDOFF_ACCEPTED);
  return {
    id: "ho-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "HandoffDecision",
        index: 0,
        parts: [{ type: "data", data: { result: { decision } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.handoff.sbar-completeness"],
        traceSpanId: "span-1",
        traceTaskId: "ho-abc",
        requestRef: decision.requestRef,
        patientRef: decision.patientRef,
        transitionTypeId: decision.transitionTypeId,
        receivingClinicianRef: decision.receivingClinicianRef,
        handoffDecision: decision.decision,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        missingSbarCount: decision.missingSbarSections.length,
        appliedRuleCount: decision.appliedRules.length,
        requiresReceivingClinicianCosign: decision.requiresReceivingClinicianCosign,
        sbarIsComplete: true,
        receivingClinicianIsCredentialed: true,
        handoffHasConsent: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "ho-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this handoff: policy.handoff.consent-on-file"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.handoff.consent-on-file"],
        violations: [
          { policyId: "policy.handoff.consent-on-file", reason: "no transfer consent" }
        ]
      }
    }
  };
}

describe("CARE_COORDINATION_HANDOFF_PRESETS", () => {
  it("has a handoff-accepted preset that clean-accepts", () => {
    const preset = CARE_COORDINATION_HANDOFF_PRESETS.find(
      (p) => p.id === "handoff-accepted"
    );
    expect(preset).toBeDefined();
    const d = evaluateHandoff(preset!.request!);
    expect(d.decision).toBe("handoff-accepted");
  });

  it("has pend + block + ED→PCP presets", () => {
    expect(
      CARE_COORDINATION_HANDOFF_PRESETS.find((p) => p.id === "pend-sbar-incomplete")!.request
    ).toEqual(DEMO_HANDOFF_SBAR_INCOMPLETE);
    expect(
      CARE_COORDINATION_HANDOFF_PRESETS.find((p) => p.id === "blocked-uncredentialed")!.request
    ).toEqual(DEMO_HANDOFF_UNCREDENTIALED);
    expect(
      CARE_COORDINATION_HANDOFF_PRESETS.find((p) => p.id === "blocked-no-consent")!.request
    ).toEqual(DEMO_HANDOFF_NO_CONSENT);
    expect(
      CARE_COORDINATION_HANDOFF_PRESETS.find((p) => p.id === "handoff-ed-pcp")!.request
    ).toEqual(DEMO_HANDOFF_ED_TO_PCP);
  });

  it("has the three governance-block presets asserting offending overrides", () => {
    const sbar = CARE_COORDINATION_HANDOFF_PRESETS.find(
      (p) => p.id === "sbar-completeness-block"
    );
    expect(sbar!.decisionOverride!.missingSbarSections).toEqual(["recommendation"]);
    const cred = CARE_COORDINATION_HANDOFF_PRESETS.find((p) => p.id === "uncredentialed-block");
    expect(cred!.decisionOverride!.receivingClinicianCredentialing).toBe("expired");
    const nc = CARE_COORDINATION_HANDOFF_PRESETS.find((p) => p.id === "no-consent-block");
    expect(nc!.decisionOverride!.decision).toBe("handoff-accepted");
    expect(nc!.request!.transferConsentOnFile).toBe(false);
  });
});

describe("buildCareCoordinationHandoffRequestBody", () => {
  it("builds a JSON-RPC envelope with a request data part", () => {
    const body = buildCareCoordinationHandoffRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_HANDOFF_ACCEPTED
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.message.parts[0].data).toEqual({ request: DEMO_HANDOFF_ACCEPTED });
  });
});

describe("runCareCoordinationHandoffTask", () => {
  it("POSTs the body and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("/api/agents/care-coordination-handoff/tasks");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });
    const out = await runCareCoordinationHandoffTask(
      { taskId: "task-1", request: DEMO_HANDOFF_ACCEPTED },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("ho-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runCareCoordinationHandoffTask(
        { taskId: "t", request: DEMO_HANDOFF_ACCEPTED },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("careCoordinationHandoffViewFromTask", () => {
  it("lifts a produced decision with all signals true", () => {
    const view = careCoordinationHandoffViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.decision.decision).toBe("handoff-accepted");
    expect(view.sbarIsComplete).toBe(true);
    expect(view.receivingClinicianIsCredentialed).toBe(true);
    expect(view.handoffHasConsent).toBe(true);
  });

  it("lifts a governance block", () => {
    const view = careCoordinationHandoffViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.handoff.consent-on-file"
    );
  });

  it("treats a failed non-block task as invalid", () => {
    const task: A2ATask = {
      id: "ho-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The handoff could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = careCoordinationHandoffViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
