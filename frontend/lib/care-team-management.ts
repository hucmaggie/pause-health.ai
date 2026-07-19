/**
 * Care Team & Case Management — deterministic multi-disciplinary team
 * assembly for high-need menopause/midlife patients + case-manager assignment.
 *
 * Deterministic, dependency-free domain core the Care Team & Case Management
 * Agent (app/api/agents/care-team) wraps — the Salesforce "Agentforce for
 * Health" / Health Cloud care-team-management analog on Pause's Agent Fabric.
 * Unlike the panel-level Population Health & Risk Stratification Agent (which
 * PRIORITIZES which patients need attention), this agent COORDINATES clinician
 * roles around a single high-need patient — assembling the multi-disciplinary
 * team (PCP, menopause specialist, cardiology, endocrinology, bone health,
 * pelvic-floor PT, behavioral health), assigning a case manager, and emitting
 * a shared team snapshot the whole team reads from.
 *
 *   Inbound:  PatientCareTeamContext (a synthetic patientRef — clearly
 *             labeled illustrative — the patient's active clinical needs
 *             (menopause-focused, cardiovascular, bone-health, behavioral),
 *             the assigned PCP + MSCP, optional other members, and an
 *             asOfDate accepted as data
 *   Outbound: CareTeamAssembly { roster: TeamMember[], caseManager:
 *             CaseManager | null, coverage: {role → present}, gaps: TeamGap[],
 *             snapshot, synthetic:true, note } and a case-manager-approval-
 *             gated TeamChangeProposal from proposeTeamChange()
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every role traces to the care-role catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every team member's role must trace to the defined CARE_ROLES catalog —
 *  a discipline / role label that isn't on the catalog is not a legitimate
 *  care-team role. Fabricating an "AI concierge liaison" role to pad the
 *  roster is a load-bearing failure mode this guard closes. Every needed
 *  role for the patient's condition must also be a catalog id — never
 *  invented. rolesTraceToCatalog() reports the honest signal the Agent
 *  Fabric enforces via policy.careteam.role-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no autonomous team assignment.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent may only DRAFT team-change proposals — it may NEVER autonomously
 *  add or remove a clinician from the team. Every proposeTeamChange() output
 *  is requiresCaseManagerApproval:true / applied:false; a caller-asserted
 *  plan that claims already-applied or bypasses the case manager is a
 *  violation. Mirrors the Prior Authorization Agent's no-autonomous-
 *  submission, the ACP Agent's no-autonomous-directive-change, and the HEDIS
 *  Agent's no-autonomous-submission posture. teamChangeRequiresCaseManager()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.careteam.no-autonomous-assignment.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a legitimate team must include a PCP.
 * ─────────────────────────────────────────────────────────────────────
 *  A care team without a primary care physician is not a legitimate team —
 *  the PCP is the continuity-of-care anchor every specialist coordinates
 *  around. A roster missing role:'pcp' is a violation. teamIncludesPcp()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.careteam.pcp-required. This is a shape / continuity-of-care
 *  invariant, deliberately load-bearing at the fabric level so no assembly
 *  can quietly ship a team without an accountable PCP.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified care-team / case-management system.
 * ─────────────────────────────────────────────────────────────────────
 *  The care-role catalog, condition→role mapping, case-manager pool, and
 *  responsibility labels below are ILLUSTRATIVE synthetic/demo values chosen
 *  to model the SHAPE of multi-disciplinary team assembly for a midlife /
 *  menopause panel — they are NOT a certified care-team schema, a real
 *  provider directory, or a case-management workflow engine (real programs
 *  are payer- and network-specific). The patientRefs, memberRefs, and
 *  case-manager ids are synthetic / de-identified. There is NO randomness
 *  and NO clock anywhere here: the assembly is a pure function of the
 *  patient context + asOfDate the caller passes, so the same context always
 *  yields the same team + case manager + snapshot — which is what lets the
 *  demo, the seeded trace, and the tests agree.
 */

