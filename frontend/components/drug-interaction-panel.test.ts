import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  DRUG_INTERACTION_PRESETS,
  buildDrugInteractionRequestBody,
  drugInteractionViewFromTask,
  runDrugInteractionTask
} from "./drug-interaction-panel";
import { DEMO_DRUG_INTERACTION_REQUEST } from "../lib/drug-interaction";

describe("DRUG_INTERACTION_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(DRUG_INTERACTION_PRESETS.length).toBeGreaterThanOrEqual(7);
    for (const p of DRUG_INTERACTION_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = DRUG_INTERACTION_PRESETS.map((p) => p.id);
    expect(ids).toContain("off-catalog-interaction-block");
    expect(ids).toContain("inflated-severity-block");
    expect(ids).toContain("auto-held-block");
  });
});

describe("buildDrugInteractionRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildDrugInteractionRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_DRUG_INTERACTION_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_DRUG_INTERACTION_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildDrugInteractionRequestBody({
      taskId: "t2",
      determination: { autoHeldOrder: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoHeldOrder: true });
  });
});

function okResponse(task: A2ATask): Response {
  const payload: A2ARpcResponse<A2ATask> = { jsonrpc: "2.0", id: "x", result: task };
  return {
    ok: true,
    status: 200,
    json: async () => payload
  } as unknown as Response;
}

describe("runDrugInteractionTask", () => {
  it("POSTs to the drug-interaction route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runDrugInteractionTask(
      { taskId: "t", request: DEMO_DRUG_INTERACTION_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/drug-interaction/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runDrugInteractionTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("drugInteractionViewFromTask", () => {
  it("lifts a resolved finding from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "DrugInteractionDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  requestRef: "ddi-001",
                  determination: {
                    requestRef: "ddi-001",
                    patientRef: "patient-8842",
                    proposedDrug: "paroxetine",
                    activeMedicationCount: 3,
                    detectedInteractions: [
                      {
                        interactionId: "ddi.paroxetine-tamoxifen",
                        withDrug: "tamoxifen",
                        pair: ["paroxetine", "tamoxifen"],
                        severity: "major",
                        mechanism: "CYP2D6 inhibition",
                        management: "Avoid"
                      }
                    ],
                    interactionCount: 1,
                    overallSeverity: "major",
                    disposition: "review-required",
                    requiresClinicianReview: true,
                    autoHeldOrder: false,
                    autoOverrodeAlert: false,
                    reason: "ok",
                    synthetic: true,
                    note: "note"
                  }
                }
              }
            }
          ]
        }
      ],
      metadata: {
        agentFabric: {
          decision: "allow",
          traceTaskId: "trace-1",
          ddiInteractionSourced: true,
          ddiSeverityConsistent: true,
          ddiNoAutonomousHoldOrOverride: true
        }
      }
    };
    const view = drugInteractionViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.overallSeverity).toBe("major");
      expect(view.disposition).toBe("review-required");
      expect(view.detectedInteractions[0].interactionId).toBe("ddi.paroxetine-tamoxifen");
      expect(view.traceTaskId).toBe("trace-1");
    }
  });

  it("lifts a blocked view from a failed task with a fabric block", () => {
    const task: A2ATask = {
      id: "t",
      status: {
        state: "failed",
        timestamp: new Date().toISOString(),
        message: { role: "agent", parts: [{ type: "text", text: "blocked" }] }
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: ["policy.ddi.severity-consistent"],
          violations: [{ policyId: "policy.ddi.severity-consistent", reason: "inflated" }]
        }
      }
    };
    const view = drugInteractionViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.ddi.severity-consistent");
      expect(view.policiesEvaluated).toContain("policy.ddi.severity-consistent");
    }
  });
});
