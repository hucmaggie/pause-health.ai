import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HEDIS_QUALITY_PRESETS,
  buildHedisQualityRequestBody,
  hedisQualityViewFromTask,
  runHedisQualityTask
} from "./hedis-quality-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_AS_OF_PERIOD,
  DEMO_PANEL,
  assembleSubmission,
  exclusionsTraceToCatalog,
  measuresTraceToCatalog,
  rollUpPanel
} from "../lib/hedis-quality";

/**
 * Unit coverage for the /demo/intake HEDIS & Quality Reporting panel. This repo
 * tests components as node-env pure functions (see language-access-panel.test.ts)
 * rather than rendering them, so we exercise the exact logic the panel invokes:
 * the JSON-RPC A2A body it POSTs, that runHedisQualityTask returns the
 * resulting task, and that hedisQualityViewFromTask lifts a produced report and
 * a governance block into render-ready shapes. The task fixtures mirror the
 * shapes app/api/agents/hedis-quality actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const report = rollUpPanel(DEMO_PANEL, DEMO_AS_OF_PERIOD);
  const submission = assembleSubmission(report);
  return {
    id: "hedis-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "PanelQualityReport",
        index: 0,
        parts: [{ type: "data", data: { result: { report, submission } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.hedis.measure-catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "hedis-abc",
        asOfPeriod: report.asOfPeriod,
        panelSize: report.panelSize,
        measureCount: report.perMeasure.length,
        submissionState: submission.state,
        submissionPackageId: submission.packageId,
        measuresTraceToCatalog: true,
        exclusionsTraceToCatalog: true,
        submissionRequiresHumanApproval: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "hedis-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this HEDIS quality-reporting run: policy.hedis.exclusion-integrity (ad-hoc exclusion)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.hedis.exclusion-integrity"],
        violations: [
          {
            policyId: "policy.hedis.exclusion-integrity",
            reason: "unlisted exclusion applied to a measure"
          }
        ]
      }
    }
  };
}

describe("HEDIS_QUALITY_PRESETS", () => {
  it("has a demo-panel roll-up preset whose panel + period produce a catalog-sourced report", () => {
    const preset = HEDIS_QUALITY_PRESETS.find((p) => p.id === "demo-panel-rollup");
    expect(preset).toBeDefined();
    const report = rollUpPanel(preset!.panel!, preset!.asOfPeriod!);
    expect(measuresTraceToCatalog(report.perMeasure)).toBe(true);
    expect(exclusionsTraceToCatalog(preset!.panel!.flatMap((p) => p.exclusions ?? []))).toBe(true);
    // Every reported measure has a rate or null; nothing NaN / invalid.
    for (const m of report.perMeasure) {
      expect(m.denominator).toBeGreaterThanOrEqual(0);
      if (m.rate !== null) {
        expect(m.rate).toBeGreaterThanOrEqual(0);
        expect(m.rate).toBeLessThanOrEqual(1);
      }
    }
  });

  it("has the three governance-block presets asserting an offending plan / exclusion / measure", () => {
    const offcatalog = HEDIS_QUALITY_PRESETS.find((p) => p.id === "offcatalog-measure-block");
    expect(offcatalog!.assertedPerMeasure).toEqual([
      { measureId: "measure.made-up-quality-metric" }
    ]);
    const adhoc = HEDIS_QUALITY_PRESETS.find((p) => p.id === "adhoc-exclusion-block");
    expect(
      exclusionsTraceToCatalog(
        adhoc!.assertedAppliedExclusions as Array<{ measureId: string; exclusionId: string }>
      )
    ).toBe(false);
    const autosub = HEDIS_QUALITY_PRESETS.find((p) => p.id === "autonomous-submission-block");
    expect(autosub!.assertedSubmissionPlan).toMatchObject({
      requiresQualityTeamApproval: false,
      submitted: true
    });
  });
});

describe("buildHedisQualityRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a panel data part", () => {
    const body = buildHedisQualityRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      panel: DEMO_PANEL,
      asOfPeriod: DEMO_AS_OF_PERIOD
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ panel: DEMO_PANEL, asOfPeriod: DEMO_AS_OF_PERIOD });
  });

  it("posts asserted perMeasure / appliedExclusions / submissionPlan under their data parts", () => {
    const body = buildHedisQualityRequestBody({
      taskId: "task-block",
      assertedPerMeasure: [{ measureId: "measure.made-up" }],
      assertedAppliedExclusions: [
        { measureId: "measure.breast-cancer-screening", exclusionId: "exclusion.made-up" }
      ],
      assertedSubmissionPlan: { requiresQualityTeamApproval: false, submitted: true }
    });
    expect(body.params.message.parts[0].data).toEqual({
      perMeasure: [{ measureId: "measure.made-up" }],
      appliedExclusions: [
        { measureId: "measure.breast-cancer-screening", exclusionId: "exclusion.made-up" }
      ],
      submissionPlan: { requiresQualityTeamApproval: false, submitted: true }
    });
  });
});

describe("runHedisQualityTask", () => {
  it("POSTs the A2A body to the HEDIS agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/hedis-quality/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.asOfPeriod).toBe(DEMO_AS_OF_PERIOD);
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runHedisQualityTask(
      { taskId: "task-1", panel: DEMO_PANEL, asOfPeriod: DEMO_AS_OF_PERIOD },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("hedis-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runHedisQualityTask(
        { taskId: "t", panel: DEMO_PANEL, asOfPeriod: DEMO_AS_OF_PERIOD },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("hedisQualityViewFromTask", () => {
  it("lifts a produced report with per-measure rates + a human-approval-gated submission", () => {
    const view = hedisQualityViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.asOfPeriod).toBe(DEMO_AS_OF_PERIOD);
    expect(view.panelSize).toBe(DEMO_PANEL.length);
    expect(view.perMeasure.length).toBeGreaterThan(0);
    expect(view.submission?.submitted).toBe(false);
    expect(view.submission?.state).toBe("ready-for-quality-team-review");
    expect(view.measuresTraceToCatalog).toBe(true);
    expect(view.exclusionsTraceToCatalog).toBe(true);
    expect(view.submissionRequiresHumanApproval).toBe(true);
    expect(view.traceTaskId).toBe("hedis-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = hedisQualityViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this HEDIS quality-reporting run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.hedis.exclusion-integrity"
    );
    expect(view.policiesEvaluated).toContain("policy.hedis.exclusion-integrity");
    expect(view.traceTaskId).toBe("hedis-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "hedis-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The HEDIS quality report could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = hedisQualityViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