/**
 * A single care-team role in the (illustrative) role catalog. Every role
 * exposes whether it is UNIVERSALLY required for a menopause/midlife patient
 * or only conditionally on the patient's active clinical needs.
 */
export type CareRole = {
  /** Stable catalog id every team member references (never invented). */
  id: string;
  /** Human-readable role label. */
  label: string;
  /** Illustrative role responsibility (never a legal / certified definition). */
  responsibility: string;
  /**
   * Universal: a menopause/midlife team needs this role regardless of active
   * conditions. Conditional roles are keyed off ROLE_TRIGGERS below.
   */
  universallyRequired: boolean;
  /** Always true — the catalog is an illustrative synthetic. */
  synthetic: true;
};

/**
 * The illustrative care-role catalog. Two roles are universally required
 * (PCP + MSCP); the rest are triggered by the patient's active clinical
 * needs. Illustrative / synthetic — NOT a certified care-team schema.
 */
export const CARE_ROLES: CareRole[] = [
  {
    id: "role.pcp",
    label: "Primary care physician",
    responsibility:
      "Continuity-of-care anchor: coordinates across specialists, closes preventive-care gaps, and remains accountable for the whole-person plan.",
    universallyRequired: true,
    synthetic: true
  },
  {
    id: "role.mscp",
    label: "Menopause society certified practitioner (MSCP)",
    responsibility:
      "Menopause-specific specialist: reviews HRT / non-hormonal options, symptom trajectory, and midlife-relevant preventive-care windows.",
    universallyRequired: true,
    synthetic: true
  },
  {
    id: "role.cardiology",
    label: "Cardiology",
    responsibility:
      "Cardiovascular-risk consultation — lipid management, BP control, ASCVD risk-adjustment in the perimenopause / postmenopause transition.",
    universallyRequired: false,
    synthetic: true
  },
  {
    id: "role.endocrinology",
    label: "Endocrinology",
    responsibility:
      "Endocrine consultation — bone-health / osteoporosis management, thyroid, and hormonal contraindications review for complex HRT candidates.",
    universallyRequired: false,
    synthetic: true
  },
  {
    id: "role.bone-health",
    label: "Bone health / DEXA program",
    responsibility:
      "Osteoporosis-risk assessment: coordinates DEXA scans, calcium/Vit-D advice, and fall-risk reduction referrals.",
    universallyRequired: false,
    synthetic: true
  },
  {
    id: "role.pelvic-floor-pt",
    label: "Pelvic floor physical therapist",
    responsibility:
      "Pelvic-health rehabilitation — genitourinary syndrome of menopause, incontinence, and post-op pelvic-floor recovery.",
    universallyRequired: false,
    synthetic: true
  },
  {
    id: "role.behavioral-health",
    label: "Behavioral health clinician",
    responsibility:
      "Mental-health support — mood / anxiety / sleep disruption in the menopause transition; coordinates with the Care Router's behavioral-health handoff.",
    universallyRequired: false,
    synthetic: true
  }
];

const ROLE_BY_ID = new Map(CARE_ROLES.map((r) => [r.id, r]));

/** Is `id` a defined care-role catalog id? */
export function isCareRole(id: unknown): boolean {
  return typeof id === "string" && ROLE_BY_ID.has(id);
}

/** Look up a care role by id (undefined for an off-catalog id). */
export function getRole(id: string): CareRole | undefined {
  return ROLE_BY_ID.get(id);
}

/**
 * The clinical needs (illustrative) that trigger a conditional care-team role.
 * Every value in this map is a defined catalog role id — never invented.
 * `cardiovascular` → cardiology, `bone-health` → endocrinology + bone-health,
 * `menopause-focus` is universal (mscp), `behavioral` → behavioral-health,
 * `pelvic-floor` → pelvic-floor-pt.
 */
export type ClinicalNeed =
  | "menopause-focus"
  | "cardiovascular"
  | "bone-health"
  | "behavioral"
  | "pelvic-floor";

export const ROLE_TRIGGERS: Record<ClinicalNeed, string[]> = {
  "menopause-focus": [],
  cardiovascular: ["role.cardiology"],
  "bone-health": ["role.endocrinology", "role.bone-health"],
  behavioral: ["role.behavioral-health"],
  "pelvic-floor": ["role.pelvic-floor-pt"]
};

