import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ADVANCE_CARE_PLANNING_PRESETS,
  advanceCarePlanningViewFromTask,
  buildAdvanceCarePlanningRequestBody,
  runAdvanceCarePlanningTask
} from "./advance-care-planning-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_ACP_PATIENT,
  DEMO_LEP_ACP_PATIENT,
  assessAdvanceCarePlanning,
  directivesTraceToCatalog,
  proposeDirectiveChange
} from "../lib/advance-care-planning";

/**
 * Unit coverage for the /demo/intake Advance Care Planning panel. This repo
 * tests components as node-env pure functions rather than rendering them, so
 * we exercise the exact logic the panel invokes: the JSON-RPC A2A body it
 * POSTs, that runAdvanceCarePlanningTask returns the resulting task, and that
 * advanceCarePlanningViewFromTask lifts an assessment and a governance block
 * into render-ready shapes.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const assessment = assessAdvanceCarePlanning(DEMO_ACP_PATIENT);
  const proposal = proposeDirectiveChange({
    directiveId: "directive.living-will",
    proposedChange: "hold a midlife-touchpoint conversation to consider executing a living will"
  });
  return {
    id: "acp-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "AcpAssessment",
        index: 0,
        parts: [{ type: "data", data: { result: { assessment, proposal } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.acp.directive-source-integrity"],
        traceSpanId: "span-1",
        traceTaskId: "acp-abc",
        patientRef: assessment.patientRef,
        asOfDate: assessment.asOfDate,
        preferredLanguageCode: assessment.preferredLanguageCode,
        qualifiedInterpreterPlanned: assessment.qualifiedInterpreterPlanned,
        conversationPromptState: assessment.conversationPrompt.state,
        completeness: assessment.completeness,
        flagCount: assessment.flags.length,
        directivesTraceToCatalog: true,
        directiveChangeRequiresHumanSignoff: true,
        languageAccessSatisfied: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "acp-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this advance-care-planning run: policy.acp.directive-source-integrity (verbal source)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.acp.directive-source-integrity"],
        violations: [
          {
            policyId: "policy.acp.directive-source-integrity",
            reason: "verbal-not-documented is not an approved directive source"
          }
        ]
      }
    }
  };
}

describe("ADVANCE_CARE_PLANNING_PRESETS", () => {
  it("has an English happy-path preset that drafts an actionable prompt with catalog-sourced directives", () => {
    const preset = ADVANCE_CARE_PLANNING_PRESETS.find((p) => p.id === "english-happy-path");
    expect(preset).toBeDefined();
    const a = assessAdvanceCarePlanning(preset!.patient!);
    expect(a.conversationPrompt.state).toBe("drafted");
    expect(directivesTraceToCatalog(preset!.patient!.directivesOnFile!)).toBe(true);
  });

  it("has an LEP-withheld preset (safe answer, not a block)", () => {
    const preset = ADVANCE_CARE_PLANNING_PRESETS.find((p) => p.id === "lep-withheld");
    expect(preset).toBeDefined();
    expect(preset!.patient).toEqual(DEMO_LEP_ACP_PATIENT);
    const a = assessAdvanceCarePlanning(preset!.patient!);
    expect(a.conversationPrompt.state).toBe("withheld-language-access-required");
    expect(a.conversationPrompt.actionable).toBe(false);
  });

  it("has the three governance-block presets asserting an offending plan", () => {
    const verbal = ADVANCE_CARE_PLANNING_PRESETS.find((p) => p.id === "verbal-source-block");
    expect(
      directivesTraceToCatalog(
        verbal!.assertedOnFile as Array<{
          directiveId?: string;
          source?: string;
          executedDate?: string;
        }>
      )
    ).toBe(false);
    const auto = ADVANCE_CARE_PLANNING_PRESETS.find((p) => p.id === "auto-apply-block");
    expect(auto!.assertedProposals?.[0]).toMatchObject({ applied: true });
    const lepActive = ADVANCE_CARE_PLANNING_PRESETS.find((p) => p.id === "lep-active-block");
    expect(lepActive!.assertedPlan).toMatchObject({
      preferredLanguageCode: "es",
      qualifiedInterpreterPlanned: false,
      conversationPromptState: "drafted"
    });
  });
});

describe("buildAdvanceCarePlanningRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a patient data part", () => {
    const body = buildAdvanceCarePlanningRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      patient: DEMO_ACP_PATIENT
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ patient: DEMO_ACP_PATIENT });
  });

  it("posts asserted onFile / proposals / plan under their data parts", () => {
    const body = buildAdvanceCarePlanningRequestBody({
      taskId: "task-block",
      assertedOnFile: [
        {
          directiveId: "directive.dpoahc",
          source: "verbal-not-documented",
          executedDate: "2024-01-01"
        }
      ],
      assertedProposals: [
        {
          directiveId: "directive.living-will",
          proposedChange: "auto-execute",
          requiresClinicianAndPatientSignoff: false,
          applied: true
        }
      ],
      assertedPlan: {
        preferredLanguageCode: "es",
        qualifiedInterpreterPlanned: false,
        conversationPromptState: "drafted"
      }
    });
    expect(body.params.message.parts[0].data).toMatchObject({
      onFile: [{ source: "verbal-not-documented" }],
      proposal: [{ applied: true }],
      plan: { preferredLanguageCode: "es" }
    });
  });
});

describe("runAdvanceCarePlanningTask", () => {
  it("POSTs the A2A body to the ACP agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/advance-care-planning/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.patient.patientRef).toBe("acp-patient-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runAdvanceCarePlanningTask(
      { taskId: "task-1", patient: DEMO_ACP_PATIENT },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("acp-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runAdvanceCarePlanningTask(
        { taskId: "t", patient: DEMO_ACP_PATIENT },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("advanceCarePlanningViewFromTask", () => {
  it("lifts a produced assessment with an actionable prompt + a human-signoff-gated proposal", () => {
    const view = advanceCarePlanningViewFromTask(completedTask());
    expect(view.kind).toBe("assessed");
    if (view.kind !== "assessed") return;
    expect(view.patientRef).toBe(DEMO_ACP_PATIENT.patientRef);
    expect(view.conversationPrompt.state).toBe("drafted");
    expect(view.conversationPrompt.actionable).toBe(true);
    expect(view.proposal?.requiresClinicianAndPatientSignoff).toBe(true);
    expect(view.proposal?.applied).toBe(false);
    expect(view.directivesTraceToCatalog).toBe(true);
    expect(view.directiveChangeRequiresHumanSignoff).toBe(true);
    expect(view.languageAccessSatisfied).toBe(true);
    expect(view.traceTaskId).toBe("acp-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = advanceCarePlanningViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this advance-care-planning run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.acp.directive-source-integrity"
    );
    expect(view.policiesEvaluated).toContain("policy.acp.directive-source-integrity");
    expect(view.traceTaskId).toBe("acp-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "acp-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The advance-care-planning assessment could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = advanceCarePlanningViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
