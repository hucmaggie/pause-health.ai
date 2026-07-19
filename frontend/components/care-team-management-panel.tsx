"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_CARE_TEAM_PATIENT,
  DEMO_PCP_MISSING_PATIENT,
  type CareTeamAssembly,
  type CaseManager,
  type PatientCareTeamContext,
  type TeamChangeProposal,
  type TeamGap,
  type TeamMember
} from "../lib/care-team-management";

/**
 * Care Team & Case Management runner for the intake demo.
 *
 * Fires the real, server-side A2A care-team agent at
 * /api/agents/care-team/tasks — a care-coordination agent that assembles the
 * multi-disciplinary team around a single high-need patient. The panel
 * surfaces the roster (with role, member, responsibility), the per-role
 * coverage, the flagged gaps, the assigned case manager, the shared team
 * snapshot, the honesty signals, and a deep link into the parented Agent
 * Fabric trace.
 *
 * The off-catalog-role, autonomous-assign, and missing-PCP governance-block
 * presets assert offending plans — so all three governance blocks are
 * demonstrable in the UI rather than hidden.
 *
 * The care-role catalog, condition→role trigger map, case-manager pool, and
 * refs are ILLUSTRATIVE synthetics, NOT a certified care-team schema.
 */

const CARE_TEAM_ROUTE = "/api/agents/care-team/tasks";

/** A one-click demo scenario. */
export type CareTeamPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  patient?: PatientCareTeamContext;
  assertedRosterOverride?: Array<Record<string, unknown>>;
  assertedNeededRolesOverride?: string[];
  assertedProposals?: Array<Record<string, unknown>>;
};

