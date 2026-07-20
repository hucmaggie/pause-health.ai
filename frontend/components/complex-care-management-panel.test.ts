import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COMPLEX_CARE_MANAGEMENT_PRESETS,
  buildComplexCareManagementRequestBody,
  complexCareManagementViewFromTask,
  runComplexCareManagementTask
} from "./complex-care-management-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_COMPLEX_PATIENT,
  DEMO_ELIGIBLE_PATIENT,
  DEMO_INELIGIBLE_PATIENT,
  assembleCcmMonthReport
} from "../lib/complex-care-management";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const report = assembleCcmMonthReport(DEMO_ELIGIBLE_PATIENT);
  return {
    id: "ccm-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "CcmMonthReport",
        index: 0,
        parts: [{ type: "data", data: { result: { report } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.ccm.eligibility-catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "ccm-abc",
        patientRef: report.patientRef,
        month: report.month,
        eligible: report.eligibility.eligible,
        totalMinutes: report.timeSummary.totalMinutes,
        cptCode: report.billingPackage?.cptCode ?? "NOT_BILLABLE",
        billingState: report.billingPackage?.state ?? "not-billable",
        eligibilityTracesToCatalog: true,
        billingRequiresHumanApproval: true,
        timeEntriesAddUp: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "ccm-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this CCM run: policy.ccm.time-integrity (phantom minutes)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.ccm.time-integrity"],
        violations: [
          {
            policyId: "policy.ccm.time-integrity",
            reason: "reported total exceeds sum of entries"
          }
        ]
      }
    }
  };
}

describe("COMPLEX_CARE_MANAGEMENT_PRESETS", () => {
  it("has a 99490 happy-path preset (35min, non-complex)", () => {
    const preset = COMPLEX_CARE_MANAGEMENT_PRESETS.find((p) => p.id === "non-complex-99490");
    expect(preset).toBeDefined();
    const r = assembleCcmMonthReport(preset!.context!);
    expect(r.billingPackage?.cptCode).toBe("99490");
  });

  it("has a 99487 complex preset (72min, moderate-or-high)", () => {
    const preset = COMPLEX_CARE_MANAGEMENT_PRESETS.find((p) => p.id === "complex-99487");
    expect(preset!.context).toEqual(DEMO_COMPLEX_PATIENT);
    const r = assembleCcmMonthReport(preset!.context!);
    expect(r.billingPackage?.cptCode).toBe("99487");
  });

  it("has an ineligible preset (under Medicare age)", () => {
    const preset = COMPLEX_CARE_MANAGEMENT_PRESETS.find((p) => p.id === "ineligible");
    expect(preset!.context).toEqual(DEMO_INELIGIBLE_PATIENT);
    const r = assembleCcmMonthReport(preset!.context!);
    expect(r.eligibility.eligible).toBe(false);
    expect(r.billingPackage).toBeNull();
  });

  it("has the three governance-block presets asserting offending overrides", () => {
    const offcat = COMPLEX_CARE_MANAGEMENT_PRESETS.find(
      (p) => p.id === "offcat-condition-block"
    );
    expect(offcat!.eligibilityOverride!.qualifyingConditions).toContain("condition.made-up");
    const auto = COMPLEX_CARE_MANAGEMENT_PRESETS.find((p) => p.id === "auto-submit-block");
    expect(auto!.billingOverride!.submitted).toBe(true);
    const phantom = COMPLEX_CARE_MANAGEMENT_PRESETS.find(
      (p) => p.id === "phantom-minutes-block"
    );
    expect(phantom!.timeSummaryOverride!.totalMinutes).toBe(60);
  });
});

describe("buildComplexCareManagementRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a context data part", () => {
    const body = buildComplexCareManagementRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      context: DEMO_ELIGIBLE_PATIENT
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ context: DEMO_ELIGIBLE_PATIENT });
  });

  it("posts asserted eligibility / billing / time overrides under their data parts", () => {
    const body = buildComplexCareManagementRequestBody({
      taskId: "task-block",
      context: DEMO_ELIGIBLE_PATIENT,
      timeSummaryOverride: {
        perActivity: [],
        totalMinutes: 60,
        everyActivityIsCatalogSourced: true
      }
    });
    expect(body.params.message.parts[0].data).toMatchObject({
      context: DEMO_ELIGIBLE_PATIENT,
      timeSummaryOverride: { totalMinutes: 60 }
    });
  });
});

describe("runComplexCareManagementTask", () => {
  it("POSTs the A2A body to the CCM agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/complex-care-management/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.context.patientRef).toBe(
        DEMO_ELIGIBLE_PATIENT.patientRef
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runComplexCareManagementTask(
      { taskId: "task-1", context: DEMO_ELIGIBLE_PATIENT },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("ccm-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runComplexCareManagementTask(
        { taskId: "t", context: DEMO_ELIGIBLE_PATIENT },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("complexCareManagementViewFromTask", () => {
  it("lifts a produced report with all signals true", () => {
    const view = complexCareManagementViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.report.billingPackage?.cptCode).toBe("99490");
    expect(view.eligibilityTracesToCatalog).toBe(true);
    expect(view.billingRequiresHumanApproval).toBe(true);
    expect(view.timeEntriesAddUp).toBe(true);
    expect(view.traceTaskId).toBe("ccm-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = complexCareManagementViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this CCM run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.ccm.time-integrity"
    );
    expect(view.traceTaskId).toBe("ccm-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "ccm-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [
            { type: "text", text: "The CCM month report could not be produced." }
          ]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = complexCareManagementViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
