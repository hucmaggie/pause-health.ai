"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type AccessDetermination,
  type AccessRequest,
  DEMO_ACCESS_ENDANGER_REQUEST,
  DEMO_ACCESS_EXTENSION_REQUEST,
  DEMO_ACCESS_PSYCH_REQUEST,
  DEMO_ACCESS_REQUEST
} from "../lib/right-of-access";

/**
 * Right of Access (HIPAA §164.524) runner for the intake demo.
 *
 * Fires the real, server-side A2A Right of Access agent at /api/agents/right-of-access/tasks — a
 * control-plane / data-substrate privacy service on the platform plane that adjudicates a patient's
 * right to GET a copy of their own PHI, and by when. The panel surfaces the computed response
 * deadline, the days remaining, any cited denial ground, the disposition, the honesty signals, the
 * synthetic labels, and a deep link into the parented Agent Fabric trace.
 *
 * A determination — grant OR deny — is a SAFE, honest OUTPUT (it completes; it carries
 * requiresHumanReview:true, autoReleased:false). The off-catalog-ground, bad-deadline, and
 * auto-released presets assert offending DETERMINATIONS — so all three governance blocks are
 * demonstrable in the UI rather than hidden.
 *
 * PHI-bearing — the access decision references the patient's record. The exception catalog + 30/60-day
 * math are ILLUSTRATIVE, NOT a certified release-of-information system. Structure, styling tokens, and
 * tone mirror <AccountingOfDisclosuresPanel> and <SubrogationPanel> so this reads as a native sibling
 * on /demo/intake.
 */

const RIGHT_OF_ACCESS_ROUTE = "/api/agents/right-of-access/tasks";

