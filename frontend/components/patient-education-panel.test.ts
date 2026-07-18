import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PATIENT_EDUCATION_PRESETS,
  buildPatientEducationRequestBody,
  patientEducationViewFromTask,
  runPatientEducationTask
} from "./patient-education-panel";
import type { A2ATask } from "../lib/a2a";
import {
  buildEducationCurriculum,
  curriculumTracesToEvidenceSource,
  educationContextFromIntake,
  isCatalogModule,
  scriptedCoachEducation,
  type EducationCoachingResult,
  type EducationCurriculum
} from "../lib/patient-education";

/**
 * Unit coverage for the /demo/intake Patient Education agent panel — the FOURTH
 * live-Claude agent. This repo tests components as node-env pure functions (see
 * care-plan-panel.test.ts) rather than rendering them, so we exercise the exact
 * logic the panel invokes:
 *   - the JSON-RPC A2A body it POSTs to the Patient Education agent (both an
 *     intake and a caller-asserted curriculum),
 *   - that runPatientEducationTask returns the resulting task,
 *   - and that patientEducationViewFromTask lifts a curated curriculum +
 *     coaching (BOTH the claude-api and scripted-fallback cases) and a
 *     governance block into render-ready shapes.
 * The task fixtures mirror the shapes app/api/agents/patient-education actually
 * returns (see that route + lib/patient-education).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE_CURRICULUM: EducationCurriculum = buildEducationCurriculum(
  educationContextFromIntake({
    preferredName: "Ada",
    ageBand: "45-49",
    cycleStatus: "perimenopausal",
    primarySymptom: "vasomotor",
    severity: "moderate"
  })
);

function completedTask(opts?: {
  curriculum?: EducationCurriculum;
  coaching?: Partial<EducationCoachingResult>;
}): A2ATask {
  const curriculum = opts?.curriculum ?? BASE_CURRICULUM;
  const coaching: EducationCoachingResult = {
    coachingMessage: scriptedCoachEducation(curriculum),
    moduleIds: curriculum.moduleIds,
    via: "scripted-fallback",
    modelProvenance: {
      provider: "pause-scripted",
      model: "pause-patient-education-coach@1.0",
      via: "scripted-fallback"
    },
    fallbackReason:
      "ANTHROPIC_API_KEY not set; using deterministic Pause patient-education coach.",
    synthetic: true,
    ...(opts?.coaching ?? {})
  };
  return {
    id: "patiented-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "PatientEducation",
        index: 0,
        parts: [{ type: "data", data: { curriculum, coaching } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: [
          "policy.education.evidence-sourced",
          "policy.model.anthropic-claude-sonnet-allowlisted"
        ],
        traceSpanId: "span-1",
        traceTaskId: "patiented-abc",
        modulesSelected: curriculum.moduleIds.length,
        educationTracesToEvidenceSource: true,
        coachingVia: coaching.via,
        ...(coaching.fallbackReason ? { fallbackReason: coaching.fallbackReason } : {})
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "patiented-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this patient-education task: policy.education.evidence-sourced (off-catalog topic)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.education.evidence-sourced"],
        violations: [
          {
            policyId: "policy.education.evidence-sourced",
            reason: "module does not trace to a defined evidence source"
          }
        ]
      }
    }
  };
}

describe("PATIENT_EDUCATION_PRESETS", () => {
  it("curates an evidence-sourced curriculum for each intake preset", () => {
    const intakePresets = PATIENT_EDUCATION_PRESETS.filter((p) => p.intake);
    expect(intakePresets.length).toBeGreaterThanOrEqual(3);
    for (const preset of intakePresets) {
      const curriculum = buildEducationCurriculum(
        educationContextFromIntake(preset.intake!, {
          onHrt: preset.onHrt,
          carePlanFocusAreas: preset.carePlanFocusAreas,
          careGapMeasures: preset.careGapMeasures
        })
      );
      expect(curriculumTracesToEvidenceSource(curriculum)).toBe(true);
    }
  });

  it("steers a postmenopausal + care-gap preset to bone + cardiovascular education", () => {
    const preset = PATIENT_EDUCATION_PRESETS.find(
      (p) => p.id === "postmenopausal-prevention"
    );
    expect(preset).toBeDefined();
    const curriculum = buildEducationCurriculum(
      educationContextFromIntake(preset!.intake!, {
        careGapMeasures: preset!.careGapMeasures
      })
    );
    expect(curriculum.moduleIds).toContain("education.bone-health");
    expect(curriculum.moduleIds).toContain("education.cardiovascular");
  });

  it("has an off-catalog preset whose asserted curriculum is NOT evidence-sourced", () => {
    const preset = PATIENT_EDUCATION_PRESETS.find((p) => p.id === "off-catalog-block");
    expect(preset).toBeDefined();
    expect(preset!.assertedCurriculum).toBeDefined();
    expect(preset!.intake).toBeUndefined();
    const modules = preset!.assertedCurriculum!.modules as { id: string }[];
    expect(isCatalogModule(modules[0].id)).toBe(false);
  });

  it("has scope + consent block presets that set the trip flags", () => {
    const scope = PATIENT_EDUCATION_PRESETS.find((p) => p.id === "medical-advice-block");
    expect(scope?.deliversMedicalAdvice).toBe(true);
    const consent = PATIENT_EDUCATION_PRESETS.find((p) => p.id === "no-consent-block");
    expect(consent?.hasCoachingConsent).toBe(false);
  });
});

describe("buildPatientEducationRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with an intake data part", () => {
    const intake = { preferredName: "Ada", primarySymptom: "vasomotor" };
    const body = buildPatientEducationRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      intake,
      careGapMeasures: ["DEXA bone-density"]
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({
      intake,
      careGapMeasures: ["DEXA bone-density"]
    });
  });

  it("posts a caller-asserted curriculum under a `curriculum` data part", () => {
    const curriculum = { moduleIds: ["education.totally-invented"] };
    const body = buildPatientEducationRequestBody({
      taskId: "task-block",
      assertedCurriculum: curriculum
    });
    expect(body.params.message.parts[0].data).toEqual({ curriculum });
  });

  it("passes the scope + consent trip flags through to the data part", () => {
    const body = buildPatientEducationRequestBody({
      taskId: "t",
      intake: { primarySymptom: "vasomotor" },
      deliversMedicalAdvice: true,
      hasCoachingConsent: false
    });
    expect(body.params.message.parts[0].data).toMatchObject({
      deliversMedicalAdvice: true,
      hasCoachingConsent: false
    });
  });
});

describe("runPatientEducationTask", () => {
  it("POSTs the A2A body to the Patient Education agent and returns the task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/patient-education/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.intake.primarySymptom).toBe("vasomotor");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runPatientEducationTask(
      { taskId: "task-1", intake: { primarySymptom: "vasomotor" } },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("patiented-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runPatientEducationTask(
        { taskId: "t", intake: {} },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("patientEducationViewFromTask", () => {
  it("lifts a curated curriculum with modules, focus areas, and evidence trace", () => {
    const view = patientEducationViewFromTask(completedTask());
    expect(view.kind).toBe("curated");
    if (view.kind !== "curated") return;
    expect(view.moduleIds).toContain("education.vasomotor");
    expect(view.modules.length).toBeGreaterThan(0);
    expect(view.focusAreas.length).toBeGreaterThan(0);
    expect(view.educationTracesToEvidenceSource).toBe(true);
    expect(view.traceTaskId).toBe("patiented-abc");
  });

  it("renders the scripted-fallback case with via + fallbackReason", () => {
    const view = patientEducationViewFromTask(completedTask());
    expect(view.kind).toBe("curated");
    if (view.kind !== "curated") return;
    expect(view.via).toBe("scripted-fallback");
    expect(view.modelProvider).toBe("pause-scripted");
    expect(view.fallbackReason).toMatch(/ANTHROPIC_API_KEY not set/);
    expect(view.coachingMessage).toMatch(/does not diagnose/i);
  });

  it("renders the live claude-api case with no fallbackReason", () => {
    const view = patientEducationViewFromTask(
      completedTask({
        coaching: {
          coachingMessage: "Ada, small steady habits go a long way.",
          via: "claude-api",
          modelProvenance: {
            provider: "anthropic",
            model: "claude-sonnet-4-5-20250929",
            via: "claude-api"
          },
          fallbackReason: undefined
        }
      })
    );
    expect(view.kind).toBe("curated");
    if (view.kind !== "curated") return;
    expect(view.via).toBe("claude-api");
    expect(view.modelProvider).toBe("anthropic");
    expect(view.model).toBe("claude-sonnet-4-5-20250929");
    expect(view.fallbackReason).toBeUndefined();
    expect(view.coachingMessage).toBe("Ada, small steady habits go a long way.");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = patientEducationViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this patient-education task/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.education.evidence-sourced"
    );
    expect(view.policiesEvaluated).toContain("policy.education.evidence-sourced");
    expect(view.traceTaskId).toBe("patiented-block");
  });

  it("treats a failed non-block task as an invalid (not-curated) result", () => {
    const task: A2ATask = {
      id: "patiented-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The education curriculum could not be curated." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = patientEducationViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be curated/);
  });
});