export const CARE_TEAM_PRESETS: CareTeamPreset[] = [
  {
    id: "high-need-patient",
    label: "Assemble team for a high-need patient",
    hint: "Cardiovascular + bone-health + behavioral needs, PCP + MSCP on file.",
    patient: DEMO_CARE_TEAM_PATIENT,
    demonstrates:
      "The agent assembling the multi-disciplinary care team from the patient's active clinical needs, filling PCP + MSCP + cardiology + behavioral-health, flagging endocrinology + bone-health as open gaps, and assigning a case manager by a stable-hash pick from the synthetic pool."
  },
  {
    id: "offcatalog-role-block",
    label: "Off-catalog role → governance block",
    hint: "Roster with a fabricated 'AI Concierge' role.",
    patient: DEMO_CARE_TEAM_PATIENT,
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
    demonstrates:
      "The Agent Fabric blocking a roster that includes an off-catalog / fabricated discipline role — the guard against padding a team with an invented role (policy.careteam.role-catalog-sourced)."
  },
  {
    id: "autonomous-assign-block",
    label: "Autonomous team change → governance block",
    hint: "A proposal that would add a member without case-manager approval.",
    patient: DEMO_CARE_TEAM_PATIENT,
    assertedProposals: [
      {
        action: "add-member",
        roleId: "role.endocrinology",
        rationale: "auto-add",
        requiresCaseManagerApproval: false,
        applied: true,
        state: "applied"
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a team-change that bypasses the case manager — the agent NEVER autonomously adds or removes a member (policy.careteam.no-autonomous-assignment)."
  },
  {
    id: "missing-pcp-block",
    label: "No PCP on roster → governance block",
    hint: "Specialist-only roster with no accountable PCP anchor.",
    patient: DEMO_PCP_MISSING_PATIENT,
    demonstrates:
      "The Agent Fabric blocking a roster that ships without a PCP — the continuity-of-care anchor every specialist coordinates around (policy.careteam.pcp-required)."
  }
];

/** Render-ready view of a produced assembly lifted from the task. */
export type CareTeamAssembledView = {
  kind: "assembled";
  patientRef: string;
  asOfDate: string;
  roster: TeamMember[];
  neededRoles: string[];
  coverage: Array<{ roleId: string; roleLabel: string; present: boolean }>;
  gaps: TeamGap[];
  caseManager: CaseManager | null;
  snapshot: string;
  proposal: TeamChangeProposal | null;
  note: string;
  rolesTraceToCatalog: boolean;
  teamChangeRequiresCaseManager: boolean;
  teamIncludesPcp: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type CareTeamBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type CareTeamInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type CareTeamView =
  | CareTeamAssembledView
  | CareTeamBlockedView
  | CareTeamInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  rolesTraceToCatalog?: unknown;
  teamChangeRequiresCaseManager?: unknown;
  teamIncludesPcp?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure
 * (no fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildCareTeamRequestBody(input: {
  taskId: string;
  personaId?: string;
  patient?: PatientCareTeamContext;
  assertedRosterOverride?: Array<Record<string, unknown>>;
  assertedNeededRolesOverride?: string[];
  assertedProposals?: Array<Record<string, unknown>>;
}) {
  const data: Record<string, unknown> = {};
  if (input.patient !== undefined) data.patient = input.patient;
  if (input.assertedRosterOverride !== undefined) {
    data.rosterOverride = input.assertedRosterOverride;
  }
  if (input.assertedNeededRolesOverride !== undefined) {
    data.neededRolesOverride = input.assertedNeededRolesOverride;
  }
  if (input.assertedProposals !== undefined) data.proposals = input.assertedProposals;
  return {
    jsonrpc: "2.0" as const,
    id: input.taskId,
    method: "tasks/send" as const,
    params: {
      id: input.taskId,
      message: {
        role: "user" as const,
        parts: [{ type: "data" as const, data }]
      },
      metadata: { personaId: input.personaId ?? "demo" }
    }
  };
}

/**
 * POST a patient (or an asserted plan) to the care-team agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the
 * network boundary.
 */
export async function runCareTeamTask(
  input: {
    taskId: string;
    personaId?: string;
    patient?: PatientCareTeamContext;
    assertedRosterOverride?: Array<Record<string, unknown>>;
    assertedNeededRolesOverride?: string[];
    assertedProposals?: Array<Record<string, unknown>>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CARE_TEAM_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCareTeamRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * assembly (completed) from a governance block vs. an invalid request.
 */
export function careTeamViewFromTask(task: A2ATask): CareTeamView {
  const fabric = ((task.metadata?.agentFabric as FabricMeta) ?? {}) as FabricMeta;
  const traceTaskId =
    (typeof fabric.traceTaskId === "string" && fabric.traceTaskId) || task.id;

  if (task.status.state === "failed") {
    if (fabric.decision === "block") {
      const violations = Array.isArray(fabric.violations)
        ? (fabric.violations as { policyId: string; reason: string }[])
        : [];
      const message =
        task.status.message?.parts.find((p) => p.type === "text")?.text ??
        "The Agent Fabric blocked this care-team assembly.";
      return {
        kind: "blocked",
        message,
        policiesEvaluated: asStringArray(fabric.policiesEvaluated),
        violations,
        traceTaskId
      };
    }
    const message =
      task.status.message?.parts.find((p) => p.type === "text")?.text ??
      (typeof fabric.error === "string"
        ? fabric.error
        : "The care-team assembly could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { assembly?: CareTeamAssembly; proposal?: TeamChangeProposal | null }
      | undefined) ?? undefined;
  const assembly = result?.assembly;

  return {
    kind: "assembled",
    patientRef: assembly?.patientRef ?? "",
    asOfDate: assembly?.asOfDate ?? "",
    roster: assembly?.roster ?? [],
    neededRoles: assembly?.neededRoles ?? [],
    coverage: assembly?.coverage ?? [],
    gaps: assembly?.gaps ?? [],
    caseManager: assembly?.caseManager ?? null,
    snapshot: assembly?.snapshot ?? "",
    proposal: result?.proposal ?? null,
    note: assembly?.note ?? "",
    rolesTraceToCatalog: fabric.rolesTraceToCatalog === true,
    teamChangeRequiresCaseManager: fabric.teamChangeRequiresCaseManager === true,
    teamIncludesPcp: fabric.teamIncludesPcp === true,
    traceTaskId
  };
}

function Pill({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.1rem 0.5rem",
        borderRadius: "999px",
        border: `1px solid ${tone}`,
        color: tone,
        fontSize: "0.74rem",
        fontWeight: 600
      }}
    >
      {label}: {value}
    </span>
  );
}

const SEVERITY_TONE: Record<string, string> = {
  urgent: "#ffb6c8",
  elevated: "#ffd28a",
  routine: "#9fb3c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: CareTeamView }
  | { status: "error"; message: string };

export function CareTeamManagementPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: CareTeamPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runCareTeamTask({
          taskId: newTaskId("careteam"),
          personaId: "demo",
          patient: preset.patient,
          assertedRosterOverride: preset.assertedRosterOverride,
          assertedNeededRolesOverride: preset.assertedNeededRolesOverride,
          assertedProposals: preset.assertedProposals
        });
        setRunState({ status: "done", view: careTeamViewFromTask(task) });
      } catch (err) {
        setRunState({
          status: "error",
          message: err instanceof Error ? err.message : String(err)
        });
      }
    })();
  };

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.15rem" }}>
        Care team &amp; case management
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that coordinates the multi-disciplinary team around a high-need
        patient — never a roster edit without the case manager
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The care-team agent assembles the{" "}
        <strong>multi-disciplinary team</strong> around a single high-need
        menopause/midlife patient — PCP, MSCP, cardiology, endocrinology,
        bone-health, pelvic-floor PT, behavioral health — deterministically
        resolves which roles are needed from the patient&apos;s active clinical
        needs, <strong>assigns a case manager</strong> by a stable hash on the
        patient ref, and emits a{" "}
        <strong>shared team snapshot</strong> for the whole team. Every role must{" "}
        <strong>trace to the care-role catalog</strong>, every roster change is{" "}
        <strong>case-manager sign-off gated</strong> (no autonomous add/remove),
        and a legitimate team must include a{" "}
        <strong>PCP anchor</strong>.{" "}
        <strong>
          The care-role catalog, condition→role triggers, case-manager pool,
          and refs are illustrative synthetics, not a certified care-team
          schema.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CARE_TEAM_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => runPreset(preset)}
            title={`${preset.hint} ${preset.demonstrates}`}
            style={{ fontSize: "0.85rem" }}
          >
            {runState.status === "running" && runState.label === preset.label
              ? "Assembling…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Care-team assembly failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <CareTeamResult view={runState.view} />}
    </section>
  );
}

