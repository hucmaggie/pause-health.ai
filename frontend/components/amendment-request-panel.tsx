"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type AmendmentDetermination,
  type AmendmentRequest,
  DEMO_AMENDMENT_ACCURATE_REQUEST,
  DEMO_AMENDMENT_EXTENSION_REQUEST,
  DEMO_AMENDMENT_NOT_ORIGINATOR_REQUEST,
  DEMO_AMENDMENT_REQUEST
} from "../lib/amendment-request";

/**
 * Amendment / Correction (HIPAA §164.526) runner for the intake demo.
 *
 * Fires the real, server-side A2A Amendment Request agent at /api/agents/amendment-request/tasks — a
 * control-plane / data-substrate privacy service that adjudicates a patient's §164.526 right to fix
 * their record. The panel surfaces the disposition, the denial ground (if any), the computed 60/90-day
 * deadline, the honesty signals, the synthetic labels, and a deep link into the parented Agent Fabric
 * trace.
 *
 * A determination — accept OR deny — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresHumanReview:true, autoAmended:false, autoDenied:false). The off-catalog-ground,
 * wrong-deadline, and auto-amended presets assert offending DETERMINATIONS — so all three governance
 * blocks are demonstrable in the UI rather than hidden.
 *
 * PHI-bearing — the amendment decision references the patient's record. The catalog + 60/90-day math
 * are ILLUSTRATIVE, NOT a certified HIM system. Structure, styling tokens, and tone mirror
 * <RightOfAccessPanel> so this reads as a native sibling on /demo/intake.
 */

const AMENDMENT_REQUEST_ROUTE = "/api/agents/amendment-request/tasks";

