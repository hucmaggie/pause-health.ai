"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type EnrollmentReconciliationDetermination,
  type EnrollmentReconciliationRequest,
  type ReconciliationAction,
  DEMO_ENROLLMENT_RECONCILIATION_CLEAN_REQUEST,
  DEMO_ENROLLMENT_RECONCILIATION_NEW_GROUP_REQUEST,
  DEMO_ENROLLMENT_RECONCILIATION_REQUEST
} from "../lib/enrollment-reconciliation";

/**
 * Eligibility & Enrollment (834) Reconciliation runner for the intake demo.
 *
 * Fires the real, server-side A2A Enrollment Reconciliation agent at
 * /api/agents/enrollment-reconciliation/tasks — a payer-operations service that reconciles a group's
 * employer roster against the carrier's roster. The panel surfaces the per-kind counts, the actions
 * (with the field deltas), the honesty signals, the synthetic / PHI labels, and a deep link into the
 * parented Agent Fabric trace.
 *
 * A reconciliation — any set of actions, including all-no-change — is a SAFE, honest OUTPUT (it
 * completes; it carries requiresBenefitsAdminReview:true, autoApplied:false). The dropped-member,
 * fabricated-discrepancy, and auto-applied presets assert offending DETERMINATIONS — so all three
 * governance blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-bearing — the rosters reference members and their coverage. The rosters are ILLUSTRATIVE, NOT a
 * certified 834 system. Structure, styling tokens, and tone mirror <MemberCostSharePanel> so this
 * reads as a native sibling on /demo/intake.
 */

const ENROLLMENT_RECONCILIATION_ROUTE = "/api/agents/enrollment-reconciliation/tasks";

