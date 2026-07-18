import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CARE_GAP_PRESETS,
  buildCareGapRequestBody,
  careGapViewFromTask,
  runCareGapTask
} from "./care-gap-panel";
import type { A2ATask } from "../lib/a2a";
import {
  detectCareGaps,
  draftAllGapOutreach,
  gapsTraceToClinicalMeasure,
  isCatalogMeasure
} from "../lib/care-gaps";

/**
 * Unit coverage for the /demo/intake Care Gap Closure agent panel. This
 * repo tests components as node-env pure functions (see
 * benefits-panel.test.ts) rather than rendering them, so we exercise the
 * exact logic the panel invokes:
 *   - the JSON-RPC A2A body it POSTs to the Care Gap agent (both a
 *     detectionContext and caller-asserted gaps),
 *   - that runCareGapTask returns the resulting task,
 *   - and that careGapViewFromTask lifts a detected gap set and a
 *     governance block into render-ready shapes.
 * The task fixtures mirror the shapes app/api/agents/care-gap-closure
 * actually returns (see that route + lib/care-gaps).
 */

const AS_OF = "2026-02-02";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  // Derive realistic gaps + drafts from the domain source of truth so the
  // fixture can't drift from what the agent actually returns.
  const gaps = detectCareGaps({
    asOf: AS_OF,
    ageBand: "51-55",
    cycleStatus: "stopped>=12mo",
    onHrt: true,
    measureHistory: {}
  });
  const drafts = draftAllGapOutreach(gaps, { channel: "email", hasContactConsent: true });
  return {
    id: "caregap-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "CareGapClosure",
        index: 0,
        parts: [{ type: "data", data: { gaps, drafts } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.caregap.clinical-measure-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "caregap-abc",
        gapsDetected: gaps.length,
        gapsTraceToClinicalMeasure: true,
        nextAgent: "engagement-agent"
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "caregap-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this care-gap closure: policy.caregap.clinical-measure-sourced (off-catalog gap)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.caregap.clinical-measure-sourced"],
        violations: [
          {
            policyId: "policy.caregap.clinical-measure-sourced",
            reason: "gap does not trace to a defined clinical measure"
          }
        ]
      }
    }
  };
}

describe("CARE_GAP_PRESETS", () => {
  it("detects catalog-sourced gaps for the representative grounded preset", () => {
    const preset = CARE_GAP_PRESETS.find((p) => p.id === "postmenopausal-on-hrt");
    expect(preset).toBeDefined();
    const gaps = detectCareGaps({
      asOf: AS_OF,
      ...preset!.detectionContext!
    });
    expect(gaps.length).toBeGreaterThan(0);
    expect(gapsTraceToClinicalMeasure(gaps)).toBe(true);
  });

  it("skips an up-to-date measure but surfaces an overdue one (partial history)", () => {
    const preset = CARE_GAP_PRESETS.find((p) => p.id === "perimenopausal-partial-history");
    expect(preset).toBeDefined();
    const gaps = detectCareGaps({ asOf: AS_OF, ...preset!.detectionContext! });
    const measureIds = gaps.map((g) => g.measureId);
    // Recent mammogram is within interval → not a gap.
    expect(measureIds).not.toContain("measure.mammogram");
    // Long-overdue lipid panel → a gap.
    expect(measureIds).toContain("measure.lipid-panel");
  });

  it("has an off-catalog preset whose asserted gap is NOT a catalog measure", () => {
    const preset = CARE_GAP_PRESETS.find((p) => p.id === "off-catalog-block");
    expect(preset).toBeDefined();
    expect(preset!.assertedGaps).toBeDefined();
    expect(preset!.detectionContext).toBeUndefined();
    const measureId = preset!.assertedGaps![0].measureId as string;
    expect(isCatalogMeasure(measureId)).toBe(false);
  });

  it("has a no-consent preset that suppresses contact consent", () => {
    const preset = CARE_GAP_PRESETS.find((p) => p.id === "no-consent-block");
    expect(preset).toBeDefined();
    expect(preset!.patientPrefs?.hasContactConsent).toBe(false);
  });
});

describe("buildCareGapRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a detectionContext data part", () => {
    const detectionContext = { asOf: AS_OF, ageBand: "51-55", onHrt: true };
    const body = buildCareGapRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      detectionContext,
      patientPrefs: { channel: "email", hasContactConsent: true }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({
      detectionContext,
      patientPrefs: { channel: "email", hasContactConsent: true }
    });
  });

  it("posts caller-asserted gaps under a `gaps` data part", () => {
    const gaps = [{ measureId: "measure.totally-invented" }];
    const body = buildCareGapRequestBody({ taskId: "task-block", assertedGaps: gaps });
    expect(body.params.message.parts[0].data).toEqual({ gaps });
  });
});

describe("runCareGapTask", () => {
  it("POSTs the A2A body to the Care Gap agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/care-gap-closure/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.detectionContext.ageBand).toBe("51-55");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runCareGapTask(
      {
        taskId: "task-1",
        detectionContext: { asOf: AS_OF, ageBand: "51-55", onHrt: true }
      },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("caregap-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runCareGapTask(
        { taskId: "t", detectionContext: { asOf: AS_OF } },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("careGapViewFromTask", () => {
  it("lifts detected gaps + drafts, each gap tracing to a catalog measure", () => {
    const view = careGapViewFromTask(completedTask());
    expect(view.kind).toBe("detected");
    if (view.kind !== "detected") return;
    expect(view.gaps.length).toBeGreaterThan(0);
    for (const g of view.gaps) {
      expect(g.measureId).toMatch(/^measure\./);
    }
    // One draft per gap, all human-approval-gated and unsent.
    expect(view.drafts).toHaveLength(view.gaps.length);
    for (const d of view.drafts) {
      expect(d.requiresHumanApproval).toBe(true);
      expect(d.sent).toBe(false);
    }
    expect(view.gapsTraceToClinicalMeasure).toBe(true);
    expect(view.nextAgent).toBe("engagement-agent");
    expect(view.traceTaskId).toBe("caregap-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = careGapViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this care-gap closure/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.caregap.clinical-measure-sourced"
    );
    expect(view.policiesEvaluated).toContain("policy.caregap.clinical-measure-sourced");
    expect(view.traceTaskId).toBe("caregap-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "caregap-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The care gaps could not be detected." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = careGapViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be detected/);
  });
});