/** A one-click demo scenario. */
export type AmendmentRequestPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: AmendmentRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const AMENDMENT_REQUEST_PRESETS: AmendmentRequestPreset[] = [
  {
    id: "accept",
    label: "Correctable clinical note → recommend accept",
    hint: "In the record set, CE-authored, not accurate/complete.",
    request: DEMO_AMENDMENT_REQUEST,
    demonstrates:
      "A correctable note → recommend ACCEPT the amendment, response due in 60 days."
  },
  {
    id: "accurate",
    label: "Record accurate & complete → recommend deny",
    hint: "The §164.526 accurate-and-complete ground.",
    request: DEMO_AMENDMENT_ACCURATE_REQUEST,
    demonstrates:
      "An accurate & complete record → recommend DENY; the patient may submit a statement of disagreement."
  },
  {
    id: "not-originator",
    label: "Authored by another provider → recommend deny",
    hint: "The §164.526 not-originator ground.",
    request: DEMO_AMENDMENT_NOT_ORIGINATOR_REQUEST,
    demonstrates:
      "PHI the CE didn't create (originator available) → recommend DENY (not-originator) with a referral."
  },
  {
    id: "extension",
    label: "Complex request → 90-day extended deadline",
    hint: "The single 30-day extension invoked.",
    request: DEMO_AMENDMENT_EXTENSION_REQUEST,
    demonstrates:
      "A complex request with the single extension invoked → recommend accept, deadline computed at 90 days."
  },
  {
    id: "off-catalog-ground-block",
    label: "Off-catalog denial ground → governance block",
    hint: "A denial on a made-up ground.",
    request: DEMO_AMENDMENT_REQUEST,
    determination: {
      requestRef: "amend-001",
      patientRef: "patient-8842",
      recordRef: "note-55210",
      requestType: "correct-clinical",
      extensionInvoked: false,
      responseDeadline: "2026-10-14",
      daysUntilDeadline: 37,
      disposition: "recommend-deny",
      deniedOnGround: "ground.we-made-up",
      deniedOnGroundLabel: "made up",
      patientMayStatementOfDisagreement: true,
      requiresHumanReview: true,
      autoAmended: false,
      autoDenied: false
    },
    demonstrates:
      "The Agent Fabric blocking a denial on an off-catalog ground (policy.amendment.ground-sourced)."
  },
  {
    id: "wrong-deadline-block",
    label: "Wrong deadline → governance block",
    hint: "A deadline that isn't request-date + 60.",
    request: DEMO_AMENDMENT_REQUEST,
    determination: {
      requestRef: "amend-001",
      patientRef: "patient-8842",
      recordRef: "note-55210",
      requestType: "correct-clinical",
      requestDate: "2026-08-15",
      asOfDate: "2026-09-07",
      extensionInvoked: false,
      // Wrong: request-date + 60 = 2026-10-14, not this.
      responseDeadline: "2026-12-31",
      daysUntilDeadline: 115,
      disposition: "recommend-accept",
      deniedOnGround: null,
      deniedOnGroundLabel: null,
      patientMayStatementOfDisagreement: false,
      requiresHumanReview: true,
      autoAmended: false,
      autoDenied: false
    },
    demonstrates:
      "The Agent Fabric blocking a mis-computed §164.526 deadline (policy.amendment.deadline-computed)."
  },
  {
    id: "auto-amended-block",
    label: "Record amended autonomously → governance block",
    hint: "A determination that wrote the amendment itself.",
    request: DEMO_AMENDMENT_REQUEST,
    determination: {
      requestRef: "amend-001",
      patientRef: "patient-8842",
      recordRef: "note-55210",
      requestType: "correct-clinical",
      requestDate: "2026-08-15",
      asOfDate: "2026-09-07",
      extensionInvoked: false,
      responseDeadline: "2026-10-14",
      daysUntilDeadline: 37,
      disposition: "recommend-accept",
      deniedOnGround: null,
      deniedOnGroundLabel: null,
      patientMayStatementOfDisagreement: false,
      // Wrong: the agent amended the record and skipped human review.
      requiresHumanReview: false,
      autoAmended: true,
      autoDenied: false
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-amended record (policy.amendment.no-autonomous-write-or-denial)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type AmendmentResolvedView = {
  kind: "resolved";
  requestRef: string;
  patientRef: string;
  recordRef: string;
  disposition: string;
  deniedOnGround: string | null;
  deniedOnGroundLabel: string | null;
  responseDeadline: string;
  daysUntilDeadline: number;
  patientMayStatementOfDisagreement: boolean;
  reason: string;
  note: string;
  amendmentGroundSourced: boolean;
  amendmentDeadlineComputed: boolean;
  amendmentNoAutonomousWrite: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type AmendmentBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type AmendmentInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type AmendmentView =
  | AmendmentResolvedView
  | AmendmentBlockedView
  | AmendmentInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  amendmentGroundSourced?: unknown;
  amendmentDeadlineComputed?: unknown;
  amendmentNoAutonomousWrite?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildAmendmentRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: AmendmentRequest;
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
 * POST an amendment request (or an asserted determination) to the Amendment Request agent and return
 * the resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A
 * governance block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse
 * error is a non-OK response.
 */
export async function runAmendmentRequestTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: AmendmentRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(AMENDMENT_REQUEST_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAmendmentRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced determination
 * (completed) from a governance block vs. an invalid request (both `failed`, told
 * apart by metadata.agentFabric.decision).
 */
export function amendmentViewFromTask(task: A2ATask): AmendmentView {
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
        "The Agent Fabric blocked this amendment run.";
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
        : "The amendment determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: AmendmentDetermination; requestRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    patientRef: det?.patientRef ?? "",
    recordRef: det?.recordRef ?? "",
    disposition: det?.disposition ?? "",
    deniedOnGround: det?.deniedOnGround ?? null,
    deniedOnGroundLabel: det?.deniedOnGroundLabel ?? null,
    responseDeadline: det?.responseDeadline ?? "",
    daysUntilDeadline: det?.daysUntilDeadline ?? 0,
    patientMayStatementOfDisagreement: det?.patientMayStatementOfDisagreement ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    amendmentGroundSourced: fabric.amendmentGroundSourced === true,
    amendmentDeadlineComputed: fabric.amendmentDeadlineComputed === true,
    amendmentNoAutonomousWrite: fabric.amendmentNoAutonomousWrite === true,
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
  | { status: "done"; view: AmendmentView }
  | { status: "error"; message: string };

export function AmendmentRequestPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: AmendmentRequestPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runAmendmentRequestTask({
          taskId: newTaskId("amendment-request"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: amendmentViewFromTask(task) });
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
        Amendment / correction · HIPAA §164.526 · platform & data substrate
      </p>
      <h3 style={{ margin: 0 }}>
        Amendment Request — a computed deadline, never an autonomous record write
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Completing the HIPAA patient-rights trilogy (access §164.524 · accounting §164.528 ·{" "}
        <strong>amendment §164.526</strong>), this agent <strong>deterministically</strong>{" "}
        adjudicates a patient&rsquo;s request to <strong>fix</strong> their record — computing the{" "}
        <strong>60-day (+30) response deadline</strong> by pure date math and deriving whether a
        statutory ground to deny applies (not-originator, not-in-record-set, accurate-and-complete).
        Every determination is a <strong>recommendation</strong>: the agent <strong>never</strong>{" "}
        amends the record (a data write) or issues a denial on its own.{" "}
        <strong>The catalog and 60/90-day math are illustrative, not a certified HIM system.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {AMENDMENT_REQUEST_PRESETS.map((preset) => (
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
              ? "Adjudicating…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Amendment run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <AmendmentResult view={runState.view} />}
    </section>
  );
}

function AmendmentResult({ view }: { view: AmendmentView }) {
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

  const accept = view.disposition === "recommend-accept";
  const dispoTone = accept ? "#8fd6b0" : "#ffd28a";
  const overdue = view.daysUntilDeadline < 0;
  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Amendment determination (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""}
        {view.recordRef ? ` · ${view.recordRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Disposition" value={view.disposition} tone={dispoTone} />{" "}
        <Pill
          label="Due"
          value={`${view.responseDeadline} (${overdue ? `${Math.abs(view.daysUntilDeadline)}d overdue` : `${view.daysUntilDeadline}d left`})`}
          tone={overdue ? "#ffb6c8" : "#9db8ff"}
        />
        {view.deniedOnGroundLabel && (
          <>
            {" "}
            <Pill label="Ground" value={view.deniedOnGroundLabel} tone="#ffb6c8" />
          </>
        )}
      </p>
      {view.patientMayStatementOfDisagreement && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.84rem", color: "var(--muted)" }}>
          On denial, the patient may submit a <strong>statement of disagreement</strong> (§164.526(d)).
        </p>
      )}

      <div
        role="note"
        aria-label="Amendment compliance"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Ground sourced · deadline computed · never an autonomous amend / deny{" "}
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
          amendmentGroundSourced = {String(view.amendmentGroundSourced)} · amendmentDeadlineComputed ={" "}
          {String(view.amendmentDeadlineComputed)} · amendmentNoAutonomousWrite ={" "}
          {String(view.amendmentNoAutonomousWrite)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