function CareTeamResult({ view }: { view: CareTeamView }) {
  const traceLink = (
    <p style={{ margin: "0.6rem 0 0", fontSize: "0.86rem" }}>
      <a
        href={`/demo/agent-fabric?taskId=${encodeURIComponent(view.traceTaskId)}`}
        className="agentforce-voice-help-link"
      >
        Open the multi-agent trace →
      </a>
    </p>
  );

  if (view.kind === "blocked") {
    return (
      <div className="routing-live-result">
        <p className="eyebrow" style={{ marginBottom: "0.3rem", color: "#ffb6c8" }}>
          Blocked by the Agent Fabric
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>{view.message}</p>
        {view.violations.length > 0 && (
          <ul
            style={{
              margin: "0.5rem 0 0",
              paddingLeft: "1.1rem",
              color: "var(--muted)",
              fontSize: "0.85rem"
            }}
          >
            {view.violations.map((v) => (
              <li key={v.policyId}>
                <code>{v.policyId}</code> — {v.reason}
              </li>
            ))}
          </ul>
        )}
        {view.policiesEvaluated.length > 0 && (
          <p
            style={{
              margin: "0.5rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            policies evaluated: {view.policiesEvaluated.join(", ")}
          </p>
        )}
        {traceLink}
      </div>
    );
  }

  if (view.kind === "invalid") {
    return (
      <div className="routing-live-result">
        <p className="eyebrow" style={{ marginBottom: "0.3rem", color: "#ffd28a" }}>
          Not processed
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>{view.message}</p>
        {traceLink}
      </div>
    );
  }

  const covered = view.coverage.filter((c) => c.present).length;

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Care-team assembly (deterministic, synthetic catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Patient" value={view.patientRef} tone="#9fb3c8" />{" "}
        <Pill label="As of" value={view.asOfDate} tone="#9fb3c8" />{" "}
        <Pill
          label="Coverage"
          value={`${covered}/${view.coverage.length}`}
          tone={
            covered === view.coverage.length
              ? "#8fd6b0"
              : covered >= view.coverage.length / 2
              ? "#ffd28a"
              : "#ffb6c8"
          }
        />{" "}
        {view.caseManager && (
          <Pill label="Case manager" value={view.caseManager.id} tone="#8fd6b0" />
        )}
      </p>

      <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
        Roster (role catalog order)
      </p>
      <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
        {view.roster.map((m) => (
          <li
            key={`${m.roleId}-${m.memberRef}`}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "0.55rem",
              border: "1px solid var(--line)",
              background: "rgba(255,255,255,0.03)",
              marginBottom: "0.4rem"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.5rem",
                flexWrap: "wrap",
                alignItems: "baseline"
              }}
            >
              <strong style={{ fontSize: "0.9rem" }}>
                {m.roleLabel} · {m.memberName}
              </strong>
              <Pill label="Assigned" value={m.assignedAt} tone="#9fb3c8" />
            </div>
            {m.responsibility && (
              <p
                style={{
                  margin: "0.25rem 0 0",
                  fontSize: "0.78rem",
                  color: "var(--muted)"
                }}
              >
                {m.responsibility}
              </p>
            )}
          </li>
        ))}
      </ul>

      {view.gaps.length > 0 && (
        <>
          <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem", color: "#ffd28a" }}>
            Open team gaps (needs a case-manager-approved add)
          </p>
          <ul style={{ margin: 0, listStyle: "none", padding: 0 }}>
            {view.gaps.map((g) => (
              <li
                key={g.roleId}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.55rem",
                  border: "1px solid var(--line)",
                  background: "rgba(255,255,255,0.03)",
                  marginBottom: "0.4rem"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                    alignItems: "baseline"
                  }}
                >
                  <strong style={{ fontSize: "0.88rem" }}>{g.roleLabel}</strong>
                  <Pill
                    label="Severity"
                    value={g.severity}
                    tone={SEVERITY_TONE[g.severity] ?? "#9fb3c8"}
                  />
                </div>
                <p
                  style={{
                    margin: "0.25rem 0 0",
                    fontSize: "0.78rem",
                    color: "var(--muted)"
                  }}
                >
                  {g.reason}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      {view.caseManager && (
        <div
          role="note"
          aria-label="Assigned case manager"
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Case manager · {view.caseManager.label}{" "}
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 600,
                color: "#ffd28a",
                border: "1px solid #ffd28a",
                borderRadius: "999px",
                padding: "0.05rem 0.4rem",
                marginLeft: "0.35rem"
              }}
            >
              synthetic
            </span>
          </p>
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            id = {view.caseManager.id} · panelCount = {view.caseManager.panelCount}
          </p>
        </div>
      )}

      {view.proposal && (
        <div
          role="note"
          aria-label="Team change proposal"
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Team change proposal ·{" "}
            <span style={{ color: "#ffd28a" }}>{view.proposal.state}</span>
          </p>
          <p style={{ margin: "0.3rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
            {view.proposal.body}
          </p>
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.78rem",
              color: "var(--muted)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
            }}
          >
            action = {view.proposal.action} · requiresCaseManagerApproval ={" "}
            {String(view.proposal.requiresCaseManagerApproval)} · applied ={" "}
            {String(view.proposal.applied)}
          </p>
        </div>
      )}

      <div
        role="note"
        aria-label="Team snapshot"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
          {view.snapshot}
        </p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          rolesTraceToCatalog = {String(view.rolesTraceToCatalog)} ·
          teamChangeRequiresCaseManager ={" "}
          {String(view.teamChangeRequiresCaseManager)} · teamIncludesPcp ={" "}
          {String(view.teamIncludesPcp)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
