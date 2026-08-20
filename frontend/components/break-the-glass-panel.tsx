"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  DEMO_EMERGENCY_ACCESS_REQUEST,
  DEMO_NON_EMERGENCY_REQUEST,
  type EmergencyAccessDecision,
  type EmergencyAccessRequest
} from "../lib/break-the-glass";

/**
 * Break-the-Glass / Emergency Access Governance runner for the intake demo.
 *
 * Fires the real, server-side A2A Break-the-Glass agent at
 * /api/agents/break-the-glass/tasks — the MuleSoft control-plane / data-substrate
 * security service, the emergency-access governance layer of the data substrate.
 * It decides whether to grant emergency override access to PHI and, if so, returns
 * a TIME-BOXED, MINIMUM-NECESSARY grant (a scoped field set + a derived expiry),
 * ALWAYS emitting a mandatory audit event and flagging the grant for post-access
 * review. The panel surfaces the decision, the granted minimum-necessary scope,
 * the expiry, the audit-event id + post-access-review flag, the honesty signals,
 * and a deep link into the parented Agent Fabric trace.
 *
 * A DENY (no emergency, no justification, or an off-catalog purpose) is a SAFE,
 * honest OUTPUT — NOT a block. The no-justification, standing/full-record, and
 * un-audited presets assert offending GRANTS — so all three governance blocks are
 * demonstrable in the UI rather than hidden.
 *
 * The purpose catalog, scopes, durations, and audit ids are ILLUSTRATIVE
 * synthetics, NOT a certified break-the-glass system. Structure, styling tokens,
 * and tone mirror <MasterPatientIndexPanel> and <ConsentManagementPanel> so this
 * reads as a native sibling on /demo/intake.
 */

const BTG_ROUTE = "/api/agents/break-the-glass/tasks";

/** A one-click demo scenario. */
export type BreakTheGlassPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The emergency-access request the agent evaluates (the common case). */
  request?: EmergencyAccessRequest;
  /** Caller-asserted grant (used only for the three governance blocks). */
  grant?: Record<string, unknown>;
};

export const BREAK_THE_GLASS_PRESETS: BreakTheGlassPreset[] = [
  {
    id: "valid-grant",
    label: "Valid emergency → time-boxed grant",
    hint: "An emergency physician breaks the glass for an unstable ED patient, with a recorded justification.",
    request: DEMO_EMERGENCY_ACCESS_REQUEST,
    demonstrates:
      "A declared emergency with a recorded justification → a minimum-necessary grant scoped to allergies / medications / problems / vitals (not the full chart), time-boxed to 60 minutes, with a mandatory audit event flagged for post-access review."
  },
  {
    id: "non-emergency-deny",
    label: "No emergency → deny (safe)",
    hint: "A routine chart review with no declared emergency.",
    request: DEMO_NON_EMERGENCY_REQUEST,
    demonstrates:
      "No emergency declared → a denied access with the attempt still logged — a safe, completed answer, NOT a governance block."
  },
  {
    id: "no-justification-block",
    label: "Grant without justification → governance block",
    hint: "A grant asserted with no recorded clinical justification.",
    request: DEMO_EMERGENCY_ACCESS_REQUEST,
    grant: {
      granted: true,
      justificationRecorded: false,
      grantedScope: ["allergies", "medications"],
      expiresAt: "2026-03-01T03:30:00.000Z",
      durationMinutes: 60,
      auditEventId: "btg-audit-demo",
      requiresPostAccessReview: true
    },
    demonstrates:
      "The Agent Fabric blocking an emergency access granted with no recorded clinical justification (policy.btg.justification-required)."
  },
  {
    id: "standing-access-block",
    label: "Standing / full-record grant → governance block",
    hint: "A full-record, non-expiring grant.",
    request: DEMO_EMERGENCY_ACCESS_REQUEST,
    grant: {
      granted: true,
      justificationRecorded: true,
      grantedScope: ["full-chart"],
      expiresAt: undefined,
      durationMinutes: undefined,
      auditEventId: "btg-audit-demo",
      requiresPostAccessReview: true
    },
    demonstrates:
      "The Agent Fabric blocking a standing / full-record / non-expiring grant — every grant must be minimum-necessary and time-boxed (policy.btg.minimum-necessary-time-boxed)."
  },
  {
    id: "unaudited-block",
    label: "Un-audited grant → governance block",
    hint: "A grant with no audit event and no post-access review.",
    request: DEMO_EMERGENCY_ACCESS_REQUEST,
    grant: {
      granted: true,
      justificationRecorded: true,
      grantedScope: ["allergies", "medications"],
      expiresAt: "2026-03-01T03:30:00.000Z",
      durationMinutes: 60,
      auditEventId: "",
      requiresPostAccessReview: false
    },
    demonstrates:
      "The Agent Fabric blocking an un-audited / un-reviewed grant — every emergency access must be logged and flagged for post-access review (policy.btg.mandatory-audit-review)."
  }
];

