import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RISK_ADJUSTMENT_PRESETS,
  buildRiskAdjustmentRequestBody,
  riskAdjustmentViewFromTask,
  runRiskAdjustmentTask
} from "./risk-adjustment-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_RISK_ADJUSTMENT_CONTEXT,
  assessRiskAdjustment,
  codesTraceToClinicalEvidence
} from "../lib/risk-adjustment";

/**
 * Unit coverage for the /demo/intake Risk Adjustment agent panel. This repo tests
 * components as node-env pure functions (see language-access-panel.test.ts) rather
 * than rendering them, so we exercise the exact logic the panel invokes: the
 * JSON-RPC A2A body it POSTs, that runRiskAdjustmentTask returns the resulting
 * task, and that riskAdjustmentViewFromTask lifts an assessment and a governance
 * block into render-ready shapes. The task fixtures mirror the shapes
 * app/api/agents/risk-adjustment actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const assessment = assessRiskAdjustment(DEMO_RISK_ADJUSTMENT_CONTEXT);
  return {
    id: "riskadj-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "RiskAdjustmentAssessment",
        index: 0,
        parts: [{ type: "data", data: { result: { assessment } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.riskadj.evidence-supported-coding"],
        traceSpanId: "span-1",
        traceTaskId: "riskadj-abc",
        rafScore: assessment.rafScore,
        confirmedCount: 2,
        suspectedCount: assessment.codingGaps.length,
        unsupportedCount: assessment.unsupportedFlags.length,
        requiresClinicianValidation: true,
        submitted: false,
        codesTraceToClinicalEvidence: true,
        codingRequiresClinicianValidation: true,
        noAutonomousCodeSubmission: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "riskadj-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this risk-adjustment run: policy.riskadj.evidence-supported-coding (upcoding)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.riskadj.evidence-supported-coding"],
        violations: [
          {
            policyId: "policy.riskadj.evidence-supported-coding",
            reason: "an HCC presented as supported does not trace to documented evidence"
          }
        ]
      }
    }
  };
}

describe("RISK_ADJUSTMENT_PRESETS", () => {
  it("has a happy-path preset with confirmed HCCs, a RAF score, and a suspected coding gap", () => {
    const preset = RISK_ADJUSTMENT_PRESETS.find((p) => p.id === "confirmed-plus-gap");
    expect(preset).toBeDefined();
    const a = assessRiskAdjustment(preset!.context!);
    expect(a.hccs.filter((h) => h.status === "confirmed").map((h) => h.hccId).sort()).toEqual([
      "hcc.diabetes-with-complication",
      "hcc.osteoporosis-fracture"
    ]);
    expect(a.rafScore).toBeCloseTo(0.739, 3);
    expect(a.codingGaps.map((h) => h.hccId)).toEqual(["hcc.major-depression"]);
    expect(a.unsupportedFlags).toHaveLength(0);
  });

  it("has an upcoding-block preset asserting a confirmed HCC with no documented evidence", () => {
    const preset = RISK_ADJUSTMENT_PRESETS.find((p) => p.id === "upcoding-block");
    expect(preset).toBeDefined();
    // The asserted set does NOT trace to documented evidence — the anti-upcoding
    // signal is false, which is what the Agent Fabric blocks.
    expect(codesTraceToClinicalEvidence(preset!.assertedHccs as never)).toBe(false);
  });

  it("has skip-validation and autonomous-submission block presets asserting an offending action", () => {
    const skip = RISK_ADJUSTMENT_PRESETS.find((p) => p.id === "skip-validation-block");
    expect(skip!.assertedAction).toMatchObject({ kind: "submit", clinicianValidated: false });
    const autonomous = RISK_ADJUSTMENT_PRESETS.find(
      (p) => p.id === "autonomous-submission-block"
    );
    expect(autonomous!.assertedAction).toMatchObject({ submitted: true });
  });
});

describe("buildRiskAdjustmentRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a context data part", () => {
    const body = buildRiskAdjustmentRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      context: DEMO_RISK_ADJUSTMENT_CONTEXT
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ context: DEMO_RISK_ADJUSTMENT_CONTEXT });
  });

  it("posts an asserted HCC set / code action under their data parts", () => {
    const body = buildRiskAdjustmentRequestBody({
      taskId: "task-block",
      assertedHccs: [{ hccId: "hcc.copd", status: "confirmed", supportingEvidence: [] }],
      assertedAction: { kind: "submit", clinicianValidated: false }
    });
    expect(body.params.message.parts[0].data).toEqual({
      hccs: [{ hccId: "hcc.copd", status: "confirmed", supportingEvidence: [] }],
      action: { kind: "submit", clinicianValidated: false }
    });
  });
});

describe("runRiskAdjustmentTask", () => {
  it("POSTs the A2A body to the risk-adjustment agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/risk-adjustment/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.context.patientRef).toBe(
        "riskadj-patient-001"
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runRiskAdjustmentTask(
      { taskId: "task-1", context: DEMO_RISK_ADJUSTMENT_CONTEXT },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("riskadj-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runRiskAdjustmentTask(
        { taskId: "t", context: DEMO_RISK_ADJUSTMENT_CONTEXT },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("riskAdjustmentViewFromTask", () => {
  it("lifts a produced assessment with confirmed HCCs, a RAF score, and a coding gap", () => {
    const view = riskAdjustmentViewFromTask(completedTask());
    expect(view.kind).toBe("assessed");
    if (view.kind !== "assessed") return;
    expect(view.patientRef).toBe("riskadj-patient-001");
    expect(view.rafScore).toBeCloseTo(0.739, 3);
    expect(view.hccs.filter((h) => h.status === "confirmed")).toHaveLength(2);
    expect(view.codingGaps.map((h) => h.hccId)).toEqual(["hcc.major-depression"]);
    expect(view.requiresClinicianValidation).toBe(true);
    expect(view.submitted).toBe(false);
    expect(view.codesTraceToClinicalEvidence).toBe(true);
    expect(view.codingRequiresClinicianValidation).toBe(true);
    expect(view.noAutonomousCodeSubmission).toBe(true);
    expect(view.traceTaskId).toBe("riskadj-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = riskAdjustmentViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this risk-adjustment run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.riskadj.evidence-supported-coding"
    );
    expect(view.policiesEvaluated).toContain("policy.riskadj.evidence-supported-coding");
    expect(view.traceTaskId).toBe("riskadj-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "riskadj-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [
            { type: "text", text: "The risk-adjustment assessment could not be produced." }
          ]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = riskAdjustmentViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
