"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type Assignment,
  type CaseloadBalancingDetermination,
  type CaseloadBalancingDisposition,
  type CaseloadBalancingRequest,
  type ManagerLoad,
  type WaitlistedMember,
  DEMO_CASELOAD_BALANCING_BALANCED_REQUEST,
  DEMO_CASELOAD_BALANCING_REQUEST,
  DEMO_CASELOAD_BALANCING_WAITLIST_REQUEST
} from "../lib/caseload-balancing";

/**
 * Caseload Balancing runner for the intake demo.
 *
 * Fires the real, server-side A2A Caseload Balancing agent at /api/agents/caseload-balancing/tasks — a
 * care-coordination service that allocates a panel of members across the care managers' finite capacity.
 * The panel surfaces the disposition, the per-manager loads, any waitlist, the honesty signals, the
 * synthetic / PHI labels, and a deep link into the parented Agent Fabric trace.
 *
 * An allocation — fully assigned OR partially assigned with a waitlist — is a SAFE, honest OUTPUT (it
 * completes; it carries requiresCareLeadReview:true, autoAssigned:false). The dropped-member,
 * over-capacity, and auto-assigned presets assert offending DETERMINATIONS — so all three governance
 * blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-bearing — the members reference the patients on the panel. The panel is ILLUSTRATIVE, NOT a
 * certified caseload / staffing system. Structure, styling tokens, and tone mirror <AccessAnomalyPanel>
 * so this reads as a native sibling on /demo/intake.
 */

const CASELOAD_BALANCING_ROUTE = "/api/agents/caseload-balancing/tasks";

/** A one-click demo scenario. */
export type CaseloadBalancingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: CaseloadBalancingRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the fully-assigned demo — the base for the block presets. */
const VALID_DETERMINATION = {
  requestRef: "cbl-001",
  panelRef: "panel-4821",
  disposition: "fully-assigned",
  assignments: [
    { memberId: "m1", managerId: "mgr-a", acuity: 5 },
    { memberId: "m2", managerId: "mgr-b", acuity: 4 },
    { memberId: "m3", managerId: "mgr-c", acuity: 4 },
    { memberId: "m4", managerId: "mgr-a", acuity: 3 },
    { memberId: "m5", managerId: "mgr-b", acuity: 3 },
    { memberId: "m6", managerId: "mgr-a", acuity: 2 }
  ],
  managerLoads: [
    { managerId: "mgr-a", capacity: 10, assignedAcuity: 10, remainingCapacity: 0, memberCount: 3, memberIds: ["m1", "m4", "m6"] },
    { managerId: "mgr-b", capacity: 8, assignedAcuity: 7, remainingCapacity: 1, memberCount: 2, memberIds: ["m2", "m5"] },
    { managerId: "mgr-c", capacity: 6, assignedAcuity: 4, remainingCapacity: 2, memberCount: 1, memberIds: ["m3"] }
  ],
  waitlisted: [],
  members: [
    { memberId: "m1", acuity: 5 },
    { memberId: "m2", acuity: 4 },
    { memberId: "m3", acuity: 4 },
    { memberId: "m4", acuity: 3 },
    { memberId: "m5", acuity: 3 },
    { memberId: "m6", acuity: 2 }
  ],
  invalidMembers: [],
  invalidManagers: [],
  totalMembers: 6,
  assignedCount: 6,
  waitlistedCount: 0,
  totalCapacity: 24,
  totalAssignedAcuity: 21,
  requiresCareLeadReview: true,
  autoAssigned: false
};