/** Render-ready view of a produced decision lifted from the task. */
export type BreakTheGlassResolvedView = {
  kind: "resolved";
  patientRef: string;
  purpose: string;
  granted: boolean;
  grantedScope: string[];
  expiresAt?: string;
  durationMinutes?: number;
  auditEventId: string;
  requiresPostAccessReview: boolean;
  reason: string;
  note: string;
  accessHasJustification: boolean;
  accessIsMinimumNecessaryTimeBoxed: boolean;
  accessLoggedForReview: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type BreakTheGlassBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type BreakTheGlassInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type BreakTheGlassView =
  | BreakTheGlassResolvedView
  | BreakTheGlassBlockedView
  | BreakTheGlassInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  accessHasJustification?: unknown;
  accessIsMinimumNecessaryTimeBoxed?: unknown;
  accessLoggedForReview?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildMasterPatientIndexRequestBody.
 */
export function buildBreakTheGlassRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: EmergencyAccessRequest;
  grant?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {};
  if (input.request !== undefined) data.request = input.request;
  if (input.grant !== undefined) data.grant = input.grant;
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
 * POST an emergency-access request (or an asserted grant) to the Break-the-Glass
 * agent and return the resulting A2A task. `fetchImpl` is injectable so tests can
 * stub the network boundary. A governance block comes back as HTTP 200 with a
 * `failed` task — only a malformed envelope / parse error is a non-OK response.
 */
export async function runBreakTheGlassTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: EmergencyAccessRequest;
    grant?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(BTG_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBreakTheGlassRequestBody(input))
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) throw new Error(payload.error.message);
  if (!payload.result) throw new Error("A2A response missing result");
  return payload.result;
}

/**
 * Lift a render-ready view out of the A2A task. Distinguishes a produced decision
 * (completed) from a governance block vs. an invalid request (both `failed`, told
 * apart by metadata.agentFabric.decision).
 */
