"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type ClaimTimelinessRequest,
  type TimelyFilingDetermination,
  type TimelyFilingDisposition,
  DEMO_TIMELY_FILING_EXCEPTION_REQUEST,
  DEMO_TIMELY_FILING_REQUEST,
  DEMO_TIMELY_FILING_UNTIMELY_REQUEST
} from "../lib/timely-filing";

/**
 * Timely Filing Compliance runner for the intake demo.
 *
 * Fires the real, server-side A2A Timely Filing agent at /api/agents/timely-filing/tasks — the
 * payer-operations service that decides whether a claim was filed within its payer's
 * timely-filing limit. The panel surfaces the computed deadline, the days-late count, the
 * timely flag, the disposition, the honesty signals, the synthetic labels, and a deep link into
 * the parented Agent Fabric trace.
 *
 * A determination — timely OR untimely — is a SAFE, honest OUTPUT (it completes; an untimely
 * claim carries requiresHumanReview:true). The un-sourced-rule, guessed-deadline, and
 * auto-write-off presets assert offending DETERMINATIONS — so all three governance blocks are
 * demonstrable in the UI rather than hidden.
 *
 * The filing limits + exceptions are ILLUSTRATIVE, NOT a certified timely-filing engine (real
 * limits are governed by each payer's provider contract, Medicare / Medicaid rules, and state
 * prompt-pay law). Structure, styling tokens, and tone mirror <AuditLogIntegrityPanel> and
 * <MinimumNecessaryPanel> so this reads as a native sibling on /demo/intake.
 */

const TIMELY_FILING_ROUTE = "/api/agents/timely-filing/tasks";