/**
 * The illustrative case-manager pool. Case-manager assignment is a stable
 * documented hash of the patient's ref → an index in this pool, so the same
 * patient always yields the same manager (no randomness, no clock).
 */
export type CaseManager = {
  /** Stable case-manager id (illustrative synthetic — de-identified). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Illustrative panel size (informational only — not used in scoring). */
  panelCount: number;
  /** Always true — the pool is an illustrative synthetic. */
  synthetic: true;
};

export const CASE_MANAGERS: CaseManager[] = [
  {
    id: "cm.001",
    label: "Case Manager A · Midlife Care Program",
    panelCount: 42,
    synthetic: true
  },
  {
    id: "cm.002",
    label: "Case Manager B · Midlife Care Program",
    panelCount: 38,
    synthetic: true
  },
  {
    id: "cm.003",
    label: "Case Manager C · Midlife Care Program",
    panelCount: 47,
    synthetic: true
  }
];

/**
 * Deterministically map a patient ref → a case manager index. A stable
 * djb2-style hash over the ASCII bytes; documented + testable, no randomness,
 * no clock. Same patientRef always yields the same manager.
 */
function stableHashIndex(patientRef: string, poolSize: number): number {
  let hash = 5381;
  for (let i = 0; i < patientRef.length; i += 1) {
    hash = (hash * 33 + patientRef.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % Math.max(1, poolSize);
}

/** Assign a case manager to a patient ref (deterministic; empty pool → null). */
export function assignCaseManager(patientRef: string): CaseManager | null {
  if (CASE_MANAGERS.length === 0) return null;
  return CASE_MANAGERS[stableHashIndex(patientRef, CASE_MANAGERS.length)];
}

/** A single team member's registration on the roster. */
export type TeamMember = {
  /** The care-role catalog id (never invented). */
  roleId: string;
  /** Copied from the catalog for display convenience. */
  roleLabel: string;
  /** Copied from the catalog for display convenience. */
  responsibility: string;
  /** Illustrative synthetic clinician ref (never a real provider). */
  memberRef: string;
  /** Illustrative synthetic display name. */
  memberName: string;
  /** ISO date the member joined the team (accepted as data — no clock). */
  assignedAt: string;
};

/** A gap in the assembled team — a needed role that has no assigned member. */
export type TeamGap = {
  /** The needed care-role catalog id (never invented). */
  roleId: string;
  /** Copied from the catalog for display convenience. */
  roleLabel: string;
  /** Human-readable reason this role is needed for THIS patient. */
  reason: string;
  /** Deterministic severity. */
  severity: "routine" | "elevated" | "urgent";
};

/** The deterministic care-team assembly the agent returns. */
export type CareTeamAssembly = {
  /** The synthetic patient reference this assembly is about. */
  patientRef: string;
  /** As-of date the assembly was computed against (accepted as data). */
  asOfDate: string;
  /** The multi-disciplinary roster (ordered by role catalog order). */
  roster: TeamMember[];
  /** Every role needed for this patient (catalog-sourced). */
  neededRoles: string[];
  /** Per-role coverage flag (present / gap). */
  coverage: Array<{ roleId: string; roleLabel: string; present: boolean }>;
  /** Gaps — needed roles the patient has no member for. */
  gaps: TeamGap[];
  /** The deterministic case-manager assignment (or null on an empty pool). */
  caseManager: CaseManager | null;
  /** Rule-based shared team snapshot (never a live-model narrative). */
  snapshot: string;
  /** Always true — the catalog, pool, and refs are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note. */
  note: string;
};

/** The state of a team-change proposal. NEVER autonomously applied. */
export type TeamChangeState = "draft" | "ready-for-case-manager-approval";

/**
 * A team-change proposal. It is ALWAYS requiresCaseManagerApproval:true /
 * applied:false — the agent never adds or removes a member on its own.
 * Mirrors the ACP directive-change proposal shape.
 */
export type TeamChangeProposal = {
  /** draft / ready-for-case-manager-approval. */
  state: TeamChangeState;
  /** add-member / remove-member / reassign-case-manager. */
  action: "add-member" | "remove-member" | "reassign-case-manager";
  /** The role affected, when action targets a role. */
  roleId?: string;
  /** The member affected, when action targets a specific member. */
  memberRef?: string;
  /** Illustrative rationale. */
  rationale: string;
  /** Always true — a change ALWAYS requires case-manager approval. */
  requiresCaseManagerApproval: true;
  /** Always false — the agent NEVER autonomously adds or removes a member. */
  applied: false;
  /** Human-readable proposal body. */
  body: string;
};

/**
 * The structured signals the care-team planner reads. `patientRef` is a
 * synthetic, de-identified id — clearly labeled illustrative. Every needed-
 * role and every assigned member's roleId must be catalog-sourced;
 * off-catalog roles fall to the source-integrity signal, not the assembly.
 */
export type PatientCareTeamContext = {
  /** Synthetic, de-identified patient reference (e.g. "careteam-patient-001"). */
  patientRef: string;
  /** As-of date the assembly is `as of` (accepted as data — no clock). */
  asOfDate: string;
  /**
   * Active clinical needs (illustrative). Drive the conditional-role triggers
   * beyond the universally-required roles (PCP + MSCP). Duplicates are
   * de-duplicated; unknown values are ignored (the assembly reflects only
   * defined needs — the source-integrity signal separately catches an
   * off-catalog role a caller might assert as needed).
   */
  clinicalNeeds?: ClinicalNeed[];
  /**
   * Team members already assigned. Every roleId must be a defined
   * catalog id — off-catalog roles surface via rolesTraceToCatalog().
   */
  currentMembers?: TeamMember[];
};

/** Resolve the ordered set of needed role ids for a patient. */
function neededRolesFor(ctx: PatientCareTeamContext): string[] {
  const set = new Set<string>();
  // Universal roles first, in catalog order.
  for (const r of CARE_ROLES) if (r.universallyRequired) set.add(r.id);
  // Conditional roles added by clinical need (each trigger is catalog-sourced).
  for (const need of ctx.clinicalNeeds ?? []) {
    const triggers = ROLE_TRIGGERS[need];
    if (!triggers) continue;
    for (const rid of triggers) set.add(rid);
  }
  // Preserve catalog order for a stable, documented output.
  return CARE_ROLES.filter((r) => set.has(r.id)).map((r) => r.id);
}

/**
 * Assemble a patient's multi-disciplinary care team. DETERMINISTIC: needed
 * roles are the union of universally-required + condition-triggered roles,
 * coverage is the intersection with the current members (only members whose
 * roleId is catalog-sourced count toward coverage — off-catalog roles are
 * surfaced by the source-integrity signal), gaps are the difference, and
 * the case manager is the stable-hash assignment on the patient ref. A pure
 * function of the context + asOfDate (no randomness, no clock).
 */
export function assembleCareTeam(ctx: PatientCareTeamContext): CareTeamAssembly {
  const neededRoles = neededRolesFor(ctx);

  const legitimateMembers = (ctx.currentMembers ?? []).filter((m) => isCareRole(m.roleId));

  // Roster is the legitimate members ordered by role catalog order for a
  // stable, documented display.
  const roster: TeamMember[] = CARE_ROLES.flatMap((r) =>
    legitimateMembers.filter((m) => m.roleId === r.id)
  ).map((m) => ({
    ...m,
    roleLabel: getRole(m.roleId)?.label ?? m.roleLabel,
    responsibility: getRole(m.roleId)?.responsibility ?? m.responsibility
  }));

  const rolesOnRoster = new Set(roster.map((m) => m.roleId));

  const coverage = neededRoles.map((roleId) => ({
    roleId,
    roleLabel: getRole(roleId)?.label ?? roleId,
    present: rolesOnRoster.has(roleId)
  }));

  const gaps: TeamGap[] = neededRoles
    .filter((roleId) => !rolesOnRoster.has(roleId))
    .map((roleId) => {
      const role = getRole(roleId);
      const universal = role?.universallyRequired === true;
      return {
        roleId,
        roleLabel: role?.label ?? roleId,
        reason: universal
          ? `${role?.label} is universally required for a midlife/menopause team`
          : `${role?.label} is required for one of this patient's active clinical needs`,
        severity: roleId === "role.pcp" ? "urgent" : universal ? "elevated" : "routine"
      };
    });

  const caseManager = assignCaseManager(ctx.patientRef);

  const rosterSummary = roster.length
    ? roster.map((m) => `${m.roleLabel} (${m.memberName})`).join(", ")
    : "no members on file";
  const gapSummary = gaps.length
    ? gaps.map((g) => g.roleLabel).join(", ")
    : "no open gaps";
  const cmLabel = caseManager?.label ?? "unassigned (empty case-manager pool)";
  const snapshot =
    `Care team as of ${ctx.asOfDate} for ${ctx.patientRef} — coordinator: ${cmLabel}. ` +
    `Roster: ${rosterSummary}. Open gaps: ${gapSummary}. ` +
    "Every team-change requires case-manager approval; the agent never autonomously adds or removes a member.";

  const note =
    `Assembled care team for ${ctx.patientRef} as of ${ctx.asOfDate}: ${roster.length} member${
      roster.length === 1 ? "" : "s"
    } on ${neededRoles.length} needed role${
      neededRoles.length === 1 ? "" : "s"
    }; ${gaps.length} gap${gaps.length === 1 ? "" : "s"}. ` +
    "Every role on the roster and every needed role traces to the illustrative care-role catalog; the agent NEVER autonomously adds or removes a team member — every change is case-manager sign-off gated; and a legitimate care team must include a PCP (the continuity-of-care anchor). Synthetic/illustrative catalog, case-manager pool, and refs — not a certified care-team schema.";

  return {
    patientRef: ctx.patientRef,
    asOfDate: ctx.asOfDate,
    roster,
    neededRoles,
    coverage,
    gaps,
    caseManager,
    snapshot,
    synthetic: true,
    note
  };
}

/**
 * Propose a team change (add / remove a member, reassign the case manager)
 * for the assigned case manager to approve. Deterministic on its input.
 * NEVER autonomously applied: requiresCaseManagerApproval is always true,
 * applied is always false. Mirrors proposeDirectiveChange from the ACP core.
 */
export function proposeTeamChange(input: {
  action: TeamChangeProposal["action"];
  roleId?: string;
  memberRef?: string;
  rationale: string;
}): TeamChangeProposal {
  const label = input.roleId ? getRole(input.roleId)?.label ?? input.roleId : "";
  return {
    state: "ready-for-case-manager-approval",
    action: input.action,
    ...(input.roleId ? { roleId: input.roleId } : {}),
    ...(input.memberRef ? { memberRef: input.memberRef } : {}),
    rationale: input.rationale,
    requiresCaseManagerApproval: true,
    applied: false,
    body:
      `Team-change proposal · ${input.action}${label ? ` (${label})` : ""} · ${input.rationale}. ` +
      "Ready for the assigned case manager to approve — the agent NEVER autonomously adds or removes a team member."
  };
}

/**
 * Source-integrity check: does EVERY role on the roster + every needed role
 * trace to the CARE_ROLES catalog? True when both sets are catalog-only; the
 * guard that catches a caller-asserted off-catalog role (a fabricated
 * discipline label) either on the roster or in the needed set. This is the
 * honest signal the route reports to policy.careteam.role-catalog-sourced.
 * A non-object input is a violation.
 */
export function rolesTraceToCatalog(
  input:
    | { roster?: Array<{ roleId?: string }>; neededRoles?: string[] }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  const roster = Array.isArray(input.roster) ? input.roster : [];
  const needed = Array.isArray(input.neededRoles) ? input.neededRoles : [];
  if (!roster.every((m) => isCareRole(m.roleId))) return false;
  if (!needed.every((r) => isCareRole(r))) return false;
  return true;
}

/**
 * Human-approval check: does EVERY team-change proposal require case-manager
 * approval, and is it explicitly NOT applied? True for anything
 * proposeTeamChange() produces (and the trivial empty-set default); the guard
 * that catches a caller-asserted plan that would autonomously add / remove a
 * member or bypass approval. This is the honest signal the route reports to
 * policy.careteam.no-autonomous-assignment. A non-array input is a violation.
 */
export function teamChangeRequiresCaseManager(
  proposals:
    | Array<{
        requiresCaseManagerApproval?: boolean;
        applied?: boolean;
        state?: string;
      }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(proposals)) return false;
  return proposals.every((p) => {
    if (p.requiresCaseManagerApproval !== true) return false;
    if (p.applied === true) return false;
    return true;
  });
}

/**
 * Continuity-of-care check: does the roster include a PCP (role.pcp)? True
 * when a PCP is on the roster; the guard that catches a roster that would
 * ship without an accountable primary-care anchor. This is the honest signal
 * the route reports to policy.careteam.pcp-required. A non-array input is a
 * violation.
 */
export function teamIncludesPcp(
  roster: Array<{ roleId?: string }> | null | undefined
): boolean {
  if (!Array.isArray(roster)) return false;
  return roster.some((m) => m.roleId === "role.pcp");
}

/**
 * A representative, deterministic demo patient (illustrative). A high-need
 * midlife patient with cardiovascular + bone-health + behavioral needs — so
 * the full multi-disciplinary team assembly (with a PCP + MSCP + cardiology +
 * endocrinology + bone-health + behavioral-health, but a pelvic-floor-PT gap
 * NOT applicable), plus a stable case-manager assignment, is demonstrable.
 * Synthetic / de-identified.
 */
export const DEMO_CARE_TEAM_PATIENT: PatientCareTeamContext = {
  patientRef: "careteam-patient-001",
  asOfDate: "2026-07-01",
  clinicalNeeds: ["menopause-focus", "cardiovascular", "bone-health", "behavioral"],
  currentMembers: [
    {
      roleId: "role.pcp",
      roleLabel: "Primary care physician",
      responsibility: "",
      memberRef: "member-pcp-001",
      memberName: "Dr. A. Reyes",
      assignedAt: "2025-08-14"
    },
    {
      roleId: "role.mscp",
      roleLabel: "MSCP",
      responsibility: "",
      memberRef: "member-mscp-001",
      memberName: "Dr. J. Okafor",
      assignedAt: "2025-08-14"
    },
    {
      roleId: "role.cardiology",
      roleLabel: "Cardiology",
      responsibility: "",
      memberRef: "member-card-001",
      memberName: "Dr. K. Patel",
      assignedAt: "2025-09-02"
    },
    {
      roleId: "role.behavioral-health",
      roleLabel: "Behavioral health",
      responsibility: "",
      memberRef: "member-bh-001",
      memberName: "LCSW P. Nguyen",
      assignedAt: "2025-10-11"
    }
  ]
};

/**
 * A representative "missing PCP" demo patient (illustrative). Same clinical
 * profile as DEMO_CARE_TEAM_PATIENT, but with the PCP intentionally omitted
 * so the pcp-required governance block is demonstrable. Synthetic /
 * de-identified.
 */
export const DEMO_PCP_MISSING_PATIENT: PatientCareTeamContext = {
  patientRef: "careteam-patient-002",
  asOfDate: "2026-07-01",
  clinicalNeeds: ["menopause-focus", "cardiovascular"],
  currentMembers: [
    {
      roleId: "role.mscp",
      roleLabel: "MSCP",
      responsibility: "",
      memberRef: "member-mscp-002",
      memberName: "Dr. J. Okafor",
      assignedAt: "2025-08-14"
    },
    {
      roleId: "role.cardiology",
      roleLabel: "Cardiology",
      responsibility: "",
      memberRef: "member-card-002",
      memberName: "Dr. K. Patel",
      assignedAt: "2025-09-02"
    }
  ]
};
