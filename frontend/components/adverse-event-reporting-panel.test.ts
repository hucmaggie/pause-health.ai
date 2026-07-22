import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ADVERSE_EVENT_REPORTING_PRESETS,
  buildAdverseEventReportingRequestBody,
  runAdverseEventReportingTask,
  adverseEventReportingViewFromTask
} from "./adverse-event-reporting-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_AE_DEATH_LIFE_THREATENING,
  DEMO_AE_MEDWATCH_DRUG,
  DEMO_AE_NON_SERIOUS,
  DEMO_AE_UNVERIFIED_REPORTER,
  DEMO_AE_VAERS_VACCINE,
  evaluateAdverseEvent
} from "../lib/adverse-event-reporting";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const decision = evaluateAdverseEvent(DEMO_AE_MEDWATCH_DRUG);
  return {
    id: "ae-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "AdverseEventDecision",
        index: 0,
        parts: [{ type: "data", data: { result: { decision } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.adverse-event.event-catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "ae-abc",
        requestRef: decision.requestRef,
        patientRef: decision.patientRef,
        eventTypeId: decision.eventTypeId,
        seriousnessTierId: decision.seriousnessTierId,
        reporterType: decision.reporterType,
        adverseEventDecision: decision.decision,
        primaryReasonCode: decision.primaryReasonCode,
        routedTo: decision.routedTo,
        appliedRuleCount: decision.appliedRules.length,
        requiresRegulatoryTeamCosign: decision.requiresRegulatoryTeamCosign,
        eventsTraceToCatalog: true,
        submissionRequiresRegulatoryTeamCosign: true,
        reporterIdentityVerified: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "ae-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this adverse-event report: policy.adverse-event.reporter-verified"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.adverse-event.reporter-verified"],
        violations: [
          { policyId: "policy.adverse-event.reporter-verified", reason: "reporter not attested" }
        ]
      }
    }
  };
}

describe("ADVERSE_EVENT_REPORTING_PRESETS", () => {
  it("has a MedWatch draft preset", () => {
    const preset = ADVERSE_EVENT_REPORTING_PRESETS.find((p) => p.id === "medwatch-serious-drug");
    expect(preset).toBeDefined();
    const d = evaluateAdverseEvent(preset!.request!);
    expect(d.decision).toBe("draft-medwatch");
    expect(d.seriousnessTierId).toBe("seriousness.serious");
  });

  it("has VAERS + life-threatening + non-serious + unverified presets", () => {
    expect(
      ADVERSE_EVENT_REPORTING_PRESETS.find((p) => p.id === "vaers-vaccine")!.request
    ).toEqual(DEMO_AE_VAERS_VACCINE);
    expect(
      ADVERSE_EVENT_REPORTING_PRESETS.find((p) => p.id === "medwatch-life-threatening")!.request
    ).toEqual(DEMO_AE_DEATH_LIFE_THREATENING);
    expect(
      ADVERSE_EVENT_REPORTING_PRESETS.find((p) => p.id === "medwatch-non-serious")!.request
    ).toEqual(DEMO_AE_NON_SERIOUS);
    expect(
      ADVERSE_EVENT_REPORTING_PRESETS.find((p) => p.id === "blocked-unverified-reporter")!.request
    ).toEqual(DEMO_AE_UNVERIFIED_REPORTER);
  });

  it("has the three governance-block presets asserting offending overrides", () => {
    const off = ADVERSE_EVENT_REPORTING_PRESETS.find((p) => p.id === "offcat-event-block");
    expect(off!.decisionOverride!.eventTypeId).toBe("event.made-up");
    const auto = ADVERSE_EVENT_REPORTING_PRESETS.find((p) => p.id === "autonomous-cosign-block");
    expect(auto!.decisionOverride!.cosigned).toBe(true);
    const rep = ADVERSE_EVENT_REPORTING_PRESETS.find(
      (p) => p.id === "unverified-reporter-block"
    );
    expect(rep!.decisionOverride!.reporterIdentityVerified).toBe(false);
  });
});

describe("buildAdverseEventReportingRequestBody", () => {
  it("builds a JSON-RPC envelope with a request data part", () => {
    const body = buildAdverseEventReportingRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      request: DEMO_AE_MEDWATCH_DRUG
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.message.parts[0].data).toEqual({ request: DEMO_AE_MEDWATCH_DRUG });
  });
});

describe("runAdverseEventReportingTask", () => {
  it("POSTs the body and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("/api/agents/adverse-event-reporting/tasks");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });
    const out = await runAdverseEventReportingTask(
      { taskId: "task-1", request: DEMO_AE_MEDWATCH_DRUG },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("ae-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runAdverseEventReportingTask(
        { taskId: "t", request: DEMO_AE_MEDWATCH_DRUG },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("adverseEventReportingViewFromTask", () => {
  it("lifts a produced decision with all signals true", () => {
    const view = adverseEventReportingViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.decision.decision).toBe("draft-medwatch");
    expect(view.eventsTraceToCatalog).toBe(true);
    expect(view.submissionRequiresRegulatoryTeamCosign).toBe(true);
    expect(view.reporterIdentityVerified).toBe(true);
  });

  it("lifts a governance block", () => {
    const view = adverseEventReportingViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.adverse-event.reporter-verified"
    );
  });

  it("treats a failed non-block task as invalid", () => {
    const task: A2ATask = {
      id: "ae-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The adverse-event report could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = adverseEventReportingViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
