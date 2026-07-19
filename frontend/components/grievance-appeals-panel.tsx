"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_BILLING_INTAKE,
  DEMO_GRIEVANCE_INTAKE,
  type GrievanceAppealCase,
  type MemberCaseIntake,
  type ResolutionProposal
} from "../lib/grievance-appeals";

/**
 * Grievance & Appeals runner for the intake demo.
 *
 * Fires the real, server-side A2A grievance-and-appeals agent at
 * /api/agents/grievance-appeals/tasks — a member-service intake agent that
 * classifies member complaints + coverage-denial appeals, routes each to
 * the correct human queue, and stamps a regulatory deadline. The panel
 * surfaces the classified case type, urgency, target queue, deadline, the
 * PHI-safe routing summary, the honesty signals, and a deep link into the
 * parented Agent Fabric trace.
 *
 * The autonomous-resolve, deadline-extension, and PHI-in-routing
 * governance-block presets assert offending plans — so all three
 * governance blocks are demonstrable in the UI rather than hidden.
 */

const GRIEVANCE_ROUTE = "/api/agents/grievance-appeals/tasks";

/** A one-click demo scenario. */
export type GrievanceAppealsPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  intake?: MemberCaseIntake;
  assertedProposals?: Array<Record<string, unknown>>;
  assertedRoutingSummaryOverride?: Record<string, unknown>;
  assertedDeadlineOverride?: {
    caseType?: string;
    receivedDate?: string;
    deadlineDate?: string;
  };
};

export const GRIEVANCE_APPEALS_PRESETS: GrievanceAppealsPreset[] = [
  {
    id: "expedited-denial",
    label: "Expedited coverage-denial appeal → clinical-review (3d)",
    hint: "HRT prior auth denied, member requests expedited handling.",
    intake: DEMO_GRIEVANCE_INTAKE,
    demonstrates:
      "The agent classifying an expedited coverage-denial appeal, routing to the clinical-review queue with a 3-day regulatory deadline, and emitting a PHI-safe routing summary (structured only — no free-text PHI). Every resolution is queued for human action."
  },
  {
    id: "billing-grievance",
    label: "Billing dispute → member-services (30d)",
    hint: "Member disputes a copay charge.",
    intake: DEMO_BILLING_INTAKE,
    demonstrates:
      "The agent classifying a billing-dispute grievance, routing to the member-services queue with a 30-day regulatory deadline, and emitting a PHI-safe routing summary."
  },
  {
    id: "autonomous-resolve-block",
    label: "Autonomous resolve → governance block",
    hint: "A proposal that would close a case without the human queue.",
    intake: DEMO_GRIEVANCE_INTAKE,
    assertedProposals: [
      {
        caseId: "case-x",
        queue: "clinical-review",
        rationale: "auto-resolve",
        requiresHumanQueueAction: false,
        applied: true
      }
    ],
    demonstrates:
      "The Agent Fabric blocking a case resolution that bypasses the human queue — the agent NEVER autonomously resolves, approves, or denies a case (policy.grievance.no-autonomous-resolution)."
  },
  {
    id: "deadline-extension-block",
    label: "Deadline pushed past reg max → governance block",
    hint: "A caller-asserted 30-day deadline on a 3-day expedited appeal.",
    intake: DEMO_GRIEVANCE_INTAKE,
    assertedDeadlineOverride: {
      caseType: "case.appeal-expedited-coverage-denial",
      receivedDate: "2026-07-01",
      deadlineDate: "2026-07-31"
    },
    demonstrates:
      "The Agent Fabric blocking a deadline silently extended past the regulatory maximum — the load-bearing regulatory-compliance guard against breaching Medicare Advantage Chapter 13 / state-insurance-code timelines (policy.grievance.deadline-integrity)."
  },
  {
    id: "phi-in-routing-block",
    label: "PHI in routing summary → governance block",
    hint: "A routing summary with free-text clinical detail.",
    intake: DEMO_GRIEVANCE_INTAKE,
    assertedRoutingSummaryOverride: {
      memberRef: "member-001",
      caseType: "case.appeal-expedited-coverage-denial",
      urgency: "expedited",
      queue: "clinical-review",
      deadlineDate: "2026-07-04",
      phiSafe: true,
      clinicalDetail: "denial for estradiol patch; menopause symptoms worsening"
    },
    demonstrates:
      "The Agent Fabric blocking a routing summary that leaks free-text PHI — the guard against PHI leakage into downstream channels (Slack, email, ticketing) (policy.grievance.no-phi-in-routing-summary)."
  }
];

