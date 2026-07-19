import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GRIEVANCE_APPEALS_PRESETS,
  buildGrievanceAppealsRequestBody,
  grievanceAppealsViewFromTask,
  runGrievanceAppealsTask
} from "./grievance-appeals-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_BILLING_INTAKE,
  DEMO_GRIEVANCE_INTAKE,
  assembleGrievanceCase,
  classifyCase,
  proposeCaseResolution
} from "../lib/grievance-appeals";

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const c = assembleGrievanceCase(DEMO_GRIEVANCE_INTAKE);
  const proposal = proposeCaseResolution({
    caseId: c.caseId,
    queue: c.queue,
    rationale: `${c.caseTypeLabel} — ${c.urgency}`
  });
  return {
    id: "grievance-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "GrievanceAppealCase",
        index: 0,
        parts: [{ type: "data", data: { result: { case: c, proposal } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.grievance.no-autonomous-resolution"],
        traceSpanId: "span-1",
        traceTaskId: "grievance-abc",
        memberRef: c.memberRef,
        caseId: c.caseId,
        caseType: c.caseType,
        urgency: c.urgency,
        queue: c.queue,
        deadlineDate: c.deadlineDate,
        deadlineDays: c.deadlineDays,
        state: c.state,
        caseResolutionRequiresHumanQueue: true,
        deadlineTracesToCatalog: true,
        routingSummaryIsPhiSafe: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "grievance-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this grievance-and-appeals run: policy.grievance.deadline-integrity (deadline extended)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.grievance.deadline-integrity"],
        violations: [
          {
            policyId: "policy.grievance.deadline-integrity",
            reason: "deadline exceeded regulatory maximum"
          }
        ]
      }
    }
  };
}

describe("GRIEVANCE_APPEALS_PRESETS", () => {
  it("has an expedited coverage-denial happy-path preset", () => {
    const preset = GRIEVANCE_APPEALS_PRESETS.find((p) => p.id === "expedited-denial");
    expect(preset).toBeDefined();
    expect(classifyCase(preset!.intake!)).toBe("case.appeal-expedited-coverage-denial");
  });

  it("has a billing-grievance preset routing to member-services", () => {
    const preset = GRIEVANCE_APPEALS_PRESETS.find((p) => p.id === "billing-grievance");
    expect(preset!.intake).toEqual(DEMO_BILLING_INTAKE);
    expect(classifyCase(preset!.intake!)).toBe("case.grievance-billing-dispute");
  });

  it("has the three governance-block presets asserting an offending plan", () => {
    const autoResolve = GRIEVANCE_APPEALS_PRESETS.find(
      (p) => p.id === "autonomous-resolve-block"
    );
    expect(autoResolve!.assertedProposals?.[0]).toMatchObject({
      requiresHumanQueueAction: false,
      applied: true
    });
    const deadline = GRIEVANCE_APPEALS_PRESETS.find(
      (p) => p.id === "deadline-extension-block"
    );
    expect(deadline!.assertedDeadlineOverride).toMatchObject({
      caseType: "case.appeal-expedited-coverage-denial",
      deadlineDate: "2026-07-31"
    });
    const phi = GRIEVANCE_APPEALS_PRESETS.find((p) => p.id === "phi-in-routing-block");
    expect(phi!.assertedRoutingSummaryOverride).toHaveProperty("clinicalDetail");
  });
});

describe("buildGrievanceAppealsRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with an intake data part", () => {
    const body = buildGrievanceAppealsRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      intake: DEMO_GRIEVANCE_INTAKE
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ intake: DEMO_GRIEVANCE_INTAKE });
  });

  it("posts asserted proposals / routing-summary override / deadline override", () => {
    const body = buildGrievanceAppealsRequestBody({
      taskId: "task-block",
      assertedProposals: [
        { caseId: "x", queue: "clinical-review", rationale: "auto", requiresHumanQueueAction: false, applied: true }
      ],
      assertedRoutingSummaryOverride: {
        memberRef: "m", caseType: "case.x", urgency: "expedited",
        queue: "clinical-review", deadlineDate: "2026-07-04", phiSafe: true,
        clinicalDetail: "leaks"
      },
      assertedDeadlineOverride: {
        caseType: "case.x", receivedDate: "2026-07-01", deadlineDate: "2026-07-31"
      }
    });
    expect(body.params.message.parts[0].data).toMatchObject({
      proposals: [{ applied: true }],
      routingSummaryOverride: { clinicalDetail: "leaks" },
      deadlineOverride: { deadlineDate: "2026-07-31" }
    });
  });
});

describe("runGrievanceAppealsTask", () => {
  it("POSTs the A2A body to the grievance agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/grievance-appeals/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.intake.memberRef).toBe("member-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runGrievanceAppealsTask(
      { taskId: "task-1", intake: DEMO_GRIEVANCE_INTAKE },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("grievance-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runGrievanceAppealsTask(
        { taskId: "t", intake: DEMO_GRIEVANCE_INTAKE },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("grievanceAppealsViewFromTask", () => {
  it("lifts a produced case with the human-queue gated proposal + PHI-safe summary", () => {
    const view = grievanceAppealsViewFromTask(completedTask());
    expect(view.kind).toBe("reported");
    if (view.kind !== "reported") return;
    expect(view.case.state).toBe("queued-for-human-review");
    expect(view.case.phiSafeRoutingSummary.phiSafe).toBe(true);
    expect(view.proposal?.requiresHumanQueueAction).toBe(true);
    expect(view.proposal?.applied).toBe(false);
    expect(view.caseResolutionRequiresHumanQueue).toBe(true);
    expect(view.deadlineTracesToCatalog).toBe(true);
    expect(view.routingSummaryIsPhiSafe).toBe(true);
    expect(view.traceTaskId).toBe("grievance-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = grievanceAppealsViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this grievance-and-appeals run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.grievance.deadline-integrity"
    );
    expect(view.policiesEvaluated).toContain("policy.grievance.deadline-integrity");
    expect(view.traceTaskId).toBe("grievance-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "grievance-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [
            { type: "text", text: "The grievance-and-appeals case could not be produced." }
          ]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = grievanceAppealsViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
