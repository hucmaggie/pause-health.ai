import { NextResponse } from "next/server";
import {
  type A2ATask,
  agentMessage,
  findDataPart,
  newTaskId,
  nowIso,
  parseTasksSendEnvelope
} from "../../../../../lib/a2a";
import {
  evaluateGovernance,
  recordInstantSpan
} from "../../../../../lib/agent-fabric";
import {
  type PatientCareTeamContext,
  type TeamChangeProposal,
  type TeamMember,
  DEMO_CARE_TEAM_PATIENT,
  assembleCareTeam,
  proposeTeamChange,
  rolesTraceToCatalog,
  teamChangeRequiresCaseManager,
  teamIncludesPcp
} from "../../../../../lib/care-team-management";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "care-team-management-agent";

/**
 * Google A2A `tasks/send` endpoint for the Care Team & Case Management agent
 * — a care-coordination agent that assembles the multi-disciplinary team
 * around a single high-need menopause/midlife patient.
 *
 *   POST /api/agents/care-team/tasks
 *
 * DETERMINISTICALLY assembles the roster + assigns a case manager + emits a
 * shared team snapshot. It NEVER autonomously adds or removes a member; a
 * legitimate team must include a PCP; every role must be catalog-sourced.
 * The assembly is a pure function of the caller-provided asOfDate + patient
 * context (no clock).
 *
 * Enforced-block policies checked before any assembly is returned:
 *   - policy.careteam.role-catalog-sourced (signal rolesTraceToCatalog) —
 *     every role on the roster and in the needed set must be catalog-sourced.
 *   - policy.careteam.no-autonomous-assignment (signal
 *     teamChangeRequiresCaseManager) — every roster change requires case-
 *     manager approval; the agent never autonomously adds or removes a
 *     member.
 *   - policy.careteam.pcp-required (signal teamIncludesPcp) — a legitimate
 *     roster must include a PCP anchor.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { patient?: PatientCareTeamContext, proposals?: TeamChangeProposal[],
 *     rosterOverride?: TeamMember[], neededRolesOverride?: string[] } — the
 *   patient is assembled by default; caller-asserted rosterOverride /
 *   neededRolesOverride demonstrate the role-catalog block, a caller-asserted
 *   proposals set demonstrates the no-autonomous-assignment block, and a
 *   patient / rosterOverride that omits role.pcp demonstrates the pcp-required
 *   block.
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  const parsed = parseTasksSendEnvelope(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: parsed.id, error: { code: parsed.code, message: parsed.message } },
      { status: 400 }
    );
  }

  const params = parsed.params;
  const taskId = params.id || newTaskId("careteam");
  const sessionId = params.sessionId;
  const parentSpanId =
    typeof params.metadata?.parentSpanId === "string"
      ? (params.metadata.parentSpanId as string)
      : undefined;
  const personaId =
    typeof params.metadata?.personaId === "string"
      ? (params.metadata.personaId as string)
      : undefined;

  const data = findDataPart(params.message?.parts) ?? {};
  const patient =
    data.patient && typeof data.patient === "object"
      ? (data.patient as PatientCareTeamContext)
      : DEMO_CARE_TEAM_PATIENT;

  // Deterministic care-team assembly.
  const assembly = assembleCareTeam(patient);

  // The roster the role-catalog gate checks — the caller-asserted set (to
  // demonstrate the block) or the produced assembly's roster.
  const rosterOverride = Array.isArray(data.rosterOverride)
    ? (data.rosterOverride as TeamMember[])
    : undefined;
  const rosterForCheck = rosterOverride ?? assembly.roster;

  // The needed-roles the role-catalog gate checks — the caller-asserted set
  // (to demonstrate an off-catalog needed role) or the produced set.
  const neededOverride = Array.isArray(data.neededRolesOverride)
    ? (data.neededRolesOverride as string[])
    : undefined;
  const neededForCheck = neededOverride ?? assembly.neededRoles;

  // The proposals the no-autonomous-assignment gate checks — the caller-
  // asserted set (to demonstrate the block) or an empty set (the agent's
  // default posture — no autonomous proposals, only the assembly + snapshot).
  const proposalsForCheck = Array.isArray(data.proposals)
    ? (data.proposals as TeamChangeProposal[])
    : [];

  // Honest governance signals.
  const rolesCatalog = rolesTraceToCatalog({
    roster: rosterForCheck,
    neededRoles: neededForCheck
  });
  const changeApproval = teamChangeRequiresCaseManager(proposalsForCheck);
  const pcpPresent = teamIncludesPcp(rosterForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      rolesTraceToCatalog: rolesCatalog,
      teamChangeRequiresCaseManager: changeApproval,
      teamIncludesPcp: pcpPresent
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "careteam.assemble.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: patient.patientRef,
        rolesTraceToCatalog: rolesCatalog,
        teamChangeRequiresCaseManager: changeApproval,
        teamIncludesPcp: pcpPresent,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        phiAccessed: true,
        ...(personaId ? { personaId } : {})
      }
    });
    const failed: A2ATask = {
      id: taskId,
      sessionId,
      status: {
        state: "failed",
        timestamp: nowIso(),
        message: agentMessage(
          `Pause Agent Fabric blocked this care-team assembly: ${governance.blockingViolations
            .map((v) => `${v.policyId} (${v.reason})`)
            .join("; ")}`,
          { blockingViolations: governance.blockingViolations }
        )
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
          violations: governance.blockingViolations
        }
      }
    };
    return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: failed });
  }

  // Assemble span — records the produced roster + case manager parented
  // under the caller's span if any.
  const assembleSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "careteam.assemble",
    protocol: "a2a",
    attributes: {
      patientRef: patient.patientRef,
      asOfDate: patient.asOfDate,
      rosterCount: assembly.roster.length,
      neededRoleCount: assembly.neededRoles.length,
      gapCount: assembly.gaps.length,
      caseManagerId: assembly.caseManager?.id ?? null,
      rolesTraceToCatalog: rolesCatalog,
      teamIncludesPcp: pcpPresent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Draft-proposals span — records that the agent's default posture is no
  // autonomous roster change; every change flows through the case manager.
  const draftSpan = recordInstantSpan({
    taskId,
    parentSpanId: assembleSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "careteam.draft-proposals",
    protocol: "a2a",
    attributes: {
      teamChangeRequiresCaseManager: changeApproval,
      proposalCount: 0,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // A default illustrative proposal — fill the first open gap (if any) with
  // a case-manager-approval gated add-member request.
  const firstGap = assembly.gaps[0];
  const defaultProposal = firstGap
    ? proposeTeamChange({
        action: "add-member",
        roleId: firstGap.roleId,
        rationale: firstGap.reason
      })
    : null;

  const result = { assembly, proposal: defaultProposal };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Assembled care team for ${assembly.patientRef} as of ${assembly.asOfDate}: ${assembly.roster.length}/${assembly.neededRoles.length} needed roles filled${
          assembly.caseManager
            ? `; assigned ${assembly.caseManager.label}`
            : "; no case manager assigned (empty pool)"
        }; ${assembly.gaps.length} open gap${assembly.gaps.length === 1 ? "" : "s"}${
          firstGap ? ` (first: ${firstGap.roleLabel})` : ""
        }. Every role on the roster + every needed role traces to the catalog; every team-change is case-manager sign-off gated (the agent never autonomously adds or removes a member); a legitimate team includes a PCP anchor. Synthetic — illustrative catalog, pool, and refs, not a certified care-team schema.`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "CareTeamAssembly",
        description:
          "Deterministically-produced multi-disciplinary care-team assembly for a single high-need menopause/midlife patient — the roster (role, member, responsibility) in role catalog order, the needed-roles set, per-role coverage, the flagged gaps (with a PCP gap deliberately raised to urgent), the deterministic case-manager assignment (a stable hash on the patientRef), a shared team snapshot, and a case-manager-approval gated team-change proposal for the first open gap (NEVER autonomously applied). The care-role catalog, condition→role trigger map, case-manager pool, and refs are illustrative/synthetic, NOT a certified care-team schema or a real provider directory.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: draftSpan.id,
        traceTaskId: taskId,
        patientRef: patient.patientRef,
        asOfDate: patient.asOfDate,
        rosterCount: assembly.roster.length,
        neededRoleCount: assembly.neededRoles.length,
        gapCount: assembly.gaps.length,
        caseManagerId: assembly.caseManager?.id ?? null,
        rolesTraceToCatalog: rolesCatalog,
        teamChangeRequiresCaseManager: changeApproval,
        teamIncludesPcp: pcpPresent
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