export const CASELOAD_BALANCING_PRESETS: CaseloadBalancingPreset[] = [
  {
    id: "fully-assigned",
    label: "6 members, 3 managers → fully assigned",
    hint: "Total acuity 21 fits capacity 24.",
    request: DEMO_CASELOAD_BALANCING_REQUEST,
    demonstrates:
      "The worst-fit-decreasing greedy spreads 6 members across 3 managers within capacity — all assigned, load balanced."
  },
  {
    id: "waitlist",
    label: "Over capacity → partial + waitlist",
    hint: "Panel acuity 16 exceeds capacity 11.",
    request: DEMO_CASELOAD_BALANCING_WAITLIST_REQUEST,
    demonstrates:
      "When the panel's total acuity exceeds capacity, the overflow members are surfaced on a waitlist rather than silently dropped."
  },
  {
    id: "balanced",
    label: "Equal members → evenly balanced",
    hint: "4 equal members across 2 managers.",
    request: DEMO_CASELOAD_BALANCING_BALANCED_REQUEST,
    demonstrates:
      "Worst-fit places each member into the emptiest manager → the two managers end up perfectly balanced (2 and 2)."
  },
  {
    id: "dropped-member-block",
    label: "Dropped member → governance block",
    hint: "A member neither assigned nor waitlisted.",
    request: DEMO_CASELOAD_BALANCING_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: m6 is dropped — removed from the assignments and mgr-a's load, so it is
      // neither assigned nor waitlisted (a patient with no owner).
      assignments: VALID_DETERMINATION.assignments.filter((a) => a.memberId !== "m6"),
      managerLoads: VALID_DETERMINATION.managerLoads.map((l) =>
        l.managerId === "mgr-a"
          ? { ...l, assignedAcuity: 8, remainingCapacity: 2, memberCount: 2, memberIds: ["m1", "m4"] }
          : l
      )
    },
    demonstrates:
      "The Agent Fabric blocking an allocation that drops a member — not accounted for exactly once (policy.caseload.assignment-complete)."
  },
  {
    id: "over-capacity-block",
    label: "Manager over capacity → governance block",
    hint: "Assigned acuity exceeds capacity.",
    request: DEMO_CASELOAD_BALANCING_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: mgr-c is assigned acuity 4 but its capacity is claimed to be only 3.
      managerLoads: VALID_DETERMINATION.managerLoads.map((l) =>
        l.managerId === "mgr-c" ? { ...l, capacity: 3, remainingCapacity: -1 } : l
      ),
      totalCapacity: 21
    },
    demonstrates:
      "The Agent Fabric blocking an over-loaded manager (policy.caseload.capacity-respected)."
  },
  {
    id: "auto-assigned-block",
    label: "Assignment committed autonomously → governance block",
    hint: "An allocation that committed itself.",
    request: DEMO_CASELOAD_BALANCING_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      // Wrong: the agent committed the assignment and skipped care-lead review.
      requiresCareLeadReview: false,
      autoAssigned: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous assignment (policy.caseload.no-autonomous-assignment)."
  }
];