/** A one-click demo scenario. */
export type TimelyFilingPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The claim the agent evaluates (the common case). */
  request?: ClaimTimelinessRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const TIMELY_FILING_PRESETS: TimelyFilingPreset[] = [
  {
    id: "timely",
    label: "Filed within 90 days → timely",
    hint: "A commercial claim submitted ~5 weeks after the date of service.",
    request: DEMO_TIMELY_FILING_REQUEST,
    demonstrates:
      "Submission is on or before the computed deadline → timely, accepted, no review."
  },
  {
    id: "exception",
    label: "Late but exception applies → appeal",
    hint: "Past the 90-day window with a recognized COB-primary-delay exception.",
    request: DEMO_TIMELY_FILING_EXCEPTION_REQUEST,
    demonstrates:
      "Untimely, but a recognized exception → file an appeal with documentation; human review required."
  },
  {
    id: "untimely",
    label: "Late with no exception → write-off review",
    hint: "Past the 90-day window with no exception claimed.",
    request: DEMO_TIMELY_FILING_UNTIMELY_REQUEST,
    demonstrates:
      "Untimely with no exception → routed to a write-off decision; human review required (NOT auto-written-off)."
  },
  {
    id: "unsourced-rule-block",
    label: "Un-sourced filing limit → governance block",
    hint: "A determination citing a made-up filing rule id.",
    request: DEMO_TIMELY_FILING_REQUEST,
    determination: {
      claimRef: "claim-tf-001",
      filingRuleId: "rule.filing.we-made-up",
      payerType: "commercial",
      limitDays: 90,
      serviceDate: "2026-01-10",
      submissionDate: "2026-02-15",
      deadline: "2026-04-10",
      daysLate: 0,
      timely: true,
      requiresHumanReview: false,
      writtenOff: false
    },
    demonstrates:
      "The Agent Fabric blocking a timeliness decision with no recorded filing-limit rule (policy.timelyfiling.filing-limit-sourced)."
  },
  {
    id: "guessed-deadline-block",
    label: "Guessed deadline → governance block",
    hint: "A determination whose deadline doesn't match service date + limit.",
    request: DEMO_TIMELY_FILING_UNTIMELY_REQUEST,
    determination: {
      claimRef: "claim-tf-003",
      filingRuleId: "rule.filing.commercial-90day",
      payerType: "commercial",
      limitDays: 90,
      serviceDate: "2026-01-10",
      submissionDate: "2026-06-01",
      // Wrong: 2026-01-10 + 90 days is 2026-04-10, not 2026-07-01.
      deadline: "2026-07-01",
      daysLate: 0,
      timely: true,
      requiresHumanReview: false,
      writtenOff: false
    },
    demonstrates:
      "The Agent Fabric blocking a guessed deadline that does not match the computed date of service + limit (policy.timelyfiling.deadline-computed)."
  },
  {
    id: "auto-write-off-block",
    label: "Auto-written-off → governance block",
    hint: "A determination that writes off an untimely claim autonomously.",
    request: DEMO_TIMELY_FILING_UNTIMELY_REQUEST,
    determination: {
      claimRef: "claim-tf-003",
      filingRuleId: "rule.filing.commercial-90day",
      payerType: "commercial",
      limitDays: 90,
      serviceDate: "2026-01-10",
      submissionDate: "2026-06-01",
      deadline: "2026-04-10",
      daysLate: 52,
      timely: false,
      requiresHumanReview: false,
      writtenOff: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous write-off of an untimely claim (policy.timelyfiling.no-autonomous-write-off)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type TimelyFilingResolvedView = {
  kind: "resolved";
  claimRef: string;
  filingRuleId: string;
  limitDays: number;
  serviceDate: string;
  submissionDate: string;
  deadline: string;
  daysLate: number;
  timely: boolean;
  exceptionRecognized: boolean;
  disposition: TimelyFilingDisposition;
  requiresHumanReview: boolean;
  reason: string;
  note: string;
  timelyFilingRuleSourced: boolean;
  timelyFilingDeadlineComputed: boolean;
  timelyFilingNoAutonomousWriteOff: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type TimelyFilingBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type TimelyFilingInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type TimelyFilingView =
  | TimelyFilingResolvedView
  | TimelyFilingBlockedView
  | TimelyFilingInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  timelyFilingRuleSourced?: unknown;
  timelyFilingDeadlineComputed?: unknown;
  timelyFilingNoAutonomousWriteOff?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildAuditLogRequestBody.
 */
export function buildTimelyFilingRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: ClaimTimelinessRequest;
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
 * POST a claim (or an asserted determination) to the Timely Filing agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A
 * governance block comes back as HTTP 200 with a `failed` task — only a malformed envelope /
 * parse error is a non-OK response.
 */
export async function runTimelyFilingTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: ClaimTimelinessRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(TIMELY_FILING_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildTimelyFilingRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * determination (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function timelyFilingViewFromTask(task: A2ATask): TimelyFilingView {
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
        "The Agent Fabric blocked this timely-filing run.";
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
        : "The timely-filing determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: TimelyFilingDetermination; claimRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    claimRef: result?.claimRef ?? det?.claimRef ?? "",
    filingRuleId: det?.filingRuleId ?? "",
    limitDays: det?.limitDays ?? 0,
    serviceDate: det?.serviceDate ?? "",
    submissionDate: det?.submissionDate ?? "",
    deadline: det?.deadline ?? "",
    daysLate: det?.daysLate ?? 0,
    timely: det?.timely ?? false,
    exceptionRecognized: det?.exceptionRecognized ?? false,
    disposition: det?.disposition ?? "write-off-review",
    requiresHumanReview: det?.requiresHumanReview ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    timelyFilingRuleSourced: fabric.timelyFilingRuleSourced === true,
    timelyFilingDeadlineComputed: fabric.timelyFilingDeadlineComputed === true,
    timelyFilingNoAutonomousWriteOff: fabric.timelyFilingNoAutonomousWriteOff === true,
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

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; view: TimelyFilingView }
  | { status: "error"; message: string };

export function TimelyFilingPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: TimelyFilingPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runTimelyFilingTask({
          taskId: newTaskId("timely-filing"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: timelyFilingViewFromTask(task) });
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
        Timely filing · claims compliance · payer operations
      </p>
      <h3 style={{ margin: 0 }}>
        Timely Filing — a computed deadline, never an autonomous write-off
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Given a <strong>claim</strong> (a date of service, a submission date, and the cited payer{" "}
        <strong>filing-limit rule</strong>), this agent <strong>deterministically</strong> computes
        the filing <strong>deadline</strong> (date of service + the rule&rsquo;s limit days), checks
        the submission date against it, honors a recognized <strong>exception</strong> when claimed,
        and decides the <strong>disposition</strong>. An untimely claim is a{" "}
        <strong>recommendation requiring human review</strong> — the balance is{" "}
        <strong>never</strong> autonomously written off.{" "}
        <strong>
          The filing limits and exceptions are illustrative, not a certified timely-filing engine —
          real limits come from each payer&rsquo;s contract, Medicare / Medicaid rules, and state
          prompt-pay law.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {TIMELY_FILING_PRESETS.map((preset) => (
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
              ? "Checking…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Timely-filing run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <TimelyFilingResult view={runState.view} />}
    </section>
  );
}

function TimelyFilingResult({ view }: { view: TimelyFilingView }) {
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

  const dispositionTone =
    view.disposition === "accept"
      ? "#8fd6b0"
      : view.disposition === "appeal-with-exception"
        ? "#ffd28a"
        : "#ff9db1";

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Timely-filing (deterministic, synthetic)
        {view.claimRef ? ` · ${view.claimRef}` : ""} · {view.limitDays}-day limit
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="Timely"
          value={String(view.timely)}
          tone={view.timely ? "#8fd6b0" : "#ff9db1"}
        />{" "}
        <Pill label="Deadline" value={view.deadline || "—"} tone="#9db8ff" />{" "}
        <Pill label="Days late" value={String(view.daysLate)} tone="#ffd28a" />{" "}
        <Pill label="Disposition" value={view.disposition} tone={dispositionTone} />{" "}
        <Pill
          label="Requires human review"
          value={String(view.requiresHumanReview)}
          tone={view.requiresHumanReview ? "#ffd28a" : "#8fd6b0"}
        />
      </p>

      <p style={{ margin: "0.6rem 0 0", fontSize: "0.86rem", color: "var(--muted)" }}>
        Service {view.serviceDate || "—"} · submitted {view.submissionDate || "—"} · deadline{" "}
        {view.deadline || "—"}
        {view.exceptionRecognized ? " · recognized exception applies" : ""}
      </p>

      <div
        role="note"
        aria-label="Timely-filing compliance"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Filing-limit sourced · deadline computed · never an autonomous write-off{" "}
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
          timelyFilingRuleSourced = {String(view.timelyFilingRuleSourced)} ·
          timelyFilingDeadlineComputed = {String(view.timelyFilingDeadlineComputed)} ·
          timelyFilingNoAutonomousWriteOff = {String(view.timelyFilingNoAutonomousWriteOff)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