export function breakTheGlassViewFromTask(task: A2ATask): BreakTheGlassView {
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
        "The Agent Fabric blocked this emergency-access run.";
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
        : "The emergency-access decision could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as { decision?: EmergencyAccessDecision; patientRef?: string } | undefined) ??
    undefined;
  const decision = result?.decision;

  return {
    kind: "resolved",
    patientRef: result?.patientRef ?? decision?.patientRef ?? "",
    purpose: decision?.purpose ?? "",
    granted: decision?.granted ?? false,
    grantedScope: decision?.grantedScope ?? [],
    expiresAt: decision?.expiresAt,
    durationMinutes: decision?.durationMinutes,
    auditEventId: decision?.auditEventId ?? "",
    requiresPostAccessReview: decision?.requiresPostAccessReview ?? false,
    reason: decision?.reason ?? "",
    note: decision?.note ?? "",
    accessHasJustification: fabric.accessHasJustification === true,
    accessIsMinimumNecessaryTimeBoxed: fabric.accessIsMinimumNecessaryTimeBoxed === true,
    accessLoggedForReview: fabric.accessLoggedForReview === true,
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
  | { status: "done"; view: BreakTheGlassView }
  | { status: "error"; message: string };

export function BreakTheGlassPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: BreakTheGlassPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runBreakTheGlassTask({
          taskId: newTaskId("btg"),
          personaId: "demo",
          request: preset.request,
          grant: preset.grant
        });
        setRunState({ status: "done", view: breakTheGlassViewFromTask(task) });
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
        Break-the-glass / emergency access governance
      </p>
      <h3 style={{ margin: 0 }}>
        Emergency override access — justification-required, minimum-necessary +
        time-boxed, always audited
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        The Break-the-Glass agent governs emergency override access to PHI: given
        an <strong>access request</strong> (requester role, target patient, stated
        purpose, an <strong>emergency flag</strong>, and a{" "}
        <strong>clinical justification</strong>), it{" "}
        <strong>deterministically decides</strong> whether to grant access. A grant
        is <strong>always time-boxed</strong> (an expiry derived from the request&apos;s
        own time) and <strong>minimum-necessary</strong> (a scoped field set — never
        the full chart), <strong>always emits a mandatory audit event</strong>, and
        is <strong>flagged for mandatory post-access review</strong>. It{" "}
        <strong>never grants standing / broad / full-record access</strong> and{" "}
        <strong>never grants without a recorded justification</strong>. A deny (no
        emergency, no justification, or an off-catalog purpose) is a safe, completed
        answer — not a block.{" "}
        <strong>
          The purpose catalog, scopes, durations, and audit ids are illustrative
          synthetics, not a certified break-the-glass system.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the
        trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {BREAK_THE_GLASS_PRESETS.map((preset) => (
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
          Emergency-access run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <BreakTheGlassResult view={runState.view} />}
    </section>
  );
}

function BreakTheGlassResult({ view }: { view: BreakTheGlassView }) {
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

  const decisionTone = view.granted ? "#8fd6b0" : "#9fb3c8";

  return (
    <div className="routing-live-result">
      <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>
        Emergency-access decision (deterministic, synthetic records)
        {view.patientRef ? ` · patient ${view.patientRef}` : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="Decision"
          value={view.granted ? "granted" : "denied"}
          tone={decisionTone}
        />{" "}
        {view.purpose ? <Pill label="Purpose" value={view.purpose} tone="#9fb3c8" /> : null}{" "}
        <Pill
          label="Requires post-access review"
          value={String(view.requiresPostAccessReview)}
          tone={view.requiresPostAccessReview ? "#ffd28a" : "#9fb3c8"}
        />
      </p>

      {view.granted ? (
        <>
          <p className="eyebrow" style={{ margin: "0.8rem 0 0.35rem" }}>
            Granted minimum-necessary scope
          </p>
          <p style={{ margin: 0, fontSize: "0.9rem" }}>
            <span style={{ display: "inline-flex", gap: "0.35rem", flexWrap: "wrap" }}>
              {view.grantedScope.map((f) => (
                <Pill key={f} label="field" value={f} tone="#8fd6b0" />
              ))}
            </span>
          </p>
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.86rem", color: "var(--muted)" }}>
            Time-boxed to <strong>{view.durationMinutes} minutes</strong>
            {view.expiresAt ? (
              <>
                {" "}
                (expires <code>{view.expiresAt}</code>)
              </>
            ) : null}
            . Audit event <code>{view.auditEventId}</code>.
          </p>
        </>
      ) : (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.88rem", color: "var(--muted)" }}>
          {view.reason} The attempt is still logged (audit{" "}
          <code>{view.auditEventId}</code>).
        </p>
      )}

      <div
        role="note"
        aria-label="Emergency-access integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Justification-required · minimum-necessary + time-boxed · mandatory audit +
          post-access review — never standing access{" "}
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
          accessHasJustification = {String(view.accessHasJustification)} ·
          accessIsMinimumNecessaryTimeBoxed ={" "}
          {String(view.accessIsMinimumNecessaryTimeBoxed)} · accessLoggedForReview ={" "}
          {String(view.accessLoggedForReview)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
