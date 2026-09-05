"use client";

import { useState } from "react";

import {
  type A2ARpcResponse,
  type A2ATask,
  findDataPart,
  newTaskId
} from "../lib/a2a";
import {
  type AuditLogDetermination,
  type AuditLogVerificationRequest,
  type EntryCheck,
  DEMO_AUDIT_LOG_GAP_REQUEST,
  DEMO_AUDIT_LOG_REQUEST,
  DEMO_AUDIT_LOG_TAMPERED_REQUEST
} from "../lib/audit-log-integrity";

/**
 * Audit Log Integrity (Tamper-Evidence) runner for the intake demo.
 *
 * Fires the real, server-side A2A Audit Log Integrity agent at
 * /api/agents/audit-log-integrity/tasks — the data-substrate service that verifies an audit
 * trail is tamper-evident by recomputing its hash chain and checking its sequence for gaps.
 * The panel surfaces the per-entry checks, the verified / hash-chain / sequence flags, the
 * broken-link + gap counts, the honesty signals, the synthetic labels, and a deep link into
 * the parented Agent Fabric trace.
 *
 * A determination — verified OR tampered — is a SAFE, honest OUTPUT (it completes; a tampered /
 * incomplete log carries requiresForensicReview:true). The verified-over-break, verified-with-gap,
 * and repaired presets assert offending DETERMINATIONS — so all three governance blocks are
 * demonstrable in the UI rather than hidden.
 *
 * The hash is an ILLUSTRATIVE non-cryptographic FNV-1a, NOT a certified tamper-evidence system
 * (a real control uses SHA-256 + WORM storage + signed checkpoints). Structure, styling tokens,
 * and tone mirror <MinimumNecessaryPanel> and <DeidentificationPanel> so this reads as a native
 * sibling on /demo/intake.
 */

const AUDIT_LOG_ROUTE = "/api/agents/audit-log-integrity/tasks";

/** A one-click demo scenario. */
export type AuditLogPreset = {
  id: string;
  label: string;
  hint: string;
  demonstrates: string;
  /** The audit log the agent evaluates (the common case). */
  request?: AuditLogVerificationRequest;
  /** Caller-asserted determination (used only for the three governance blocks). */
  determination?: Record<string, unknown>;
};

export const AUDIT_LOG_PRESETS: AuditLogPreset[] = [
  {
    id: "intact",
    label: "Intact 5-entry log → verified",
    hint: "A sealed hash chain with contiguous sequence numbers.",
    request: DEMO_AUDIT_LOG_REQUEST,
    demonstrates:
      "The hash chain recomputes and the sequence is complete → verified, no forensic review."
  },
  {
    id: "tampered",
    label: "Altered entry → tamper suspected",
    hint: "A sealed chain whose 3rd entry's action was changed after sealing.",
    request: DEMO_AUDIT_LOG_TAMPERED_REQUEST,
    demonstrates:
      "The altered entry's hash no longer matches → broken link, flagged for forensic review (NOT repaired)."
  },
  {
    id: "gap",
    label: "Deleted entry → sequence gap",
    hint: "A sealed chain with entry seq 4 removed.",
    request: DEMO_AUDIT_LOG_GAP_REQUEST,
    demonstrates:
      "The sequence jumps 3 → 5 → a gap plus a broken link, flagged for forensic review."
  },
  {
    id: "verified-over-break-block",
    label: "Verified over a broken chain → governance block",
    hint: "A determination claiming verified while the chain is broken.",
    request: DEMO_AUDIT_LOG_REQUEST,
    determination: {
      logRef: "audit-log-002",
      verified: true,
      hashChainIntact: false,
      sequenceComplete: true,
      repaired: false
    },
    demonstrates:
      "The Agent Fabric blocking a verified label asserted over a broken hash chain (policy.auditlog.hash-chain-verified)."
  },
  {
    id: "verified-with-gap-block",
    label: "Verified with a sequence gap → governance block",
    hint: "A determination claiming verified while the sequence has a gap.",
    request: DEMO_AUDIT_LOG_REQUEST,
    determination: {
      logRef: "audit-log-003",
      verified: true,
      hashChainIntact: true,
      sequenceComplete: false,
      repaired: false
    },
    demonstrates:
      "The Agent Fabric blocking a verified label asserted over a sequence gap (policy.auditlog.sequence-complete)."
  },
  {
    id: "repaired-block",
    label: "Log auto-repaired → governance block",
    hint: "A determination that claims it rewrote / repaired the log.",
    request: DEMO_AUDIT_LOG_REQUEST,
    determination: {
      logRef: "audit-log-001",
      verified: false,
      hashChainIntact: false,
      sequenceComplete: true,
      repaired: true
    },
    demonstrates:
      "The Agent Fabric blocking an autonomous redaction / repair of the audit trail (policy.auditlog.no-autonomous-redaction)."
  }
];

