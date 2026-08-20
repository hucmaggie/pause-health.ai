import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MASTER_PATIENT_INDEX_PRESETS,
  buildMasterPatientIndexRequestBody,
  masterPatientIndexViewFromTask,
  runMasterPatientIndexTask
} from "./master-patient-index-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_CLEAR_MATCH_CANDIDATE,
  DEMO_INCOMING_RECORD,
  excludesProtectedAttributesInMatching,
  matchTracesToFeatures,
  mergeRequiresHumanReview,
  resolveIdentity
} from "../lib/master-patient-index";

/**
 * Unit coverage for the /demo/intake Master Patient Index agent panel. This repo
 * tests components as node-env pure functions (see risk-adjustment-panel.test.ts)
 * rather than rendering them, so we exercise the exact logic the panel invokes:
 * the JSON-RPC A2A body it POSTs, that runMasterPatientIndexTask returns the
 * resulting task, and that masterPatientIndexViewFromTask lifts a resolution and
 * a governance block into render-ready shapes. The task fixtures mirror the
 * shapes app/api/agents/master-patient-index actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const resolution = resolveIdentity(DEMO_INCOMING_RECORD, [DEMO_CLEAR_MATCH_CANDIDATE]);
  return {
    id: "mpi-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "IdentityResolution",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result: { resolution, incomingRef: DEMO_INCOMING_RECORD.recordId } }
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.mpi.transparent-matching"],
        traceSpanId: "span-1",
        traceTaskId: "mpi-abc",
        recommendation: resolution.recommendation,
        classification: resolution.bestMatch?.classification,
        requiresHumanReview: resolution.requiresHumanReview,
        matchTracesToFeatures: true,
        mergeRequiresHumanReview: true,
        excludesProtectedAttributesInMatching: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "mpi-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this identity-resolution run: policy.mpi.transparent-matching (opaque match)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.mpi.transparent-matching"],
        violations: [
          {
            policyId: "policy.mpi.transparent-matching",
            reason: "a match decision does not trace to the defined match-feature spec"
          }
        ]
      }
    }
  };
}

describe("MASTER_PATIENT_INDEX_PRESETS", () => {
  it("has a clear-match preset that resolves to a merge across every feature", () => {
    const preset = MASTER_PATIENT_INDEX_PRESETS.find((p) => p.id === "clear-match");
    expect(preset).toBeDefined();
    const r = resolveIdentity(preset!.incoming!, preset!.candidates!);
    expect(r.bestMatch?.score).toBe(100);
    expect(r.bestMatch?.classification).toBe("match");
    expect(r.recommendation).toBe("merge");
    expect(r.requiresHumanReview).toBe(false);
  });

  it("has an ambiguous preset that resolves to manual-review requiring human review", () => {
    const preset = MASTER_PATIENT_INDEX_PRESETS.find((p) => p.id === "possible-match");
    expect(preset).toBeDefined();
    const r = resolveIdentity(preset!.incoming!, preset!.candidates!);
    expect(r.bestMatch?.classification).toBe("possible-match");
    expect(r.recommendation).toBe("manual-review");
    expect(r.requiresHumanReview).toBe(true);
  });

  it("has a no-match preset that resolves to no-action", () => {
    const preset = MASTER_PATIENT_INDEX_PRESETS.find((p) => p.id === "no-match");
    expect(preset).toBeDefined();
    const r = resolveIdentity(preset!.incoming!, preset!.candidates!);
    expect(r.bestMatch?.classification).toBe("no-match");
    expect(r.recommendation).toBe("no-action");
  });

  it("has the three governance-block presets asserting an offending input", () => {
    const opaque = MASTER_PATIENT_INDEX_PRESETS.find((p) => p.id === "opaque-match-block");
    // The asserted scored set does NOT trace to the feature spec.
    expect(matchTracesToFeatures(opaque!.scoredCandidates as never)).toBe(false);

    const merge = MASTER_PATIENT_INDEX_PRESETS.find((p) => p.id === "autonomous-merge-block");
    // The asserted resolution merges below the auto threshold without review.
    expect(mergeRequiresHumanReview(merge!.resolution as never)).toBe(false);

    const protectedClass = MASTER_PATIENT_INDEX_PRESETS.find(
      (p) => p.id === "protected-class-block"
    );
    // The asserted feature set includes a protected-class attribute.
    expect(excludesProtectedAttributesInMatching(protectedClass!.matchingFeatureIds!)).toBe(
      false
    );
  });
});

describe("buildMasterPatientIndexRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with an incoming + candidates data part", () => {
    const body = buildMasterPatientIndexRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      incoming: DEMO_INCOMING_RECORD,
      candidates: [DEMO_CLEAR_MATCH_CANDIDATE]
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({
      incoming: DEMO_INCOMING_RECORD,
      candidates: [DEMO_CLEAR_MATCH_CANDIDATE]
    });
  });

  it("posts an asserted scored set / resolution / feature ids under their data parts", () => {
    const body = buildMasterPatientIndexRequestBody({
      taskId: "task-block",
      matchingFeatureIds: ["feature.name", "attr.race"]
    });
    expect(body.params.message.parts[0].data).toEqual({
      matchingFeatureIds: ["feature.name", "attr.race"]
    });
  });
});

describe("runMasterPatientIndexTask", () => {
  it("POSTs the A2A body to the master-patient-index agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/master-patient-index/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.incoming.recordId).toBe("mpi-incoming-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runMasterPatientIndexTask(
      { taskId: "task-1", incoming: DEMO_INCOMING_RECORD, candidates: [DEMO_CLEAR_MATCH_CANDIDATE] },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("mpi-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runMasterPatientIndexTask(
        { taskId: "t", incoming: DEMO_INCOMING_RECORD, candidates: [] },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("masterPatientIndexViewFromTask", () => {
  it("lifts a produced resolution with a best match, recommendation, and honesty signals", () => {
    const view = masterPatientIndexViewFromTask(completedTask());
    expect(view.kind).toBe("resolved");
    if (view.kind !== "resolved") return;
    expect(view.incomingRef).toBe("mpi-incoming-001");
    expect(view.bestMatch?.candidateId).toBe("mpi-candidate-clear-001");
    expect(view.bestMatch?.score).toBe(100);
    expect(view.recommendation).toBe("merge");
    expect(view.requiresHumanReview).toBe(false);
    expect(view.matchTracesToFeatures).toBe(true);
    expect(view.mergeRequiresHumanReview).toBe(true);
    expect(view.excludesProtectedAttributesInMatching).toBe(true);
    expect(view.traceTaskId).toBe("mpi-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = masterPatientIndexViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this identity-resolution run/);
    expect(view.violations.map((v) => v.policyId)).toContain("policy.mpi.transparent-matching");
    expect(view.policiesEvaluated).toContain("policy.mpi.transparent-matching");
    expect(view.traceTaskId).toBe("mpi-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "mpi-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The identity resolution could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = masterPatientIndexViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
