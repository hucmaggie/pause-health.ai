"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_LEGAL_HOLD_REQUEST,
  DEMO_PURGE_ELIGIBLE_REQUEST,
  DEMO_RETENTION_REQUEST,
  type RetentionDisposition,
  type RetentionRecommendation,
  type RetentionRequest
} from "../lib/records-retention";

/**
 * Data Retention & Records Lifecycle Management runner for the intake demo.
 *
 * Fires the real, server-side A2A Data Retention agent at
 * /api/agents/records-retention/tasks — the MuleSoft control-plane / data-substrate
 * records-management service, the records-disposition layer of the data substrate.
 * It produces a disposition recommendation for a record (retain / eligible-for-purge
 * / hold), citing the governing retention rule and the computed retention expiry.
 * The panel surfaces the recommendation, the cited rule, the computed expiry, the
 * legal-hold + human-approval flags, the honesty signals, the synthetic labels, and
 * a deep link into the parented Agent Fabric trace.
 *
 * An eligible-for-purge RECOMMENDATION (a record past its retention expiry with no
 * hold) is a SAFE, honest OUTPUT — NOT a block, and never a deletion. The
 * purge-under-hold, no-cited-schedule, and autonomous-purge presets assert offending
 * DISPOSITIONS — so all three governance blocks are demonstrable in the UI rather
 * than hidden.
 *
 * The retention schedules, periods, and rule ids are ILLUSTRATIVE synthetics, NOT a
 * certified records-management system (real retention is jurisdiction-specific and
 * legally reviewed). Structure, styling tokens, and tone mirror
 * <BreakTheGlassPanel> and <MasterPatientIndexPanel> so this reads as a native
 * sibling on /demo/intake.
 */

const RETENTION_ROUTE = "/api/agents/records-retention/tasks";

/** A one-click demo scenario. */
export type RecordsRetentionPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The record the agent evaluates (the common case). */
  record?: RetentionRequest;
  /** Caller-asserted disposition (used only for the three governance blocks). */
  disposition?: Record<string, unknown>;
};

