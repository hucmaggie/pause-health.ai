import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TRANSITIONS_OF_CARE_PRESETS,
  buildTransitionsOfCareRequestBody,
  runTransitionsOfCareTask,
  transitionsOfCareViewFromTask
} from "./transitions-of-care-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_AWAITING_SCHEDULE_PATIENT,
  DEMO_TOC_PATIENT,
  assembleTransitionOfCare,
  followUpScheduledNotRecommended,
  medicationsTraceToApprovedSource,
  proposeMedicationChange
} from "../lib/transitions-of-care";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const pkg = assembleTransitionOfCare(DEMO_TOC_PATIENT);
  const proposal = proposeMedicationChange({
    medicationId: "med.metoprolol-25",
    changeKind: "dose-changed",
    rationale: "discharge reconciliation · dose-changed"
  });
  return {
    id: "toc-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "TransitionOfCarePackage",
        index: 0,
        parts: [{ type: "data", data: { result: { package: pkg, proposal } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.toc.reconciliation-source-integrity"],
        traceSpanId: "span-1",
        traceTaskId: "toc-abc",
        patientRef: pkg.patientRef,
        dischargeDate: pkg.dischargeDate,
        encounterKind: pkg.encounterKind,
        encounterReasonCategory: pkg.encounterReasonCategory,
        packageState: pkg.state,
        reconciliationLines: pkg.reconciliation.lines.length,
        reconciliationChanges: pkg.reconciliation.changes,
        followUpScheduled: pkg.followUp.scheduled,
        followUpAwaitingSchedule: pkg.followUp.awaitingSchedule,
        medicationsTraceToApprovedSource: true,
        reconciliationChangeRequiresClinician: true,
        followUpScheduledNotRecommended: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "toc-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this transitions-of-care run: policy.toc.follow-up-scheduled-not-recommended (fake schedule)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.toc.follow-up-scheduled-not-recommended"],
        violations: [
          {
            policyId: "policy.toc.follow-up-scheduled-not-recommended",
            reason: "no slotStart / providerRef"
          }
        ]
      }
    }
  };
}

describe("TRANSITIONS_OF_CARE_PRESETS", () => {
  it("has a scheduled-follow-up happy-path preset with catalog-sourced meds", () => {
    const preset = TRANSITIONS_OF_CARE_PRESETS.find((p) => p.id === "cardiovascular-scheduled");
    expect(preset).toBeDefined();
    const pkg = assembleTransitionOfCare(preset!.patient!);
    expect(pkg.followUp.scheduled).toBe(true);
    expect(medicationsTraceToApprovedSource({
      preAdmit: preset!.patient!.preAdmitMedications,
      discharge: preset!.patient!.dischargeMedications
    })).toBe(true);
    expect(followUpScheduledNotRecommended(pkg.followUp)).toBe(true);
  });

  it("has an awaiting-schedule preset (safe interim answer)", () => {
    const preset = TRANSITIONS_OF_CARE_PRESETS.find((p) => p.id === "behavioral-awaiting-schedule");
    expect(preset!.patient).toEqual(DEMO_AWAITING_SCHEDULE_PATIENT);
    const pkg = assembleTransitionOfCare(preset!.patient!);
    expect(pkg.state).toBe("awaiting-schedule");
    expect(pkg.followUp.awaitingSchedule).toBe(true);
  });

  it("has the three governance-block presets asserting an offending plan", () => {
    const verbal = TRANSITIONS_OF_CARE_PRESETS.find((p) => p.id === "verbal-source-block");
    expect(verbal!.patient!.dischargeMedications![0].source).toBe("verbal-not-documented");
    const auto = TRANSITIONS_OF_CARE_PRESETS.find((p) => p.id === "autonomous-med-change-block");
    expect(auto!.assertedProposals?.[0]).toMatchObject({
      requiresClinicianSignoff: false,
      applied: true
    });
    const fake = TRANSITIONS_OF_CARE_PRESETS.find((p) => p.id === "fake-schedule-block");
    expect(fake!.assertedFollowUpPlan).toEqual({
      scheduled: true,
      awaitingSchedule: false
    });
  });
});

describe("buildTransitionsOfCareRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a patient data part", () => {
    const body = buildTransitionsOfCareRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      patient: DEMO_TOC_PATIENT
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ patient: DEMO_TOC_PATIENT });
  });

  it("posts asserted proposals / followUpPlan under their data parts", () => {
    const body = buildTransitionsOfCareRequestBody({
      taskId: "task-block",
      assertedProposals: [
        {
          medicationId: "med.metoprolol-25",
          changeKind: "dose-changed",
          requiresClinicianSignoff: false,
          applied: true
        }
      ],
      assertedFollowUpPlan: { scheduled: true, awaitingSchedule: false }
    });
    expect(body.params.message.parts[0].data).toMatchObject({
      proposals: [{ applied: true }],
      followUpPlan: { scheduled: true }
    });
  });
});

describe("runTransitionsOfCareTask", () => {
  it("POSTs the A2A body to the TOC agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/transitions-of-care/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.patient.patientRef).toBe("toc-patient-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runTransitionsOfCareTask(
      { taskId: "task-1", patient: DEMO_TOC_PATIENT },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("toc-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runTransitionsOfCareTask(
        { taskId: "t", patient: DEMO_TOC_PATIENT },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("transitionsOfCareViewFromTask", () => {
  it("lifts a produced package with a scheduled follow-up + human-signoff gated proposal", () => {
    const view = transitionsOfCareViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.patientRef).toBe(DEMO_TOC_PATIENT.patientRef);
    expect(view.packageState).toBe("ready-for-clinician-signoff");
    expect(view.followUp.scheduled).toBe(true);
    expect(view.reconciliation.lines.length).toBeGreaterThan(0);
    expect(view.reconciliation.applied).toBe(false);
    expect(view.medicationsTraceToApprovedSource).toBe(true);
    expect(view.reconciliationChangeRequiresClinician).toBe(true);
    expect(view.followUpScheduledNotRecommended).toBe(true);
    expect(view.proposal?.requiresClinicianSignoff).toBe(true);
    expect(view.proposal?.applied).toBe(false);
    expect(view.traceTaskId).toBe("toc-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = transitionsOfCareViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this transitions-of-care run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.toc.follow-up-scheduled-not-recommended"
    );
    expect(view.policiesEvaluated).toContain(
      "policy.toc.follow-up-scheduled-not-recommended"
    );
    expect(view.traceTaskId).toBe("toc-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "toc-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [
            { type: "text", text: "The transitions-of-care package could not be produced." }
          ]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = transitionsOfCareViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
