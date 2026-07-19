import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CARE_TEAM_PRESETS,
  buildCareTeamRequestBody,
  careTeamViewFromTask,
  runCareTeamTask
} from "./care-team-management-panel";
import type { A2ATask } from "../lib/a2a";
import {
  DEMO_CARE_TEAM_PATIENT,
  DEMO_PCP_MISSING_PATIENT,
  assembleCareTeam,
  proposeTeamChange,
  rolesTraceToCatalog,
  teamIncludesPcp
} from "../lib/care-team-management";

/**
 * Unit coverage for the /demo/intake Care Team & Case Management panel. This
 * repo tests components as node-env pure functions rather than rendering them,
 * so we exercise the exact logic the panel invokes: the JSON-RPC A2A body it
 * POSTs, that runCareTeamTask returns the resulting task, and that
 * careTeamViewFromTask lifts an assembly and a governance block into
 * render-ready shapes.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const assembly = assembleCareTeam(DEMO_CARE_TEAM_PATIENT);
  const proposal = assembly.gaps[0]
    ? proposeTeamChange({
        action: "add-member",
        roleId: assembly.gaps[0].roleId,
        rationale: assembly.gaps[0].reason
      })
    : null;
  return {
    id: "careteam-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "CareTeamAssembly",
        index: 0,
        parts: [{ type: "data", data: { result: { assembly, proposal } } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.careteam.role-catalog-sourced"],
        traceSpanId: "span-1",
        traceTaskId: "careteam-abc",
        patientRef: assembly.patientRef,
        asOfDate: assembly.asOfDate,
        rosterCount: assembly.roster.length,
        neededRoleCount: assembly.neededRoles.length,
        gapCount: assembly.gaps.length,
        caseManagerId: assembly.caseManager?.id ?? null,
        rolesTraceToCatalog: true,
        teamChangeRequiresCaseManager: true,
        teamIncludesPcp: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "careteam-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this care-team assembly: policy.careteam.pcp-required (no PCP)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.careteam.pcp-required"],
        violations: [
          {
            policyId: "policy.careteam.pcp-required",
            reason: "roster missing role.pcp"
          }
        ]
      }
    }
  };
}

describe("CARE_TEAM_PRESETS", () => {
  it("has a high-need happy-path preset whose team includes a PCP + catalog-sourced roles", () => {
    const preset = CARE_TEAM_PRESETS.find((p) => p.id === "high-need-patient");
    expect(preset).toBeDefined();
    const a = assembleCareTeam(preset!.patient!);
    expect(teamIncludesPcp(a.roster)).toBe(true);
    expect(rolesTraceToCatalog({ roster: a.roster, neededRoles: a.neededRoles })).toBe(true);
  });

  it("has an off-catalog-role block preset that fails the catalog signal", () => {
    const preset = CARE_TEAM_PRESETS.find((p) => p.id === "offcatalog-role-block");
    expect(preset).toBeDefined();
    expect(
      rolesTraceToCatalog({
        roster: preset!.assertedRosterOverride as Array<{ roleId?: string }>,
        neededRoles: []
      })
    ).toBe(false);
  });

  it("has an autonomous-assign block preset (proposal applied without approval)", () => {
    const preset = CARE_TEAM_PRESETS.find((p) => p.id === "autonomous-assign-block");
    expect(preset!.assertedProposals?.[0]).toMatchObject({
      requiresCaseManagerApproval: false,
      applied: true
    });
  });

  it("has a missing-PCP block preset (specialist-only roster)", () => {
    const preset = CARE_TEAM_PRESETS.find((p) => p.id === "missing-pcp-block");
    expect(preset!.patient).toEqual(DEMO_PCP_MISSING_PATIENT);
    expect(teamIncludesPcp(preset!.patient!.currentMembers!)).toBe(false);
  });
});

describe("buildCareTeamRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a patient data part", () => {
    const body = buildCareTeamRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      patient: DEMO_CARE_TEAM_PATIENT
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({ patient: DEMO_CARE_TEAM_PATIENT });
  });

  it("posts asserted rosterOverride / neededRolesOverride / proposals under their data parts", () => {
    const body = buildCareTeamRequestBody({
      taskId: "task-block",
      assertedRosterOverride: [
        {
          roleId: "role.made-up",
          roleLabel: "AI Concierge",
          responsibility: "",
          memberRef: "made-up",
          memberName: "N/A",
          assignedAt: "2026-01-01"
        }
      ],
      assertedNeededRolesOverride: ["role.made-up-need"],
      assertedProposals: [
        {
          action: "add-member",
          requiresCaseManagerApproval: false,
          applied: true
        }
      ]
    });
    expect(body.params.message.parts[0].data).toMatchObject({
      rosterOverride: [{ roleId: "role.made-up" }],
      neededRolesOverride: ["role.made-up-need"],
      proposals: [{ applied: true }]
    });
  });
});

describe("runCareTeamTask", () => {
  it("POSTs the A2A body to the care-team agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/care-team/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(sent.params.message.parts[0].data.patient.patientRef).toBe("careteam-patient-001");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runCareTeamTask(
      { taskId: "task-1", patient: DEMO_CARE_TEAM_PATIENT },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("careteam-abc");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runCareTeamTask(
        { taskId: "t", patient: DEMO_CARE_TEAM_PATIENT },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("careTeamViewFromTask", () => {
  it("lifts a produced assembly with a case manager + human-approval gated proposal", () => {
    const view = careTeamViewFromTask(completedTask());
    expect(view.kind).toBe("assembled");
    if (view.kind !== "assembled") return;
    expect(view.patientRef).toBe(DEMO_CARE_TEAM_PATIENT.patientRef);
    expect(view.roster.length).toBeGreaterThan(0);
    expect(view.caseManager?.id).toBeTruthy();
    expect(view.rolesTraceToCatalog).toBe(true);
    expect(view.teamChangeRequiresCaseManager).toBe(true);
    expect(view.teamIncludesPcp).toBe(true);
    expect(view.proposal?.requiresCaseManagerApproval).toBe(true);
    expect(view.proposal?.applied).toBe(false);
    expect(view.traceTaskId).toBe("careteam-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = careTeamViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this care-team assembly/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.careteam.pcp-required"
    );
    expect(view.policiesEvaluated).toContain("policy.careteam.pcp-required");
    expect(view.traceTaskId).toBe("careteam-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "careteam-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The care-team assembly could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = careTeamViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