/** A one-click demo scenario. */
export type RightOfAccessPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The request the agent evaluates (the common case). */
  request?: AccessRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const RIGHT_OF_ACCESS_PRESETS: RightOfAccessPreset[] = [
  {
    id: "grant-in-full",
    label: "Routine copy → grant in full",
    hint: "In the record set, no denial ground.",
    request: DEMO_ACCESS_REQUEST,
    demonstrates:
      "A routine copy request granted in full, due in 30 days, records / privacy officer to fulfill."
  },
  {
    id: "psych-notes",
    label: "Psychotherapy notes → unreviewable denial",
    hint: "An unreviewable §164.524 ground.",
    request: DEMO_ACCESS_PSYCH_REQUEST,
    demonstrates:
      "An unreviewable denial (psychotherapy notes), records / privacy officer to issue the notice."
  },
  {
    id: "endangerment",
    label: "Endangerment concern → reviewable denial",
    hint: "A reviewable ground requiring a licensed reviewer.",
    request: DEMO_ACCESS_ENDANGER_REQUEST,
    demonstrates:
      "A reviewable denial (endangerment) — a licensed professional must review before it stands."
  },
  {
    id: "extension",
    label: "Complex request + 30-day extension",
    hint: "The single extension invoked → due in 60 days.",
    request: DEMO_ACCESS_EXTENSION_REQUEST,
    demonstrates:
      "A grant in full with the single 30-day extension invoked — deadline computed at 60 days."
  },
  {
    id: "off-catalog-ground-block",
    label: "Off-catalog denial ground → governance block",
    hint: "A determination denying on a made-up ground.",
    request: DEMO_ACCESS_REQUEST,
    determination: {
      requestRef: "access-001",
      patientRef: "patient-8842",
      requestType: "copy",
      inDesignatedRecordSet: true,
      exceptionId: "exception.we-made-up",
      exceptionType: "unknown",
      extensionInvoked: false,
      responseDeadline: "2026-09-19",
      daysUntilDeadline: 12,
      disposition: "deny-unreviewable",
      accessGranted: false,
      autoReleased: false,
      requiresHumanReview: true
    },
    demonstrates:
      "The Agent Fabric blocking a denial on an off-catalog §164.524 ground (policy.access.ground-sourced)."
  },
  {
    id: "bad-deadline-block",
    label: "Wrong deadline → governance block",
    hint: "A determination whose deadline isn't +30 days.",
    request: DEMO_ACCESS_REQUEST,
    determination: {
      requestRef: "access-001",
      patientRef: "patient-8842",
      requestType: "copy",
      inDesignatedRecordSet: true,
      exceptionId: "",
      exceptionType: "none",
      extensionInvoked: false,
      // Wrong: request 2026-08-20 + 30 days is 2026-09-19, not 2026-11-01.
      responseDeadline: "2026-11-01",
      daysUntilDeadline: 55,
      disposition: "grant-in-full",
      accessGranted: true,
      autoReleased: false,
      requiresHumanReview: true
    },
    demonstrates:
      "The Agent Fabric blocking a determination whose deadline isn't request-date + 30/60 days (policy.access.deadline-computed)."
  },
  {
    id: "auto-released-block",
    label: "Record auto-released → governance block",
    hint: "A determination that released the record itself.",
    request: DEMO_ACCESS_REQUEST,
    determination: {
      requestRef: "access-001",
      patientRef: "patient-8842",
      requestType: "copy",
      inDesignatedRecordSet: true,
      exceptionId: "",
      exceptionType: "none",
      extensionInvoked: false,
      responseDeadline: "2026-09-19",
      daysUntilDeadline: 12,
      disposition: "grant-in-full",
      accessGranted: true,
      // Wrong: the agent autonomously released the record and skipped human review.
      autoReleased: true,
      requiresHumanReview: false
    },
    demonstrates:
      "The Agent Fabric blocking an autonomously-released / un-reviewed determination (policy.access.no-autonomous-denial-or-release)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type RightOfAccessResolvedView = {
  kind: "resolved";
  requestRef: string;
  patientRef: string;
  requestType: string;
  responseDeadline: string;
  daysUntilDeadline: number;
  disposition: string;
  accessGranted: boolean;
  exceptionId: string;
  exceptionType: string;
  reason: string;
  note: string;
  accessGroundSourced: boolean;
  accessDeadlineComputed: boolean;
  accessNoAutonomousDenialOrRelease: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type RightOfAccessBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type RightOfAccessInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type RightOfAccessView =
  | RightOfAccessResolvedView
  | RightOfAccessBlockedView
  | RightOfAccessInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  accessGroundSourced?: unknown;
  accessDeadlineComputed?: unknown;
  accessNoAutonomousDenialOrRelease?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM.
 */
export function buildRightOfAccessRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: AccessRequest;
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
 * POST an access request (or an asserted determination) to the Right of Access agent and return the
 * resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A governance
 * block comes back as HTTP 200 with a `failed` task — only a malformed envelope / parse error is a
 * non-OK response.
 */
export async function runRightOfAccessTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: AccessRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(RIGHT_OF_ACCESS_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRightOfAccessRequestBody(input))
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
export function rightOfAccessViewFromTask(task: A2ATask): RightOfAccessView {
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
        "The Agent Fabric blocked this right-of-access run.";
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
        : "The access determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { determination?: AccessDetermination; requestRef?: string } | undefined) ??
    undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    requestRef: result?.requestRef ?? det?.requestRef ?? "",
    patientRef: det?.patientRef ?? "",
    requestType: det?.requestType ?? "",
    responseDeadline: det?.responseDeadline ?? "",
    daysUntilDeadline: det?.daysUntilDeadline ?? 0,
    disposition: det?.disposition ?? "",
    accessGranted: det?.accessGranted ?? false,
    exceptionId: det?.exceptionId ?? "",
    exceptionType: det?.exceptionType ?? "",
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    accessGroundSourced: fabric.accessGroundSourced === true,
    accessDeadlineComputed: fabric.accessDeadlineComputed === true,
    accessNoAutonomousDenialOrRelease: fabric.accessNoAutonomousDenialOrRelease === true,
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
  | { status: "done"; view: RightOfAccessView }
  | { status: "error"; message: string };

export function RightOfAccessPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: RightOfAccessPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runRightOfAccessTask({
          taskId: newTaskId("right-of-access"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: rightOfAccessViewFromTask(task) });
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
        Right of access · HIPAA §164.524 · platform / data substrate
      </p>
      <h3 style={{ margin: 0 }}>
        Right of Access — a computed deadline, never an autonomous release or denial
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        A patient&rsquo;s <strong>§164.524</strong> right to GET a copy of their own record, and by
        when. Given an <strong>access request</strong> (request type, request date, whether the PHI
        is in a designated record set, an optional cited denial ground, and whether the single 30-day
        extension was invoked), this agent <strong>deterministically</strong> computes the response{" "}
        <strong>deadline</strong> (request date + 30, or + 60 with the extension), classifies any
        cited denial ground, and decides the disposition. It <strong>never</strong> releases the
        record or issues a denial on its own — a records / privacy officer fulfills or reviews every
        determination.{" "}
        <strong>The exception catalog and 30/60-day math are illustrative, not a certified system.</strong>{" "}
        Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {RIGHT_OF_ACCESS_PRESETS.map((preset) => (
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
          Right-of-access run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <RightOfAccessResult view={runState.view} />}
    </section>
  );
}

function RightOfAccessResult({ view }: { view: RightOfAccessView }) {
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

  const overdue = view.daysUntilDeadline < 0;

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Access determination (deterministic, synthetic)
        {view.requestRef ? ` · ${view.requestRef}` : ""} · {view.patientRef}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill label="Type" value={view.requestType} tone="#9db8ff" />{" "}
        <Pill
          label="Response due"
          value={view.responseDeadline}
          tone={overdue ? "#ffb6c8" : "#8fd6b0"}
        />{" "}
        <Pill
          label="Days"
          value={overdue ? `${Math.abs(view.daysUntilDeadline)} overdue` : `${view.daysUntilDeadline} left`}
          tone={overdue ? "#ffb6c8" : "#8fd6b0"}
        />{" "}
        <Pill
          label="Disposition"
          value={view.disposition}
          tone={view.accessGranted ? "#8fd6b0" : "#ffd28a"}
        />
      </p>

      {view.exceptionId && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
          Cited denial ground: <code>{view.exceptionId}</code> ({view.exceptionType})
        </p>
      )}

      <div
        role="note"
        aria-label="Right of access compliance"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Ground sourced · deadline computed · never an autonomous release or denial{" "}
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
          accessGroundSourced = {String(view.accessGroundSourced)} · accessDeadlineComputed ={" "}
          {String(view.accessDeadlineComputed)} · accessNoAutonomousDenialOrRelease ={" "}
          {String(view.accessNoAutonomousDenialOrRelease)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