/** Render-ready view of a produced allocation lifted from the task. */
export type CaseloadBalancingResolvedView = {
  kind: "resolved";
  requestRef: string;
  panelRef: string;
  disposition: CaseloadBalancingDisposition;
  assignments: Assignment[];
  managerLoads: ManagerLoad[];
  waitlisted: WaitlistedMember[];
  totalMembers: number;
  assignedCount: number;
  waitlistedCount: number;
  totalCapacity: number;
  totalAssignedAcuity: number;
  reason: string;
  note: string;
  caseloadAssignmentComplete: boolean;
  caseloadCapacityRespected: boolean;
  caseloadNoAutonomousAssignment: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type CaseloadBalancingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type CaseloadBalancingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type CaseloadBalancingView =
  | CaseloadBalancingResolvedView
  | CaseloadBalancingBlockedView
  | CaseloadBalancingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  caseloadAssignmentComplete?: unknown;
  caseloadCapacityRespected?: unknown;
  caseloadNoAutonomousAssignment?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildCaseloadBalancingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: CaseloadBalancingRequest;
  determination?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (input.request !== undefined) data.request = input.request;
  if (input.determination !== undefined) data.determination = input.determination;
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
 * POST a caseload-balancing request (or an asserted allocation) to the Caseload Balancing agent and
 * return the resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A
 * governance block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse error
 * is a non-OK response.
 */
export async function runCaseloadBalancingTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: CaseloadBalancingRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(CASELOAD_BALANCING_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCaseloadBalancingRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * allocation (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function caseloadBalancingViewFromTask(task: A2ATask): CaseloadBalancingView {
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
        "The Agent Fabric blocked this caseload-balancing run.";
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
        : "The caseload could not be balanced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: CaseloadBalancingDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    panelRef: det?.panelRef ?? "",
    disposition: det?.disposition ?? "fully-assigned",
    assignments: det?.assignments ?? [],
    managerLoads: det?.managerLoads ?? [],
    waitlisted: det?.waitlisted ?? [],
    totalMembers: det?.totalMembers ?? 0,
    assignedCount: det?.assignedCount ?? 0,
    waitlistedCount: det?.waitlistedCount ?? 0,
    totalCapacity: det?.totalCapacity ?? 0,
    totalAssignedAcuity: det?.totalAssignedAcuity ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    caseloadAssignmentComplete: fabric.caseloadAssignmentComplete === true,
    caseloadCapacityRespected: fabric.caseloadCapacityRespected === true,
    caseloadNoAutonomousAssignment: fabric.caseloadNoAutonomousAssignment === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<CaseloadBalancingDisposition, string> = {
  "fully-assigned": "#8fd6b0",
  "partially-assigned-waitlist": "#ffd28a"
};

const DISPOSITION_LABEL: Record<CaseloadBalancingDisposition, string> = {
  "fully-assigned": "Fully assigned",
  "partially-assigned-waitlist": "Partially assigned · waitlist"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: CaseloadBalancingView }
  | { status: "error"; message: string };

export function CaseloadBalancingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: CaseloadBalancingPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runCaseloadBalancingTask({
          taskId: newTaskId("caseload-balancing"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: caseloadBalancingViewFromTask(task) });
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
        Care coordination · care-manager panel assignment · patient &amp; clinical
      </p>
      <h3 style={{ margin: 0 }}>
        Caseload Balancing — every member placed once, no manager over capacity, never an autonomous
        assignment
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> allocates a <strong>panel of members</strong>{" "}
        (each with an acuity weight) across <strong>care managers</strong> (each with a capacity),{" "}
        <strong>balancing the load</strong> and <strong>waitlisting</strong> the overflow. No
        sliding-window count, no interval merge — a <strong>greedy bin-packing under capacity</strong>.
        Every member is <strong>accounted for once</strong>, no manager is <strong>over capacity</strong>,
        and the result is a <strong>recommendation</strong>: the agent <strong>never</strong> commits an
        assignment — a care-management lead confirms every allocation.{" "}
        <strong>PHI-bearing · illustrative panel, not a certified system.</strong> Run a preset, then open
        the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {CASELOAD_BALANCING_PRESETS.map((preset) => (
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
              ? "Balancing…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Balancing run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <CaseloadBalancingResult view={runState.view} />}
    </section>
  );
}

function CaseloadBalancingResult({ view }: { view: CaseloadBalancingView }) {
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

  const tone = DISPOSITION_TONE[view.disposition];

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Allocation (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""}
        {view.panelRef ? ` · ${view.panelRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]} · {view.assignedCount}/{view.totalMembers} assigned ·
        acuity {view.totalAssignedAcuity}/{view.totalCapacity}
      </p>

      {view.managerLoads.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.managerLoads.map((l) => (
            <li key={l.managerId}>
              <strong>{l.managerId}</strong>: {l.assignedAcuity}/{l.capacity} acuity ({l.memberCount}{" "}
              member{l.memberCount === 1 ? "" : "s"}
              {l.memberIds.length > 0 ? ` — ${l.memberIds.join(", ")}` : ""}), {l.remainingCapacity}{" "}
              remaining
            </li>
          ))}
        </ul>
      )}

      {view.waitlisted.length > 0 && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "#ffb6c8" }}>
          Waitlisted: {view.waitlisted.map((w) => `${w.memberId} (acuity ${w.acuity})`).join(", ")}
        </p>
      )}

      <div
        role="note"
        aria-label="Allocation safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Accounted for once · within capacity · never an autonomous assignment{" "}
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
            synthetic · PHI-bearing
          </span>
        </p>
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
          {view.note}
        </p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          caseloadAssignmentComplete = {String(view.caseloadAssignmentComplete)} ·
          caseloadCapacityRespected = {String(view.caseloadCapacityRespected)} ·
          caseloadNoAutonomousAssignment = {String(view.caseloadNoAutonomousAssignment)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
