import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ASSESSMENT_PRESETS,
  assessmentViewFromTask,
  buildAssessmentRequestBody,
  carryIntoCareRouter,
  runAssessmentTask
} from "./assessment-panel";
import type { A2ATask } from "../lib/a2a";
import {
  ALLOWLISTED_INSTRUMENTS,
  getInstrumentSpec,
  isAllowlistedInstrument,
  type AssessmentInstrument
} from "../lib/assessments";

/**
 * Unit coverage for the /demo/intake Assessment agent panel. This repo
 * tests components as node-env pure functions (see
 * chat-to-care-router-handoff.test.ts) rather than rendering them, so we
 * exercise the exact logic the panel invokes:
 *   - the JSON-RPC A2A body it POSTs to the Assessment agent,
 *   - that runAssessmentTask returns the resulting task,
 *   - and that assessmentViewFromTask lifts a scored result, a red-flag
 *     escalation, and a governance block into render-ready shapes.
 * The task fixtures mirror the shapes app/api/agents/assessment/tasks
 * actually returns (see that route's tests).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(overrides?: {
  result?: Record<string, unknown>;
  intakeSignal?: Record<string, unknown>;
  intakeSeverity?: string;
}): A2ATask {
  const result = {
    instrument: "phq-9",
    instrumentName: "Patient Health Questionnaire-9 (PHQ-9)",
    total: 11,
    maxTotal: 27,
    subscores: [],
    severityBand: "moderate",
    normalizedSeverity: "moderate",
    redFlags: [],
    interpretation: "PHQ-9: 11/27 (moderate); ...",
    ...(overrides?.result ?? {})
  };
  const intakeSignal = {
    severity: "moderate",
    redFlagsAcknowledged: "no",
    ...(overrides?.intakeSignal ?? {})
  };
  return {
    id: "assessment-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "AssessmentResult",
        index: 0,
        parts: [{ type: "data", data: { result, intakeSignal } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.assessment.validated-instrument-only"],
        traceSpanId: "span-1",
        traceTaskId: "assessment-abc",
        intakeSeverity: overrides?.intakeSeverity ?? intakeSignal.severity,
        nextAgent: "agentforce-intake"
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "assessment-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this assessment: policy.assessment.validated-instrument-only (off allow-list)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: [
          "policy.assessment.validated-instrument-only",
          "policy.phi.no-free-text-pii"
        ],
        violations: [
          {
            policyId: "policy.assessment.validated-instrument-only",
            reason: "off allow-list"
          }
        ]
      }
    }
  };
}

describe("ASSESSMENT_PRESETS", () => {
  it("sends valid response vectors of the right length for allow-listed presets", () => {
    for (const preset of ASSESSMENT_PRESETS) {
      if (!isAllowlistedInstrument(preset.instrument)) continue;
      const spec = getInstrumentSpec(preset.instrument as AssessmentInstrument);
      expect(preset.responses).toHaveLength(spec.itemCount);
      for (const v of preset.responses) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(spec.itemMax);
      }
    }
  });

  it("includes an off-allow-list preset so the governance block is demonstrable", () => {
    const offList = ASSESSMENT_PRESETS.filter(
      (p) => !ALLOWLISTED_INSTRUMENTS.includes(p.instrument as AssessmentInstrument)
    );
    expect(offList.length).toBeGreaterThan(0);
    expect(offList.some((p) => p.instrument === "gad-7")).toBe(true);
  });

  it("has a PHQ-9 preset that endorses item 9 (the red-flag item)", () => {
    const redFlag = ASSESSMENT_PRESETS.find((p) => p.id === "phq9-red-flag");
    expect(redFlag).toBeDefined();
    expect(redFlag!.instrument).toBe("phq-9");
    expect(redFlag!.responses[8]).toBeGreaterThan(0);
  });
});

describe("buildAssessmentRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with the instrument + responses", () => {
    const body = buildAssessmentRequestBody({
      instrument: "phq-9",
      responses: [1, 2, 3],
      taskId: "task-xyz",
      personaId: "demo"
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ instrument: "phq-9", responses: [1, 2, 3] });
  });
});

describe("runAssessmentTask", () => {
  it("POSTs the A2A body and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/assessment/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data).toEqual({
        instrument: "phq-9",
        responses: [2, 2, 2, 1, 1, 1, 1, 1, 0]
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runAssessmentTask(
      {
        instrument: "phq-9",
        responses: [2, 2, 2, 1, 1, 1, 1, 1, 0],
        taskId: "task-1"
      },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("assessment-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runAssessmentTask(
        { instrument: "phq-9", responses: [], taskId: "t" },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("assessmentViewFromTask", () => {
  it("lifts a scored result with total, band, subscores, and intake severity", () => {
    const task = completedTask({
      result: {
        instrument: "mrs",
        instrumentName: "Menopause Rating Scale (MRS)",
        total: 30,
        maxTotal: 44,
        severityBand: "severe",
        normalizedSeverity: "severe",
        subscores: [
          { id: "somatic", label: "Somato-vegetative", score: 13, maxScore: 16, band: "severe" },
          { id: "psychological", label: "Psychological", score: 12, maxScore: 16, band: "severe" },
          { id: "urogenital", label: "Urogenital", score: 5, maxScore: 12, band: "severe" }
        ],
        redFlags: []
      },
      intakeSignal: { severity: "severe", redFlagsAcknowledged: "no" }
    });
    const view = assessmentViewFromTask(task);
    expect(view.kind).toBe("scored");
    if (view.kind !== "scored") return;
    expect(view.instrumentName).toBe("Menopause Rating Scale (MRS)");
    expect(view.total).toBe(30);
    expect(view.maxTotal).toBe(44);
    expect(view.severityBand).toBe("severe");
    expect(view.subscores).toHaveLength(3);
    expect(view.intakeSeverity).toBe("severe");
    expect(view.nextAgent).toBe("agentforce-intake");
    expect(view.traceTaskId).toBe("assessment-abc");
  });

  it("surfaces a PHQ-9 item-9 red flag and the severe intake escalation", () => {
    const task = completedTask({
      result: {
        total: 11,
        severityBand: "moderate",
        normalizedSeverity: "moderate",
        redFlags: [
          {
            itemIndex: 8,
            code: "phq9-item9-self-harm",
            description:
              "PHQ-9 item 9 (thoughts of self-harm / being better off dead) was endorsed — mandatory safety escalation.",
            value: 2
          }
        ]
      },
      intakeSignal: { severity: "severe", redFlagsAcknowledged: "yes" },
      intakeSeverity: "severe"
    });
    const view = assessmentViewFromTask(task);
    expect(view.kind).toBe("scored");
    if (view.kind !== "scored") return;
    // The band stays moderate but the red flag escalates intake severity.
    expect(view.severityBand).toBe("moderate");
    expect(view.redFlags).toHaveLength(1);
    expect(view.redFlags[0].code).toBe("phq9-item9-self-harm");
    expect(view.intakeSeverity).toBe("severe");
    expect(view.redFlagsAcknowledged).toBe("yes");
  });

  it("lifts a governance block with the blocking policy and message", () => {
    const view = assessmentViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this assessment/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.assessment.validated-instrument-only"
    );
    expect(view.policiesEvaluated).toContain(
      "policy.assessment.validated-instrument-only"
    );
    expect(view.traceTaskId).toBe("assessment-block");
  });

  it("treats a failed non-block task as an invalid (not-scored) result", () => {
    const task: A2ATask = {
      id: "assessment-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [
            { type: "text", text: "Assessment could not be scored: PHQ-9 expects 9 responses; received 3" }
          ]
        }
      },
      metadata: {
        agentFabric: {
          decision: "allow",
          policiesEvaluated: [],
          error: "PHQ-9 expects 9 responses; received 3"
        }
      }
    };
    const view = assessmentViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/expects 9 responses/);
  });
});

describe("carryIntoCareRouter", () => {
  it("POSTs the assessment to the Care Router handoff and lifts the decision", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/intake/route-to-care-router");
      const sent = JSON.parse(String(init?.body));
      expect(sent.assessment).toEqual({
        instrument: "phq-9",
        responses: [2, 2, 2, 1, 1, 1, 1, 1, 0]
      });
      expect(sent.origin).toBe("assessment-agent");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          taskId: "intake-to-router-99",
          decision: {
            pathway: "behavioral-health",
            pathwayLabel: "Behavioral health",
            acuity: "urgent"
          },
          assessment: { severityDrivenByAssessment: true }
        })
      } as unknown as Response;
    });

    const out = await carryIntoCareRouter(
      { instrument: "phq-9", responses: [2, 2, 2, 1, 1, 1, 1, 1, 0], personaId: "demo" },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.taskId).toBe("intake-to-router-99");
    expect(out.pathwayLabel).toBe("Behavioral health");
    expect(out.acuity).toBe("urgent");
    expect(out.severityDrivenByAssessment).toBe(true);
  });
});
