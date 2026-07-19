import { describe, expect, it } from "vitest";
import {
  CARE_ROLES,
  CASE_MANAGERS,
  DEMO_CARE_TEAM_PATIENT,
  DEMO_PCP_MISSING_PATIENT,
  ROLE_TRIGGERS,
  assembleCareTeam,
  assignCaseManager,
  getRole,
  isCareRole,
  proposeTeamChange,
  rolesTraceToCatalog,
  teamChangeRequiresCaseManager,
  teamIncludesPcp
} from "./care-team-management";

/**
 * Tests for lib/care-team-management.ts — the deterministic care-team
 * assembly behind the Care Team & Case Management Agent. Assembly is a pure
 * function of the patient context + asOfDate (no randomness, no clock), so
 * the same context always yields the same team + case manager + snapshot.
 * These pin determinism, the catalog-sourced roles, the case-manager stable-
 * hash assignment, and the three honest governance signals (role-catalog-
 * sourced + no-autonomous-assignment + pcp-required).
 */

describe("catalog", () => {
  it("exposes a stable, illustrative care-role catalog + case-manager pool", () => {
    expect(CARE_ROLES.length).toBeGreaterThan(0);
    for (const r of CARE_ROLES) {
      expect(r.id).toMatch(/^role\./);
      expect(r.synthetic).toBe(true);
    }
    // PCP + MSCP are universally required.
    const pcp = CARE_ROLES.find((r) => r.id === "role.pcp");
    const mscp = CARE_ROLES.find((r) => r.id === "role.mscp");
    expect(pcp?.universallyRequired).toBe(true);
    expect(mscp?.universallyRequired).toBe(true);
    // Every ROLE_TRIGGERS value is catalog-sourced (never invented).
    for (const [need, triggers] of Object.entries(ROLE_TRIGGERS)) {
      expect(Array.isArray(triggers)).toBe(true);
      for (const r of triggers) expect(isCareRole(r)).toBe(true);
      expect(need.length).toBeGreaterThan(0);
    }
    expect(CASE_MANAGERS.length).toBeGreaterThan(0);
  });

  it("catalog lookups agree with the catalog", () => {
    for (const r of CARE_ROLES) {
      expect(isCareRole(r.id)).toBe(true);
      expect(getRole(r.id)?.label).toBe(r.label);
    }
    expect(isCareRole("role.made-up")).toBe(false);
    expect(isCareRole(42)).toBe(false);
  });
});

describe("assignCaseManager", () => {
  it("is deterministic — same patientRef always yields the same case manager", () => {
    const a = assignCaseManager("careteam-patient-001");
    const b = assignCaseManager("careteam-patient-001");
    expect(a).toEqual(b);
    expect(CASE_MANAGERS).toContain(a!);
  });

  it("distributes across the pool for different patient refs", () => {
    const assigned = new Set(
      Array.from({ length: 20 }, (_, i) => assignCaseManager(`p-${i}`)?.id)
    );
    // With 3 case managers and 20 refs, at least 2 distinct managers get hit.
    expect(assigned.size).toBeGreaterThan(1);
  });
});

