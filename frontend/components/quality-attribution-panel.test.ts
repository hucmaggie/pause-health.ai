import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QUALITY_ATTRIBUTION_PRESETS,
  buildQualityAttributionRequestBody,
  qualityAttributionViewFromTask,
  runQualityAttributionTask
} from "./quality-attribution-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_ATTRIBUTION_PANEL,
  attributePanel
} from "../lib/quality-attribution";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const report = attributePanel(DEMO_ATTRIBUTION_PANEL);
  return {
    id: "attribution-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "QualityAttributionReport",
        index: 0,
        parts: [{ type: "data", data: { result: { report } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.attribution.methodology-catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "attribution-abc",
        panelSize: report.patients.length,
        providerCount: report.perProvider.length,
        contractRef: report.contractRef,
        methodologyId: report.methodologyId,
        attributionsTraceToCatalog: true,
        attributionsHonorContractTerms: true,
        attributionTieBreaksAreDocumented: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "attribution-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this attribution run: policy.attribution.methodology-catalog-sourced (off-catalog methodology)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.attribution.methodology-catalog-sourced"],
        violations: [
          {
            policyId: "policy.attribution.methodology-catalog-sourced",
            reason: "methodology.coin-flip is off-catalog"
          }
        ]
      }
    }
  };
}

describe("QUALITY_ATTRIBUTION_PRESETS", () => {
  it("has a demo-panel happy-path preset spanning all methodologies", () => {
    const preset = QUALITY_ATTRIBUTION_PRESETS.find((p) => p.id === "demo-panel");
    expect(preset).toBeDefined();
    expect(preset!.panel).toEqual(DEMO_ATTRIBUTION_PANEL);
    // Sanity — the panel produces at least one tie-break + one exclusion.
    const report = attributePanel(preset!.panel!);
    expect(report.patients.some((p) => p.tieBreakApplied)).toBe(true);
    expect(report.patients.some((p) => p.excludedByContract)).toBe(true);
  });

  it("has the three governance-block presets asserting offending overrides", () => {
    const offcat = QUALITY_ATTRIBUTION_PRESETS.find(
      (p) => p.id === "offcat-methodology-block"
    );
    expect(offcat!.attributionOverrides![0].methodologyId).toBe("methodology.coin-flip");
    const contract = QUALITY_ATTRIBUTION_PRESETS.find(
      (p) => p.id === "contract-terms-block"
    );
    expect(contract!.attributionOverrides![0].excludedByContract).toBe(false);
    const tiebreak = QUALITY_ATTRIBUTION_PRESETS.find(
      (p) => p.id === "opaque-tiebreak-block"
    );
    expect(tiebreak!.attributionOverrides![0].tieBreakApplied).toBe("coin-flip");
  });
});

describe("buildQualityAttributionRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a panel data part", () => {
    const body = buildQualityAttributionRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      panel: DEMO_ATTRIBUTION_PANEL
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ panel: DEMO_ATTRIBUTION_PANEL });
  });

  it("posts asserted attribution overrides under their data part", () => {
    const body = buildQualityAttributionRequestBody({
      taskId: "task-block",
      panel: DEMO_ATTRIBUTION_PANEL,
      attributionOverrides: [
        {
          patientRef: "attr-x",
          methodologyId: "methodology.coin-flip",
          providerRef: "provider-a",
          clinicRef: "clinic-north",
          contractRef: "contract.commercial-vbc-my2026",
          tieBreakApplied: null,
          excludedByContract: false,
          exclusionReasons: [],
          synthetic: true,
          note: "override"
        }
      ]
    });
    expect(body.params.message.parts[0].data).toMatchObject({
      panel: DEMO_ATTRIBUTION_PANEL,
      attributionOverrides: [{ methodologyId: "methodology.coin-flip" }]
    });
  });
});

describe("runQualityAttributionTask", () => {
  it("POSTs the A2A body to the attribution agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/quality-attribution/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.panel).toHaveLength(
        DEMO_ATTRIBUTION_PANEL.length
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runQualityAttributionTask(
      { taskId: "task-1", panel: DEMO_ATTRIBUTION_PANEL },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("attribution-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runQualityAttributionTask(
        { taskId: "t", panel: DEMO_ATTRIBUTION_PANEL },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("qualityAttributionViewFromTask", () => {
  it("lifts a produced report with per-provider rollup and all signals true", () => {
    const view = qualityAttributionViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.report.patients.length).toBe(DEMO_ATTRIBUTION_PANEL.length);
    expect(view.attributionsTraceToCatalog).toBe(true);
    expect(view.attributionsHonorContractTerms).toBe(true);
    expect(view.attributionTieBreaksAreDocumented).toBe(true);
    expect(view.traceTaskId).toBe("attribution-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = qualityAttributionViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this attribution run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.attribution.methodology-catalog-sourced"
    );
    expect(view.traceTaskId).toBe("attribution-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "attribution-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [
            { type: "text", text: "The attribution report could not be produced." }
          ]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = qualityAttributionViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
