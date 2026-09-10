import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  MEDICATION_NAME_SAFETY_PRESETS,
  buildMedicationNameSafetyRequestBody,
  medicationNameSafetyViewFromTask,
  runMedicationNameSafetyTask
} from "./medication-name-safety-panel";

describe("MEDICATION_NAME_SAFETY_PRESETS", () => {
  it("has the three finding presets and the three governance-block presets", () => {
    const ids = MEDICATION_NAME_SAFETY_PRESETS.map((p) => p.id);
    expect(ids).toContain("recognized-clear");
    expect(ids).toContain("lasa-warning");
    expect(ids).toContain("unrecognized");
    expect(ids).toContain("fabricated-candidate-block");
    expect(ids).toContain("miscomputed-distance-block");
    expect(ids).toContain("auto-substituted-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of MEDICATION_NAME_SAFETY_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildMedicationNameSafetyRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildMedicationNameSafetyRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: {
        requestRef: "mns-x",
        patientRef: "patient-x",
        prescribedName: "premarin"
      }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { prescribedName: string }).prescribedName).toBe("premarin");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildMedicationNameSafetyRequestBody({
      taskId: "t-2",
      determination: { disposition: "recognized-clear" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "recognized-clear" });
  });
});

describe("runMedicationNameSafetyTask", () => {
  it("POSTs and returns the A2A task result", async () => {
    const task: A2ATask = {
      id: "t-9",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } }
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t-9", result: task }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const result = await runMedicationNameSafetyTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runMedicationNameSafetyTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("medicationNameSafetyViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "MedicationNameSafetyDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  requestRef: "mns-002",
                  determination: {
                    requestRef: "mns-002",
                    patientRef: "patient-6640",
                    prescribedName: "premarin",
                    disposition: "lasa-warning",
                    exactMatch: true,
                    nearestMatch: { drugId: "drug-premarin", name: "premarin", editDistance: 0 },
                    confusable: [{ drugId: "drug-primaxin", name: "primaxin", editDistance: 2 }],
                    editDistanceThreshold: 2,
                    catalogSize: 10,
                    reason: "r",
                    note: "n"
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
          traceTaskId: "t-1",
          lasaCandidatesSourced: true,
          lasaDistancesConsistent: true,
          lasaNoAutonomousSubstitution: true
        }
      }
    };
    const view = medicationNameSafetyViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("lasa-warning");
      expect(view.nearestMatch?.name).toBe("premarin");
      expect(view.confusable).toHaveLength(1);
      expect(view.lasaCandidatesSourced).toBe(true);
    }
  });

  it("lifts a blocked view from a governance block", () => {
    const task: A2ATask = {
      id: "t-2",
      status: {
        state: "failed",
        timestamp: "now",
        message: { role: "agent", parts: [{ type: "text", text: "blocked" }] }
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: ["policy.lasa.distances-consistent"],
          violations: [{ policyId: "policy.lasa.distances-consistent", reason: "bad math" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = medicationNameSafetyViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.lasa.distances-consistent");
    }
  });

  it("lifts an invalid view from a non-block failure", () => {
    const task: A2ATask = {
      id: "t-3",
      status: {
        state: "failed",
        timestamp: "now",
        message: { role: "agent", parts: [{ type: "text", text: "nope" }] }
      },
      metadata: { agentFabric: { decision: "invalid", traceTaskId: "t-3" } }
    };
    const view = medicationNameSafetyViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
