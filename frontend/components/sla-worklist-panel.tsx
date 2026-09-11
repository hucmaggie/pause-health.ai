"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type ScheduledTask,
  type WorklistDetermination,
  type WorklistDisposition,
  type WorklistRequest,
  DEMO_WORKLIST_ALL_ON_TIME_REQUEST,
  DEMO_WORKLIST_REQUEST,
  DEMO_WORKLIST_TIGHT_REQUEST,
  evaluateWorklist
} from "../lib/sla-worklist";

/**
 * SLA Worklist Sequencing / Earliest-Deadline-First (EDF) Scheduling runner for the intake demo.
 *
 * Fires the real, server-side A2A SLA Worklist agent at /api/agents/sla-worklist/tasks — a payer-operations
 * work-sequencing service that orders a worklist earliest-deadline-first and flags the SLA breaches. The panel
 * surfaces the disposition, the EDF-ordered cases (with completion times + lateness), the honesty signals, the
 * synthetic / PHI labels, and a deep link into the parented Agent Fabric trace.
 *
 * A worklist — all-on-time or breaches-present — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresReviewerReview:true, autoDispatched:false). The fabricated-case, non-EDF-order, and auto-dispatched
 * presets assert offending DETERMINATIONS — so all three governance blocks are demonstrable in the UI rather
 * than hidden.
 *
 * PHI-bearing — each case references the member / claim being worked. The worklist is an ILLUSTRATIVE
 * synthetic, NOT a certified workforce / queueing system. Structure, styling tokens, and tone mirror
 * <ResourceSchedulingPanel> so this reads as a native sibling on /demo/intake.
 */

const SLA_WORKLIST_ROUTE = "/api/agents/sla-worklist/tasks";

/** A one-click demo scenario. */
export type SlaWorklistPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: WorklistRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateWorklist(DEMO_WORKLIST_REQUEST);

/** A self-consistently-timed but non-EDF order (auth-501 ahead of the earlier-deadline auth-502). */
const NON_EDF_SCHEDULED = [
  { taskId: "auth-501", duration: 30, deadline: 60, startTime: 0, completionTime: 30, late: false, label: "Prior-auth review" },
  { taskId: "auth-502", duration: 20, deadline: 40, startTime: 30, completionTime: 50, late: true, label: "Urgent prior-auth" },
  { taskId: "auth-504", duration: 25, deadline: 70, startTime: 50, completionTime: 75, late: true, label: "Prior-auth review" },
  { taskId: "auth-503", duration: 40, deadline: 200, startTime: 75, completionTime: 115, late: false, label: "Concurrent review" }
];

export const SLA_WORKLIST_PRESETS: SlaWorklistPreset[] = [
  {
    id: "breaches",
    label: "Worklist with an SLA breach",
    hint: "Four UM cases; one breaches its 70-minute SLA.",
    request: DEMO_WORKLIST_REQUEST,
    demonstrates: "EDF ordering \u2014 the earliest-deadline case runs first; the breach is flagged."
  },
  {
    id: "all-on-time",
    label: "All on time",
    hint: "Every case meets its SLA.",
    request: DEMO_WORKLIST_ALL_ON_TIME_REQUEST,
    demonstrates: "A comfortable worklist \u2014 no breaches."
  },
  {
    id: "over-committed",
    label: "Over-committed \u2192 two breaches",
    hint: "Even the optimal EDF order breaches two SLAs.",
    request: DEMO_WORKLIST_TIGHT_REQUEST,
    demonstrates: "The signal a supervisor needs to add staff or triage."
  },
  {
    id: "phantom-case-block",
    label: "Fabricated case \u2192 governance block",
    hint: "A scheduled case that wasn't submitted.",
    request: DEMO_WORKLIST_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      scheduled: VALID_DETERMINATION.scheduled.map((s) =>
        s.taskId === "auth-503" ? { ...s, taskId: "phantom-case" } : s
      )
    },
    demonstrates:
      "The Agent Fabric blocking a schedule whose case was never submitted (policy.worklist.schedule-sourced)."
  },
  {
    id: "non-edf-block",
    label: "Non-EDF order \u2192 governance block",
    hint: "A later-deadline case worked first.",
    request: DEMO_WORKLIST_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      scheduled: NON_EDF_SCHEDULED,
      lateCount: 2,
      onTimeCount: 2,
      disposition: "breaches-present"
    },
    demonstrates:
      "The Agent Fabric blocking an order that isn't earliest-deadline-first (policy.worklist.edf-ordered)."
  },
  {
    id: "auto-dispatched-block",
    label: "Dispatched autonomously \u2192 governance block",
    hint: "A worklist that started the cases itself.",
    request: DEMO_WORKLIST_REQUEST,
    determination: {
      ...VALID_DETERMINATION,
      requiresReviewerReview: false,
      autoDispatched: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous dispatch (policy.worklist.no-autonomous-dispatch)."
  }
];