/** Render-ready view of a produced determination lifted from the task. */
export type AuditLogResolvedView = {
  kind: "resolved";
  logRef: string;
  entryCount: number;
  verified: boolean;
  hashChainIntact: boolean;
  sequenceComplete: boolean;
  brokenLinks: number;
  sequenceGaps: number;
  firstBreakSeq?: number;
  entryChecks: EntryCheck[];
  requiresForensicReview: boolean;
  reason: string;
  note: string;
  auditLogHashChainVerified: boolean;
  auditLogSequenceComplete: boolean;
  auditLogNoAutonomousRedaction: boolean;
  traceTaskId: string;
};

/** Render-ready view of a governance-blocked run. */
export type AuditLogBlockedView = {
  kind: "blocked";
  message: string;
  policiesEvaluated: string[];
  violations: { policyId: string; reason: string }[];
  traceTaskId: string;
};

/** Render-ready view of a well-formed request that could not be processed. */
export type AuditLogInvalidView = {
  kind: "invalid";
  message: string;
  traceTaskId: string;
};

export type AuditLogView =
  | AuditLogResolvedView
  | AuditLogBlockedView
  | AuditLogInvalidView;

type FabricMeta = {
  decision?: string;
  policiesEvaluated?: unknown;
  violations?: unknown;
  traceTaskId?: unknown;
  auditLogHashChainVerified?: unknown;
  auditLogSequenceComplete?: unknown;
  auditLogNoAutonomousRedaction?: unknown;
  error?: unknown;
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Build the exact JSON-RPC A2A `tasks/send` body the panel POSTs. Kept pure (no
 * fetch, no hooks) so it can be unit-tested without a DOM, mirroring
 * buildMinimumNecessaryRequestBody.
 */
export function buildAuditLogRequestBody(input: {
  taskId: string;
  personaId?: string;
  request?: AuditLogVerificationRequest;
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
 * POST an audit log (or an asserted determination) to the Audit Log Integrity agent and return
 * the resulting A2A task. `fetchImpl` is injectable so tests can stub the network boundary. A
 * governance block comes back as HTTP 200 with a `failed` task — only a malformed envelope /
 * parse error is a non-OK response.
 */
export async function runAuditLogTask(
  input: {
    taskId: string;
    personaId?: string;
    request?: AuditLogVerificationRequest;
    determination?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch
): Promise<A2ATask> {
  const res = await fetchImpl(AUDIT_LOG_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAuditLogRequestBody(input))
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
export function auditLogViewFromTask(task: A2ATask): AuditLogView {
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
        "The Agent Fabric blocked this audit-log integrity run.";
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
        : "The audit-log integrity determination could not be produced.");
    return { kind: "invalid", message, traceTaskId };
  }

  const data = findDataPart(task.artifacts?.[0]?.parts) ?? {};
  const result =
    (data.result as
      | { determination?: AuditLogDetermination; logRef?: string }
      | undefined) ?? undefined;
  const det = result?.determination;

  return {
    kind: "resolved",
    logRef: result?.logRef ?? det?.logRef ?? "",
    entryCount: det?.entryCount ?? 0,
    verified: det?.verified ?? false,
    hashChainIntact: det?.hashChainIntact ?? false,
    sequenceComplete: det?.sequenceComplete ?? false,
    brokenLinks: det?.brokenLinks ?? 0,
    sequenceGaps: det?.sequenceGaps ?? 0,
    firstBreakSeq: det?.firstBreakSeq,
    entryChecks: det?.entryChecks ?? [],
    requiresForensicReview: det?.requiresForensicReview ?? false,
    reason: det?.reason ?? "",
    note: det?.note ?? "",
    auditLogHashChainVerified: fabric.auditLogHashChainVerified === true,
    auditLogSequenceComplete: fabric.auditLogSequenceComplete === true,
    auditLogNoAutonomousRedaction: fabric.auditLogNoAutonomousRedaction === true,
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
  | { status: "done"; view: AuditLogView }
  | { status: "error"; message: string };

export function AuditLogIntegrityPanel() {
  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const busy = runState.status === "running";

  const runPreset = (preset: AuditLogPreset) => {
    setRunState({ status: "running", label: preset.label });
    void (async () => {
      try {
        const task = await runAuditLogTask({
          taskId: newTaskId("audit-log-integrity"),
          personaId: "demo",
          request: preset.request,
          determination: preset.determination
        });
        setRunState({ status: "done", view: auditLogViewFromTask(task) });
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
        Audit log integrity · tamper-evidence · data substrate
      </p>
      <h3 style={{ margin: 0 }}>
        Audit Log Integrity — verified only over an intact chain, never an autonomous redaction
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
        Every agent on the fabric writes a HIPAA audit span; this agent verifies the{" "}
        <strong>audit trail itself</strong>. Given an <strong>audit log</strong> (entries chained
        by hash, with sequence numbers), it <strong>deterministically</strong> recomputes the{" "}
        <strong>hash chain</strong> and checks the <strong>sequence</strong> for gaps, deciding
        whether the log is <strong>verified</strong>. A break is flagged for{" "}
        <strong>human forensic review</strong> — the log is <strong>never</strong> rewritten or
        repaired.{" "}
        <strong>
          The hash is an illustrative non-cryptographic FNV-1a, not a certified tamper-evidence
          system — a real control uses SHA-256, append-only / WORM storage, and signed
          checkpoints.
        </strong>{" "}
        Every run is governed by the Agent Fabric. Run a preset, then open the trace.
      </p>

      <p className="eyebrow" style={{ margin: "0.9rem 0 0.35rem" }}>
        Preset scenarios
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {AUDIT_LOG_PRESETS.map((preset) => (
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
              ? "Verifying…"
              : preset.label}
          </button>
        ))}
      </div>

      {runState.status === "error" && (
        <p role="alert" style={{ marginTop: "0.6rem", color: "#ffb6c8" }}>
          Audit-log integrity run failed: {runState.message}.
        </p>
      )}

      {runState.status === "done" && <AuditLogResult view={runState.view} />}
    </section>
  );
}

function AuditLogResult({ view }: { view: AuditLogView }) {
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
        Audit-log integrity (deterministic, synthetic)
        {view.logRef ? ` · ${view.logRef}` : ""} · {view.entryCount} entries
      </p>
      <p style={{ margin: 0, fontSize: "0.95rem" }}>
        <Pill
          label="Verified"
          value={String(view.verified)}
          tone={view.verified ? "#8fd6b0" : "#ff9db1"}
        />{" "}
        <Pill label="Broken links" value={String(view.brokenLinks)} tone="#ffb6c8" />{" "}
        <Pill label="Sequence gaps" value={String(view.sequenceGaps)} tone="#ffd28a" />{" "}
        <Pill
          label="Requires forensic review"
          value={String(view.requiresForensicReview)}
          tone={view.requiresForensicReview ? "#ffd28a" : "#8fd6b0"}
        />
      </p>

      <ul style={{ margin: "0.7rem 0 0", paddingLeft: "1.1rem", fontSize: "0.86rem" }}>
        {view.entryChecks.map((c) => {
          const ok = c.hashValid && c.linkValid && c.sequenceValid;
          return (
            <li key={c.seq} style={{ marginBottom: "0.2rem" }}>
              <strong style={{ color: "var(--fg)" }}>seq {c.seq}</strong> —{" "}
              <span style={{ color: ok ? "#8fd6b0" : "#ff9db1", fontWeight: 600 }}>
                {ok ? "ok" : "BREAK"}
              </span>
              {c.issue ? <span style={{ color: "var(--muted)" }}> · {c.issue}</span> : null}
            </li>
          );
        })}
      </ul>

      <div
        role="note"
        aria-label="Audit-log integrity"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 0.75rem",
          borderRadius: "0.55rem",
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem", color: "#ffd28a" }}>
          Verified only over an intact chain · sequence complete · never redacted{" "}
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
          auditLogHashChainVerified = {String(view.auditLogHashChainVerified)} ·
          auditLogSequenceComplete = {String(view.auditLogSequenceComplete)} ·
          auditLogNoAutonomousRedaction = {String(view.auditLogNoAutonomousRedaction)}
        </p>
      </div>

      {traceLink}
    </div>
  );
}
