import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLINICAL_TRIALS_PRESETS,
  buildClinicalTrialsRequestBody,
  clinicalTrialsViewFromTask,
  runClinicalTrialsTask
} from "./clinical-trials-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_TRIAL_PATIENT,
  eligibilityTracesToCriteria,
  matchTrials
} from "../lib/clinical-trials";

/**
 * Unit coverage for the /demo/intake Clinical Trials agent panel. This repo
 * tests components as node-env pure functions (see population-health-panel.test.ts)
 * rather than rendering them, so we exercise the exact logic the panel invokes:
 * the JSON-RPC A2A body it POSTs, that runClinicalTrialsTask returns the
 * resulting task, and that clinicalTrialsViewFromTask lifts a match and a
 * governance block into render-ready shapes. The task fixtures mirror the shapes
 * app/api/agents/clinical-trials actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const result = matchTrials(DEMO_TRIAL_PATIENT, { researchConsent: true });
  return {
    id: "trials-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "TrialMatchResult",
        index: 0,
        parts: [{ type: "data", data: { result } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.trials.eligibility-criteria-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "trials-abc",
        eligibleCount: result.eligibleCount,
        recommendedStudyIds: result.recommendedStudyIds,
        outreachState: result.outreach.state,
        eligibilityTracesToCriteria: true,
        researchConsentPresent: true,
        enrollmentRequiresHuman: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "trials-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this clinical-trials run: policy.trials.no-autonomous-enrollment (auto enroll)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.trials.no-autonomous-enrollment"],
        violations: [
          {
            policyId: "policy.trials.no-autonomous-enrollment",
            reason: "autonomous enrollment attempted"
          }
        ]
      }
    }
  };
}

describe("CLINICAL_TRIALS_PRESETS", () => {
  it("has a consent-present preset that matches eligible studies traceable to criteria", () => {
    const preset = CLINICAL_TRIALS_PRESETS.find((p) => p.id === "match-with-consent");
    expect(preset).toBeDefined();
    const result = matchTrials(preset!.patient!, { researchConsent: preset!.researchConsent });
    expect(result.eligibleCount).toBeGreaterThan(0);
    expect(result.outreach.state).toBe("drafted");
    expect(eligibilityTracesToCriteria(result.matches)).toBe(true);
  });

  it("has a no-consent preset whose outreach is withheld (not enrolled)", () => {
    const preset = CLINICAL_TRIALS_PRESETS.find((p) => p.id === "match-no-consent");
    expect(preset).toBeDefined();
    const result = matchTrials(preset!.patient!, { researchConsent: preset!.researchConsent });
    expect(result.outreach.state).toBe("consent-required");
    expect(result.outreach.enrolled).toBe(false);
  });

  it("has an off-catalog-eligibility preset whose asserted match doesn't trace to criteria", () => {
    const preset = CLINICAL_TRIALS_PRESETS.find(
      (p) => p.id === "off-catalog-eligibility-block"
    );
    expect(preset).toBeDefined();
    expect(
      eligibilityTracesToCriteria(
        preset!.assertedMatches as Array<{
          matchedCriteria: { criterionId: string }[];
          failedCriteria: { criterionId: string }[];
        }>
      )
    ).toBe(false);
  });

  it("has consent + enrollment block presets that assert an offending outreach", () => {
    const noConsent = CLINICAL_TRIALS_PRESETS.find(
      (p) => p.id === "outreach-without-consent-block"
    );
    expect(noConsent!.assertedOutreach).toMatchObject({
      state: "drafted",
      researchConsentPresent: false
    });
    const autoEnroll = CLINICAL_TRIALS_PRESETS.find(
      (p) => p.id === "autonomous-enrollment-block"
    );
    expect(autoEnroll!.assertedOutreach).toMatchObject({ enrolled: true });
  });
});

describe("buildClinicalTrialsRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a patient data part", () => {
    const body = buildClinicalTrialsRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      patient: DEMO_TRIAL_PATIENT,
      researchConsent: true
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ patient: DEMO_TRIAL_PATIENT, researchConsent: true });
  });

  it("posts asserted matches and outreach under their data parts", () => {
    const body = buildClinicalTrialsRequestBody({
      taskId: "task-block",
      assertedMatches: [{ studyId: "s", matchedCriteria: [{ criterionId: "crit.x" }] }],
      assertedOutreach: { state: "drafted", enrolled: true }
    });
    expect(body.params.message.parts[0].data).toEqual({
      matches: [{ studyId: "s", matchedCriteria: [{ criterionId: "crit.x" }] }],
      outreach: { state: "drafted", enrolled: true }
    });
  });
});

describe("runClinicalTrialsTask", () => {
  it("POSTs the A2A body to the clinical-trials agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/clinical-trials/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.patient.patientRef).toBe("trial-patient-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runClinicalTrialsTask(
      { taskId: "task-1", patient: DEMO_TRIAL_PATIENT, researchConsent: true },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("trials-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runClinicalTrialsTask(
        { taskId: "t", patient: DEMO_TRIAL_PATIENT },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("clinicalTrialsViewFromTask", () => {
  it("lifts a produced match with per-study criteria + a consent-gated outreach", () => {
    const view = clinicalTrialsViewFromTask(completedTask());
    expect(view.kind).toBe("matched");
    if (view.kind !== "matched") return;
    expect(view.matches.length).toBeGreaterThan(0);
    expect(view.eligibleCount).toBeGreaterThan(0);
    expect(view.outreach?.state).toBe("drafted");
    expect(view.outreach?.enrolled).toBe(false);
    expect(view.eligibilityTracesToCriteria).toBe(true);
    expect(view.researchConsentPresent).toBe(true);
    expect(view.enrollmentRequiresHuman).toBe(true);
    expect(view.traceTaskId).toBe("trials-abc");
    expect(eligibilityTracesToCriteria(view.matches)).toBe(true);
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = clinicalTrialsViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this clinical-trials run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.trials.no-autonomous-enrollment"
    );
    expect(view.policiesEvaluated).toContain("policy.trials.no-autonomous-enrollment");
    expect(view.traceTaskId).toBe("trials-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "trials-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The trial match could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = clinicalTrialsViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