describe("assembleCareTeam", () => {
  it("is deterministic — same context always yields the same assembly", () => {
    const a = assembleCareTeam(DEMO_CARE_TEAM_PATIENT);
    const b = assembleCareTeam(DEMO_CARE_TEAM_PATIENT);
    expect(a).toEqual(b);
  });

  it("resolves the union of universal + condition-triggered needed roles", () => {
    const a = assembleCareTeam(DEMO_CARE_TEAM_PATIENT);
    // Universal (pcp, mscp) + cardiovascular (cardiology) + bone-health
    // (endocrinology + bone-health) + behavioral (behavioral-health).
    expect(a.neededRoles).toEqual([
      "role.pcp",
      "role.mscp",
      "role.cardiology",
      "role.endocrinology",
      "role.bone-health",
      "role.behavioral-health"
    ]);
    // Roster only has pcp, mscp, cardiology, behavioral-health — endo + bone are gaps.
    const gapRoleIds = a.gaps.map((g) => g.roleId);
    expect(gapRoleIds).toContain("role.endocrinology");
    expect(gapRoleIds).toContain("role.bone-health");
    expect(gapRoleIds).not.toContain("role.pcp");
    // PCP + MSCP are on the roster.
    expect(a.roster.some((m) => m.roleId === "role.pcp")).toBe(true);
    expect(a.roster.some((m) => m.roleId === "role.mscp")).toBe(true);
  });

  it("filters off-catalog members from the roster (source-integrity guard fires separately)", () => {
    const a = assembleCareTeam({
      ...DEMO_CARE_TEAM_PATIENT,
      currentMembers: [
        ...DEMO_CARE_TEAM_PATIENT.currentMembers!,
        {
          roleId: "role.made-up",
          roleLabel: "AI Concierge Liaison",
          responsibility: "",
          memberRef: "made-up",
          memberName: "N/A",
          assignedAt: "2026-01-01"
        }
      ]
    });
    // The off-catalog "AI Concierge" is not on the roster.
    expect(a.roster.some((m) => m.roleId === "role.made-up")).toBe(false);
  });

  it("orders the roster by role catalog order (stable, documented display)", () => {
    const a = assembleCareTeam(DEMO_CARE_TEAM_PATIENT);
    const roleOrder = a.roster.map((m) => m.roleId);
    const catalogOrder = CARE_ROLES.map((r) => r.id).filter((id) => roleOrder.includes(id));
    expect(roleOrder).toEqual(catalogOrder);
  });

  it("flags a missing PCP as an urgent gap (continuity-of-care anchor)", () => {
    const a = assembleCareTeam(DEMO_PCP_MISSING_PATIENT);
    const pcpGap = a.gaps.find((g) => g.roleId === "role.pcp");
    expect(pcpGap).toBeDefined();
    expect(pcpGap!.severity).toBe("urgent");
    // The pcp-required signal is separately enforced — the assembly still
    // completes so the case manager can see the gap.
    expect(teamIncludesPcp(a.roster)).toBe(false);
  });
});

describe("proposeTeamChange", () => {
  it("always requires case-manager approval; never applied autonomously", () => {
    const p = proposeTeamChange({
      action: "add-member",
      roleId: "role.endocrinology",
      rationale: "bone-health need requires endocrinology"
    });
    expect(p.requiresCaseManagerApproval).toBe(true);
    expect(p.applied).toBe(false);
    expect(p.state).toBe("ready-for-case-manager-approval");
    expect(p.action).toBe("add-member");
    expect(p.roleId).toBe("role.endocrinology");
  });
});

describe("governance signals", () => {
  const assembly = assembleCareTeam(DEMO_CARE_TEAM_PATIENT);
  const proposal = proposeTeamChange({
    action: "add-member",
    roleId: "role.endocrinology",
    rationale: "bone-health need"
  });

  it("rolesTraceToCatalog: true for a produced assembly, false when off-catalog", () => {
    expect(
      rolesTraceToCatalog({
        roster: assembly.roster,
        neededRoles: assembly.neededRoles
      })
    ).toBe(true);
    expect(
      rolesTraceToCatalog({
        roster: [{ roleId: "role.made-up" }],
        neededRoles: ["role.pcp"]
      })
    ).toBe(false);
    expect(
      rolesTraceToCatalog({
        roster: assembly.roster,
        neededRoles: ["role.made-up-need"]
      })
    ).toBe(false);
    expect(rolesTraceToCatalog(null)).toBe(false);
  });

  it("teamChangeRequiresCaseManager: true for produced proposals, false when applied or unapproved", () => {
    expect(teamChangeRequiresCaseManager([proposal])).toBe(true);
    expect(teamChangeRequiresCaseManager([])).toBe(true);
    expect(
      teamChangeRequiresCaseManager([
        {
          ...proposal,
          applied: true
        } as unknown as typeof proposal
      ])
    ).toBe(false);
    expect(
      teamChangeRequiresCaseManager([
        {
          requiresCaseManagerApproval: false,
          applied: false,
          state: "ready-for-case-manager-approval"
        }
      ])
    ).toBe(false);
    expect(teamChangeRequiresCaseManager(null)).toBe(false);
  });

  it("teamIncludesPcp: true when a role.pcp is on the roster, false otherwise", () => {
    expect(teamIncludesPcp(assembly.roster)).toBe(true);
    const noPcpAssembly = assembleCareTeam(DEMO_PCP_MISSING_PATIENT);
    expect(teamIncludesPcp(noPcpAssembly.roster)).toBe(false);
    expect(teamIncludesPcp([])).toBe(false);
    expect(teamIncludesPcp(null)).toBe(false);
  });
});