/** A one-click demo scenario. */
export type EnrollmentReconciliationPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: EnrollmentReconciliationRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const ENROLLMENT_RECONCILIATION_PRESETS: EnrollmentReconciliationPreset[] = [
  {
    id: "drift",
    label: "Rosters drifted → enroll / terminate / update / no-change",
    hint: "One of each action.",
    request: DEMO_ENROLLMENT_RECONCILIATION_REQUEST,
    demonstrates:
      "The set-difference at work — a new hire enrolls, a departed employee terminates, a tier change updates, an unchanged member stays."
  },
  {
    id: "clean",
    label: "Rosters agree → all no-change",
    hint: "No drift.",
    request: DEMO_ENROLLMENT_RECONCILIATION_CLEAN_REQUEST,
    demonstrates:
      "Two rosters that already agree → every member is no-change; a clean reconciliation is still a completed output."
  },
  {
    id: "new-group",
    label: "New group, empty carrier → all enroll",
    hint: "Carrier has no roster yet.",
    request: DEMO_ENROLLMENT_RECONCILIATION_NEW_GROUP_REQUEST,
    demonstrates:
      "A brand-new group the carrier has no roster for → every member is an enroll."
  },
  {
    id: "dropped-member-block",
    label: "Dropped member → governance block",
    hint: "totalMembers says 4 but only 3 actions.",
    request: DEMO_ENROLLMENT_RECONCILIATION_REQUEST,
    determination: {
      requestRef: "recon-001",
      groupRef: "group-4821",
      comparedFields: ["name", "coverageTier", "planId", "status"],
      totalMembers: 4,
      // Wrong: only 3 actions but totalMembers claims 4 — a member was dropped.
      actions: [
        { memberId: "M1", action: "no-change" },
        { memberId: "M2", action: "update", differingFields: [{ field: "coverageTier", sourceValue: "employee-only", carrierValue: "family" }] },
        { memberId: "M3", action: "enroll" }
      ],
      counts: { enroll: 1, terminate: 0, update: 1, noChange: 1 },
      requiresBenefitsAdminReview: true,
      autoApplied: false
    },
    demonstrates:
      "The Agent Fabric blocking an incomplete reconciliation (policy.enrollment.reconciliation-complete)."
  },
  {
    id: "fabricated-discrepancy-block",
    label: "Fabricated discrepancy → governance block",
    hint: "An 'update' whose values are identical.",
    request: DEMO_ENROLLMENT_RECONCILIATION_REQUEST,
    determination: {
      requestRef: "recon-001",
      groupRef: "group-4821",
      comparedFields: ["name", "coverageTier", "planId", "status"],
      totalMembers: 1,
      actions: [
        // Wrong: an "update" whose source and carrier values are the same — a fabricated discrepancy.
        { memberId: "M1", action: "update", differingFields: [{ field: "coverageTier", sourceValue: "family", carrierValue: "family" }] }
      ],
      counts: { enroll: 0, terminate: 0, update: 1, noChange: 0 },
      requiresBenefitsAdminReview: true,
      autoApplied: false
    },
    demonstrates:
      "The Agent Fabric blocking a fabricated discrepancy (policy.enrollment.actions-sourced)."
  },
  {
    id: "auto-applied-block",
    label: "Changes applied autonomously → governance block",
    hint: "A determination that posted itself.",
    request: DEMO_ENROLLMENT_RECONCILIATION_REQUEST,
    determination: {
      requestRef: "recon-001",
      groupRef: "group-4821",
      comparedFields: ["name", "coverageTier", "planId", "status"],
      totalMembers: 2,
      actions: [
        { memberId: "M3", action: "enroll" },
        { memberId: "M4", action: "terminate" }
      ],
      counts: { enroll: 1, terminate: 1, update: 0, noChange: 0 },
      // Wrong: the agent applied the changes and skipped benefits-admin review.
      requiresBenefitsAdminReview: false,
      autoApplied: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous enrollment change (policy.enrollment.no-autonomous-change)."
  }
];

/** Render-ready view of a produced reconciliation lifted from the task. */
export type EnrollmentReconciliationResolvedView = {
  kind: "resolved";
  requestRef: string;
  groupRef: string;
  totalMembers: number;
  counts: { enroll: number; terminate: number; update: number; noChange: number };
  actions: ReconciliationAction[];
  reason: string;
  note: string;
  reconciliationComplete: boolean;
  reconciliationActionsSourced: boolean;
  reconciliationNoAutonomousChange: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type EnrollmentReconciliationBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type EnrollmentReconciliationInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type EnrollmentReconciliationView =
  | EnrollmentReconciliationResolvedView
  | EnrollmentReconciliationBlockedView
  | EnrollmentReconciliationInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  reconciliationComplete?: unknown;
  reconciliationActionsSourced?: unknown;
  reconciliationNoAutonomousChange?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildEnrollmentReconciliationRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: EnrollmentReconciliationRequest;
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
 * POST a reconciliation request (or an asserted determination) to the Enrollment Reconciliation agent
 * and return the resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary.
 * A governance block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse
 * error is a non-OK response.
 */
export async function runEnrollmentReconciliationTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: EnrollmentReconciliationRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(ENROLLMENT_RECONCILIATION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildEnrollmentReconciliationRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * reconciliation (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function enrollmentReconciliationViewFromTask(task: A2ATask): EnrollmentReconciliationView {
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
        "The Agent Fabric blocked this enrollment-reconciliation run.";
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
        : "The enrollment reconciliation could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: EnrollmentReconciliationDetermination; requestRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    groupRef: det?.groupRef ?? "",
    totalMembers: det?.totalMembers ?? 0,
    counts: det?.counts ?? { enroll: 0, terminate: 0, update: 0, noChange: 0 },
    actions: det?.actions ?? [],
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    reconciliationComplete: fabric.reconciliationComplete === true,
    reconciliationActionsSourced: fabric.reconciliationActionsSourced === true,
    reconciliationNoAutonomousChange: fabric.reconciliationNoAutonomousChange === true,
    traceTaskId
  };
}

const ACTION_TONE: Record<string, string> = {
  enroll: "#8fd6b0",
  terminate: "#ffb6c8",
  update: "#ffd28a",
  "no-change": "#9db8ff"
};

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

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: EnrollmentReconciliationView }
  | { status: "error"; message: string };

export function EnrollmentReconciliationPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: EnrollmentReconciliationPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runEnrollmentReconciliationTask({
          taskId: newTaskId("enrollment-reconciliation"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: enrollmentReconciliationViewFromTask(task) });
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
        Eligibility &amp; enrollment · 834 reconciliation · payer &amp; plan operations
      </p>
      <h3 style={{ margin: 0 }}>
        Enrollment Reconciliation — complete, every action sourced, never an autonomous change
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> compares a group&rsquo;s source-of-truth roster
        (the employer / HR feed) against the carrier&rsquo;s roster and emits the actions —{" "}
        <strong>enroll / terminate / update / no-change</strong> — that bring them into agreement. No
        dollar waterfall, no identity match — a keyed <strong>set-difference</strong> + a field-level
        comparison. Every member is accounted for <strong>exactly once</strong>, and the actions are a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> applies an enrollment change —
        a benefits administrator posts every one.{" "}
        <strong>PHI-bearing · illustrative rosters, not a certified 834 system.</strong> Run a preset,
        then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {ENROLLMENT_RECONCILIATION_PRESETS.map((preset) => (
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
              ? "Reconciling…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Reconciliation run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <EnrollmentReconciliationResult view={runState.view} />}
    </section>
  );
}

function EnrollmentReconciliationResult({ view }: { view: EnrollmentReconciliationView }) {
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

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Reconciliation (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""}
        {view.groupRef ? ` · ${view.groupRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Members" value={String(view.totalMembers)} tone="#9db8ff" />{" "}
        <Pill label="Enroll" value={String(view.counts.enroll)} tone="#8fd6b0" />{" "}
        <Pill label="Terminate" value={String(view.counts.terminate)} tone="#ffb6c8" />{" "}
        <Pill label="Update" value={String(view.counts.update)} tone="#ffd28a" />{" "}
        <Pill label="No-change" value={String(view.counts.noChange)} tone="#9db8ff" />
      </p>

      {view.actions.length > 0 && (
        <ul
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.1rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.actions.map((a) => (
            <li key={a.memberId}>
              <strong>{a.memberId}</strong> →{" "}
              <span style={{ color: ACTION_TONE[a.action] ?? "#9db8ff", fontWeight: 600 }}>
                {a.action}
              </span>
              {a.differingFields && a.differingFields.length > 0 && (
                <span>
                  {" "}
                  (
                  {a.differingFields
                    .map((d) => `${d.field}: ${d.sourceValue} → ${d.carrierValue}`)
                    .join(", ")}
                  )
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div
        role="note"
        aria-label="Reconciliation safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Complete · every action sourced · never an autonomous change{" "}
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
          reconciliationComplete = {String(view.reconciliationComplete)} ·
          reconciliationActionsSourced = {String(view.reconciliationActionsSourced)} ·
          reconciliationNoAutonomousChange = {String(view.reconciliationNoAutonomousChange)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