/** Render-ready view of a produced case lifted from the task. */
export type GrievanceReportedView = {
  kind: "reported";
  case: GrievanceAppealCase;
  proposal: ResolutionProposal | null;
  caseResolutionRequiresHumanQueue: boolean;
  deadlineTracesToCatalog: boolean;
  routingSummaryIsPhiSafe: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type GrievanceBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type GrievanceInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type GrievanceAppealsView =
  | GrievanceReportedView
  | GrievanceBlockedView
  | GrievanceInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  caseResolutionRequiresHumanQueue?: unknown;
  deadlineTracesToCatalog?: unknown;
  routingSummaryIsPhiSafe?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure
 * (no fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildGrievanceAppealsRequestBody(input: {
  taskId: string;
  personaId?: string;
  intake?: MemberCaseIntake;
  assertedProposals?: Array<Record<string, unknown>>;
  assertedRoutingSummaryOverride?: Record<string, unknown>;
  assertedDeadlineOverride?: {
    caseType?: string;
    receivedDate?: string;
    deadlineDate?: string;
  };
}) {
  const data: Record<string, unknown> = {};
  if (input.intake !== undefined) data.intake = input.intake;
  if (input.assertedProposals !== undefined) data.proposals = input.assertedProposals;
  if (input.assertedRoutingSummaryOverride !== undefined) {
    data.routingSummaryOverride = input.assertedRoutingSummaryOverride;
  }
  if (input.assertedDeadlineOverride !== undefined) {
    data.deadlineOverride = input.assertedDeadlineOverride;
  }
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
 * POST an intake (or an asserted plan) to the grievance agent and return
 * the resulting A2A task. `fetchImpl` is injectable so tests can stub the
 * network boundary.
 */
export async function runGrievanceAppealsTask(
  input: {
    taskId: string;
    personaId?: string;
    intake?: MemberCaseIntake;
    assertedProposals?: Array<Record<string, unknown>>;
    assertedRoutingSummaryOverride?: Record<string, unknown>;
    assertedDeadlineOverride?: {
      caseType?: string;
      receivedDate?: string;
      deadlineDate?: string;
    };
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(GRIEVANCE_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildGrievanceAppealsRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * case (completed) from a governance block vs. an invalid request.
 */
export function grievanceAppealsViewFromTask(
  task: A2ATask
): GrievanceAppealsView {
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
        "The Agent Fabric blocked this grievance-and-appeals run.";
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
        : "The grievance-and-appeals case could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { case?: GrievanceAppealCase; proposal?: ResolutionProposal | null }
      | undefined) ?? undefined;
  const grievanceCase = result?.case;

  if (!grievanceCase) {
    return {
      kind: "invalid",
      message: "The grievance-and-appeals case could not be lifted from the task.",
      traceTaskId
    };
  }

  return {
    kind: "reported",
    case: grievanceCase,
    proposal: result?.proposal ?? null,
    caseResolutionRequiresHumanQueue:
      fabric.caseResolutionRequiresHumanQueue === true,
    deadlineTracesToCatalog: fabric.deadlineTracesToCatalog === true,
    routingSummaryIsPhiSafe: fabric.routingSummaryIsPhiSafe === true,
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

const URGENCY_TONE: Record<string, string> = {
  expedited: "#ffb6c8",
  standard: "#9fb3c8"
};

const QUEUE_TONE: Record<string, string> = {
  "member-services": "#9fb3c8",
  "clinical-review": "#ffd28a",
  compliance: "#ffb6c8"
};

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: GrievanceAppealsView }
  | { status: "error"; message: string };

export function GrievanceAppealsPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const busy = runState.status === "running";

  const runPreset = (preset: GrievanceAppealsPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runGrievanceAppealsTask({
          taskId: newTaskId("grievance"),
          personaId: "demo",
          intake: preset.intake,
          assertedProposals: preset.assertedProposals,
          assertedRoutingSummaryOverride: preset.assertedRoutingSummaryOverride,
          assertedDeadlineOverride: preset.assertedDeadlineOverride
        });
        setRunState({ status: "done", view: grievanceAppealsViewFromTask(task) });
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
        Grievance &amp; appeals
      </p>
      <h3 style={{ margin: 0 }}>
        The agent that classifies member complaints and coverage denials — never
        resolves them, never leaks PHI, never extends a regulatory deadline
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The grievance-and-appeals agent runs the{" "}
        <strong>intake half</strong> of the regulated process — classifying a
        member complaint or coverage-denial appeal (grievance / billing /
        standard-appeal / expedited-appeal), routing it to the correct{" "}
        <strong>human queue</strong> (member-services / clinical-review /
        compliance), and stamping a <strong>regulatory deadline</strong> that
        traces to the case-type catalog + received date. It{" "}
        <strong>NEVER</strong> resolves, approves, or denies a case on its own;
        every case is queued for human review. The routing summary handed to
        the receiving queue is{" "}
        <strong>PHI-safe</strong> (structured only — no free-text PHI), so it
        can be delivered via lower-trust channels (Slack, email, ticketing)
        without leaking PHI.{" "}
        <strong>
          The case-type catalog, deadline windows, and queue mapping are
          illustrative synthetics, not Medicare Advantage Chapter 13 or a real
          appeal-adjudication engine.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {GRIEVANCE_APPEALS_PRESETS.map((preset) => (
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
              ? "Classifying…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Grievance-and-appeals run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && (
        <GrievanceAppealsResult view={runState.view} />
      )}
    </section>
  );
}

function GrievanceAppealsResult({ view }: { view: GrievanceAppealsView }) {
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

  const c = view.case;
  const summary = c.phiSafeRoutingSummary;

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Case classification (deterministic, synthetic catalog)
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Case" value={c.caseId} tone="#9fb3c8" />{" "}
        <Pill label="Type" value={c.caseTypeLabel} tone="#9fb3c8" />{" "}
        <Pill
          label="Urgency"
          value={c.urgency}
          tone={URGENCY_TONE[c.urgency] ?? "#9fb3c8"}
        />{" "}
        <Pill
          label="Queue"
          value={c.queue}
          tone={QUEUE_TONE[c.queue] ?? "#9fb3c8"}
        />{" "}
        <Pill label="Deadline" value={c.deadlineDate} tone="#ffd28a" />
      </p>

      <div
        role="note"
        aria-label="PHI-safe routing summary"
        style={{
          marginTop: "0.6rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
          PHI-safe routing summary (structured only — no free-text PHI){" "}
          <span
            style={{
              fontSize: "0.72rem",
              fontWeight: 600,
              color: "#8fd6b0",
              border: "1px solid #8fd6b0",
              borderRadius: "999px",
              padding: "0.05rem 0.4rem",
              marginLeft: "0.35rem"
            }}
          >
            phiSafe:true
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
          memberRef = {summary.memberRef} · caseType = {summary.caseType} ·
          urgency = {summary.urgency} · queue = {summary.queue} · deadlineDate ={" "}
          {summary.deadlineDate}
        </p>
      </div>

      {view.proposal && (
        <div
          role="note"
          aria-label="Resolution proposal"
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "0.55rem",
            border: "1px solid var(--line)",
            background: "rgba(255,255,255,0.03)"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>
            Resolution proposal ·{" "}
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
            requiresHumanQueueAction ={" "}
            {String(view.proposal.requiresHumanQueueAction)} · applied ={" "}
            {String(view.proposal.applied)}
          </p>
        </div>
      )}

      <div
        role="note"
        aria-label="Case note"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
          {c.note}
        </p>
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.78rem",
            color: "var(--muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
          }}
        >
          caseResolutionRequiresHumanQueue ={" "}
          {String(view.caseResolutionRequiresHumanQueue)} · deadlineTracesToCatalog ={" "}
          {String(view.deadlineTracesToCatalog)} · routingSummaryIsPhiSafe ={" "}
          {String(view.routingSummaryIsPhiSafe)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