/** Render-ready view of a produced worklist lifted from the task. */
export type SlaWorklistResolvedView = {
  kind: "resolved";
  queueRef: string;
  disposition: WorklistDisposition;
  scheduled: ScheduledTask[];
  lateCount: number;
  onTimeCount: number;
  total: number;
  reason: string;
  note: string;
  worklistScheduleSourced: boolean;
  worklistEdfOrdered: boolean;
  worklistNoAutonomousDispatch: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type SlaWorklistBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type SlaWorklistInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type SlaWorklistView =
  | SlaWorklistResolvedView
  | SlaWorklistBlockedView
  | SlaWorklistInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  worklistScheduleSourced?: unknown;
  worklistEdfOrdered?: unknown;
  worklistNoAutonomousDispatch?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildSlaWorklistRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: WorklistRequest;
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
 * POST a worklist request (or an asserted determination) to the agent and return the resulting A2A task.
 * `fetchImpl` is injectable so tests can stub the network boundary. A governance block comes back as HTTP 200
 * with a `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runSlaWorklistTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: WorklistRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(SLA_WORKLIST_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSlaWorklistRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * worklist (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function slaWorklistViewFromTask(task: A2ATask): SlaWorklistView {
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
        "The Agent Fabric blocked this worklist.";
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
      (typeof fabric.error === "string" ? fabric.error : "The worklist could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: WorklistDetermination; queueRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    queueRef: result?.queueRef ?? det?.queueRef ?? "",
    disposition: det?.disposition ?? "all-on-time",
    scheduled: det?.scheduled ?? [],
    lateCount: det?.lateCount ?? 0,
    onTimeCount: det?.onTimeCount ?? 0,
    total: det?.total ?? 0,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    worklistScheduleSourced: fabric.worklistScheduleSourced === true,
    worklistEdfOrdered: fabric.worklistEdfOrdered === true,
    worklistNoAutonomousDispatch: fabric.worklistNoAutonomousDispatch === true,
    traceTaskId
  };
}

const DISPOSITION_TONE: Record<WorklistDisposition, string> = {
  "all-on-time": "#8fd6b0",
  "breaches-present": "#ffd28a"
};

const DISPOSITION_LABEL: Record<WorklistDisposition, string> = {
  "all-on-time": "All on time \u00b7 every case meets its SLA in EDF order",
  "breaches-present": "Breaches present \u00b7 EDF order flags the SLA breaches"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: SlaWorklistView }
  | { status: "error"; message: string };

export function SlaWorklistPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: SlaWorklistPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runSlaWorklistTask({
          taskId: newTaskId("sla-worklist"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: slaWorklistViewFromTask(task) });
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
        Payer operations &middot; work sequencing &middot; earliest-deadline-first
      </p>
      <h3 style={{ margin: 0 }}>
        SLA Worklist Sequencing — schedule sourced &amp; self-consistent, EDF order recomputed, never an
        autonomous dispatch
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        This agent <strong>deterministically</strong> orders a worklist{" "}
        <strong>earliest-deadline-first</strong>, computes each case&rsquo;s cumulative completion time, and
        flags which cases will <strong>breach their SLA</strong> &mdash; the classic optimal single-processor
        discipline. Every scheduled case is a <strong>real submitted case</strong>, the completion times{" "}
        <strong>chain honestly</strong>, the order is the <strong>proven EDF sequence</strong>, and it is a{" "}
        <strong>recommendation</strong>: the agent <strong>never</strong> dispatches or reassigns a case
        &mdash; a supervisor confirms.{" "}
        <strong>PHI-bearing &middot; illustrative, not a certified workforce system.</strong> Run a preset,
        then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {SLA_WORKLIST_PRESETS.map((preset) => (
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
              ? "Sequencing\u2026"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Sequencing failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <SlaWorklistResult view={runState.view} />}
    </section>
  );
}

function SlaWorklistResult({ view }: { view: SlaWorklistView }) {
  const traceLink = (
    <p style={{ margin: "0.6rem 0 0", fontSize: "0.86rem" }}>
      <a
        href={`/demo/agent-fabric?taskId=${encodeURIComponent(view.traceTaskId)}`}
        className="agentforce-voice-help-link"
      >
        Open the multi-agent trace &rarr;
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
                <code>{v.policyId}</code> &mdash; {v.reason}
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
        Worklist (deterministic, synthetic)
        {view.queueRef ? ` \u00b7 ${view.queueRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: tone }}>
        {DISPOSITION_LABEL[view.disposition]}
      </p>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
        {view.onTimeCount} of {view.total} case(s) on time
        {view.lateCount > 0 ? ` \u00b7 ${view.lateCount} breaching SLA` : ""}
      </p>

      {view.scheduled.length > 0 && (
        <ol
          style={{
            margin: "0.5rem 0 0",
            paddingLeft: "1.3rem",
            color: "var(--muted)",
            fontSize: "0.84rem"
          }}
        >
          {view.scheduled.map((s) => (
            <li key={s.taskId}>
              <code>{s.taskId}</code> &middot; done at {s.completionTime} / SLA {s.deadline}{" "}
              {s.late ? (
                <span style={{ color: "#ffb6c8" }}>&middot; breach</span>
              ) : (
                <span style={{ color: "#8fd6b0" }}>&#10003; on time</span>
              )}
            </li>
          ))}
        </ol>
      )}

      <div
        role="note"
        aria-label="Worklist safety"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Sourced &middot; EDF-ordered &middot; never an autonomous dispatch{" "}
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
            synthetic &middot; PHI
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
          worklistScheduleSourced = {String(view.worklistScheduleSourced)} &middot; worklistEdfOrdered ={" "}
          {String(view.worklistEdfOrdered)} &middot; worklistNoAutonomousDispatch ={" "}
          {String(view.worklistNoAutonomousDispatch)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
