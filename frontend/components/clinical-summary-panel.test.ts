import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLINICAL_SUMMARY_PRESETS,
  buildClinicalSummaryRequestBody,
  clinicalSummaryViewFromTask,
  runClinicalSummaryTask
} from "./clinical-summary-panel";
import type { A2ATask } from "../lib/a2a";
import {
  assembleClinicalSummaryContext,
  scriptedSummarizeClinical,
  summaryTracesToSourceRecords,
  type ClinicalSummaryContext,
  type ClinicalSummaryResult
} from "../lib/clinical-summary";

/**
 * Unit coverage for the /demo/intake Clinical Summary agent panel — the THIRD
 * live-Claude agent. This repo tests components as node-env pure functions
 * (see care-plan-panel.test.ts) rather than rendering them, so we exercise the
 * exact logic the panel invokes:
 *   - the JSON-RPC A2A body it POSTs to the Clinical Summary agent (both an
 *     intake/pathway and a caller-asserted summary),
 *   - that runClinicalSummaryTask returns the resulting task,
 *   - and that clinicalSummaryViewFromTask lifts a composed summary (BOTH the
 *     claude-api and scripted-fallback cases) and a governance block into
 *     render-ready shapes.
 * The task fixtures mirror the shapes app/api/agents/clinical-summary actually
 * returns (see that route + lib/clinical-summary).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE_CONTEXT: ClinicalSummaryContext = assembleClinicalSummaryContext({
  intake: {
    preferredName: "Ada",
    ageBand: "45-49",
    cycleStatus: "perimenopausal",
    primarySymptom: "vasomotor",
    severity: "moderate"
  },
  pathway: "mscp-virtual-visit"
});

function completedTask(opts?: {
  context?: ClinicalSummaryContext;
  summary?: Partial<ClinicalSummaryResult>;
}): A2ATask {
  const context = opts?.context ?? BASE_CONTEXT;
  const scripted = scriptedSummarizeClinical(context);
  const summary: ClinicalSummaryResult = {
    patientSummary: scripted.patientSummary,
    clinicianHandoff: scripted.clinicianHandoff,
    sourceRecords: context.sourceRecords.slice(),
    via: "scripted-fallback",
    modelProvenance: {
      provider: "pause-scripted",
      model: "pause-clinical-summary-composer@1.0",
      via: "scripted-fallback"
    },
    fallbackReason:
      "ANTHROPIC_API_KEY not set; using deterministic Pause clinical-summary composer.",
    synthetic: true,
    ...(opts?.summary ?? {})
  };
  return {
    id: "clinsum-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "ClinicalSummary",
        index: 0,
        parts: [{ type: "data", data: { context, summary } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: [
          "policy.clinical-summary.source-record-sourced",
          "policy.model.anthropic-claude-sonnet-allowlisted"
        ],
        traceSpanId: "span-1",
        traceTaskId: "clinsum-abc",
        sourceRecords: summary.sourceRecords,
        summaryTracesToSourceRecords: true,
        summaryVia: summary.via,
        ...(summary.fallbackReason ? { fallbackReason: summary.fallbackReason } : {})
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "clinsum-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this clinical-summary task: policy.clinical-summary.source-record-sourced (off-context summary)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.clinical-summary.source-record-sourced"],
        violations: [
          {
            policyId: "policy.clinical-summary.source-record-sourced",
            reason: "summary does not trace to a source record"
          }
        ]
      }
    }
  };
}

describe("CLINICAL_SUMMARY_PRESETS", () => {
  it("assembles a grounded context for each intake preset", () => {
    const intakePresets = CLINICAL_SUMMARY_PRESETS.filter((p) => p.intake);
    expect(intakePresets.length).toBeGreaterThanOrEqual(2);
    for (const preset of intakePresets) {
      const context = assembleClinicalSummaryContext({
        intake: preset.intake!,
        ...(preset.pathway ? { pathway: preset.pathway } : {}),
        ...(preset.onHrt !== undefined ? { onHrt: preset.onHrt } : {})
      });
      expect(context.sourceRecords.length).toBeGreaterThan(0);
      // A summary composed from this context traces to its own source records.
      expect(
        summaryTracesToSourceRecords(
          { sourceRecords: context.sourceRecords },
          context
        )
      ).toBe(true);
    }
  });

  it("has an ungrounded preset whose asserted summary cites an off-context record", () => {
    const preset = CLINICAL_SUMMARY_PRESETS.find((p) => p.id === "ungrounded-block");
    expect(preset).toBeDefined();
    expect(preset!.assertedSummary).toBeDefined();
    expect(preset!.intake).toBeUndefined();
    // With no inputs, the assembled context has no source records, so the
    // asserted record is off-context (fabricated).
    const emptyContext = assembleClinicalSummaryContext({});
    expect(
      summaryTracesToSourceRecords(
        {
          sourceRecords: preset!.assertedSummary!.sourceRecords as string[]
        },
        emptyContext
      )
    ).toBe(false);
  });
});

describe("buildClinicalSummaryRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with intake + pathway data part", () => {
    const intake = { preferredName: "Ada", severity: "moderate" };
    const body = buildClinicalSummaryRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      pathway: "mscp-virtual-visit",
      intake,
      onHrt: true
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({
      pathway: "mscp-virtual-visit",
      intake,
      onHrt: true
    });
  });

  it("posts a caller-asserted summary under a `summary` data part", () => {
    const summary = { sourceRecords: ["care-plan:careplan.totally-invented"] };
    const body = buildClinicalSummaryRequestBody({ taskId: "task-block", assertedSummary: summary });
    expect(body.params.message.parts[0].data).toEqual({ summary });
  });
});

describe("runClinicalSummaryTask", () => {
  it("POSTs the A2A body to the Clinical Summary agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/clinical-summary/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.pathway).toBe("mscp-virtual-visit");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runClinicalSummaryTask(
      {
        taskId: "task-1",
        pathway: "mscp-virtual-visit",
        intake: { severity: "moderate", primarySymptom: "vasomotor" }
      },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("clinsum-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runClinicalSummaryTask(
        { taskId: "t", pathway: "mscp-virtual-visit", intake: {} },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("clinicalSummaryViewFromTask", () => {
  it("lifts a composed summary with both artifacts, source records, and provenance", () => {
    const view = clinicalSummaryViewFromTask(completedTask());
    expect(view.kind).toBe("composed");
    if (view.kind !== "composed") return;
    expect(view.patientDisplayName).toBe("Ada");
    expect(view.patientSummary).toMatch(/After-visit summary for Ada/);
    expect(view.clinicianHandoff).toMatch(/Clinician handoff — Ada/);
    expect(view.sourceRecords).toContain("intake");
    expect(view.sourceRecords).toContain("care-router:mscp-virtual-visit");
    expect(view.summaryTracesToSourceRecords).toBe(true);
    expect(view.traceTaskId).toBe("clinsum-abc");
  });

  it("renders the scripted-fallback case with via + fallbackReason", () => {
    const view = clinicalSummaryViewFromTask(completedTask());
    expect(view.kind).toBe("composed");
    if (view.kind !== "composed") return;
    expect(view.via).toBe("scripted-fallback");
    expect(view.modelProvider).toBe("pause-scripted");
    expect(view.fallbackReason).toMatch(/ANTHROPIC_API_KEY not set/);
  });

  it("renders the live claude-api case with no fallbackReason", () => {
    const view = clinicalSummaryViewFromTask(
      completedTask({
        summary: {
          patientSummary: "Ada, a friendly recap of your visit.",
          clinicianHandoff: "Ada — moderate vasomotor; virtual MSCP recommended.",
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
    expect(view.kind).toBe("composed");
    if (view.kind !== "composed") return;
    expect(view.via).toBe("claude-api");
    expect(view.modelProvider).toBe("anthropic");
    expect(view.model).toBe("claude-sonnet-4-5-20250929");
    expect(view.fallbackReason).toBeUndefined();
    expect(view.patientSummary).toBe("Ada, a friendly recap of your visit.");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = clinicalSummaryViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this clinical-summary task/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.clinical-summary.source-record-sourced"
    );
    expect(view.policiesEvaluated).toContain(
      "policy.clinical-summary.source-record-sourced"
    );
    expect(view.traceTaskId).toBe("clinsum-block");
  });

  it("treats a failed non-block task as an invalid (not-composed) result", () => {
    const task: A2ATask = {
      id: "clinsum-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The clinical summary could not be composed." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = clinicalSummaryViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be composed/);
  });
});