export const RECORDS_RETENTION_PRESETS: RecordsRetentionPreset[] = [
  {
    id: "valid-retain",
    label: "Within retention period → retain",
    hint: "A recently-touched adult clinical record, well within its 7-year window.",
    record: DEMO_RETENTION_REQUEST,
    demonstrates:
      "A record within its retention period → RETAIN under the cited 7-year clinical-record schedule, with the computed retention expiry."
  },
  {
    id: "eligible-for-purge",
    label: "Past expiry, no hold → eligible-for-purge",
    hint: "An old billing / claim record last touched a decade ago, past its 7-year expiry.",
    record: DEMO_PURGE_ELIGIBLE_REQUEST,
    demonstrates:
      "A record past its retention expiry with no active legal hold → ELIGIBLE-FOR-PURGE: a RECOMMENDATION requiring human approval — never an autonomous purge, and not a block."
  },
  {
    id: "legal-hold",
    label: "Legal hold → hold (overrides purge)",
    hint: "A record past its expiry, but under an active legal hold.",
    record: DEMO_LEGAL_HOLD_REQUEST,
    demonstrates:
      "A record past its expiry but under an active legal hold → HOLD: a legal hold always overrides a purge, so the record is never marked eligible-for-purge."
  },
  {
    id: "purge-under-hold-block",
    label: "Purge under legal hold → governance block",
    hint: "A disposition asserting a purge of a record on active legal hold.",
    record: DEMO_LEGAL_HOLD_REQUEST,
    disposition: {
      recommendation: "eligible-for-purge",
      underLegalHold: true,
      retentionRuleId: "rule.retention.clinical-record-7y",
      requiresHumanApproval: true
    },
    demonstrates:
      "The Agent Fabric blocking a purge asserted while under an active legal hold — a legal hold always overrides a purge (policy.retention.legal-hold-overrides-purge)."
  },
  {
    id: "no-schedule-block",
    label: "No cited schedule → governance block",
    hint: "An ad-hoc disposition with no cited retention schedule.",
    record: DEMO_RETENTION_REQUEST,
    disposition: {
      recommendation: "retain",
      underLegalHold: false,
      retentionRuleId: "rule.retention.we-just-decided",
      requiresHumanApproval: false
    },
    demonstrates:
      "The Agent Fabric blocking an ad-hoc disposition that doesn't cite a recorded retention schedule (policy.retention.schedule-sourced)."
  },
  {
    id: "autonomous-purge-block",
    label: "Autonomous purge → governance block",
    hint: "An eligible-for-purge disposition not gated on human approval.",
    record: DEMO_PURGE_ELIGIBLE_REQUEST,
    disposition: {
      recommendation: "eligible-for-purge",
      underLegalHold: false,
      retentionRuleId: "rule.retention.billing-claim-7y",
      requiresHumanApproval: false
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous / unapproved purge — a purge is only ever a recommendation requiring human approval (policy.retention.no-autonomous-purge)."
  }
];

/** Render-ready view of a produced disposition lifted from the task. */
export type RecordsRetentionResolvedView = {
  kind: "resolved";
  recordId: string;
  patientRef: string;
  recordType: string;
  recommendation: RetentionRecommendation;
  retentionRuleId: string;
  retentionRuleLabel: string;
  retentionExpiresAt?: string;
  underLegalHold: boolean;
  requiresHumanApproval: boolean;
  reason: string;
  note: string;
  retentionRespectsLegalHold: boolean;
  retentionRuleCited: boolean;
  purgeHumanApproved: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type RecordsRetentionBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type RecordsRetentionInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type RecordsRetentionView =
  | RecordsRetentionResolvedView
  | RecordsRetentionBlockedView
  | RecordsRetentionInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  retentionRespectsLegalHold?: unknown;
  retentionRuleCited?: unknown;
  purgeHumanApproved?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildBreakTheGlassRequestBody.
 */
export function buildRecordsRetentionRequestBody(input: {
  taskId: string;
  personaId?: string;
  record?: RetentionRequest;
  disposition?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (input.record !== undefined) data.record = input.record;
  if (input.disposition !== undefined) data.disposition = input.disposition;
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
 * POST a record (or an asserted disposition) to the Data Retention agent and
 * return the resulting A2A task. `fetchImpl` is injectable so tests can stub the
 * network boundary. A governance block comes back as HTTP 200 with a `failed`
 * task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runRecordsRetentionTask(
  input: {
    taskId: string;
    personaId?: string;
    record?: RetentionRequest;
    disposition?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(RETENTION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRecordsRetentionRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced
 * disposition (completed) from a governance block vs. an invalid request (both
 * `failed`, told apart by metadata.agentFabric.decision).
 */
export function recordsRetentionViewFromTask(task: A2ATask): RecordsRetentionView {
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
        "The Agent Fabric blocked this records-disposition run.";
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
        : "The records-disposition could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { disposition?: RetentionDisposition; recordId?: string } | undefined) ??
    undefined;
  const disposition = result?.disposition;

  return {
    kind: "resolved",
    recordId: result?.recordId ?? disposition?.recordId ?? "",
    patientRef: disposition?.patientRef ?? "",
    recordType: disposition?.recordType ?? "",
    recommendation: disposition?.recommendation ?? "retain",
    retentionRuleId: disposition?.retentionRuleId ?? "",
    retentionRuleLabel: disposition?.retentionRuleLabel ?? "",
    retentionExpiresAt: disposition?.retentionExpiresAt,
    underLegalHold: disposition?.underLegalHold ?? false,
    requiresHumanApproval: disposition?.requiresHumanApproval ?? false,
    reason: disposition?.reason ?? "",
    note: disposition?.note ?? "",
    retentionRespectsLegalHold: fabric.retentionRespectsLegalHold === true,
    retentionRuleCited: fabric.retentionRuleCited === true,
    purgeHumanApproved: fabric.purgeHumanApproved === true,
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
  | { status: "done"; view: RecordsRetentionView }
  | { status: "error"; message: string };

const RECOMMENDATION_TONE: Record<RetentionRecommendation, string> = {
  retain: "#8fd6b0",
  "eligible-for-purge": "#ffd28a",
  hold: "#9fb3c8"
};

export function RecordsRetentionPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: RecordsRetentionPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runRecordsRetentionTask({
          taskId: newTaskId("retention"),
          personaId: "demo",
          record: preset.record,
          disposition: preset.disposition
        });
        setRunState({ status: "done", view: recordsRetentionViewFromTask(task) });
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
        Data retention & records lifecycle management
      </p>
      <h3 style={{ margin: 0 }}>
        Records disposition — legal-hold-overrides-purge, schedule-sourced, never an
        autonomous purge
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Data Retention agent governs the lifecycle of records against{" "}
        <strong>retention schedules</strong> and <strong>legal holds</strong>: given
        a <strong>record</strong> (type/category, patient, created / last-touched
        dates, jurisdiction, and any active <strong>legal hold</strong>), it{" "}
        <strong>deterministically produces a recommendation</strong> —{" "}
        <strong>retain</strong>, <strong>eligible-for-purge</strong>, or{" "}
        <strong>hold</strong> — citing the governing retention rule and the computed
        expiry. It <strong>never autonomously purges</strong>: an eligible-for-purge
        is a <strong>recommendation requiring human approval</strong>, and an active{" "}
        <strong>legal hold always overrides a purge</strong> (a held record is
        never marked eligible-for-purge). An eligible-for-purge recommendation is a
        safe, completed answer — not a block, and never a deletion.{" "}
        <strong>
          The retention schedules, periods, and rule ids are illustrative synthetics,
          not a certified records-management system — real retention is
          jurisdiction-specific and legally reviewed.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {RECORDS_RETENTION_PRESETS.map((preset) => (
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
              ? "Evaluating…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Records-disposition run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <RecordsRetentionResult view={runState.view} />}
    </section>
  );
}

function RecordsRetentionResult({ view }: { view: RecordsRetentionView }) {
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

  const recommendationTone = RECOMMENDATION_TONE[view.recommendation] ?? "#9fb3c8";

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Records disposition (deterministic, synthetic records)
        {view.recordId ? ` · record ${view.recordId}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Recommendation" value={view.recommendation} tone={recommendationTone} />{" "}
        {view.recordType ? (
          <Pill label="Record type" value={view.recordType} tone="#9fb3c8" />
        ) : null}{" "}
        <Pill
          label="Under legal hold"
          value={String(view.underLegalHold)}
          tone={view.underLegalHold ? "#ffd28a" : "#9fb3c8"}
        />{" "}
        <Pill
          label="Requires human approval"
          value={String(view.requiresHumanApproval)}
          tone={view.requiresHumanApproval ? "#ffd28a" : "#9fb3c8"}
        />
      </p>

      <p style={{ margin: "0.7rem 0 0", fontSize: "0.86rem", color: "var(--muted)" }}>
        Governing rule <code>{view.retentionRuleId}</code>
        {view.retentionRuleLabel ? ` — ${view.retentionRuleLabel}` : ""}.
        {view.retentionExpiresAt ? (
          <>
            {" "}
            Retention expiry <code>{view.retentionExpiresAt}</code>.
          </>
        ) : null}
      </p>

      {view.recommendation === "eligible-for-purge" ? (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.86rem", color: "#ffd28a" }}>
          A purge is a <strong>recommendation requiring human approval</strong> — the
          agent never autonomously purges a record.
        </p>
      ) : null}

      <div
        role="note"
        aria-label="Records-retention integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Legal-hold-overrides-purge · schedule-sourced · no autonomous purge{" "}
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
          retentionRespectsLegalHold = {String(view.retentionRespectsLegalHold)} ·
          retentionRuleCited = {String(view.retentionRuleCited)} · purgeHumanApproved
          = {String(view.purgeHumanApproved)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
