import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LANGUAGE_ACCESS_PRESETS,
  buildLanguageAccessRequestBody,
  languageAccessViewFromTask,
  runLanguageAccessTask
} from "./language-access-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_EQUITY_GAP_PATIENT,
  DEMO_LANGUAGE_PATIENT,
  arrangeInterpreter,
  assessLanguageAccess,
  materialsTraceToApprovedSource
} from "../lib/language-access";

/**
 * Unit coverage for the /demo/intake Language Access agent panel. This repo
 * tests components as node-env pure functions (see clinical-trials-panel.test.ts)
 * rather than rendering them, so we exercise the exact logic the panel invokes:
 * the JSON-RPC A2A body it POSTs, that runLanguageAccessTask returns the
 * resulting task, and that languageAccessViewFromTask lifts an assessment and a
 * governance block into render-ready shapes. The task fixtures mirror the shapes
 * app/api/agents/language-access actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(patientRef = "langaccess-patient-001"): A2ATask {
  const assessment = assessLanguageAccess(DEMO_LANGUAGE_PATIENT);
  const interpreterRequest = arrangeInterpreter(assessment);
  return {
    id: "langaccess-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "LanguageAccessAssessment",
        index: 0,
        parts: [{ type: "data", data: { result: { assessment, interpreterRequest } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.langaccess.qualified-interpreter-only"],
        traceSpanId: "span-1",
        traceTaskId: "langaccess-abc",
        preferredLanguageCode: assessment.preferredLanguage.code,
        interpreterNeeded: assessment.interpreterNeeded,
        qualifiedInterpreterAvailable: assessment.qualifiedInterpreterAvailable,
        recommendedModality: assessment.recommendedModality,
        interpreterState: interpreterRequest.state,
        equityGapCount: assessment.equityGaps.length,
        usesQualifiedInterpreter: true,
        materialsTraceToApprovedSource: true,
        noMachineTranslationForConsent: true,
        patientRef
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "langaccess-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this language-access run: policy.langaccess.qualified-interpreter-only (family interpreter)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.langaccess.qualified-interpreter-only"],
        violations: [
          {
            policyId: "policy.langaccess.qualified-interpreter-only",
            reason: "unqualified interpreter for clinical use"
          }
        ]
      }
    }
  };
}

describe("LANGUAGE_ACCESS_PRESETS", () => {
  it("has a Spanish happy-path preset with a qualified video interpreter + full materials", () => {
    const preset = LANGUAGE_ACCESS_PRESETS.find((p) => p.id === "spanish-qualified");
    expect(preset).toBeDefined();
    const a = assessLanguageAccess(preset!.patient!);
    expect(a.qualifiedInterpreterAvailable).toBe(true);
    expect(a.recommendedModality).toBe("video");
    expect(a.equityGaps).toHaveLength(0);
    expect(materialsTraceToApprovedSource(a.materialsInLanguage)).toBe(true);
  });

  it("has an equity-gap preset that escalates (no qualified interpreter, not a block)", () => {
    const preset = LANGUAGE_ACCESS_PRESETS.find((p) => p.id === "equity-gap-escalation");
    expect(preset).toBeDefined();
    expect(preset!.patient).toEqual(DEMO_EQUITY_GAP_PATIENT);
    const a = assessLanguageAccess(preset!.patient!);
    expect(a.qualifiedInterpreterAvailable).toBe(false);
    expect(arrangeInterpreter(a).state).toBe("equity-gap-escalation");
    expect(a.equityGaps.length).toBeGreaterThan(0);
  });

  it("has the three governance-block presets asserting an offending plan / material", () => {
    const family = LANGUAGE_ACCESS_PRESETS.find((p) => p.id === "family-interpreter-block");
    expect(family!.assertedInterpreterPlan).toMatchObject({ interpreterType: "family" });
    const material = LANGUAGE_ACCESS_PRESETS.find(
      (p) => p.id === "unapproved-translation-block"
    );
    expect(
      materialsTraceToApprovedSource(
        material!.assertedMaterials as Array<{
          materialId: string;
          languageCode: string;
          available: boolean;
        }>
      )
    ).toBe(false);
    const machine = LANGUAGE_ACCESS_PRESETS.find((p) => p.id === "machine-consent-block");
    expect(machine!.assertedConsentPlan).toMatchObject({
      translationMethod: "machine-translation",
      forClinicalConsent: true
    });
  });
});

describe("buildLanguageAccessRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a patient data part", () => {
    const body = buildLanguageAccessRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      patient: DEMO_LANGUAGE_PATIENT
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ patient: DEMO_LANGUAGE_PATIENT });
  });

  it("posts asserted interpreter plan / materials / consent plan under their data parts", () => {
    const body = buildLanguageAccessRequestBody({
      taskId: "task-block",
      assertedInterpreterPlan: { interpreterType: "family" },
      assertedMaterials: [{ materialId: "m", languageCode: "vi", available: true }],
      assertedConsentPlan: { translationMethod: "machine-translation" }
    });
    expect(body.params.message.parts[0].data).toEqual({
      interpreterPlan: { interpreterType: "family" },
      materials: [{ materialId: "m", languageCode: "vi", available: true }],
      consentPlan: { translationMethod: "machine-translation" }
    });
  });
});

describe("runLanguageAccessTask", () => {
  it("POSTs the A2A body to the language-access agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/language-access/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.patient.preferredLanguageCode).toBe("es");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runLanguageAccessTask(
      { taskId: "task-1", patient: DEMO_LANGUAGE_PATIENT },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("langaccess-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runLanguageAccessTask(
        { taskId: "t", patient: DEMO_LANGUAGE_PATIENT },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("languageAccessViewFromTask", () => {
  it("lifts a produced assessment with a qualified interpreter + in-language materials", () => {
    const view = languageAccessViewFromTask(completedTask());
    expect(view.kind).toBe("assessed");
    if (view.kind !== "assessed") return;
    expect(view.preferredLanguage?.code).toBe("es");
    expect(view.interpreterNeeded).toBe(true);
    expect(view.qualifiedInterpreterAvailable).toBe(true);
    expect(view.interpreterRequest?.state).toBe("arranged");
    expect(view.materialsInLanguage.length).toBeGreaterThan(0);
    expect(view.equityGaps).toHaveLength(0);
    expect(view.usesQualifiedInterpreter).toBe(true);
    expect(view.materialsTraceToApprovedSource).toBe(true);
    expect(view.noMachineTranslationForConsent).toBe(true);
    expect(view.traceTaskId).toBe("langaccess-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = languageAccessViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this language-access run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.langaccess.qualified-interpreter-only"
    );
    expect(view.policiesEvaluated).toContain("policy.langaccess.qualified-interpreter-only");
    expect(view.traceTaskId).toBe("langaccess-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "langaccess-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The language-access assessment could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = languageAccessViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
